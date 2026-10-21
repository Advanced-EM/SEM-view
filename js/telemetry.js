// Session telemetry: what people do, in what order, from which input, and how good the result truly is.
//
// Opt-in only. Nothing leaves the browser: a session is kept in memory and downloaded as JSON by the user.
// No personal data: an anonymous random session id, a self-reported experience level, and the exhibit state.
//
// Format "sem-view-telemetry/1":
//   { format, app, session: { id, started, experience, consent, screen }, scenario?: { id, seed, hidden, target },
//     events: [ { t, k, ... } ] }        t = seconds since the session started
//   k = 'change'   key, from, to, src        a tracked setting changed (coalesced every 100 ms)
//       'snap'     state, m                 full tracked state and hidden metrics (every 0.5 s)
//       'mode'     from, to                 operating mode
//       'button'   id                       a control button (optimal focus, align zero loss, …)
//       'blocked'  id                       a button disabled in this scenario
//       'acquire'  m                         an acquisition (an implicit "this is good")
//       'judge'    rating, cues, note, m    the user's own judgment at a checkpoint
//       'voice'    intent, ok               a spoken command (what it did, not what was said)
//       'end'      outcome, m               done, gave up, or abandoned
//   src = 'mouse' | 'touch' | 'keyboard' | 'panel' | 'controller' | 'onscreen-panel' | 'voice' | 'agent' | 'scenario' | 'unknown'

export const TELEMETRY_FORMAT = 'sem-view-telemetry/1';

// settings worth tracking (BSE segments are flattened)
const KEYS = ['mode', 'spec', 'fov', 'cx', 'cy', 'tilt', 'coated', 'kV', 'current', 'aperture', 'wd', 'focus', 'stigX', 'stigY', 'apX', 'apY', 'dwell',
  'etdBias', 'clarity', 'mapN', 'expo', 'tkdThick', 'paused', 'wobble'];
const round = (v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);

export function flatState(S) {
  const o = {};
  for (const k of KEYS) o[k] = round(S[k]);
  for (const q of 'ABCD') o[`seg.${q}`] = S.seg?.[q];
  return o;
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export class Recorder {
  constructor({ S, version }) {
    this.S = S; this.version = version;
    this.sess = null; this.last = null; this.src = 'unknown'; this.srcT = 0; this.metricsFn = null;
  }
  get active() { return !!this.sess; }

  start({ experience, scenario = null, metrics = null }) {
    this.t0 = performance.now();
    this.sess = {
      format: TELEMETRY_FORMAT,
      app: { name: 'Scanning with Electrons (SEM-view)', version: this.version },
      session: { id: newId(), started: new Date().toISOString(), experience, consent: true, screen: [innerWidth, innerHeight], inputs: [] },
      scenario, events: [],
    };
    this.metricsFn = metrics;
    this.last = flatState(this.S); this.lastChange = 0; this.lastSnap = -1;
    this.snap();
  }
  t() { return Math.round((performance.now() - this.t0)) / 1000; }
  // who caused the next change: the latest input within 1.5 s
  noteSource(src) {
    this.src = src; this.srcT = performance.now();
    if (this.sess && !this.sess.session.inputs.includes(src)) this.sess.session.inputs.push(src);
  }
  source() { return performance.now() - this.srcT < 1500 ? this.src : 'unknown'; }
  event(k, data = {}) {
    if (!this.sess) return;
    const e = { t: this.t(), k, ...data };
    if (['acquire', 'judge', 'end', 'button', 'blocked'].includes(k) && this.metricsFn) e.m = this.metricsFn();
    this.sess.events.push(e);
    return e;
  }
  snap() { if (this.sess) this.sess.events.push({ t: this.t(), k: 'snap', state: flatState(this.S), m: this.metricsFn ? this.metricsFn() : undefined }); }

  // every frame: coalesce changes every 100 ms, full snapshot every 0.5 s
  tick() {
    if (!this.sess) return;
    const now = performance.now();
    if (now - this.lastChange >= 100) {
      this.lastChange = now;
      const cur = flatState(this.S), src = this.source();
      for (const k in cur) if (cur[k] !== this.last[k]) this.sess.events.push({ t: this.t(), k: 'change', key: k, from: this.last[k], to: cur[k], src });
      this.last = cur;
    }
    if (now - this.lastSnap >= 500) { this.lastSnap = now; this.snap(); }
  }
  stop(outcome) {
    if (!this.sess) return null;
    this.tick();
    this.event('end', { outcome });
    const s = this.sess;
    this.sess = null; this.metricsFn = null;
    return s;
  }
}
