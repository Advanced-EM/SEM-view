// What a Python script can do to the microscope. One implementation serves every way of running a script:
//   - the Python IDE inside the exhibit (Pyodide, js/ide.js)
//   - desktop Python driving an open exhibit (the agent bridge, method "script")
//   - desktop Python with the headless simulator (tools/semview-py/semview/driver.mjs)
// The host supplies the state, the simulator and how to run one operation; this file holds the rest, so a
// script behaves the same in all three. Every call is synchronous: the simulator computes on demand.
import * as P from './physics.js';
import { collectData, toNpz } from './export.js';
import { analyze, ANALYSES } from './analyze.js';
import { parseCommand } from './voice.js';
import { SCENARIOS } from './scenarios.js';
import { MODES, settle, autofocusTarget, SEG_PRESETS } from './ops.js';
import { SESSION_KEYS } from './state.js';
import { PRESETS, FIELDS, newProfile } from './profile.js';

export const SCRIPT_API = 1;
const SPECS = Object.keys(P.SPECIMENS);
const CHALLENGES = Object.keys(SCENARIOS);
const SETTINGS = {
  mode: MODES.join(', '), specimen: SPECS.join(', '), kV: 'accelerating voltage, 0.5–30', current_pA: 'probe current, 1–20000', aperture_um: '10, 20, 30, 60 or 120',
  wd_mm: 'working distance, 2–20', focus_um: 'focus offset (the knob)', stig_x: 'stigmator X (µm)', stig_y: 'stigmator Y (µm)', aperture_x_um: 'aperture alignment X', aperture_y_um: 'aperture alignment Y',
  fov_um: 'horizontal field of view', stage_um: '[x, y] stage position', tilt_deg: 'stage tilt, 0–72', dwell_us: 'pixel dwell time', coated: 'carbon coating, True or False',
  etd_bias_V: 'ETD Faraday cage bias, −150 to +300', bse: 'comp, topoX or topoY', segments: '{"A": 1, "B": -1, "C": 0, "D": 0}', realistic: 'shot noise (True) or the clean view',
  beam: 'True (on) or False (blanked)', wobbler: 'focus wobbler on or off', map_size: '24, 40 or 56 (EBSD/TKD)', exposure_ms: 'EBSD pattern exposure', foil_nm: 'TKD foil thickness', trajectories: 'Monte Carlo electrons',
};
const KEY = { kV: 'kV', current_pA: 'current', aperture_um: 'aperture', wd_mm: 'wd', focus_um: 'focus', stig_x: 'stigX', stig_y: 'stigY', aperture_x_um: 'apX', aperture_y_um: 'apY', fov_um: 'fov', tilt_deg: 'tilt',
  dwell_us: 'dwell', etd_bias_V: 'etdBias', map_size: 'mapN', exposure_ms: 'expo', foil_nm: 'tkdThick', trajectories: 'mcMax' };

export function settingsToOps(a) {
  const bad = Object.keys(a).filter((k) => !(k in SETTINGS));
  if (bad.length) throw new Error(`unknown setting ${bad.join(', ')}. Settings: ${Object.keys(SETTINGS).join(', ')}`);
  const ops = [];
  // specimen and mode first (they set sensible conditions), then the optics
  if (a.specimen !== undefined) { if (!SPECS.includes(a.specimen)) throw new Error(`specimen must be one of ${SPECS.join(', ')}`); ops.push({ op: 'spec', v: a.specimen }); }
  if (a.mode !== undefined) { if (!MODES.includes(a.mode)) throw new Error(`mode must be one of ${MODES.join(', ')}`); ops.push({ op: 'mode', v: a.mode }); }
  for (const [k, sk] of Object.entries(KEY)) if (a[k] !== undefined) { if (!Number.isFinite(+a[k])) throw new Error(`${k} must be a number`); ops.push({ op: 'set', k: sk, v: +a[k] }); }
  if (a.stage_um !== undefined) { const [x, y] = a.stage_um; ops.push({ op: 'stageTo', x: +x, y: +y }); }
  if (a.coated !== undefined) ops.push({ op: 'set', k: 'coated', v: !!a.coated });
  if (a.realistic !== undefined) ops.push({ op: 'set', k: 'clarity', v: a.realistic ? 'real' : 'edu' });
  if (a.bse !== undefined) { if (!SEG_PRESETS[a.bse]) throw new Error('bse must be comp, topoX or topoY'); ops.push({ op: 'chip', k: 'bseMode', v: a.bse }); }
  if (a.segments !== undefined) ops.push({ op: 'seg', v: a.segments });
  if (a.wobbler !== undefined) ops.push({ op: 'setWobble', v: !!a.wobbler });
  if (a.beam !== undefined) ops.push({ op: 'beam', v: !a.beam });
  return ops;
}

