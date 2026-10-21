// Validation of SEM-view sessions ("sem-view-telemetry/1"): the same rules as hf/space/schema.py, so a session is
// checked the same way by the Worker, the Space and the dataset builder. clean(s) returns a sanitized copy or throws.

export const FORMAT = 'sem-view-telemetry/1';
export const MAX_BYTES = 5_000_000;
const MAX_EVENTS = 60_000;
const EXPERIENCE = new Set(['novice', 'student', 'trained', 'expert']);
const SOURCES = new Set(['mouse', 'touch', 'keyboard', 'panel', 'controller', 'onscreen-panel', 'voice', 'agent', 'scenario', 'unknown']);
const OUTCOMES = new Set(['done', 'gave_up', 'abandoned']);
const KINDS = new Set(['change', 'snap', 'mode', 'button', 'blocked', 'acquire', 'judge', 'judge_cancel', 'end', 'voice']);
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const KEY_RE = /^[A-Za-z0-9_.]{1,32}$/;
const SCENARIO_RE = /^[a-z0-9-]{1,40}$/;

export class Invalid extends Error {}
const fail = (m) => { throw new Invalid(m); };

const num = (v, name) => (typeof v === 'number' && Number.isFinite(v) ? v : fail(`${name}: not a finite number`));
function scalar(v, name) {
  if (v === null || v === undefined || typeof v === 'boolean') return v ?? null;
  if (typeof v === 'number') return num(v, name);
  if (typeof v === 'string' && v.length <= 40) return v;
  return fail(`${name}: unexpected value`);
}
function flat(d, name, maxKeys = 80) {
  if (d === null || d === undefined) return null;
  if (typeof d !== 'object' || Array.isArray(d) || Object.keys(d).length > maxKeys) fail(`${name}: expected a small object`);
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (!KEY_RE.test(k)) fail(`${name}: bad key ${k}`);
    out[k] = scalar(v, `${name}.${k}`);
  }
  return out;
}
function small(d, name, limit = 4000) {
  const s = JSON.stringify(d ?? null);
  if (s.length > limit) fail(`${name}: too large`);
  return JSON.parse(s);
}

export function clean(s) {
  if (!s || typeof s !== 'object' || s.format !== FORMAT) fail(`not a ${FORMAT} session`);
  const se = s.session ?? {};
  if (se.consent !== true) fail('no recorded consent');
  if (!ID_RE.test(String(se.id ?? ''))) fail('bad session id');
  if (!EXPERIENCE.has(se.experience)) fail('bad experience level');
  const started = String(se.started ?? '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}/.test(started)) fail('bad start time');
  const screen = Array.isArray(se.screen) ? se.screen.slice(0, 2) : [0, 0];
  const app = s.app ?? {};
  const out = {
    format: FORMAT,
    app: { name: String(app.name ?? '').slice(0, 60), version: String(app.version ?? '').slice(0, 20) },
    session: {
      id: se.id, started: `${started.slice(0, 13)}:00:00Z`, experience: se.experience, consent: true,
      screen: screen.map((x) => Math.round(num(x, 'screen') / 100) * 100),
      inputs: (Array.isArray(se.inputs) ? se.inputs : []).filter((x) => SOURCES.has(x)),
    },
    scenario: null, events: [],
  };
  const sc = s.scenario;
  if (sc !== null && sc !== undefined) {
    if (!SCENARIO_RE.test(String(sc.id ?? ''))) fail('bad scenario id');
    out.scenario = { id: sc.id, seed: Math.trunc(num(sc.seed ?? 0, 'seed')), hidden: small(sc.hidden, 'hidden'), target: small(sc.target, 'target') };
  }
  const ev = s.events;
  if (!Array.isArray(ev) || !ev.length || ev.length > MAX_EVENTS) fail('events missing or too many');
  let lastT = -1;
  ev.forEach((e, i) => {
    const k = e?.k;
    if (!KINDS.has(k)) fail(`event ${i}: unknown kind`);
    const t = num(e.t, `event ${i}.t`);
    if (t < lastT - 0.01 || t > 86400) fail(`event ${i}: time out of order`);
    lastT = t;
    const o = { t: Math.round(t * 1000) / 1000, k };
    if (k === 'change') {
      if (!KEY_RE.test(String(e.key ?? ''))) fail(`event ${i}: bad key`);
      Object.assign(o, { key: e.key, from: scalar(e.from, 'from'), to: scalar(e.to, 'to'), src: SOURCES.has(e.src) ? e.src : 'unknown' });
    } else if (k === 'snap') o.state = flat(e.state, `event ${i}.state`);
    else if (k === 'mode') Object.assign(o, { from: scalar(e.from, 'from'), to: scalar(e.to, 'to') });
    else if (k === 'button' || k === 'blocked') o.id = String(e.id ?? '').slice(0, 40);
    else if (k === 'judge') {
      o.rating = e.rating === null || e.rating === undefined ? null : Math.trunc(num(e.rating, 'rating'));
      if (o.rating !== null && (o.rating < 1 || o.rating > 5)) fail('rating out of range');
      o.cues = (Array.isArray(e.cues) ? e.cues : []).slice(0, 12).map((c) => String(c).slice(0, 60));
      o.note = String(e.note ?? '').slice(0, 140);
    } else if (k === 'voice') { o.intent = String(e.intent ?? '').slice(0, 120); o.ok = !!e.ok; }
    else if (k === 'end') o.outcome = OUTCOMES.has(e.outcome) ? e.outcome : 'abandoned';
    if (e.m !== null && e.m !== undefined) o.m = flat(e.m, `event ${i}.m`, 40);
    out.events.push(o);
  });
  return out;
}
