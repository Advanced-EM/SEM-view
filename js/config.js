// Deployment settings for the exhibit.
//
// share: where visitors may send a recorded training session (they choose "Record and share" on the consent
// screen, or send it from the result screen). Leave url empty to keep everything local (sessions can still be
// downloaded). Point it at the session collector once it is deployed (hf/worker, a free Cloudflare Worker), e.g.
//   url: 'https://sem-view-collector.<subdomain>.workers.dev/submit'
// dataset is the Hugging Face dataset the collector commits to (and that hf/build_dataset.py builds).
export const SHARE = {
  url: 'https://sem-view-collector.tem-view.workers.dev/submit',
  dataset: 'rmsreis/sem-view-alignment',
};

// agent: the local semview-mcp server (tools/semview-mcp) an AI agent runs; the exhibit connects only when the
// visitor clicks "Connect agent". 8792 is semview-mcp's default (temview-mcp uses 8790, so both can run), 8793 the
// fallback when it is taken.
export const AGENT = { urls: ['ws://127.0.0.1:8792', 'ws://127.0.0.1:8793'] };

// the top-left buttons: "Buy me a coffee" (hidden while empty) and "Subscribe for news", which posts to the
// TEM-view collector's mailing list (one list for both exhibits; addresses stay private in its Cloudflare KV)
export const SUPPORT = {
  coffee: 'https://buymeacoffee.com/rmsreis',
  subscribe: 'https://tem-view-collector.tem-view.workers.dev/subscribe',
};

// the sister exhibit, and the physical Console that drives both (same USB protocol)
export const LINKS = {
  tem: 'https://advanced-em.github.io/TEM-view/',
  console: 'https://advanced-em.github.io/TEM-view/console/',
  repo: 'https://github.com/Advanced-EM/SEM-view',
};
