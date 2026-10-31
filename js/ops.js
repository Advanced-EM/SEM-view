// Instrument operations on the state alone (no DOM): load a specimen, switch mode, change a setting.
// The exhibit calls these and then refreshes its controls; the headless drivers (tools/semview-py,
// tools/semview-mcp, tools/headless.mjs) call them directly, so a script sees the same instrument either way.
import * as P from './physics.js';
import { analyze } from './analyze.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const MODES = ['se', 'inlens', 'bse', 'ebsd', 'tkd', 'eds', 'cl', 'mc'];
export const IMAGING = ['se', 'inlens', 'bse'];
export const APERTURES = [10, 20, 30, 60, 120];
export const MAP_SIZES = [24, 40, 56];
const nearest = (list, v) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
// focus range follows the field of view, as the coarse/fine focus of a real SEM does
export const focusRange = (S) => Math.max(0.3, Math.min(60, S.fov * 0.6));

// every numeric setting: [min, max, digits]; functions take the state
export const LIMITS = {
  kV: [0.5, 30, 1], current: [1, 20000, 1], wd: [2, 20, 1], tilt: [0, 72, 1], dwell: [0.1, 30, 2], etdBias: [-150, 300, 0],
  tkdThick: [20, 400, 0], expo: [1, 50, 0], clLam: [300, 800, 0], clBand: [2, 100, 0], mcMax: [200, 6000, 0], stigX: [-2, 2, 3], stigY: [-2, 2, 3], apX: [-40, 40, 2], apY: [-40, 40, 2],
  focus: [(S) => -focusRange(S), (S) => focusRange(S), 4], fov: [(S, sim) => sim.spec.fovMin, (S, sim) => sim.spec.fovMax, 4],
};
const UI_ONLY = ['speed', 'showLabels', 'showElectrons', 'showGlass', 'autoRotate', 'paused', 'showHough'];

// load a specimen with the field of view it was made for
export function specState(S, sim, v) {
  if (!P.SPECIMENS[v]) return false;
  S.spec = v;
  S.fov = P.SPECIMENS[v].fov; [S.cx, S.cy] = P.SPECIMENS[v].center ?? [0, 0]; S.edsSel = 'all';
  sim.invalidate('spec');
  return true;
}

// switch mode with the conditions a microscopist would choose for it
export function modeState(S, sim, m) {
  if (m === S.mode || !MODES.includes(m)) return false;
  const prev = S.mode;
  S.mode = m;
  const quietSpec = (v) => { S.spec = v; S.fov = P.SPECIMENS[v].fov; [S.cx, S.cy] = P.SPECIMENS[v].center ?? [0, 0]; S.edsSel = 'all'; };
  if (m === 'ebsd') { if (!['ni', 'chip'].includes(S.spec)) quietSpec('ni'); S.tilt = 70; S.kV = Math.max(S.kV, 20); S.current = Math.max(S.current, 3000); S.wd = Math.max(S.wd, 14); }
  if (m === 'tkd') { if (!['chip', 'lib'].includes(S.spec)) quietSpec('chip'); S.tilt = 0; S.kV = Math.max(S.kV, 30); S.current = Math.max(S.current, 2000); S.wd = Math.min(S.wd, 5); }
  if (m === 'eds') { S.kV = Math.max(S.kV, 15); S.current = Math.max(S.current, 1000); if (prev === 'ebsd') S.tilt = 0; }
  // CL: a luminescent specimen, the parabolic mirror inserted (it needs ~10 mm working distance), nanoamps
  if (m === 'cl') { if (!P.SPECIMENS[S.spec].luminescent || S.spec === 'chip') quietSpec('gan'); S.tilt = 0; S.wd = 10; S.kV = clamp(S.kV, 3, 15); S.current = Math.max(S.current, 1000); if (S.spec === 'ni') { [S.cx, S.cy] = P.SPECIMENS.ni.inclusion(); S.fov = 18; } }
  if (IMAGING.includes(m) && prev === 'ebsd') S.tilt = 0;
  if (m === 'inlens') S.wd = Math.min(S.wd, 4);
  S.focus = clamp(S.focus, -focusRange(S), focusRange(S));
  sim.invalidate('mode-all');
  return true;
}

// one setting, clamped to what the instrument allows; returns the value set (or null if nothing changed)
export function setState(S, sim, key, v, inv = key) {
  if (key === 'aperture') v = nearest(APERTURES, +v);
  else if (key === 'mapN') v = nearest(MAP_SIZES, +v);
  else if (LIMITS[key]) {
    const [lo, hi, dg] = LIMITS[key], f = (x) => (typeof x === 'function' ? x(S, sim) : x);
    v = +clamp(+v, f(lo), f(hi)).toFixed(dg);
  }
  if (S[key] === v) return null;
  S[key] = v;
  if (key === 'fov') S.focus = clamp(S.focus, -focusRange(S), focusRange(S));
  if (key === 'clLam' || key === 'clBand') S.clMode = 'mono'; // choosing a wavelength means a monochromatic image
  if (!UI_ONLY.includes(key)) sim.invalidate(inv);
  if (key === 'showHough') sim.version++;
  return v;
}

