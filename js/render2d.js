// Detector views for the SEM exhibit.
import * as P from './physics.js';
import { blurred } from './sim.js';

export const C = { accent: '#6fd6ff', warm: '#ffb45e', text: '#e9edf2', muted: '#8a94a3', dim: '#566070', grid: 'rgba(255,255,255,0.07)', bg: '#06080b', green: '#5fe3a8' };
const MONO = '"IBM Plex Mono", ui-monospace, monospace';
const clamp = P.clamp;
const _arc = CanvasRenderingContext2D.prototype.arc;
CanvasRenderingContext2D.prototype.arc = function (x, y, r, ...rest) { return _arc.call(this, x, y, Math.max(0, r), ...rest); };

function lut(stops) {
  const L = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1], f = clamp((t - t0) / (t1 - t0), 0, 1);
    for (let j = 0; j < 3; j++) L[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * f;
  }
  return L;
}
export const LUT = {
  gray: lut([[0, [0, 0, 0]], [1, [255, 255, 255]]]),
  sem: lut([[0, [4, 6, 10]], [0.55, [120, 132, 145]], [1, [245, 248, 250]]]),
  ice: lut([[0, [3, 6, 12]], [0.3, [14, 52, 102]], [0.65, [70, 170, 235]], [1, [236, 250, 255]]]),
  phosphor: lut([[0, [2, 7, 4]], [0.45, [28, 120, 62]], [0.8, [150, 235, 150]], [1, [235, 255, 225]]]),
};

const offs = new Map();
function off(w, h) {
  const k = w + 'x' + h;
  let o = offs.get(k);
  if (!o) { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); o = { c, ctx, id: ctx.createImageData(w, h) }; offs.set(k, o); }
  return o;
}
export function fit(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { ctx, W: w, H: h, dpr };
}
export function range(arr, pLo = 0.005, pHi = 0.995) {
  const n = arr.length, m = Math.min(n, 5000), s = new Float32Array(m);
  for (let i = 0; i < m; i++) s[i] = arr[Math.floor((i * n) / m)];
  s.sort();
  return [s[Math.floor(pLo * (m - 1))], s[Math.floor(pHi * (m - 1))]];
}
export function paint(ctx, arr, w, h, dst, o = {}) {
  const { lo, hi, lut: L = LUT.gray, noise = 0, gamma = 1, rows = h, rowsFill = null } = o;
  const { c, ctx: oc, id } = off(w, h), d = id.data;
  let mean = 1;
  if (noise) { mean = 0; for (let i = 0; i < arr.length; i++) mean += arr[i]; mean = mean / arr.length || 1; }
  const span = hi - lo || 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = arr[i];
      if (noise) v = (P.poisson(Math.max(0, (v / mean) * noise)) / noise) * mean;
      let t = clamp((v - lo) / span, 0, 1);
      if (gamma !== 1) t = Math.pow(t, gamma);
      if (y >= rows && rowsFill !== null) t = rowsFill;
      const k = (t * 255) | 0, p = i * 4;
      d[p] = L[k * 3]; d[p + 1] = L[k * 3 + 1]; d[p + 2] = L[k * 3 + 2]; d[p + 3] = 255;
    }
  oc.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, w, h, dst[0], dst[1], dst[2], dst[3]);
}
export function font(ctx, px, dpr, weight = 400) { ctx.font = `${weight} ${Math.round(px * dpr)}px ${MONO}`; }
export function label(ctx, text, x, y, dpr, { color = C.text, bg = 'rgba(5,7,10,0.62)', size = 10, align = 'left' } = {}) {
  font(ctx, size, dpr);
  const w = ctx.measureText(text).width, p = 4 * dpr, h = size * dpr + 2 * p;
  const bx = align === 'center' ? x - w / 2 - p : align === 'right' ? x - w - 2 * p : x;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, y - h / 2, w + 2 * p, h, 4 * dpr) : ctx.rect(bx, y - h / 2, w + 2 * p, h); ctx.fill();
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(text, bx + p, y + 0.5 * dpr);
}
export const fmtLen = (um) => (um >= 1000 ? `${+(um / 1000).toFixed(2)} mm` : um >= 1 ? `${+um.toFixed(um < 10 ? 2 : 0)} µm` : `${+(um * 1000).toFixed(um < 0.01 ? 1 : 0)} nm`);
function scaleBar(ctx, W, H, fov, dpr) {
  const target = fov * 0.25, e = Math.pow(10, Math.floor(Math.log10(target)));
  const L = [1, 2, 5].map((k) => k * e).filter((v) => v <= target).pop() || e;
  const px = (L / fov) * W, x = W - px - 12 * dpr, y = H - 14 * dpr;
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(x, y, px, 3 * dpr);
  font(ctx, 10, dpr, 500); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(fmtLen(L), x + px / 2, y - 3 * dpr); ctx.textAlign = 'left';
}
export function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [r * 255, g * 255, b * 255];
}
const real = (S) => S.clarity === 'real';
export const layout = {};

