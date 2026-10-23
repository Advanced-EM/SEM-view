"""Validation and flattening of SEM-view sessions ("sem-view-telemetry/1").

Shared by the collection Space (app.py) and the dataset builder (hf/build_dataset.py), so a session is checked
the same way wherever it enters the dataset.

clean(session) -> a sanitized copy, or raises Invalid: only known fields are kept, numbers must be finite,
    free text is cut short, timestamps are coarsened to the hour, consent must be true.
rows(session) -> (session_row, step_rows): one summary row per session and one row per state snapshot,
    with the actions taken since the previous snapshot. These are the training tables.
"""
import json
import math
import re

FORMAT = "sem-view-telemetry/1"
MAX_BYTES = 5_000_000
MAX_EVENTS = 60_000
EXPERIENCE = {"novice", "student", "trained", "expert"}
SOURCES = {"mouse", "touch", "keyboard", "panel", "controller", "onscreen-panel", "voice", "agent", "scenario", "unknown"}
OUTCOMES = {"done", "gave_up", "abandoned"}
KINDS = {"change", "snap", "mode", "button", "blocked", "acquire", "judge", "judge_cancel", "end", "voice"}
ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
KEY_RE = re.compile(r"^[A-Za-z0-9_.]{1,32}$")
SCENARIO_RE = re.compile(r"^[a-z0-9-]{1,40}$")


class Invalid(ValueError):
    pass


def _num(v, name):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise Invalid(f"{name}: not a finite number")
    return v


def _scalar(v, name):
    """A setting value: number, bool, short string or null."""
    if v is None or isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return _num(v, name)
    if isinstance(v, str) and len(v) <= 40:
        return v
    raise Invalid(f"{name}: unexpected value")


def _flat(d, name, max_keys=80):
    """A flat {key: scalar} dict (state snapshots, hidden metrics)."""
    if d is None:
        return None
    if not isinstance(d, dict) or len(d) > max_keys:
        raise Invalid(f"{name}: expected a small object")
    out = {}
    for k, v in d.items():
        if not KEY_RE.match(str(k)):
            raise Invalid(f"{name}: bad key {k!r}")
        out[k] = _scalar(v, f"{name}.{k}")
    return out


def _json_small(d, name, limit=4000):
    """Scenario hidden truth / target: kept as given, if small and JSON-only."""
    s = json.dumps(d, allow_nan=False)
    if len(s) > limit:
        raise Invalid(f"{name}: too large")
    return json.loads(s)


def clean(s, drop_notes=False):
    if not isinstance(s, dict) or s.get("format") != FORMAT:
        raise Invalid(f"not a {FORMAT} session")
    se = s.get("session") or {}
    if se.get("consent") is not True:
        raise Invalid("no recorded consent")
    if not ID_RE.match(str(se.get("id", ""))):
        raise Invalid("bad session id")
    exp = se.get("experience")
    if exp not in EXPERIENCE:
        raise Invalid("bad experience level")
    started = str(se.get("started", ""))
    if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}", started):
        raise Invalid("bad start time")
    screen = se.get("screen") or [0, 0]
    out = {
        "format": FORMAT,
        "app": {"name": str((s.get("app") or {}).get("name", ""))[:60], "version": str((s.get("app") or {}).get("version", ""))[:20]},
        "session": {
            "id": se["id"],
            "started": started[:13] + ":00:00Z",  # to the hour
            "experience": exp,
            "consent": True,
            "screen": [int(round(_num(x, "screen") / 100) * 100) for x in screen[:2]],  # coarse
            "inputs": [x for x in se.get("inputs", []) if x in SOURCES],
        },
        "scenario": None,
        "events": [],
    }
    sc = s.get("scenario")
    if sc is not None:
        if not SCENARIO_RE.match(str(sc.get("id", ""))):
            raise Invalid("bad scenario id")
        out["scenario"] = {"id": sc["id"], "seed": int(_num(sc.get("seed", 0), "seed")),
                           "hidden": _json_small(sc.get("hidden"), "hidden"), "target": _json_small(sc.get("target"), "target")}
    ev = s.get("events")
    if not isinstance(ev, list) or not ev or len(ev) > MAX_EVENTS:
        raise Invalid("events missing or too many")
    last_t = -1.0
    for i, e in enumerate(ev):
        k = e.get("k")
        if k not in KINDS:
            raise Invalid(f"event {i}: unknown kind {k!r}")
        t = _num(e.get("t"), f"event {i}.t")
        if t < last_t - 0.01 or t > 86_400:
            raise Invalid(f"event {i}: time out of order")
        last_t = t
        o = {"t": round(t, 3), "k": k}
        if k == "change":
            if not KEY_RE.match(str(e.get("key", ""))):
                raise Invalid(f"event {i}: bad key")
            o.update(key=e["key"], **{"from": _scalar(e.get("from"), "from")}, to=_scalar(e.get("to"), "to"),
                     src=e.get("src") if e.get("src") in SOURCES else "unknown")
        elif k == "snap":
            o["state"] = _flat(e.get("state"), f"event {i}.state")
        elif k == "mode":
            o.update(**{"from": _scalar(e.get("from"), "from")}, to=_scalar(e.get("to"), "to"))
        elif k in ("button", "blocked"):
            o["id"] = str(e.get("id", ""))[:40]
        elif k == "judge":
            r = e.get("rating")
            o["rating"] = int(_num(r, "rating")) if r is not None else None
            if o["rating"] is not None and not 1 <= o["rating"] <= 5:
                raise Invalid("rating out of range")
            o["cues"] = [str(c)[:60] for c in (e.get("cues") or [])][:12]
            o["note"] = "" if drop_notes else str(e.get("note") or "")[:140]
        elif k == "voice":
            o["intent"] = str(e.get("intent", ""))[:120]
            o["ok"] = bool(e.get("ok"))
        elif k == "end":
            o["outcome"] = e.get("outcome") if e.get("outcome") in OUTCOMES else "abandoned"
        if e.get("m") is not None:
            o["m"] = _flat(e["m"], f"event {i}.m", 40)
        out["events"].append(o)
    return out


