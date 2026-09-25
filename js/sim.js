// Simulation engine: SEM image formation, EBSD/TKD patterns + indexing, EDS, Monte Carlo.
import * as P from './physics.js';

const { clamp, mat3, DEG } = P;
const SP = P.SPECIMENS;
const MKEYS = Object.keys(P.MAT);

// separable Gaussian blur (edge-clamped) returning a new array
export function blurred(a, w, h, sx, sy = sx) {
  let src = a;
  const pass = (arr, s, horiz) => {
    if (s < 0.35) return arr;
    const R = Math.min(60, Math.ceil(3 * s)), k = new Float32Array(2 * R + 1);
    let sum = 0;
    for (let i = -R; i <= R; i++) { k[i + R] = Math.exp((-0.5 * i * i) / (s * s)); sum += k[i + R]; }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const out = new Float32Array(w * h);
    if (horiz) for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) { let v = 0; for (let i = -R; i <= R; i++) v += arr[o + clamp(x + i, 0, w - 1)] * k[i + R]; out[o + x] = v; } }
    else for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let i = -R; i <= R; i++) v += arr[clamp(y + i, 0, h - 1) * w + x] * k[i + R]; out[y * w + x] = v; }
    return out;
  };
  src = pass(src, sx, true);
  src = pass(src, sy, false);
  return src === a ? Float32Array.from(a) : src;
}

export class Sim {
  constructor(S) {
    this.S = S;
    this.stale = { img: 1, map: 1, eds: 1, mc: 1 };
    this.version = 0;
    this.raster = 0; this.frame = 0;
    this.astig = 0.9; // hidden residual astigmatism (µm) the operator must correct with the stigmator
  }
  get spec() { return SP[this.S.spec]; }
  get probe() { return P.probe(this.S); }
  invalidate(key) {
    const only = { etdBias: ['img'], bseMode: ['img'], mapView: [], edsSel: [], dwell: ['img'], hover: [] };
    for (const k of only[key] ?? ['img', 'map', 'eds', 'mc']) this.stale[k] = 1;
    this.version++;
  }
  // sample → microscope rotation (stage tilted about x toward the EBSD detector)
  tiltM() { return mat3.rx(-this.S.tilt * DEG); }

