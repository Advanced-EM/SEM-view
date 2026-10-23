"""SEM-view session collector: a Hugging Face Space that receives training sessions from the exhibit and stores
them in a dataset repo.

The browser never holds a Hugging Face token. It POSTs a session the visitor chose to share; this server validates
it (schema.py), writes it to raw/<scenario>/<id>.json, and a CommitScheduler pushes new files to the dataset
every few minutes with the Space's own token.

Space secrets / variables:
    HF_TOKEN         write token for the dataset (secret)
    DATASET_REPO     e.g. rmsreis/sem-view-alignment
    ALLOWED_ORIGINS  comma-separated, default https://advanced-em.github.io
Without HF_TOKEN or DATASET_REPO it runs in dry-run mode: sessions are validated and kept locally only.

No IP addresses are stored: the rate limiter keeps a salted hash in memory for an hour.
"""
import hashlib
import json
import os
import secrets
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from schema import MAX_BYTES, Invalid, clean

REPO = os.environ.get("DATASET_REPO", "")
TOKEN = os.environ.get("HF_TOKEN", "")
ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "https://advanced-em.github.io").split(",") if o.strip()]
DATA = Path(os.environ.get("DATA_DIR", "data"))
RATE = int(os.environ.get("RATE_PER_HOUR", "30"))
DRY = not (REPO and TOKEN)

(DATA / "raw").mkdir(parents=True, exist_ok=True)
scheduler = None
if not DRY:
    from huggingface_hub import CommitScheduler
    scheduler = CommitScheduler(repo_id=REPO, repo_type="dataset", folder_path=DATA / "raw", path_in_repo="raw",
                                every=5, token=TOKEN, private=True, squash_history=False)

app = FastAPI(title="SEM-view session collector")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["POST", "GET"], allow_headers=["content-type"])

SALT = secrets.token_bytes(16)  # new on every restart: the hashes cannot be linked across restarts
hits = defaultdict(deque)
stats = {"accepted": 0, "rejected": 0, "duplicate": 0, "started": time.time()}


def limited(req: Request) -> bool:
    ip = (req.headers.get("x-forwarded-for", "").split(",")[0].strip() or (req.client.host if req.client else "?"))
    h = hashlib.sha256(SALT + ip.encode()).hexdigest()[:16]
    q, now = hits[h], time.time()
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= RATE:
        return True
    q.append(now)
    return False


@app.get("/")
def health():
    return {"service": "sem-view session collector", "dataset": REPO or None, "dry_run": DRY, **stats}


@app.post("/submit")
async def submit(req: Request):
    if limited(req):
        raise HTTPException(429, "too many submissions, try again later")
    body = await req.body()
    if len(body) > MAX_BYTES:
        raise HTTPException(413, "session too large")
    try:
        s = clean(json.loads(body))
    except (Invalid, json.JSONDecodeError, UnicodeDecodeError, TypeError, AttributeError) as e:
        stats["rejected"] += 1
        raise HTTPException(422, f"invalid session: {e}")
    sid, scen = s["session"]["id"], (s.get("scenario") or {}).get("id", "free")
    path = DATA / "raw" / scen / f"{sid}.json"
    if path.exists():
        stats["duplicate"] += 1
        return {"ok": True, "id": sid, "duplicate": True}
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(s, separators=(",", ":"))
    if scheduler:
        with scheduler.lock:
            path.write_text(text)
    else:
        path.write_text(text)
    stats["accepted"] += 1
    return {"ok": True, "id": sid, "dataset": REPO or None, "dry_run": DRY}
