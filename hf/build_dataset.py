#!/usr/bin/env python3
"""Build the SEM-view behavior dataset from session files and (optionally) push it to the Hugging Face Hub.

    # local: validate and tabulate sessions you collected by hand
    python3 hf/build_dataset.py pilot/*.json --out build/sem-view-alignment

    # push to a private dataset repo (log in first: `hf auth login`, with a write token)
    python3 hf/build_dataset.py pilot/*.json --out build/sem-view-alignment --push rmsreis/sem-view-alignment

    # rebuild from what the collection Space has stored in the repo (raw/), then push the tables
    python3 hf/build_dataset.py --from-hub rmsreis/sem-view-alignment --out build/sem-view-alignment --push rmsreis/sem-view-alignment

Layout of the dataset repo:
    raw/<scenario>/<session id>.json   each validated session (the source of truth; the Space writes here)
    data/sessions.jsonl                one row per session: who (experience), what, outcome, judgment vs truth
    data/steps.jsonl                   one row per 0.5 s snapshot: state, true metrics, actions until the next snapshot
    README.md                          dataset card

Sessions that fail validation (no consent, wrong format, malformed) are reported and left out; duplicates (same
session id) are kept once. Needs huggingface_hub only for --push / --from-hub.
"""
import argparse
import glob
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "space"))
from schema import Invalid, MAX_BYTES, clean, rows  # noqa: E402


def gather(paths):
    files = []
    for p in paths:
        files += sorted(glob.glob(os.path.join(p, "**", "*.json"), recursive=True)) if os.path.isdir(p) else [p]
    return files


