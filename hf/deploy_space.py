#!/usr/bin/env python3
"""Deploy (or update) the SEM-view session collector Space. Docker Spaces need a paid plan (HF PRO or an org
plan); the free alternative is the Cloudflare Worker in hf/worker.

    ~/anaconda3/bin/python3 hf/deploy_space.py                       # rmsreis/sem-view-collector -> rmsreis/sem-view-alignment
    ~/anaconda3/bin/python3 hf/deploy_space.py --space ORG/NAME --dataset ORG/NAME

Uses your `hf auth login`. Creates a public Docker Space (it must be public so browsers can reach it; it holds no
data), sets DATASET_REPO and ALLOWED_ORIGINS, uploads hf/space, and asks for the Space's write token:
create a fine-grained token at https://huggingface.co/settings/tokens with write access to the dataset only.
The token is typed at a hidden prompt and goes straight into the Space's secrets.
"""
import argparse
import getpass
import os

from huggingface_hub import HfApi

p = argparse.ArgumentParser()
p.add_argument("--space", default="rmsreis/sem-view-collector")
p.add_argument("--dataset", default="rmsreis/sem-view-alignment")
p.add_argument("--origins", default="https://advanced-em.github.io,http://localhost:8768")
p.add_argument("--skip-token", action="store_true", help="keep the HF_TOKEN secret already set")
a = p.parse_args()

api = HfApi()
api.create_repo(a.space, repo_type="space", space_sdk="docker", private=False, exist_ok=True)
api.add_space_variable(a.space, "DATASET_REPO", a.dataset)
api.add_space_variable(a.space, "ALLOWED_ORIGINS", a.origins)
if not a.skip_token:
    tok = getpass.getpass(f"Fine-grained token with write access to {a.dataset} (hidden): ").strip()
    if tok:
        api.add_space_secret(a.space, "HF_TOKEN", tok)
here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "space")
api.upload_folder(repo_id=a.space, repo_type="space", folder_path=here, ignore_patterns=["__pycache__/*", "data/*"],
                  commit_message="Deploy the SEM-view session collector")
host = a.space.replace("/", "-").replace("_", "-").lower()
print(f"Deployed https://huggingface.co/spaces/{a.space}")
print(f"Status (after the build, ~2 min): https://{host}.hf.space/   should say \"dry_run\": false")
print(f"Exhibit setting (js/config.js): url: 'https://{host}.hf.space/submit', dataset: '{a.dataset}'")
