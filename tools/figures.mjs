// Figures for the printed guides (docs/guides), computed by the simulator itself, so they always match the exhibit.
//   node tools/figures.mjs        → docs/guides/fig/*.png
// The images are what the detectors record (shot noise at the stated current and dwell), contrast-stretched.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { Sim } from '../js/sim.js';
import { defaultState } from '../js/state.js';
import * as O from '../js/ops.js';
import * as P from '../js/physics.js';
import { recordFrame } from '../js/export.js';

const out = new URL('../docs/guides/fig/', import.meta.url);
mkdirSync(out, { recursive: true });

// ------------------------------------------------------------------ PNG (8-bit RGB), no dependencies
function png(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let i = 0; i < w * 3; i++) raw[y * (w * 3 + 1) + 1 + i] = rgb[y * w * 3 + i]; }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const save = (name, rgb, w, h = w) => { writeFileSync(new URL(`${name}.png`, out), png(rgb, w, h)); console.log(`${name}.png ${w}×${h}`); };
// grayscale with a percentile stretch, optionally scaled up (nearest neighbour) for small maps
function gray(arr, n, { lo = 0.005, hi = 0.995, up = 1, tint = [1, 1, 1] } = {}) {
  const s = Float32Array.from(arr).sort(), a = s[Math.floor(lo * (s.length - 1))], b = s[Math.floor(hi * (s.length - 1))], W = n * up, rgb = new Uint8Array(W * W * 3);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const v = Math.max(0, Math.min(1, (arr[Math.floor(y / up) * n + Math.floor(x / up)] - a) / (b - a || 1))) * 255, k = (y * W + x) * 3;
    rgb[k] = v * tint[0]; rgb[k + 1] = v * tint[1]; rgb[k + 2] = v * tint[2];
  }
  return [rgb, W];
}
// an instrument with a specimen, settings and optional hidden misalignment, imaged once
function shot(set, mis = null) {
  const S = defaultState(), sim = new Sim(S);
  S.stigX = sim.astig[0]; S.stigY = sim.astig[1];
  if (set.spec) O.specState(S, sim, set.spec);
  if (set.mode) O.modeState(S, sim, set.mode);
  const { spec, mode, ...rest } = set;
  Object.assign(S, rest, { clarity: 'real' });
  S.mis = mis;
  sim.invalidate('all');
  O.settle(S, sim);
  return { S, sim };
}
const se = (set, mis, opts) => { const { S, sim } = shot({ mode: 'se', ...set }, mis); sim.computeImage(); return gray(recordFrame(sim.img.arr, S), sim.img.n, opts); };

// ------------------------------------------------------------------ SOP-01: column alignment
const tin = { spec: 'sn', kV: 10, current: 200, fov: 0.45, cx: 0.4, cy: -0.3, dwell: 6 };
save('cover', ...se({ spec: 'sn', kV: 5, current: 300, fov: 8, dwell: 10 }));
// aperture off axis: the wobbler's two focus extremes, averaged, show the image walking; centered they overlap
function wobblePair(ap) {
  const { S, sim } = shot({ mode: 'se', spec: 'grid', kV: 10, current: 200, fov: 6, dwell: 6 }, ap ? { ap } : null);
  const amp = sim.wobbleAmp(), frames = [];
  for (const w of [-amp, amp]) { sim.wob = w; sim.computeImage(); frames.push(recordFrame(sim.img.arr, S)); }
  return gray(frames[0].map((v, i) => (v + frames[1][i]) / 2), sim.img.n);
}
save('ap_off', ...wobblePair([22, -9]));
save('ap_ok', ...wobblePair(null));
// astigmatism: perpendicular streaks either side of focus, round when corrected
const astig = { stig: [1.8, 0.6] };
save('stig_under', ...se({ ...tin, stigX: 0, stigY: 0, focus: -0.8 }, astig));
save('stig_over', ...se({ ...tin, stigX: 0, stigY: 0, focus: 0.8 }, astig));
save('stig_infocus', ...se({ ...tin, stigX: 0, stigY: 0, focus: 0 }, astig));
save('stig_ok', ...se({ ...tin, stigX: 1.8, stigY: 0.6, focus: 0 }, astig));
// resolution on tin, and magnification on the cross grating
save('res_sn', ...se({ spec: 'sn', kV: 15, current: 50, fov: 0.4, cx: 0.4, cy: -0.3, dwell: 20 }));
save('grating', ...se({ spec: 'grid', kV: 10, current: 200, fov: 4, dwell: 6 }));

