# SEM-view → Hugging Face

How training sessions from the exhibit become the Hugging Face dataset **`rmsreis/sem-view-alignment`**, the SEM
counterpart of TEM-view's `rmsreis/tem-view-alignment`.

```
exhibit (browser)                          Hugging Face
  training task, opt-in recording
  ├─ Download session file ──► you ──► hf/build_dataset.py --push ──┐
  └─ Record and share ──► collector: hf/worker (validates) ──► raw/ ─┤  dataset repo (private)
                                                                    └─ data/sessions.jsonl, data/steps.jsonl, README.md
```

The browser never holds a Hugging Face token. Every path uses the same validator
([`space/schema.py`](space/schema.py), mirrored in [`worker/src/schema.js`](worker/src/schema.js)). It keeps only
known fields, requires recorded consent, cuts free text to 140 characters, rounds the start time to the hour and the
screen size to 100 px, and stores no IP addresses.

Sessions are `sem-view-telemetry/1` JSON: every setting change with its input source (mouse, keyboard, on-screen
panel, Console, voice, agent), snapshots every 0.5 s with the hidden true metrics (blur against the probe, residual
astigmatism, aperture offset, E2, indexing rate), acquisitions, the visitor's rating and cues. A sample is in
[`tools/analysis/sample/`](../tools/analysis/sample/).

## 1. Create the dataset and push sessions collected by hand

```bash
pip install huggingface_hub datasets
hf auth login                      # a token with write access
python3 hf/build_dataset.py sessions/*.json --out build/sem-view-alignment --push rmsreis/sem-view-alignment
```

This creates the dataset **private** (pass `--public` to change that, or flip it on the Hub). Run the same command
whenever new files arrive; duplicate sessions are kept once and invalid files are listed and skipped.

## 2. Live collection (Cloudflare Worker, free)

[`worker/`](worker/README.md) receives the sessions visitors chose to share and commits each one to the dataset as
`raw/<scenario>/<id>.json`. Deploy it once (`npx wrangler secret put HF_TOKEN` with a fine-grained token that can write
**this dataset only**, then `npx wrangler deploy`), then put its address in [`js/config.js`](../js/config.js):

```js
export const SHARE = { url: 'https://sem-view-collector.<subdomain>.workers.dev/submit', dataset: 'rmsreis/sem-view-alignment' };
```

and run `node tools/stamp.mjs` before deploying the exhibit. From then on the consent screen of every task offers
**Record and share**, **Record only** and **Start without recording**. With *Record and share* the session is sent when
the task ends (or the page closes); with *Record only* the result screen still offers to send it after a consent tick.
The visitor gets the session id, which they can quote to have the session removed.

The Docker Space in [`space/`](space/) is an alternative collector (it needs a paid Hugging Face plan); deploy it with
`python3 hf/deploy_space.py`.

Rebuild the tables from what the collector stored:

```bash
python3 hf/build_dataset.py --from-hub rmsreis/sem-view-alignment --out build/sem-view-alignment --push rmsreis/sem-view-alignment
```

## 3. Training

```python
from datasets import load_dataset
steps = load_dataset("rmsreis/sem-view-alignment", "steps", split="train")      # state, true metrics, actions
sessions = load_dataset("rmsreis/sem-view-alignment", "sessions", split="train")  # outcome, rating vs truth
```

`state`, `metrics` and the action values are JSON text, so every column keeps one type across tasks; decode them with
`json.loads`. Scripted policies can be scored against the same hidden misalignments with the `semview` package's
challenges (`sem.challenge("sem-focus-stig", seed)`), so a model trained on people can be tested on the twin.

## Tests

```bash
node hf/worker/test.mjs                                       # validation, CORS, dry run, Hub commit (mocked)
python3 hf/build_dataset.py tools/analysis/sample/*.json --out build/test
```