export function draw(sim, S, mainCv, secCv, hover) {
  const m = fit(mainCv), s = fit(secCv);
  m.ctx.fillStyle = C.bg; m.ctx.fillRect(0, 0, m.W, m.H);
  s.ctx.fillStyle = C.bg; s.ctx.fillRect(0, 0, s.W, s.H);
  ({ se: drawImage, inlens: drawImage, bse: drawImage, ebsd: drawMap, tkd: drawMap, eds: drawEDS, mc: drawMC })[S.mode](sim, S, m, s, hover);
}

// ------------------------------------------------------------------ SE / In-lens / BSE images
function drawImage(sim, S, m, s) {
  const I = sim.img;
  if (!I) return;
  const { ctx, W, H, dpr } = m;
  const [lo, hi] = range(I.arr, 0.004, 0.996);
  const eff = S.mode === 'bse' ? 0.35 : S.mode === 'inlens' ? 0.25 : 0.3;
  let mean = 0;
  for (let i = 0; i < I.arr.length; i += 11) mean += I.arr[i];
  mean /= I.arr.length / 11;
  const counts = S.current * 6.24 * S.dwell * eff * mean * (real(S) ? 1 : 12);
  const row = Math.floor(sim.raster * I.n), first = sim.frame === sim.firstPass;
  paint(ctx, I.arr, I.n, I.n, [0, 0, W, H], { lo, hi, lut: real(S) ? LUT.gray : LUT.sem, noise: Math.max(0.5, counts), rows: first ? row : I.n, rowsFill: 0 });
  const y = (row / I.n) * H;
  const g = ctx.createLinearGradient(0, y - 10 * dpr, 0, y + 2 * dpr);
  g.addColorStop(0, 'rgba(111,214,255,0)'); g.addColorStop(1, 'rgba(111,214,255,0.5)');
  ctx.fillStyle = g; ctx.fillRect(0, y - 10 * dpr, W, 12 * dpr);
  scaleBar(ctx, W, H, S.fov, dpr);
  // data bar, like a real SEM
  const mag = Math.round(127000 / S.fov);
  label(ctx, `${S.kV} kV · ×${mag.toLocaleString()} · WD ${S.wd} mm · ${S.mode === 'se' ? 'ETD' : S.mode === 'inlens' ? 'In-lens' : `BSE ${P.segLabel(S.seg)}`}`, 8 * dpr, H - 14 * dpr, dpr, { color: C.muted, size: 9 });
  if (I.charging) label(ctx, 'CHARGING: insulator above E2', 8 * dpr, 16 * dpr, dpr, { color: C.warm });
  label(ctx, `sharpness ${(I.sharp * 100).toFixed(1)}`, W - 8 * dpr, 16 * dpr, dpr, { color: C.muted, size: 9, align: 'right' });
  if (S.mode === 'se') drawYieldCurves(sim, S, s);
  else if (S.mode === 'inlens') drawProbeCurve(sim, S, s);
  else drawEtaCurve(sim, S, s);
}