// ------------------------------------------------------------------ SOP-02: analytical set-up
// charging of an uncoated insulator, above and below its E2
const inc = P.SPECIMENS.ni.inclusion();
save('charge_15', ...se({ spec: 'ni', kV: 15, current: 300, fov: 18, cx: inc[0], cy: inc[1], dwell: 4 }));
save('charge_ok', ...se({ spec: 'ni', kV: 2.2, current: 300, fov: 18, cx: inc[0], cy: inc[1], dwell: 4 }));
// EDS map of the chip, coloured by element
{
  const { sim } = shot({ mode: 'eds', spec: 'chip', kV: 10 });
  const e = sim.eds, n = e.n, up = 3, W = n * up, rgb = new Uint8Array(W * W * 3), hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mx = Object.fromEntries(e.syms.map((s) => [s, Math.max(...e.maps[s])]));
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const k = Math.floor(y / up) * n + Math.floor(x / up);
    let r = 0, g = 0, b = 0, ws = 0, vm = 0;
    for (const s of e.syms) { const v = e.maps[s][k] / (mx[s] || 1), w = v * v, c = hex(P.EL_COLOR[s]); r += w * c[0]; g += w * c[1]; b += w * c[2]; ws += w; vm = Math.max(vm, v); }
    const f = ws ? Math.pow(vm, 0.8) / ws : 0, q = (y * W + x) * 3;
    rgb[q] = r * f; rgb[q + 1] = g * f; rgb[q + 2] = b * f;
  }
  save('eds_map', rgb, W, W);
}
// EBSD: an IPF-Z map of nickel and one Kikuchi pattern
{
  const { S, sim } = shot({ mode: 'ebsd', spec: 'ni', mapN: 40 });
  while (sim.map.done < sim.map.N ** 2) sim.update(0.05); // run the map to the end
  const M = sim.map, N = M.N, up = 8, W = N * up, rgb = new Uint8Array(W * W * 3);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const k = Math.floor(y / up) * N + Math.floor(x / up), c = M.O[k] ? P.ipfColor(M.O[k]) : [0, 0, 0], q = (y * W + x) * 3; rgb[q] = c[0]; rgb[q + 1] = c[1]; rgb[q + 2] = c[2]; }
  save('ebsd_ipf', rgb, W, W);
  const pat = sim.patternAt(Math.floor(N / 2) * N + Math.floor(N / 2));
  save('ebsd_pattern', ...gray(pat.pat, 144, { up: 2 }));
  console.log(`  EBSD: ${Math.round((100 * M.ok) / M.done)} % indexed at ${S.tilt}°, ${S.kV} kV`);
}
// CL of the GaN LED: panchromatic in true colours, the band edge and the wells; low and high voltage
function cl(set, name, colour = true) {
  const { sim } = shot({ mode: 'cl', spec: 'gan', ...set });
  const c = sim.cl, n = c.n, up = 2, W = n * up;
  if (!colour) { save(name, ...gray(c.img, n, { up, tint: set.clMode === 'mono' ? P.lamRGB(set.clLam).map((v) => 0.35 + 0.65 * v) : [1, 1, 1] })); return; }
  const rgb = new Uint8Array(W * W * 3); let mx = 0;
  for (const v of c.img) mx = Math.max(mx, v);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const k = Math.floor(y / up) * n + Math.floor(x / up), t = Math.max(c.rgb[k * 3], c.rgb[k * 3 + 1], c.rgb[k * 3 + 2]) || 1, v = Math.min(1, (c.img[k] / mx) * 1.2) * 255, q = (y * W + x) * 3;
    for (let i = 0; i < 3; i++) rgb[q + i] = (c.rgb[k * 3 + i] / t) * v;
  }
  save(name, rgb, W, W);
}
cl({ kV: 5, clMode: 'pan' }, 'cl_pan');
cl({ kV: 5, clMode: 'mono', clLam: 365, clBand: 10 }, 'cl_365', false);
cl({ kV: 5, clMode: 'mono', clLam: 450, clBand: 10 }, 'cl_450', false);
cl({ kV: 2, clMode: 'pan' }, 'cl_2kv');
cl({ kV: 15, clMode: 'pan' }, 'cl_15kv');
