# SEM-view session collector: Cloudflare Worker

A free, always-on alternative to the Docker Space (`../space`), which needs a paid Hugging Face plan. It
receives the sessions visitors chose to share. It then:
- validates them with the same rules as `../space/schema.py`
- commits each one to the dataset as `raw/<scenario>/<session id>.json` through the Hub commit API

The Hugging Face token is a Cloudflare secret and never reaches the browser.

## Deploy (once)

```bash
cd hf/worker
npm install
npx wrangler login
npx wrangler secret put HF_TOKEN
npx wrangler deploy
```

- `npx wrangler login` opens the browser for a free Cloudflare account.
- At the `secret put` prompt, paste a fine-grained token with write access to the dataset only.
- `deploy` prints the URL, e.g. `https://sem-view-collector.<your-subdomain>.workers.dev`.

Open that URL. It should show `"dry_run": false`. Then set `url: '<that URL>/submit'` in `js/config.js`, run
`node tools/stamp.mjs`, and deploy the exhibit.

`wrangler.toml` holds `DATASET_REPO` and `ALLOWED_ORIGINS` (the exhibit's site and localhost for testing). It
also holds a rate limit of 10 sessions per minute per visitor, keyed on a daily salted hash, and nothing is
stored. The free plan allows 100,000 requests per day.

## Test

```bash
node test.mjs
```

This runs offline, with the Hub mocked. `npx wrangler dev` runs the Worker locally on port 8787.