function axes(q, x0, y0, w, h, dpr, xt, yt) {
  q.strokeStyle = C.grid; q.lineWidth = 1 * dpr;
  q.beginPath(); q.moveTo(x0, y0); q.lineTo(x0, y0 + h); q.lineTo(x0 + w, y0 + h); q.stroke();
  font(q, 9, dpr); q.fillStyle = C.muted; q.textBaseline = 'top'; q.textAlign = 'center';
  for (const [v, x] of xt) q.fillText(v, x, y0 + h + 4 * dpr);
  q.textAlign = 'right'; q.textBaseline = 'middle';
  for (const [v, y] of yt) q.fillText(v, x0 - 4 * dpr, y);
  q.textAlign = 'left';
}
// SE + BSE yield vs beam energy: E1/E2 crossovers decide whether an insulator charges
function drawYieldCurves(sim, S, s) {
  const q = s.ctx, d = s.dpr, x0 = 34 * d, y0 = 18 * d, w = s.W - x0 - 12 * d, h = s.H - y0 - 30 * d;
  const X = (E) => x0 + ((Math.log10(E) + 1) / (Math.log10(30) + 1)) * w, Y = (v) => y0 + h - (v / 3.5) * h;
  axes(q, x0, y0, w, h, d, [[0.1, X(0.1)], [0.3, X(0.3)], [1, X(1)], [3, X(3)], [10, X(10)], [30, X(30)]].map(([v, x]) => [`${v}`, x]), [[0, Y(0)], [1, Y(1)], [2, Y(2)], [3, Y(3)]].map(([v, y]) => [`${v}`, y]));
  q.setLineDash([3 * d, 3 * d]); q.strokeStyle = 'rgba(255,255,255,0.3)'; q.beginPath(); q.moveTo(x0, Y(1)); q.lineTo(x0 + w, Y(1)); q.stroke(); q.setLineDash([]);
  const mats = [...new Set(sim.grid ? [...sim.grid.M].filter((_, i) => i % 97 === 0) : [])].map((i) => Object.keys(P.MAT)[i]).filter((k) => P.MAT[k].rho);
  for (const k of mats) {
    const m = P.MAT[k];
    q.beginPath();
    for (let i = 0; i <= 120; i++) { const E = Math.pow(10, -1 + (i / 120) * (Math.log10(30) + 1)); const v = P.delta(m, E) + P.eta(m.Z); i ? q.lineTo(X(E), Y(v)) : q.moveTo(X(E), Y(v)); }
    q.strokeStyle = m.cond ? m.color : C.warm; q.lineWidth = (m.cond ? 1.3 : 2) * d; q.stroke();
    if (!m.cond) { const E2 = m.E2; q.fillStyle = C.warm; q.beginPath(); q.arc(X(E2), Y(1), 3.5 * d, 0, 7); q.fill(); label(q, `E2 ≈ ${E2} kV`, X(E2) + 6 * d, Y(1) - 12 * d, d, { color: C.warm, size: 9 }); }
    const Ep = 1.2;
    label(q, m.name.split(' ')[0], X(Ep) + 4 * d, Y(P.delta(m, Ep) + P.eta(m.Z)) - 8 * d, d, { color: m.cond ? m.color : C.warm, size: 8.5 });
  }
  q.strokeStyle = C.accent; q.lineWidth = 1.5 * d; q.beginPath(); q.moveTo(X(S.kV), y0); q.lineTo(X(S.kV), y0 + h); q.stroke();
  label(q, 'total yield δ + η  vs  beam energy (keV)', x0, 8 * d, d, { color: C.muted, size: 9 });
  label(q, `${S.kV} kV`, X(S.kV) + 4 * d, y0 + 10 * d, d, { color: C.accent, size: 9 });
  label(q, S.etdBias >= 0 ? `ETD grid +${S.etdBias} V: SE collected` : `ETD grid ${S.etdBias} V: SE rejected → BSE only`, x0 + w, y0 + h - 10 * d, d, { color: S.etdBias >= 0 ? C.green : C.warm, size: 9, align: 'right' });
}
// Probe size vs convergence angle: the classic SEM optimisation curve
function drawProbeCurve(sim, S, s) {
  const q = s.ctx, d = s.dpr, x0 = 40 * d, y0 = 18 * d, w = s.W - x0 - 12 * d, h = s.H - y0 - 30 * d;
  const aMin = 0.5e-3, aMax = 30e-3, X = (a) => x0 + (Math.log(a / aMin) / Math.log(aMax / aMin)) * w;
  const pr = sim.probe;
  const curves = { d: [], dg: [], ds: [], dc: [], dd: [] };
  let yMax = 0;
  for (let i = 0; i <= 150; i++) { const a = aMin * Math.pow(aMax / aMin, i / 150), v = P.probeVsAlpha(S, a); for (const k in curves) curves[k].push([a, v[k]]); }
  yMax = Math.max(pr.d * 4, 5);
  const Y = (v) => y0 + h - clamp(Math.log10(Math.max(0.1, v)) / Math.log10(yMax), 0, 1) * h;
  const yt = [0.1, 1, 10, 100, 1000].filter((v) => v <= yMax * 1.01 && v >= 0.1).map((v) => [`${v}`, Y(v)]);
  axes(q, x0, y0, w, h, d, [1, 3, 10, 30].map((v) => [`${v}`, X(v * 1e-3)]), yt);
  const col = { dg: '#b59bff', ds: C.warm, dc: '#ff7d7d', dd: C.green, d: C.text };
  const nm = { dg: 'source image', ds: 'spherical Cs', dc: 'chromatic Cc', dd: 'diffraction', d: 'probe' };
  for (const k of ['dg', 'ds', 'dc', 'dd', 'd']) {
    q.beginPath(); curves[k].forEach(([a, v], i) => (i ? q.lineTo(X(a), Y(v)) : q.moveTo(X(a), Y(v))));
    q.strokeStyle = col[k]; q.lineWidth = (k === 'd' ? 2.2 : 1.1) * d; if (k !== 'd') q.setLineDash([3 * d, 3 * d]); q.stroke(); q.setLineDash([]);
  }
  let yy = y0 + 4 * d;
  for (const k of ['d', 'dg', 'ds', 'dc', 'dd']) { label(q, nm[k], x0 + w, yy, d, { color: col[k], size: 8.5, align: 'right' }); yy += 15 * d; }
  q.fillStyle = C.accent; q.beginPath(); q.arc(X(pr.alpha), Y(pr.d), 4 * d, 0, 7); q.fill();
  label(q, `α = ${(pr.alpha * 1000).toFixed(1)} mrad → d = ${pr.d.toFixed(1)} nm`, X(pr.alpha) + 8 * d, Y(pr.d) - 12 * d, d, { color: C.accent, size: 9 });
  label(q, 'probe diameter (nm)  vs  convergence α (mrad)', x0, 8 * d, d, { color: C.muted, size: 9 });
}
// Backscatter coefficient vs atomic number
function drawEtaCurve(sim, S, s) {
  const q = s.ctx, d = s.dpr, x0 = 34 * d, y0 = 18 * d, w = s.W * 0.62 - x0, h = s.H - y0 - 30 * d;
  const X = (Z) => x0 + (Z / 80) * w, Y = (v) => y0 + h - (v / 0.6) * h;
  axes(q, x0, y0, w, h, d, [10, 20, 40, 60, 80].map((Z) => [`${Z}`, X(Z)]), [0, 0.2, 0.4, 0.6].map((v) => [`${v}`, Y(v)]));
  q.beginPath();
  for (let Z = 1; Z <= 80; Z++) { const v = P.eta(Z); Z > 1 ? q.lineTo(X(Z), Y(v)) : q.moveTo(X(Z), Y(v)); }
  q.strokeStyle = C.text; q.lineWidth = 1.5 * d; q.stroke();
  const shown = new Set();
  for (const k of Object.keys(P.MAT)) {
    const m = P.MAT[k];
    if (!m.rho || shown.has(m.Z)) continue;
    if (sim.grid && ![...sim.grid.M].some((v, i) => i % 53 === 0 && Object.keys(P.MAT)[v] === k)) continue;
    shown.add(m.Z);
    q.fillStyle = m.color; q.beginPath(); q.arc(X(m.Z), Y(P.eta(m.Z)), 4 * d, 0, 7); q.fill();
    label(q, `${k.replace('2O3', '₂O₃').replace('O2', 'O₂')} η=${P.eta(m.Z).toFixed(2)}`, X(m.Z) + 6 * d, Y(P.eta(m.Z)) - 10 * d, d, { color: m.color, size: 8.5 });
  }
  label(q, 'backscatter coefficient η  vs  Z', x0, 8 * d, d, { color: C.muted, size: 9 });
  // quadrant detector
  const cx = s.W * 0.83, cy = s.H / 2 + 6 * d, R = Math.min(s.W * 0.13, s.H * 0.36);
  layout.quad = { cx: cx / d, cy: cy / d, R: R / d };
  const segs = [['A', 0], ['B', Math.PI], ['C', Math.PI / 2], ['D', -Math.PI / 2]];
  for (const [nm, a] of segs) {
    const sg = S.seg[nm];
    q.fillStyle = sg > 0 ? 'rgba(111,214,255,0.38)' : sg < 0 ? 'rgba(255,125,125,0.4)' : 'rgba(255,255,255,0.04)';
    q.beginPath(); q.moveTo(cx, cy); q.arc(cx, cy, R, a - Math.PI / 4, a + Math.PI / 4); q.closePath(); q.fill();
    q.strokeStyle = 'rgba(255,255,255,0.3)'; q.lineWidth = 1 * d; q.stroke();
    font(q, 11, d, 600); q.fillStyle = sg ? C.text : C.dim; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.fillText(`${sg > 0 ? '+' : sg < 0 ? '−' : ''}${nm}`, cx + Math.cos(a) * R * 0.62, cy - Math.sin(a) * R * 0.62);
  }
  q.fillStyle = C.bg; q.beginPath(); q.arc(cx, cy, R * 0.25, 0, 7); q.fill(); q.textAlign = 'left';
  label(q, `${P.segLabel(S.seg)}: ${P.segKind(S.seg)}`, cx, 12 * d, d, { color: C.accent, size: 9, align: 'center' });
  label(q, 'click a segment: + / − / off', cx, s.H - 12 * d, d, { color: C.muted, size: 8.5, align: 'center' });
}