export function stateSummary(S, sim) {
  const pr = sim.probe;
  return {
    mode: S.mode, specimen: S.spec, specimen_name: sim.spec.name, kV: S.kV, current_pA: S.current, aperture_um: S.aperture, wd_mm: S.wd,
    focus_um: S.focus, stig: [S.stigX, S.stigY], aperture_xy_um: [S.apX, S.apY], fov_um: S.fov, magnification: Math.round(127000 / S.fov), stage_um: [+S.cx.toFixed(4), +S.cy.toFixed(4)],
    tilt_deg: S.tilt, dwell_us: S.dwell, coated: S.coated, etd_bias_V: S.etdBias, bse_segments: { ...S.seg }, clarity: S.clarity, beam: S.paused ? 'blanked' : 'on', wobbler: !!S.wobble,
    probe_nm: +pr.d.toFixed(3), convergence_mrad: +(pr.alpha * 1e3).toFixed(3), probe_budget_nm: { source: +pr.dg.toFixed(3), spherical: +pr.ds.toFixed(3), chromatic: +pr.dc.toFixed(3), diffraction: +pr.dd.toFixed(3), aperture: +pr.dm.toFixed(3) },
    depth_of_field_um: +((2 * Math.max(S.fov / 256, pr.d / 1000)) / pr.alpha).toFixed(3), sharpness: sim.img ? +sim.img.sharp.toFixed(4) : null, charging: !!sim.img?.charging,
    instrument: S.profile.name,
  };
}

