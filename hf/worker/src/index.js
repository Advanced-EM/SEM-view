// SEM-view session collector as a Cloudflare Worker (free tier): receives training sessions that visitors chose to
// share, validates them (schema.js, same rules as hf/space/schema.py), and commits each one to the Hugging Face
// dataset as raw/<scenario>/<session id>.json through the Hub's commit API.
//
// Settings (wrangler.toml [vars] and `wrangler secret put HF_TOKEN`):
//   HF_TOKEN         fine-grained token with write access to the dataset only (secret)
//   DATASET_REPO     e.g. rmsreis/sem-view-alignment
//   ALLOWED_ORIGINS  comma-separated origins allowed to send
// Without HF_TOKEN it runs as a dry run: sessions are validated and acknowledged, nothing is stored.
// No IP addresses are stored; the optional rate limiter keys on a salted hash and keeps nothing.
import { clean, Invalid, MAX_BYTES } from './schema.js';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function cors(req, env) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? 'https://advanced-em.github.io').split(',').map((s) => s.trim());
  return allowed.includes(origin) ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, GET', 'access-control-allow-headers': 'content-type', vary: 'origin' } : {};
}

async function hashIp(req) {
  const ip = req.headers.get('cf-connecting-ip') ?? '?';
  const day = new Date().toISOString().slice(0, 10); // the key changes daily and is never stored
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sem-view:${day}:${ip}`));
  return [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const b64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// one commit per session: header line + file line (NDJSON), https://huggingface.co/docs/hub/api
async function commit(env, path, text, summary) {
  const body = [
    JSON.stringify({ key: 'header', value: { summary, description: '' } }),
    JSON.stringify({ key: 'file', value: { path, content: b64(text), encoding: 'base64' } }),
  ].join('\n');
  const r = await fetch(`https://huggingface.co/api/datasets/${env.DATASET_REPO}/commit/main`, {
    method: 'POST', headers: { authorization: `Bearer ${env.HF_TOKEN}`, 'content-type': 'application/x-ndjson' }, body,
  });
  if (!r.ok) throw new Error(`hub ${r.status}`);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), h = cors(req, env);
    const dry = !(env.HF_TOKEN && env.DATASET_REPO);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method === 'GET' && url.pathname === '/') return json({ service: 'sem-view session collector', dataset: env.DATASET_REPO || null, dry_run: dry }, 200, h);
    if (req.method !== 'POST' || url.pathname !== '/submit') return json({ detail: 'not found' }, 404, h);
    // browsers send from the exhibit only; sendBeacon carries the origin too
    if (!h['access-control-allow-origin']) return json({ detail: 'origin not allowed' }, 403);
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: await hashIp(req) });
      if (!success) return json({ detail: 'too many submissions, try again later' }, 429, h);
    }
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ detail: 'session too large' }, 413, h);
    let s;
    try { s = clean(JSON.parse(text)); } catch (e) {
      return json({ detail: `invalid session: ${e instanceof Invalid ? e.message : 'not JSON'}` }, 422, h);
    }
    const id = s.session.id, scen = s.scenario?.id ?? 'free';
    if (dry) return json({ ok: true, id, dataset: null, dry_run: true }, 200, h);
    try {
      await commit(env, `raw/${scen}/${id}.json`, JSON.stringify(s), `Session ${id.slice(0, 8)} (${scen}, ${s.session.experience})`);
    } catch (e) {
      return json({ detail: `could not store the session (${e.message})` }, 502, h);
    }
    return json({ ok: true, id, dataset: env.DATASET_REPO }, 200, h);
  },
};