// ------------------------------------------------------------------ EBSD / TKD maps
function drawMap(sim, S, m, s, hover) {
  const M = sim.map, { ctx, W, H, dpr } = m;
  if (!M) return;
  const N = M.N;
  layout.map = { N };
  const { c, ctx: oc, id } = off(N, N);
  let bcMax = 0;
  for (let k = 0; k < M.done; k++) bcMax = Math.max(bcMax, M.bc[k]);
  for (let k = 0; k < N * N; k++) {
    const p = k * 4;
    let col = [0, 0, 0];
    if (k < M.done) {
      if (S.mapView === 'bc') { const v = clamp(M.bc[k] / (bcMax || 1), 0, 1) * 255; col = [v, v, v]; }
      else if (S.mapView === 'mad') col = M.O[k] ? hsv(0.33 * (1 - clamp(M.mad[k] / 2, 0, 1)), 0.8, 0.95) : [0, 0, 0];
      else col = M.O[k] ? P.ipfColor(M.O[k]) : [0, 0, 0];
    } else col = [8, 10, 14];
    id.data[p] = col[0]; id.data[p + 1] = col[1]; id.data[p + 2] = col[2]; id.data[p + 3] = 255;
  }
  oc.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, 0, 0, N, N, 0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  const sel = hover >= 0 ? hover : Math.max(0, M.done - 1), si = sel % N, sj = (sel / N) | 0;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * dpr;
  ctx.strokeRect((si / N) * W - 1, (sj / N) * H - 1, W / N + 2, H / N + 2);
  scaleBar(ctx, W, H, M.fov, dpr);
  const pct = Math.round((100 * M.done) / (N * N));
  const rate = M.done ? Math.round((100 * M.ok) / M.done) : 0;
  label(ctx, `${S.mode.toUpperCase()} map ${N}×${N} · step ${fmtLen(M.fov / N)} · ${pct < 100 ? `${pct}%` : 'done'} · indexed ${rate}%`, 8 * dpr, 16 * dpr, dpr, { color: C.accent, size: 9 });
  if (M.ok) label(ctx, `mean error vs truth ${(M.errSum / M.ok).toFixed(2)}°`, 8 * dpr, 36 * dpr, dpr, { color: C.muted, size: 9 });
  label(ctx, { ipf: 'IPF-Z colouring', bc: 'band contrast', mad: 'MAD (green = good fit)' }[S.mapView], W - 8 * dpr, H - 30 * dpr, dpr, { color: C.muted, size: 9, align: 'right' });

  // secondary: Kikuchi pattern + indexing
  const q = s.ctx, d = s.dpr, sz = Math.min(s.H, s.W * 0.55);
  const a = sel < M.done ? sim.patternAt(sel) : null;
  layout.pat = { sz };
  if (!a) return;
  const Np = 144;
  const pat = a.pat;
  let arr = pat;
  if (!real(S)) { // background correction, as done before indexing
    const bg = blurred(pat, Np, Np, Np / 12);
    arr = new Float32Array(Np * Np);
    for (let i = 0; i < arr.length; i++) arr[i] = pat[i] ? pat[i] / (bg[i] || 1) : 0;
  }
  const inside = [];
  for (let i = 0; i < arr.length; i++) if (arr[i]) inside.push(arr[i]);
  const [lo, hi] = range(Float32Array.from(inside), 0.01, 0.995);
  paint(q, arr, Np, Np, [0, 0, sz, sz], { lo, hi, lut: real(S) ? LUT.gray : LUT.phosphor });
  q.strokeStyle = 'rgba(255,255,255,0.15)'; q.lineWidth = 1 * d; q.beginPath(); q.arc(sz / 2, sz / 2, sz / 2 - 1, 0, 7); q.stroke();
  const G = sim.geom(), toPx = (u, v) => [((u + 1) / 2) * sz, ((1 - v) / 2) * sz];
  // pattern centre
  const [pcx, pcy] = toPx(G.pcx, G.pcy);
  q.strokeStyle = C.warm; q.beginPath(); q.moveTo(pcx - 6 * d, pcy); q.lineTo(pcx + 6 * d, pcy); q.moveTo(pcx, pcy - 6 * d); q.lineTo(pcx, pcy + 6 * d); q.stroke();
  if (a.peaks && S.showHough) {
    q.strokeStyle = 'rgba(111,214,255,0.8)'; q.lineWidth = 1.2 * d;
    q.save(); q.beginPath(); q.arc(sz / 2, sz / 2, sz / 2, 0, 7); q.clip();
    for (const pk of a.peaks) {
      const ct = Math.cos(pk.theta), st = Math.sin(pk.theta);
      const [x1, y1] = toPx(pk.rho * ct - 2 * st, pk.rho * st + 2 * ct), [x2, y2] = toPx(pk.rho * ct + 2 * st, pk.rho * st - 2 * ct);
      q.beginPath(); q.moveTo(x1, y1); q.lineTo(x2, y2); q.stroke();
    }
    q.restore();
  }
  // zone axes from the indexed orientation
  if (a.res && !real(S)) {
    const T = sim.tiltM();
    for (const z of [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 1, 2]]) {
      const perms = new Set();
      for (const Sm of P.CUBIC) {
        const v = P.mat3.mv(Sm, z), key = v.join(',');
        if (perms.has(key)) continue; perms.add(key);
        const rm = P.mat3.mv(T, P.mat3.mv(a.res.O, P.norm(v)));
        let u, w;
        if (G.type === 'ebsd') { if (rm[1] <= 0.05) continue; u = (rm[0] / rm[1]) * G.D + G.pcx; w = (rm[2] / rm[1]) * G.D + G.pcy; }
        else { if (rm[2] >= -0.05) continue; u = (rm[0] / -rm[2]) * G.D + G.pcx; w = (rm[1] / -rm[2]) * G.D + G.pcy; }
        if (u * u + w * w > 0.85) continue;
        const [x, y] = toPx(u, w);
        q.fillStyle = C.warm; q.beginPath(); q.arc(x, y, 2.5 * d, 0, 7); q.fill();
        label(q, `[${v.map((c) => (c < 0 ? `${-c}̅` : c)).join('')}]`, x + 4 * d, y - 8 * d, d, { color: '#ffe2b8', size: 8 });
      }
    }
  }
  // indexing report
  const tx = sz + 14 * d;
  const rows = [];
  if (!a.res) rows.push(['result', a.phase && P.MAT[a.phase]?.cryst ? 'not indexed' : `${P.MAT[a.phase]?.name ?? 'vacuum'}: no pattern`]);
  else {
    const r = a.res;
    rows.push(['phase', `${P.MAT[r.phase].name} (${P.MAT[r.phase].cryst === 'dia' ? 'Fd3̄m' : 'Fm3̄m'})`], ['bands', `${r.matched} / ${r.K} matched`], ['MAD', `${(r.mad / P.DEG).toFixed(2)}°`], ['CI', r.ci.toFixed(2)], ['error vs truth', `${r.err.toFixed(2)}°`]);
    const e = euler(r.O);
    rows.push(['Euler (Bunge)', `${e.map((v) => v.toFixed(0)).join('°, ')}°`]);
  }
  rows.push(['pattern centre', `(${G.pcx.toFixed(2)}, ${G.pcy.toFixed(2)}) · DD ${G.D.toFixed(2)}`]);
  let y = 16 * d;
  for (const [k, v] of rows) {
    font(q, 8.5, d); q.fillStyle = C.muted; q.textBaseline = 'top'; q.fillText(k.toUpperCase(), tx, y);
    font(q, 11, d, 500); q.fillStyle = C.text; q.fillText(v, tx, y + 11 * d);
    y += 30 * d;
  }
  // IPF colour key: the [001]–[101]–[111] standard triangle
  const L = 46 * d, A = [s.W - 70 * d, s.H - 18 * d], B = [A[0] + L, A[1]], Cv = [A[0] + L * 0.8, A[1] - L * 0.75];
  const V = [[0, 0, 1], [Math.SQRT1_2, 0, Math.SQRT1_2], [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)]];
  const st = 18;
  for (let i = 0; i <= st; i++) for (let j = 0; j <= st - i; j++) {
    const b = i / st, c = j / st, a0 = 1 - b - c;
    const dir = P.norm([0, 1, 2].map((k) => a0 * V[0][k] + b * V[1][k] + c * V[2][k]));
    const col = P.ipfColor(frameTo(dir));
    const x = a0 * A[0] + b * B[0] + c * Cv[0], y = a0 * A[1] + b * B[1] + c * Cv[1];
    q.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
    q.fillRect(x - 1.6 * d, y - 1.6 * d, 3.4 * d, 3.4 * d);
  }
  font(q, 8, d); q.fillStyle = C.muted; q.textBaseline = 'top';
  q.fillText('001', A[0] - 8 * d, A[1] + 4 * d); q.fillText('101', B[0] - 8 * d, B[1] + 4 * d); q.textBaseline = 'bottom'; q.fillText('111', Cv[0] - 8 * d, Cv[1] - 4 * d);
}
// an orientation whose sample-Z lies along crystal direction v (rows of O = sample axes in crystal coords)
function frameTo(v) {
  const z = v, x = P.norm(P.cross([0.13, 1, 0.07], z)), y = P.cross(z, x);
  return [x, y, z];
}
function euler(O) {
  // Bunge angles of the crystal→sample matrix
  const g = P.mat3.T(O), Phi = Math.acos(clamp(g[2][2], -1, 1));
  let p1, p2;
  if (Math.abs(Math.sin(Phi)) > 1e-6) { p1 = Math.atan2(g[2][0], -g[2][1]); p2 = Math.atan2(g[0][2], g[1][2]); }
  else { p1 = Math.atan2(g[0][1], g[0][0]); p2 = 0; }
  const d = (v) => (((v / P.DEG) % 360) + 360) % 360;
  return [d(p1), Phi / P.DEG, d(p2)];
}