const plain = (html) => String(html).replace(/<kbd>(.*?)<\/kbd>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\\'/g, "'").replace(/\s+/g, ' ').trim();

export class ScriptCore {
  // host: { name, S, sim, run(op) → description or result, busy() → reason | null, refresh(), scenarioApi }
  constructor(host) { this.h = host; this.ch = null; }
  get S() { return this.h.S; }
  get sim() { return this.h.sim; }
  guard() { const b = this.h.busy?.(); if (b) throw new Error(b); }
  run(op) {
    // operations the shared vocabulary leaves to the host
    if (op.op === 'stageTo') { this.S.cx = op.x; this.S.cy = op.y; this.sim.invalidate('stage'); return `Stage ${op.x}, ${op.y} µm`; }
    if (op.op === 'setWobble') { this.S.wobble = op.v; return op.v ? 'Wobbler on' : 'Wobbler off'; }
    return this.h.run(op);
  }

  // ---------------------------------------------------------------- calls (each takes one object of arguments)
  info() {
    return {
      api: SCRIPT_API, backend: this.h.name, modes: MODES, specimens: Object.fromEntries(SPECS.map((k) => [k, P.SPECIMENS[k].name])), settings: SETTINGS, analyses: Object.keys(ANALYSES),
      challenges: CHALLENGES.map((id) => ({ id, title: SCENARIOS[id].title })), profiles: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.name])),
      webgpu: typeof navigator !== 'undefined' && !!navigator.gpu, compute: 'cpu',
    };
  }
  state() { return { ...stateSummary(this.S, this.sim), challenge: this.ch?.id ?? null }; }
  set(a = {}) {
    this.guard();
    const done = settingsToOps(a).map((op) => this.run(op));
    this.h.refresh?.();
    return done;
  }
  command({ text } = {}) {
    this.guard();
    const r = parseCommand(String(text ?? ''), { paused: this.S.paused, mode: this.S.mode });
    if (!r.ops) return { understood: false, text };
    const done = r.ops.filter((op) => op.op !== 'export').map((op) => this.run(op));
    this.h.refresh?.();
    return { understood: true, done };
  }
  // the instrument's own auto focus and stigmation (disabled in challenges that test your own)
  autofocus() {
    this.guard();
    if (this.ch && (SCENARIOS[this.ch.id].blocked ?? []).includes('autofocus')) throw new Error(`autofocus is disabled in the ${this.ch.id} challenge: that is the job of your script`);
    Object.assign(this.S, autofocusTarget(this.S, this.sim));
    this.sim.invalidate('focus'); this.h.refresh?.();
    return { focus_um: this.S.focus, stig: [this.S.stigX, this.S.stigY] };
  }
  // the digital twin's instrument profile: read it, pick a preset, or change fields (calibrations)
  profile(a = {}) {
    if (Object.keys(a).length) {
      this.guard();
      if (a.preset !== undefined) { if (!PRESETS[a.preset]) throw new Error(`preset must be one of ${Object.keys(PRESETS).join(', ')}`); this.S.profile = newProfile(a.preset); }
      for (const [k, v] of Object.entries(a)) {
        if (k === 'preset') continue;
        const f = FIELDS.find((x) => x[0] === k);
        if (!f) throw new Error(`unknown profile field ${k}: ${FIELDS.map((x) => x[0]).join(', ')}`);
        if (!(+v >= f[3] && +v <= f[4])) throw new Error(`${f[1]} must be within ${f[3]}–${f[4]} ${f[2]}`);
        this.S.profile[k] = +v;
      }
      this.sim.invalidate('all'); this.h.refresh?.();
    }
    return structuredClone(this.S.profile);
  }
  // record the detectors: the data as a NumPy .npz (bytes), with the array shapes and metadata
  acquire({ steps } = {}) {
    this.guard();
    settle(this.S, this.sim, steps);
    const data = collectData(this.sim, this.S);
    if (!Object.keys(data.arrays).length) throw new Error(`nothing to record in ${this.S.mode} mode yet`);
    return { npz: toNpz(data), arrays: Object.fromEntries(Object.entries(data.arrays).map(([k, v]) => [k, v.shape])), meta: data.meta };
  }
  analyze({ name, ...opts } = {}) {
    this.guard();
    settle(this.S, this.sim);
    return analyze(this.sim, this.S, name ?? undefined, opts);
  }
  step({ n = 1 } = {}) { const k = Math.max(1, Math.min(4000, n | 0)); for (let i = 0; i < k; i++) this.sim.update(0.05); return { time_s: +(this.sim.clock ?? 0).toFixed(2) }; }

  // ---------------------------------------------------------------- challenges: a training task's hidden misalignment, scored
  challenge({ id, seed } = {}) {
    this.guard();
    if (!CHALLENGES.includes(id)) throw new Error(`challenge must be one of ${CHALLENGES.join(', ')}`);
    const sc = SCENARIOS[id], s = Number.isInteger(seed) ? seed : (Math.random() * 2 ** 31) | 0;
    // the instrument as it was, restored by end_challenge (a new challenge keeps the first snapshot)
    this.saved ??= structuredClone(Object.fromEntries(SESSION_KEYS.filter((k) => k !== 'mis').map((k) => [k, this.S[k]])));
    const info = sc.setup(this.h.scenarioApi, P.mulberry32(s));
    this.sim.invalidate('all');
    this.h.refresh?.();
    this.ch = { id, seed: s, ...info };
    return { id, seed: s, title: sc.title, task: plain(sc.brief), target: Object.fromEntries(Object.entries(info.target).filter(([k]) => !['focus_um', 'stig', 'E2_kV'].includes(k))) };
  }
  score() {
    if (!this.ch) throw new Error('no challenge is running: call challenge() first');
    settle(this.S, this.sim, this.ch.id === 'ebsd-setup' ? undefined : 2);
    return SCENARIOS[this.ch.id].metrics(this.h.scenarioApi, this.ch);
  }
  reveal() {
    if (!this.ch) throw new Error('no challenge is running');
    return { id: this.ch.id, seed: this.ch.seed, hidden: this.ch.hidden };
  }
  end_challenge() {
    const was = this.ch?.id ?? null;
    this.ch = null; this.S.mis = null; this.S.wobble = false;
    if (this.saved) {
      const st = this.saved; this.saved = null;
      if (this.h.scenarioApi?.restoreState) this.h.scenarioApi.restoreState({ ...st, mis: null });
      else { Object.assign(this.S, structuredClone(st)); this.S.mis = null; }
    }
    this.sim.invalidate('all'); this.h.refresh?.();
    return { ended: was, restored: true };
  }

  // one entry point for remote callers (desktop Python): only these names can be called
  call(name, args = {}) {
    if (!['info', 'state', 'set', 'command', 'autofocus', 'profile', 'acquire', 'analyze', 'step', 'challenge', 'score', 'reveal', 'end_challenge'].includes(name)) throw new Error(`unknown call ${name}`);
    return this[name](args ?? {});
  }
}

// bytes ↔ base64 for transports that carry JSON
export function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return typeof btoa === 'function' ? btoa(s) : Buffer.from(bytes).toString('base64'); }