def card(repo, sess_rows, n_steps, rejected):
    by_s = Counter(r["scenario"] for r in sess_rows)
    by_e = Counter(r["experience"] for r in sess_rows)
    ok = sum(bool(r["success"]) for r in sess_rows)
    return f"""---
license: other
pretty_name: SEM-view alignment behavior
language: [en]
tags: [electron-microscopy, sem, scanning-electron-microscopy, ebsd, alignment, human-behavior, digital-twin, imitation-learning]
size_categories: [n<1K]
configs:
- config_name: sessions
  data_files: data/sessions.jsonl
  default: true
- config_name: steps
  data_files: data/steps.jsonl
---

# SEM-view alignment behavior

How people align a (simulated) scanning electron microscope, and how well they judge the result.
Recorded with the [Scanning with Electrons](https://advanced-em.github.io/SEM-view/) exhibit's training
scenarios: each task hides a seeded misalignment (focus, astigmatism, an off-axis aperture, an insulator's E2) or asks for a
set-up (EBSD); the user only
sees the image, while the simulator logs the true alignment quality at every moment.

**{len(sess_rows)} sessions**, {n_steps} steps · scenarios: {", ".join(f"{k} ({v})" for k, v in by_s.most_common()) or "-"}
· experience: {", ".join(f"{k} ({v})" for k, v in by_e.most_common()) or "-"} · aligned at the end: {ok}/{len(sess_rows)}
· built {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}{f" · {rejected} files rejected by validation" if rejected else ""}

## Configs

```python
from datasets import load_dataset
sessions = load_dataset("{repo}", "sessions", split="train")
steps = load_dataset("{repo}", "steps", split="train")
```

**sessions**: `session_id`, `scenario`, `seed`, `experience` (novice / student / trained / expert, self-reported),
`app_version`, `started_hour`, `inputs` (mouse, keyboard, panel, …), `duration_s`, `outcome` (done / gave_up /
abandoned), `final_score` (0–100, true), `success`, `time_to_success_s`, `n_changes`, `n_acquire`, `n_blocked`,
`rating` (the user's own 1–5 judgment before the reveal), `cues` (what they say they looked at), `note`,
`final_metrics`, `hidden` (the seeded misalignment), `target` (JSON text).

**steps** (one per 0.5 s snapshot): `session_id`, `scenario`, `experience`, `step`, `t`, `state` (JSON: every
setting the user could see), `metrics` (JSON: true quality, e.g. blur against the probe size, residual
astigmatism, aperture offset, indexing rate), `score`, `actions` (setting changes until the next step: key, from, to, input source),
`events` (acquire, judge, blocked buttons, …), `next_score`, `final_score`, `success`.

Uses: imitation learning of alignment strategies (state → action), reward and judgment models (does the image the
user sees predict the true quality? where do people over- or under-trust it?), expert-vs-novice comparison, and
priors for assisted alignment on real instruments through the digital twin.

## Collection and consent

Recording is opt-in per session, after an on-screen explanation. No names, emails, IP addresses or images of
people are stored: a random session id, a self-reported experience level, coarse screen size, the start time to
the hour, and the exhibit state. Free-text notes are limited to 140 characters. Raw files are in `raw/`; the
tables are rebuilt from them with `hf/build_dataset.py` in the SEM-view repository. To remove a session, open
an issue with its session id.

The scenarios run in a physics simulator, not a real microscope; transfer to real instruments is a research
question, not a given.
"""


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("inputs", nargs="*", help="session .json files or folders")
    p.add_argument("--from-hub", metavar="REPO", help="also read raw/ from this dataset repo")
    p.add_argument("--out", default="build/sem-view-alignment")
    p.add_argument("--push", metavar="REPO", help="upload to this dataset repo (created private if missing)")
    p.add_argument("--public", action="store_true", help="create the repo public (default: private)")
    p.add_argument("--init", action="store_true", help="allow an empty dataset (creates the repo and its card)")
    p.add_argument("--drop-notes", action="store_true", help="remove free-text notes")
    a = p.parse_args(argv)

    files = gather(a.inputs)
    if a.from_hub:
        from huggingface_hub import snapshot_download
        d = snapshot_download(a.from_hub, repo_type="dataset", allow_patterns=["raw/**"])
        files += gather([os.path.join(d, "raw")])
    if not files and not a.init:
        p.error("no session files (use --init to create an empty dataset)")

    seen, sess_rows, step_rows, rejected = {}, [], [], 0
    for f in files:
        try:
            if os.path.getsize(f) > MAX_BYTES:
                raise Invalid("file too large")
            with open(f) as fh:
                s = clean(json.load(fh), drop_notes=a.drop_notes)
        except (Invalid, json.JSONDecodeError, OSError) as e:
            rejected += 1
            print(f"  rejected {f}: {e}")
            continue
        sid = s["session"]["id"]
        if sid in seen:
            continue
        seen[sid] = s
        r, st = rows(s)
        sess_rows.append(r)
        step_rows += st

    os.makedirs(os.path.join(a.out, "data"), exist_ok=True)
    for sid, s in seen.items():
        d = os.path.join(a.out, "raw", (s.get("scenario") or {}).get("id", "free"))
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{sid}.json"), "w") as fh:
            json.dump(s, fh, separators=(",", ":"))
    for name, data in (("sessions", sess_rows), ("steps", step_rows)):
        with open(os.path.join(a.out, "data", f"{name}.jsonl"), "w") as fh:
            for r in data:
                fh.write(json.dumps(r) + "\n")
    repo = a.push or a.from_hub or "<user>/sem-view-alignment"
    with open(os.path.join(a.out, "README.md"), "w") as fh:
        fh.write(card(repo, sess_rows, len(step_rows), rejected))
    print(f"{len(sess_rows)} sessions, {len(step_rows)} steps ({rejected} rejected) -> {a.out}")

    if a.push:
        from huggingface_hub import HfApi
        api = HfApi()
        api.create_repo(a.push, repo_type="dataset", private=not a.public, exist_ok=True)
        api.upload_folder(repo_id=a.push, repo_type="dataset", folder_path=a.out,
                          commit_message=f"Rebuild: {len(sess_rows)} sessions, {len(step_rows)} steps")
        print(f"pushed to https://huggingface.co/datasets/{a.push}")


if __name__ == "__main__":
    sys.exit(main())
