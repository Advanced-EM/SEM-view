---
title: SEM-view session collector
emoji: 🔬
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: other
short_description: Receives opt-in SEM-view training sessions for a dataset
---

# SEM-view session collector

Receives training sessions that visitors of [Scanning with Electrons](https://advanced-em.github.io/SEM-view/)
chose to share, validates them, and commits them to a dataset repo (`raw/<scenario>/<id>.json`) every 5 minutes.

- `POST /submit`: one session (`sem-view-telemetry/1` JSON). Returns its id.
- `GET /`: status and counts.

Settings: secret `HF_TOKEN` (write access to the dataset), variables `DATASET_REPO` and `ALLOWED_ORIGINS`.
Without them it runs as a dry run and keeps nothing on the Hub. No IP addresses are stored.
Source: `hf/space/` in the [SEM-view repository](https://github.com/Advanced-EM/SEM-view).
