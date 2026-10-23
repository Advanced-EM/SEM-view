#!/usr/bin/env python3
"""Starter analysis for SEM-view telemetry sessions ("sem-view-telemetry/1").

Usage:
    python3 tools/analysis/sessions.py SESSION.json [MORE.json ...] [--plot out.png] [--csv out.csv]

For each session it prints a summary (duration, outcome, true score, changes per setting and input,
the order in which settings were touched, time to first success, and the user's judgment against the
hidden truth). With several sessions it adds a table to compare people. --plot draws the true score
against time with a tick for every change; --csv writes one row per session.

Needs only the standard library; --plot needs matplotlib.
"""
import argparse
import csv
import json
import sys
from collections import Counter

FORMAT = "sem-view-telemetry/1"


def load(path):
    with open(path) as f:
        s = json.load(f)
    if s.get("format") != FORMAT:
        raise ValueError(f"{path}: not a {FORMAT} session (format={s.get('format')!r})")
    return s


def metrics_series(s):
    """(t, metrics) for every event that carries hidden metrics."""
    return [(e["t"], e["m"]) for e in s["events"] if e.get("m")]


def phases(changes):
    """Collapse the change stream into runs of the same setting group: e.g. stigmate -> focus -> stigmate."""
    group = lambda k: ("seg" if k.startswith("seg.") else "stig" if k in ("stigX", "stigY") else "aperture" if k in ("apX", "apY") else k)  # X/Y knobs as one control
    out = []
    for e in changes:
        g = group(e["key"])
        if not out or out[-1][0] != g:
            out.append([g, e["t"], e["t"], 0])
        out[-1][2] = e["t"]
        out[-1][3] += 1
    return out


def summarize(s):
    ev = s["events"]
    changes = [e for e in ev if e["k"] == "change"]
    series = metrics_series(s)
    end = next((e for e in reversed(ev) if e["k"] == "end"), None)
    judge = next((e for e in reversed(ev) if e["k"] == "judge"), None)
    first_ok = next((t for t, m in series if m.get("success")), None)
    final = (end or {}).get("m") or (series[-1][1] if series else {})
    return {
        "id": s["session"]["id"],
        "scenario": (s.get("scenario") or {}).get("id", "free"),
        "experience": s["session"].get("experience"),
        "inputs": ",".join(s["session"].get("inputs", [])),
        "duration_s": ev[-1]["t"] if ev else 0,
        "outcome": (end or {}).get("outcome"),
        "final_score": final.get("score"),
        "success": final.get("success"),
        "time_to_success_s": first_ok,
        "n_changes": len(changes),
        "n_acquire": sum(e["k"] == "acquire" for e in ev),
        "n_blocked": sum(e["k"] == "blocked" for e in ev),
        "rating": (judge or {}).get("rating"),
        "cues": "; ".join((judge or {}).get("cues", [])),
        # calibration of judgment: rating 1-5 mapped to 0-100 against the true score
        "judgment_gap": None if not judge or final.get("score") is None else round((judge["rating"] - 1) * 25 - final["score"], 1),
        "_changes": changes,
        "_series": series,
        "_final": final,
    }


def report(r):
    t_ok = "-" if r["time_to_success_s"] is None else f"{r['time_to_success_s']:.1f} s"
    print(f"\n== {r['id']}  [{r['scenario']}]  experience: {r['experience']}  inputs: {r['inputs'] or '-'}")
    print(f"   {r['duration_s']:.1f} s, outcome {r['outcome']}, true score {r['final_score']} "
          f"({'success' if r['success'] else 'not aligned'}), first success at "
          f"{t_ok}")
    by_key = Counter(e["key"] for e in r["_changes"])
    by_src = Counter(e["src"] for e in r["_changes"])
    print("   changes by setting:", ", ".join(f"{k} {n}" for k, n in by_key.most_common()) or "-")
    print("   changes by input:  ", ", ".join(f"{k} {n}" for k, n in by_src.most_common()) or "-")
    print("   sequence:          ", " -> ".join(f"{g} ({n}, {t0:.1f}-{t1:.1f} s)" for g, t0, t1, n in phases(r["_changes"])) or "-")
    if r["rating"] is not None:
        print(f"   judgment: rated {r['rating']}/5 (cues: {r['cues'] or '-'}); gap to truth {r['judgment_gap']:+} points")
    extra = {k: v for k, v in r["_final"].items() if k not in ("score", "success")}
    if extra:
        print("   final hidden metrics:", ", ".join(f"{k}={v}" for k, v in extra.items()))


def plot(rows, out):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(9, 4.5))
    for r in rows:
        t = [p[0] for p in r["_series"]]
        y = [p[1].get("score", 0) for p in r["_series"]]
        line, = ax.step(t, y, where="post", label=f"{r['scenario']} · {r['experience']} · {r['id'][:8]}")
        for e in r["_changes"]:
            ax.axvline(e["t"], ymin=0, ymax=0.04, color=line.get_color(), lw=0.8)
    ax.set_xlabel("time (s)")
    ax.set_ylabel("true score (hidden)")
    ax.set_ylim(-2, 102)
    ax.legend(fontsize=8)
    ax.set_title("Alignment progress (ticks: setting changes)")
    fig.tight_layout()
    fig.savefig(out, dpi=150)
    print(f"\nplot written to {out}")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("sessions", nargs="+")
    p.add_argument("--plot")
    p.add_argument("--csv")
    a = p.parse_args(argv)
    rows = [summarize(load(f)) for f in a.sessions]
    for r in rows:
        report(r)
    cols = [k for k in rows[0] if not k.startswith("_")]
    if len(rows) > 1:
        print("\n" + " | ".join(["scenario", "exp", "dur", "score", "t_ok", "changes", "rating", "gap"]))
        for r in rows:
            print(" | ".join(str(x) for x in [r["scenario"], r["experience"], r["duration_s"], r["final_score"],
                                               r["time_to_success_s"], r["n_changes"], r["rating"], r["judgment_gap"]]))
    if a.csv:
        with open(a.csv, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
        print(f"csv written to {a.csv}")
    if a.plot:
        plot(rows, a.plot)


if __name__ == "__main__":
    sys.exit(main())