def _js(v):
    """Setting values mix numbers, strings and booleans: keep them as JSON text so every column has one type."""
    return json.dumps(v)


def rows(s):
    """Training tables for one cleaned session."""
    ev, se, sc = s["events"], s["session"], s.get("scenario") or {}
    sid, scen = se["id"], sc.get("id", "free")
    series = [(e["t"], e["m"]) for e in ev if e.get("m")]
    end = next((e for e in reversed(ev) if e["k"] == "end"), None)
    judge = next((e for e in reversed(ev) if e["k"] == "judge"), None)
    final = (end or {}).get("m") or (series[-1][1] if series else {}) or {}
    changes = [e for e in ev if e["k"] == "change"]
    session_row = {
        "session_id": sid, "scenario": scen, "seed": sc.get("seed"), "experience": se["experience"],
        "app_version": s["app"]["version"], "started_hour": se["started"], "inputs": se["inputs"],
        "duration_s": ev[-1]["t"], "outcome": (end or {}).get("outcome"),
        "final_score": final.get("score"), "success": final.get("success"),
        "time_to_success_s": next((t for t, m in series if m.get("success")), None),
        "n_changes": len(changes), "n_acquire": sum(e["k"] == "acquire" for e in ev), "n_blocked": sum(e["k"] == "blocked" for e in ev),
        "rating": (judge or {}).get("rating"), "cues": (judge or {}).get("cues", []), "note": (judge or {}).get("note", ""),
        "final_metrics": json.dumps(final), "hidden": json.dumps(sc.get("hidden")), "target": json.dumps(sc.get("target")),
    }
    # one step per snapshot: the state the user saw, the true quality, and what they did until the next snapshot
    steps, snaps = [], [i for i, e in enumerate(ev) if e["k"] == "snap"]
    for n, i in enumerate(snaps):
        j = snaps[n + 1] if n + 1 < len(snaps) else len(ev)
        between = ev[i + 1:j]
        steps.append({
            "session_id": sid, "scenario": scen, "experience": se["experience"], "step": n, "t": ev[i]["t"],
            "state": json.dumps(ev[i]["state"]), "metrics": json.dumps(ev[i].get("m")),
            "score": (ev[i].get("m") or {}).get("score"),
            "actions": [{"t": e["t"], "key": e["key"], "from": _js(e["from"]), "to": _js(e["to"]), "src": e["src"]} for e in between if e["k"] == "change"],
            "events": [f'{e["k"]}:{e["id"]}' if e["k"] in ("button", "blocked") else f'voice:{e["intent"]}' if e["k"] == "voice" else e["k"] for e in between if e["k"] not in ("change", "snap")],
            "next_score": (ev[j].get("m") or {}).get("score") if j < len(ev) else final.get("score"),
            "final_score": final.get("score"), "success": final.get("success"),
        })
    return session_row, steps