// BSE segment presets and single segments (+1 add, −1 subtract, 0 off)
export const SEG_PRESETS = { comp: { A: 1, B: 1, C: 1, D: 1 }, topoX: { A: 1, B: -1, C: 0, D: 0 }, topoY: { A: 0, B: 0, C: 1, D: -1 } };
export function segState(S, sim, seg) {
  S.seg = { A: 1, B: 1, C: 1, D: 1, ...S.seg, ...seg };
  for (const q of 'ABCD') S.seg[q] = Math.sign(+S.seg[q] || 0);
  S.bseMode = P.segPreset(S.seg);
  sim.invalidate('seg');
}

// Auto focus and stigmation: a sharpness search like the instrument's. It lands close to the true focus and
// stigmation, less precisely when the image is noisy (low current, short dwell) or has little detail.
export function autofocusTarget(S, sim, rng = Math.random) {
  const [hx, hy] = S.mis?.stig ?? sim.astig, f0 = S.mis?.focus ?? 0;
  const noise = 1 / Math.sqrt(Math.max(0.05, (S.current / 100) * S.dwell)), err = 0.004 * S.fov * (0.4 + 0.6 * Math.min(3, noise));
  return { focus: +clamp(f0 + (rng() - 0.5) * err, -focusRange(S), focusRange(S)).toFixed(4), stigX: +(hx + (rng() - 0.5) * 0.03).toFixed(3), stigY: +(hy + (rng() - 0.5) * 0.03).toFixed(3) };
}

// The exhibit's operation vocabulary (voice commands, agent tools, scripts) on the state alone: the headless
// counterpart of runOp in main.js. Returns false for operations that only make sense with a screen.
export function runOpState(S, sim, op) {
  switch (op.op) {
    case 'mode': modeState(S, sim, op.v); return true;
    case 'spec': specState(S, sim, op.v); return true;
    case 'set':
      if (op.k === 'clarity') { if (['edu', 'real'].includes(op.v)) { S.clarity = op.v; sim.invalidate('clarity'); } return true; }
      if (op.k === 'coated' || op.k === 'showHough') { setState(S, sim, op.k, !!op.v); return true; }
      if (op.k === 'clMode') { if (['pan', 'mono'].includes(op.v)) setState(S, sim, 'clMode', op.v); return true; }
      setState(S, sim, op.k, op.v); op.v = S[op.k]; return true;
    case 'chip':
      if (op.k === 'bseMode' && SEG_PRESETS[op.v]) { if (S.mode !== 'bse') modeState(S, sim, 'bse'); segState(S, sim, SEG_PRESETS[op.v]); }
      else if (op.k === 'aperture' || op.k === 'mapN' || op.k === 'kV') setState(S, sim, op.k, op.v);
      return true;
    case 'seg': segState(S, sim, op.v); return true;
    case 'nudge': setState(S, sim, 'focus', S.focus + op.d * focusRange(S) * 0.02); return true;
    case 'zoom': setState(S, sim, 'fov', S.fov * op.f); return true;
    case 'scale': setState(S, sim, op.k, S[op.k] * op.f); return true;
    case 'stage': S.cx += op.dx ?? 0; S.cy += op.dy ?? 0; sim.invalidate('stage'); return true;
    case 'action':
      if (op.v === 'autofocus') { Object.assign(S, autofocusTarget(S, sim)); sim.invalidate('focus'); return true; }
      if (op.v === 'pause') { S.paused = !S.paused; return true; }
      if (op.v === 'remap') { sim.stale.map = 1; sim.version++; return true; }
      if (op.v === 'remc') { sim.stale.mc = 1; sim.version++; return true; }
      return false;
    case 'beam': S.paused = !!op.v; return true;
    case 'analyze':
      try { for (let i = 0; i < 3; i++) sim.update(0.05); op.result = analyze(sim, S, op.v ?? undefined); op.v = op.result.analysis; } catch (e) { op.error = e.message; }
      return true;
    case 'acquire': return true; // the caller records the data
    default: return false;
  }
}

// how many simulation steps until the detectors show the current settings (an EBSD map takes a while)
export function settle(S, sim, steps) {
  const n = steps ?? ({ ebsd: 400, tkd: 400, eds: 60, cl: 40, mc: 120 }[S.mode] ?? 2);
  for (let i = 0; i < n; i++) {
    sim.update(0.05);
    if ((S.mode === 'ebsd' || S.mode === 'tkd') && sim.map && sim.map.done >= sim.map.N * sim.map.N) break;
    if (S.mode === 'mc' && sim.mc && sim.mc.n >= S.mcMax) break;
  }
}