// ------------------------------------------------------------------ EDS
function drawEDS(sim, S, m, s) {
  const e = sim.eds, a = sim.acc;
  if (!e || !a) return;
  const { ctx, W, H, dpr } = m, n = e.n;
  const syms = S.edsSel === 'all' ? e.syms : [S.edsSel];
  // colour each pixel by its element mix (weighted mean colour), brightness by the strongest element
  const { c, ctx: oc, id } = off(n, n), buf = new Float32Array(n * n * 3), wsum = new Float32Array(n * n), vmax = new Float32Array(n * n);
  for (const sym of syms) {
    const src = real(S) ? a.maps[sym] : e.maps[sym];
    let mx = 0;
    for (let i = 0; i < n * n; i++) mx = Math.max(mx, src[i]);
    const col = syms.length === 1 && real(S) ? [255, 255, 255] : hex(P.EL_COLOR[sym]);
    for (let i = 0; i < n * n; i++) {
      const v = src[i] / (mx || 1), w = v * v;
      buf[i * 3] += w * col[0]; buf[i * 3 + 1] += w * col[1]; buf[i * 3 + 2] += w * col[2];
      wsum[i] += w; if (v > vmax[i]) vmax[i] = v;
    }
  }
  for (let i = 0; i < n * n; i++) {
    const k = wsum[i] ? Math.pow(vmax[i], 0.8) / wsum[i] : 0;
    id.data[i * 4] = buf[i * 3] * k; id.data[i * 4 + 1] = buf[i * 3 + 1] * k; id.data[i * 4 + 2] = buf[i * 3 + 2] * k; id.data[i * 4 + 3] = 255;
  }
  oc.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = !real(S);
  ctx.drawImage(c, 0, 0, n, n, 0, 0, W, H);
  scaleBar(ctx, W, H, S.fov, dpr);
  let yy = 16 * dpr;
  for (const sym of syms) { label(ctx, sym, 8 * dpr, yy, dpr, { color: P.EL_COLOR[sym] }); yy += 20 * dpr; }
  label(ctx, `X-ray range ≈ ${fmtLen(e.Rx)}`, W - 8 * dpr, 16 * dpr, dpr, { color: C.warm, size: 9, align: 'right' });
  label(ctx, `${a.t.toFixed(1)} s · ${Math.round(a.total).toLocaleString()} counts`, W - 8 * dpr, 36 * dpr, dpr, { color: C.muted, size: 9, align: 'right' });
  // spectrum
  const q = s.ctx, d = s.dpr, x0 = 38 * d, y0 = 16 * d, w = s.W - x0 - 10 * d, h = s.H - y0 - 30 * d, Emax = e.Emax;
  layout.eds = { x0: x0 / d, w: w / d, Emax };
  const data = real(S) ? a.spec : e.spec;
  let mx = 0;
  for (let b = Math.floor(0.2 / e.dE); b < e.nb; b++) mx = Math.max(mx, data[b]);
  const X = (E) => x0 + (E / Emax) * w;
  q.strokeStyle = C.grid; q.lineWidth = 1 * d;
  font(q, 9, d); q.fillStyle = C.muted; q.textAlign = 'center'; q.textBaseline = 'top';
  const step = Emax > 16 ? 5 : 2;
  for (let E = 0; E <= Emax; E += step) { q.beginPath(); q.moveTo(X(E), y0); q.lineTo(X(E), y0 + h); q.stroke(); q.fillText(`${E}`, X(E), y0 + h + 4 * d); }
  q.fillText('keV', x0 + w - 8 * d, y0 + h + 14 * d); q.textAlign = 'left';
  q.beginPath();
  for (let b = 0; b < e.nb; b++) { const x = X((b + 0.5) * e.dE), y = y0 + h - Math.min(1, data[b] / (mx || 1)) * h * 0.92; b ? q.lineTo(x, y) : q.moveTo(x, y); }
  q.lineTo(x0 + w, y0 + h); q.lineTo(x0, y0 + h); q.closePath();
  const gg = q.createLinearGradient(0, y0, 0, y0 + h); gg.addColorStop(0, 'rgba(255,180,94,0.5)'); gg.addColorStop(1, 'rgba(255,180,94,0.04)');
  q.fillStyle = gg; q.fill(); q.strokeStyle = C.warm; q.lineWidth = 1.2 * d; q.stroke();
  // Duane–Hunt limit
  q.setLineDash([3 * d, 3 * d]); q.strokeStyle = C.accent; q.beginPath(); q.moveTo(X(S.kV), y0); q.lineTo(X(S.kV), y0 + h); q.stroke(); q.setLineDash([]);
  if (S.kV < Emax) label(q, `Duane–Hunt limit = ${S.kV} keV`, X(S.kV) - 4 * d, y0 + 8 * d, d, { color: C.accent, size: 8.5, align: 'right' });
  const placed = [];
  for (const L of P.XLINES.filter((l) => e.comp[l.el] && l.w >= 0.5 && S.kV > l.Ec)) {
    const b = Math.floor(L.E / e.dE);
    let pk = 0;
    for (let k = b - 4; k <= b + 4; k++) pk = Math.max(pk, data[k] || 0);
    const x = X(L.E), y = Math.max(y0 + 8 * d, y0 + h - Math.min(1, pk / (mx || 1)) * h * 0.92 - 12 * d);
    if (placed.some((p) => Math.abs(p[0] - x) < 40 * d && Math.abs(p[1] - y) < 14 * d)) continue;
    placed.push([x, y]);
    label(q, `${L.el} ${L.line}`, x, y, d, { color: P.EL_COLOR[L.el], size: 8.5, align: 'center' });
  }
  const missing = P.XLINES.filter((l) => e.comp[l.el] && l.w === 1 && S.kV <= l.Ec * 1.5 && S.kV > 0);
  if (missing.length) label(q, `U = E₀/Ec < 1.5 for ${[...new Set(missing.map((l) => `${l.el} ${l.line.startsWith('K') ? 'K' : l.line[0]}`))].join(', ')}: weak or absent`, x0, y0 + h - 12 * d, d, { color: C.warm, size: 8.5 });
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ------------------------------------------------------------------ Monte Carlo
function drawMC(sim, S, m, s) {
  const mc = sim.mc, { ctx, W, H, dpr } = m;
  if (!mc) { label(ctx, 'beam on vacuum: move the stage onto the specimen', W / 2, H / 2, dpr, { color: C.warm, align: 'center' }); return; }
  const R = Math.max(mc.R, mc.maxDepth) * 1.05, oy = H * 0.2, sc = Math.min(W / (1.7 * R), (H - oy - 8 * dpr) / R), ox = W / 2;
  ctx.fillStyle = '#0b0f15'; ctx.fillRect(0, oy, W, H - oy);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1 * dpr; ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  for (const t of mc.traj) {
    ctx.beginPath();
    t.pts.forEach(([x, z], i) => (i ? ctx.lineTo(ox + x * sc, oy + z * sc) : ctx.moveTo(ox + x * sc, oy + z * sc)));
    const E = t.pts[t.pts.length - 1][2] / mc.E0;
    const [r, g, b] = t.bse ? [255, 180, 94] : real(S) ? [200, 205, 215] : hsv(0.55 + 0.25 * (1 - E), 0.75, 1);
    ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${t.bse ? 0.75 : 0.35})`;
    ctx.lineWidth = (t.bse ? 1.1 : 0.8) * dpr; ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  // incident beam
  const tb = S.tilt * P.DEG;
  ctx.strokeStyle = C.green; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(ox - Math.sin(tb) * oy * 0.9, oy - Math.cos(tb) * oy * 0.9); ctx.lineTo(ox, oy); ctx.stroke();
  const Rk = P.rangeKO(mc.m, mc.E0) * 1000;
  ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.strokeStyle = 'rgba(111,214,255,0.6)';
  ctx.beginPath(); ctx.moveTo(0, oy + Rk * sc); ctx.lineTo(W, oy + Rk * sc); ctx.stroke();
  if (sim.mcLine) { const Rx = P.rangeX(mc.m, mc.E0, sim.mcLine.Ec) * 1000; ctx.strokeStyle = 'rgba(255,180,94,0.6)'; ctx.beginPath(); ctx.moveTo(0, oy + Rx * sc); ctx.lineTo(W, oy + Rx * sc); ctx.stroke(); label(ctx, `X-ray range (${sim.mcLine.el} ${sim.mcLine.line}) ${fmtLen(Rx / 1000)}`, 8 * dpr, oy + Rx * sc - 10 * dpr, dpr, { color: C.warm, size: 8.5 }); }
  ctx.setLineDash([]);
  label(ctx, `Kanaya–Okayama range ${fmtLen(Rk / 1000)}`, 8 * dpr, oy + Rk * sc + 12 * dpr, dpr, { color: C.accent, size: 8.5 });
  label(ctx, `${mc.m.name} · ${mc.E0} keV · tilt ${S.tilt}° · ${mc.n.toLocaleString()} electrons`, 8 * dpr, 14 * dpr, dpr, { color: C.text, size: 9 });
  label(ctx, `η (Monte Carlo) = ${mc.eta.toFixed(3)} · η (Reuter/Arnal) = ${P.eta(mc.m.Z, tb).toFixed(3)}`, 8 * dpr, 34 * dpr, dpr, { color: C.warm, size: 9 });
  // scale bar
  const target = 2 * R * 0.25, e = Math.pow(10, Math.floor(Math.log10(target))), L = [1, 2, 5].map((k) => k * e).filter((v) => v <= target).pop() || e;
  ctx.fillStyle = '#fff'; ctx.fillRect(W - 12 * dpr - L * sc, H - 14 * dpr, L * sc, 3 * dpr);
  font(ctx, 10, dpr, 500); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(fmtLen(L / 1000), W - 12 * dpr - (L * sc) / 2, H - 17 * dpr); ctx.textAlign = 'left';

  // secondary: BSE energy spectrum + depth distributions
  const q = s.ctx, d = s.dpr, pw = (s.W - 30 * d) / 2, ph = s.H - 50 * d;
  // BSE energy
  let bm = 0;
  for (const v of mc.bseE) bm = Math.max(bm, v);
  const bx = 14 * d, by = 22 * d;
  q.fillStyle = 'rgba(255,180,94,0.7)';
  mc.bseE.forEach((v, i) => { const hh = (v / (bm || 1)) * ph; q.fillRect(bx + (i / 40) * pw, by + ph - hh, pw / 40 - 1, hh); });
  q.strokeStyle = C.grid; q.strokeRect(bx, by, pw, ph);
  label(q, 'backscattered energy  E/E₀', bx, 10 * d, d, { color: C.muted, size: 9 });
  font(q, 9, d); q.fillStyle = C.muted; q.fillText('0', bx, by + ph + 12 * d); q.fillText('1', bx + pw - 6 * d, by + ph + 12 * d);
  // depth profiles
  const dx = bx + pw + 16 * d;
  const norm = (a) => { let mx = 0; for (const v of a) mx = Math.max(mx, v); return Array.from(a, (v) => v / (mx || 1)); };
  const dep = norm(mc.depthE), phi = norm(mc.phi);
  const plot = (arr, col) => { q.beginPath(); arr.forEach((v, i) => { const x = dx + v * pw, y = by + (i / arr.length) * ph; i ? q.lineTo(x, y) : q.moveTo(x, y); }); q.strokeStyle = col; q.lineWidth = 1.6 * d; q.stroke(); };
  plot(dep, C.accent);
  if (sim.mcLine) plot(phi, C.warm);
  q.strokeStyle = C.grid; q.lineWidth = 1 * d; q.strokeRect(dx, by, pw, ph);
  label(q, 'depth ↓: energy deposited', dx, 10 * d, d, { color: C.accent, size: 9 });
  if (sim.mcLine) label(q, `φ(ρz) ${sim.mcLine.el} ${sim.mcLine.line}`, dx + pw, by + 12 * d, d, { color: C.warm, size: 9, align: 'right' });
  font(q, 9, d); q.fillStyle = C.muted; q.fillText(fmtLen(0), dx - 2 * d, by + ph + 12 * d); q.fillText(`${fmtLen((mc.R * 1.25) / 1000)}`, dx + pw - 44 * d, by + ph + 12 * d);
}