  // ------------------------------------------------------------------ imaging
  sampleGrid(n, fov, cx, cy) {
    const key = [this.S.spec, n, fov, cx, cy].join('|');
    if (this._grid?.key === key) return this._grid;
    const spec = this.spec, px = fov / n;
    const H = new Float32Array(n * n), M = new Uint8Array(n * n), ori = new Array(n * n);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = cx + (i + 0.5 - n / 2) * px, y = cy - (j + 0.5 - n / 2) * px;
        const s = spec.sample(x, y, px), k = j * n + i;
        H[k] = s.h; M[k] = MKEYS.indexOf(s.mat); ori[k] = s.ori;
      }
    return (this._grid = { H, M, ori, px, n, key });
  }
  computeImage() {
    const S = this.S, n = 256, fov = S.fov, E = S.kV;
    const g = this.sampleGrid(n, fov, S.cx, S.cy);
    const { H, M, ori, px } = g;
    const t = S.tilt * DEG, T = this.tiltM();
    // dominant material for interaction ranges
    const cnt = new Map();
    for (let i = 0; i < n * n; i += 7) cnt.set(M[i], (cnt.get(M[i]) || 0) + 1);
    const dom = P.MAT[MKEYS[[...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0]]];
    const Rko = P.rangeKO(dom.rho ? dom : P.MAT.Ni, E); // µm
    const sBSE = (0.25 * Rko) / px, sEdge = Math.max(0.6, (0.15 * Rko) / px);
    const Hb = P.clamp(sEdge, 0, 60) > 0.35 ? blurred(H, n, n, Math.min(60, sEdge)) : H;
    const se1 = new Float32Array(n * n), bse = new Float32Array(n * n), topo = new Float32Array(n * n), face = new Float32Array(n * n), edge = new Float32Array(n * n);
    const beamS = mat3.tmv(T, [0, 0, -1]);
    const det = P.norm([-1, 0.25, 0.6]); // ETD sits to the left, above the sample
    const coatM = P.MAT.C;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i, m = P.MAT[MKEYS[M[k]]];
        const hx = (H[j * n + Math.min(n - 1, i + 1)] - H[j * n + Math.max(0, i - 1)]) / (2 * px);
        const hy = (H[Math.max(0, j - 1) * n + i] - H[Math.min(n - 1, j + 1) * n + i]) / (2 * px);
        const nS = P.norm([-hx, -hy, 1]), nM = mat3.mv(T, nS);
        const cosI = clamp(nM[2], 0.05, 1), inc = Math.acos(cosI);
        if (!m.rho) { se1[k] = 0; bse[k] = 0; continue; }
        const mm = S.coated && !m.cond ? { ...m, dmax: coatM.dmax * 0.6 + m.dmax * 0.4 } : m;
        se1[k] = P.delta(mm, E) / Math.max(0.15, cosI);
        let et = P.eta(m.Z, inc);
        const O = ori[k];
        if (O) {
          // electron channelling: backscattering drops when the beam runs down a low-index zone axis
          const b = mat3.tmv(O, beamS).map(Math.abs).sort((p, q) => q - p);
          const a100 = Math.acos(clamp(b[0], -1, 1)), a110 = Math.acos(clamp((b[0] + b[1]) / Math.SQRT2, -1, 1)), a111 = Math.acos(clamp((b[0] + b[1] + b[2]) / Math.sqrt(3), -1, 1));
          const ch = 0.12 * Math.exp(-((a100 / (5 * DEG)) ** 2)) + 0.09 * Math.exp(-((a110 / (4 * DEG)) ** 2)) + 0.07 * Math.exp(-((a111 / (4 * DEG)) ** 2));
          et *= 1 - ch - 0.04 * b[2];
        }
        bse[k] = et;
        topo[k] = et * (nM[0] * 1.2);
        face[k] = clamp(0.55 + 0.7 * P.dot(nM, det), 0.15, 1.25);
        edge[k] = Math.max(0, H[k] - Hb[k]) / Math.max(1e-6, 0.15 * Rko);
      }
    // shadowing toward the ETD (ray-march across the height field)
    const shadow = new Float32Array(n * n).fill(1);
    const tanE = Math.tan(28 * DEG);
    if (S.mode === 'se') for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i, h0 = H[k];
        for (let s = 2; s < 40 && i - s >= 0; s += 2) if (H[j * n + i - s] > h0 + s * px * tanE) { shadow[k] = 0.5; break; }
      }
    const bseB = blurred(bse, n, n, sBSE * 0.6), se2src = blurred(bse, n, n, sBSE);
    const beta = clamp(1 + 0.09 * E, 1, 3.5);
    const out = new Float32Array(n * n);
    const mode = S.mode;
    for (let k = 0; k < n * n; k++) {
      const m = P.MAT[MKEYS[M[k]]];
      if (!m.rho) { out[k] = 0; continue; }
      const dN = P.delta(m, E);
      const SE1 = se1[k] * (1 + 0.8 * Math.min(3, edge[k])), SE2 = dN * beta * se2src[k];
      let v;
      if (mode === 'inlens') v = (SE1 + 0.35 * SE2) * (1 / (1 + (S.wd / 5) ** 2));
      else if (mode === 'bse' || mode === 'ebsd' || mode === 'tkd') v = S.bseMode === 'topo' ? 0.5 + 2.2 * topo[k] + 0.3 * bseB[k] : bseB[k];
      else if (S.etdBias < 0) v = 0.6 * bse[k] * face[k] * face[k] * shadow[k];
      else v = (SE1 + SE2) * face[k] * shadow[k] * (0.5 + 0.5 * clamp(S.etdBias / 250, 0, 1)) + 0.2 * bse[k] * face[k] * shadow[k];
      out[k] = v;
    }
    // charging of uncoated insulators above the second crossover E2: bright blooms and streaks along the scan
    let charging = false;
    if (mode !== 'bse') {
      for (let j = 0; j < n; j++) {
        let c = 0;
        for (let i = 0; i < n; i++) {
          const k = j * n + i, m = P.MAT[MKEYS[M[k]]];
          if (P.charges(m, E, S.coated)) { c = Math.min(2.5, c + 0.06 * clamp((E - m.E2) / m.E2, 0.2, 2)); charging = true; }
          else c *= 0.965;
          out[k] += c;
        }
      }
    }
    // focus, astigmatism and depth of field → blur
    const pr = this.probe, alpha = pr.alpha;
    const sProbe = pr.d / 1000 / 2.355 / px;
    const ast = S.stig - this.astig;
    const hRef = H[(n / 2) * n + n / 2];
    // per-pixel defocus from height (depth of field) handled by blending a blur pyramid
    // only build the blur levels this image actually needs
    const dof = new Float32Array(n * n);
    let sMax = 0;
    for (let k = 0; k < n * n; k++) { const dz = S.focus + (H[k] - hRef); dof[k] = Math.hypot((alpha * Math.abs(dz)) / px, sProbe); if (dof[k] > sMax) sMax = dof[k]; }
    const levels = [0, 1, 2, 4, 8, 16].filter((l, i, a) => i < 2 || a[i - 1] < sMax);
    const pyr = levels.map((s) => (s ? blurred(out, n, n, s) : out));
    const res = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) {
      const s = dof[k];
      let lv = 0;
      while (lv < levels.length - 2 && levels[lv + 1] < s) lv++;
      const f = clamp((s - levels[lv]) / (levels[lv + 1] - levels[lv]), 0, 1);
      res[k] = pyr[lv][k] * (1 - f) + pyr[lv + 1][k] * f;
    }
    const sx = (alpha * Math.abs(S.focus + ast)) / px, sy = (alpha * Math.abs(S.focus - ast)) / px;
    const final = Math.abs(ast) > 0.02 || Math.abs(S.focus) > 0.01 ? blurred(res, n, n, Math.max(0, sx - 0.3), Math.max(0, sy - 0.3)) : res;
    this.img = { arr: final, n, px, charging, Rko, dom, sharp: this.sharpness(final, n) };
    this.grid = g;
    this.main = { arr: final, w: n, h: n };
    this.raster = 0; this.firstPass = this.frame;
  }
  sharpness(a, n) {
    let s = 0, m = 0;
    for (let i = 0; i < n * n; i++) m += a[i];
    m /= n * n;
    for (let j = 1; j < n - 1; j += 2) for (let i = 1; i < n - 1; i += 2) { const gx = a[j * n + i + 1] - a[j * n + i - 1], gy = a[(j + 1) * n + i] - a[(j - 1) * n + i]; s += gx * gx + gy * gy; }
    return Math.sqrt(s / ((n * n) / 4)) / (m || 1);
  }

  // ------------------------------------------------------------------ Kikuchi patterns
  geom() {
    const S = this.S;
    return S.mode === 'tkd' ? { type: 'tkd', D: 0.85, pcx: 0, pcy: 0 } : { type: 'ebsd', D: 0.9, pcx: 0.0, pcy: 0.25 };
  }
  // direction (microscope frame) for screen point (u, v) in [-1, 1]
  dirM(G, u, v) { return G.type === 'tkd' ? [u - G.pcx, v - G.pcy, -G.D] : [u - G.pcx, G.D, v - G.pcy]; }
  simPattern(grains, N, noise = true) {
    const S = this.S, G = this.geom(), T = this.tiltM(), out = new Float32Array(N * N);
    const quality = G.type === 'ebsd' ? Math.exp(-(((S.tilt - 70) / 18) ** 2)) : Math.exp(-(((S.tkdThick - 90) / 110) ** 2)) * (S.tilt < 25 ? 1 : 0.2);
    const lists = grains.map((g) => ({ ...g, B: g.cryst ? P.kikuchiBands(g.mat, S.kV).bands : null, OT: g.O ? mat3.T(g.O) : null }));
    const TT = mat3.T(T);
    const sMin = 1.1 / (N * G.D); // bands narrower than ~a pixel are rendered at pixel width (detector binning)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const u = ((i + 0.5) / N) * 2 - 1, v = 1 - ((j + 0.5) / N) * 2;
        if (u * u + v * v > 1) continue;
        const rm = P.norm(this.dirM(G, u, v)), rs = mat3.mv(TT, rm);
        const bg = G.type === 'ebsd' ? 0.35 + Math.exp(-(((v + 0.55) / 0.95) ** 2)) * 0.9 + 0.15 * (1 - Math.abs(u)) : 0.3 + Math.exp(-(u * u + v * v) / 0.35);
        let band = 0;
        for (const g of lists) {
          if (!g.B) continue;
          const rc = mat3.mv(g.OT, rs);
          let b = 0;
          for (const B of g.B) {
            const d = Math.abs(rc[0] * B.n[0] + rc[1] * B.n[1] + rc[2] * B.n[2]), x = d / Math.max(B.sB, sMin);
            if (x < 1) b += B.w * (0.55 + 0.45 * Math.cos(Math.PI * x));
            else if (x < 1.35) b -= B.w * 0.18 * Math.sin((Math.PI * (x - 1)) / 0.35);
          }
          band += g.w * b;
        }
        out[j * N + i] = bg * (1 + 0.28 * quality * band);
      }
    if (noise) {
      const counts = (S.expo / 10) * (S.current / 1000) * 120 * (S.clarity === 'real' ? 1 : 4);
      for (let k = 0; k < N * N; k++) if (out[k]) out[k] = P.poisson(out[k] * counts) / counts;
    }
    return out;
  }
  grainsAt(x, y) {
    const S = this.S, spec = this.spec, G = this.geom();
    const dom = spec.sample(x, y);
    const m = P.MAT[dom.mat];
    const R = P.rangeKO(m.rho ? m : P.MAT.Ni, S.kV);
    const r = G.type === 'tkd' ? 0.004 + (S.tkdThick / 1000) * 0.06 : 0.02 * R; // lateral resolution, µm
    const ry = G.type === 'tkd' ? r : r / Math.cos(Math.min(80, S.tilt) * DEG);
    const pts = [[0, 0, 0.4], [r, 0, 0.15], [-r, 0, 0.15], [0, ry, 0.15], [0, -ry, 0.15]];
    const acc = new Map();
    for (const [dx, dy, w] of pts) {
      const s = spec.sample(x + dx, y + dy);
      const key = s.ori ? `${s.mat}:${s.grain}` : `am:${s.mat}`;
      const e = acc.get(key) || { w: 0, O: s.ori, mat: s.mat, cryst: !!(P.MAT[s.mat].cryst && s.ori), grain: s.grain };
      e.w += w; acc.set(key, e);
    }
    return [...acc.values()].sort((a, b) => b.w - a.w);
  }

  // Hough transform: find the strongest straight bands (plane traces in the gnomonic projection).
  hough(img, N, K) {
    const nT = 90, nR = N, acc = new Float32Array(nT * nR);
    const bgs = blurred(img, N, N, N / 10);
    const cs = [], sn = [];
    for (let t = 0; t < nT; t++) { cs.push(Math.cos((t * Math.PI) / nT)); sn.push(Math.sin((t * Math.PI) / nT)); }
    const c = N / 2, rMax = N * 0.72;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = i + 0.5 - c, y = c - (j + 0.5);
        if (x * x + y * y > c * c * 0.88) continue;
        const v = img[j * N + i] - bgs[j * N + i];
        if (v <= 0) continue;
        for (let t = 0; t < nT; t++) {
          const r = x * cs[t] + y * sn[t], ri = Math.round(((r + rMax) / (2 * rMax)) * (nR - 1));
          acc[t * nR + ri] += v;
        }
      }
    // normalise by chord length so central and edge bands compete fairly; ignore chords too short to trust
    for (let t = 0; t < nT; t++) for (let ri = 0; ri < nR; ri++) {
      const r = (ri / (nR - 1)) * 2 * rMax - rMax, L2 = c * c * 0.88 - r * r;
      acc[t * nR + ri] = Math.abs(r) > 0.7 * c ? 0 : acc[t * nR + ri] / (2 * Math.sqrt(Math.max(L2, 0.25 * c * c)));
    }
    const peaks = [];
    const taken = new Uint8Array(nT * nR);
    for (let p = 0; p < K; p++) {
      let best = -1, bi = -1;
      for (let i = 0; i < nT * nR; i++) if (!taken[i] && acc[i] > best) { best = acc[i]; bi = i; }
      if (bi < 0 || best <= 0) break;
      const t = Math.floor(bi / nR), ri = bi % nR;
      peaks.push({ theta: (t * Math.PI) / nT, rho: ((ri / (nR - 1)) * 2 * rMax - rMax) / c, h: best });
      for (let dt = -5; dt <= 5; dt++) for (let dr = -4; dr <= 4; dr++) {
        const tt = (t + dt + nT) % nT, rr = dt + t < 0 || dt + t >= nT ? nR - 1 - (ri + dr) : ri + dr;
        if (rr >= 0 && rr < nR) taken[tt * nR + rr] = 1;
      }
    }
    return { peaks, acc, nT, nR };
  }
  // Band (ρ, θ on the screen) → plane normal in the sample frame
  bandNormal(pk) {
    const G = this.geom(), T = this.tiltM();
    const ct = Math.cos(pk.theta), st = Math.sin(pk.theta);
    const p0 = [pk.rho * ct, pk.rho * st], dirv = [-st, ct];
    const a = this.dirM(G, p0[0] - 0.5 * dirv[0], p0[1] - 0.5 * dirv[1]), b = this.dirM(G, p0[0] + 0.5 * dirv[0], p0[1] + 0.5 * dirv[1]);
    return P.norm(mat3.tmv(T, P.cross(a, b)));
  }
  // Triplet/pair voting: match inter-band angles to the crystal's inter-planar angles.
  index(peaks, matKey) {
    const C = P.indexerNormals(matKey), n = peaks.map((p) => this.bandNormal(p)), K = n.length;
    if (K < 3) return null;
    const tol = 1.6 * DEG, ctol = Math.cos(1.8 * DEG);
    const cpairs = [];
    for (let p = 0; p < C.length; p++) for (let q = p + 1; q < C.length; q++) cpairs.push([p, q, Math.acos(clamp(Math.abs(P.dot(C[p].n, C[q].n)), 0, 1))]);
    let best = null;
    for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) {
      const dij = P.dot(n[i], n[j]), ang = Math.acos(clamp(Math.abs(dij), 0, 1));
      if (ang < 8 * DEG) continue;
      for (const [p, q, ca] of cpairs) {
        if (Math.abs(ca - ang) > tol) continue;
        const a1 = C[p].n, a2 = C[q].n;
        const s = Math.sign(P.dot(a1, a2)) === Math.sign(dij) ? 1 : -1;
        const b1 = n[i], b2 = n[j].map((v) => v * s);
        const O = triad(a1, a2, b1, b2);
        let matched = 0, sum = 0;
        for (let k = 0; k < K; k++) {
          let bestc = 0;
          for (const c of C) { const d = Math.abs(P.dot(mat3.mv(O, c.n), n[k])); if (d > bestc) bestc = d; }
          if (bestc > ctol) { matched++; sum += Math.acos(clamp(bestc, 0, 1)); }
        }
        const mad = matched ? sum / matched : 9;
        if (!best || matched > best.matched || (matched === best.matched && mad < best.mad)) best = { O, matched, mad, K };
      }
    }
    if (!best || best.matched < 3) return null;
    best.ci = best.matched / K;
    return best;
  }
  analyzePoint(x, y, N = 64, K = 7) {
    const grains = this.grainsAt(x, y);
    const top = grains[0];
    const cryst = grains.filter((g) => g.cryst);
    const pat = this.simPattern(grains, N);
    if (!cryst.length || !this.spec.phases.includes(cryst[0].mat)) return { pat, res: null, truth: top, phase: top.mat };
    const H = this.hough(pat, N, K);
    const res = this.index(H.peaks, cryst[0].mat);
    const bc = H.peaks.reduce((s, p) => s + p.h, 0) / Math.max(1, H.peaks.length);
    if (res) { res.bc = bc; res.err = misoDeg(res.O, cryst[0].O); res.phase = cryst[0].mat; }
    return { pat, res, truth: cryst[0], peaks: H.peaks, bc, phase: cryst[0].mat };
  }

  // ------------------------------------------------------------------ EBSD/TKD mapping
  startMap() {
    const S = this.S, N = S.mapN;
    this.map = { N, done: 0, fov: S.fov, cx: S.cx, cy: S.cy, O: new Array(N * N), mad: new Float32Array(N * N), bc: new Float32Array(N * N), err: new Float32Array(N * N).fill(-1), phase: new Array(N * N), ok: 0, errSum: 0, t0: performance.now() };
    this.stale.map = 0;
  }
  stepMap(budget) {
    const M = this.map;
    if (!M || M.done >= M.N * M.N) return false;
    const t0 = performance.now();
    while (M.done < M.N * M.N && performance.now() - t0 < budget) {
      const k = M.done, i = k % M.N, j = (k / M.N) | 0, step = M.fov / M.N;
      const x = M.cx + (i + 0.5 - M.N / 2) * step, y = M.cy - (j + 0.5 - M.N / 2) * step;
      const a = this.analyzePoint(x, y, 64, 8);
      M.phase[k] = a.phase;
      if (a.res) { M.O[k] = a.res.O; M.mad[k] = a.res.mad / DEG; M.bc[k] = a.res.bc; M.err[k] = a.res.err; M.ok++; M.errSum += Math.min(a.res.err, 10); }
      else M.bc[k] = a.bc || 0;
      M.done++;
    }
    return true;
  }
  patternAt(k) {
    const M = this.map;
    if (!M) return null;
    if (this._patK === k && this._patKey === this.version) return this._pat;
    const i = k % M.N, j = (k / M.N) | 0, step = M.fov / M.N;
    const x = M.cx + (i + 0.5 - M.N / 2) * step, y = M.cy - (j + 0.5 - M.N / 2) * step;
    const a = this.analyzePoint(x, y, 144, 9);
    this._pat = a; this._patK = k; this._patKey = this.version;
    return a;
  }

  // ------------------------------------------------------------------ EDS
  computeEDS() {
    const S = this.S, n = 96, E0 = S.kV;
    const g = this.sampleGrid(n, S.fov, S.cx, S.cy);
    const els = new Set();
    for (let k = 0; k < n * n; k++) for (const e in P.MAT[MKEYS[g.M[k]]].comp) els.add(e);
    const syms = [...els];
    // X-ray generation range of the dominant material sets the map resolution
    const cnt = new Map();
    for (let k = 0; k < n * n; k += 5) cnt.set(g.M[k], (cnt.get(g.M[k]) || 0) + 1);
    const dom = P.MAT[MKEYS[[...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0]]];
    const mainLine = P.XLINES.filter((l) => dom.comp[l.el] && E0 > l.Ec * 1.1).sort((a, b) => b.Ec - a.Ec)[0];
    const Rx = mainLine ? P.rangeX(dom, E0, mainLine.Ec) : P.rangeKO(dom, E0) * 0.6;
    const sig = (0.35 * Rx) / g.px;
    const maps = {};
    for (const e of syms) {
      const a = new Float32Array(n * n);
      for (let k = 0; k < n * n; k++) a[k] = P.MAT[MKEYS[g.M[k]]].comp[e] || 0;
      maps[e] = blurred(a, n, n, sig);
    }
    // spectrum from the whole scanned area
    const nb = 1000, Emax = Math.max(10, Math.min(30, Math.ceil(E0 + 1))), dE = Emax / nb, spec = new Float32Array(nb);
    const comp = {}, zbar = { s: 0, n: 0 };
    for (let k = 0; k < n * n; k++) { const m = P.MAT[MKEYS[g.M[k]]]; if (!m.rho) continue; for (const e in m.comp) comp[e] = (comp[e] || 0) + m.comp[e]; zbar.s += m.Z; zbar.n++; }
    let tot = 0;
    for (const e in comp) tot += comp[e];
    for (const e in comp) comp[e] /= tot || 1;
    const Z = zbar.s / (zbar.n || 1), A = 2 * Z + 1;
    const absorb = (E, Ec) => {
      const mu = Math.min(2e4, 1.47 * Math.pow(Z, 2.8) * Math.pow(E, -2.8)), chi = mu / Math.sin(35 * DEG);
      const sg = 4.5e5 / Math.max(1e-3, Math.pow(E0, 1.65) - Math.pow(Ec, 1.65)), h = (1.2 * A) / (Z * Z);
      return 1 / ((1 + chi / sg) * (1 + (h / (1 + h)) * (chi / sg)));
    };
    const lineI = {};
    for (const L of P.XLINES) {
      const c = comp[L.el];
      if (!c || E0 <= L.Ec) continue;
      const U = E0 / L.Ec, I = c * L.y * L.w * (Math.log(U) / U) * absorb(L.E, L.Ec) * P.detEff(L.E);
      lineI[L.el + L.line] = I;
      const s = P.edsFWHM(L.E) / 2.355;
      for (let b = Math.max(0, Math.floor((L.E - 4 * s) / dE)); b <= Math.min(nb - 1, Math.ceil((L.E + 4 * s) / dE)); b++) {
        const e = (b + 0.5) * dE;
        spec[b] += (I * dE * Math.exp(-0.5 * ((e - L.E) / s) ** 2)) / (s * 2.5066);
      }
    }
    for (let b = 0; b < nb; b++) {
      const e = (b + 0.5) * dE;
      if (e < 0.1 || e >= E0) continue;
      spec[b] += 3e-4 * Z * ((E0 - e) / e) * P.detEff(e) * absorb(e, 0.1) * dE * 10;
    }
    let st = 0;
    for (let b = 0; b < nb; b++) st += spec[b];
    for (let b = 0; b < nb; b++) spec[b] /= st;
    this.eds = { n, maps, syms, spec, nb, dE, Emax, comp, Rx, mainLine, dom };
    this.acc = { t: 0, total: 0, spec: new Float32Array(nb), maps: Object.fromEntries(syms.map((s) => [s, new Float32Array(n * n)])) };
    this.main = null;
  }
  accumulateEDS(dt) {
    const e = this.eds, a = this.acc, S = this.S;
    if (!e) return;
    a.t += dt;
    const rate = (S.current / 1000) * 60000 * dt;
    for (let b = 0; b < e.nb; b++) { const c = P.poisson(e.spec[b] * rate); a.spec[b] += c; a.total += c; }
    const k = (S.current / 1000) * 6 * dt;
    for (const s of e.syms) { const m = e.maps[s], acc = a.maps[s]; for (let i = 0; i < m.length; i++) acc[i] += P.poisson(m[i] * k); }
  }

  // ------------------------------------------------------------------ Monte Carlo
  startMC() {
    const S = this.S, s = this.spec.sample(S.cx, S.cy);
    const mk = P.MAT[s.mat].rho ? s.mat : null;
    this.mcMat = mk;
    if (!mk) { this.mc = null; this.stale.mc = 0; return; }
    const m = P.MAT[mk];
    const line = P.XLINES.filter((l) => m.comp[l.el] && S.kV > l.Ec * 1.2).sort((a, b) => b.Ec - a.Ec)[0];
    this.mcLine = line;
    this.mc = new P.MonteCarlo(mk, S.kV, S.tilt, line ? line.Ec : 1e9);
    this.stale.mc = 0;
  }

  // ------------------------------------------------------------------ main update
  update(dt) {
    const S = this.S, m = S.mode;
    if (['se', 'inlens', 'bse'].includes(m)) {
      if (this.stale.img) { this.computeImage(); this.stale.img = 0; this.version++; }
      if (!S.paused) {
        const frameT = clamp(0.35 + S.dwell * 0.25, 0.35, 8);
        const prev = this.raster;
        this.raster += (dt * S.speed) / frameT;
        if (this.raster >= 1) { this.raster = 0; this.frame++; }
        if ((this.raster * 256 | 0) !== (prev * 256 | 0)) this.version++;
      }
    }
    if (m === 'ebsd' || m === 'tkd') {
      if (this.stale.img) { this.computeImage(); this.stale.img = 0; }
      if (this.stale.map) { this.startMap(); this.version++; }
      if (!S.paused && this.stepMap(10 * clamp(S.speed, 0.3, 2.5))) this.version++;
    }
    if (m === 'eds') {
      if (this.stale.eds) { this.computeEDS(); this.stale.eds = 0; this.version++; }
      if (!S.paused) { this.accumulateEDS(dt * S.speed); this.version++; }
    }
    if (m === 'mc') {
      if (this.stale.mc) { this.startMC(); this.version++; }
      if (this.mc && !S.paused && this.mc.n < S.mcMax) { this.mc.run(Math.ceil(25 * S.speed)); this.version++; }
    }
  }
}

function triad(a1, a2, b1, b2) {
  const ta = [a1, P.norm(P.cross(a1, a2))]; ta.push(P.cross(ta[0], ta[1]));
  const tb = [b1, P.norm(P.cross(b1, b2))]; tb.push(P.cross(tb[0], tb[1]));
  // O = Σ tb_i ⊗ ta_i
  const O = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) O[r][c] += tb[i][r] * ta[i][c];
  return O;
}
const misoDeg = (A, B) => P.misorientation(A, B) / DEG;
