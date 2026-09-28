// SEM physics: materials, electron–solid interaction, probe formation, crystallography and specimens.
// Units: lengths in µm unless noted (nm where stated), energies in keV, angles in radians.

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const DEG = Math.PI / 180;

// ---------------------------------------------------------------- random / hashing
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash(i, j, s = 0) {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
let spare = null;
export function gauss() {
  if (spare !== null) { const g = spare; spare = null; return g; }
  let u, v, s;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const m = Math.sqrt((-2 * Math.log(s)) / s);
  spare = v * m;
  return u * m;
}
export function poisson(l) {
  if (l <= 0) return 0;
  if (l < 25) { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; }
  return Math.max(0, Math.round(l + Math.sqrt(l) * gauss()));
}
// smooth value noise
export function vnoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const s = (t) => t * t * (3 - 2 * t);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return (a + (b - a) * s(fx)) + ((c + (d - c) * s(fx)) - (a + (b - a) * s(fx))) * s(fy);
}

// ---------------------------------------------------------------- electron optics
export function wavelengthA(kV) { const V = kV * 1e3; return 12.2643 / Math.sqrt(V * (1 + 0.978476e-6 * V)); } // Å

// Convergence semi-angle at the specimen: set by the aperture, demagnified onto a working distance.
export const convAngle = (S) => S.aperture * 0.2e-3 * (7 / (S.wd + 2));
// Probe diameter from brightness, aberrations and diffraction (quadrature sum, FW50-like).
export function probe(S) {
  const V = S.kV * 1e3, I = S.current * 1e-12; // A
  const Br = 1e8; // reduced brightness, A m⁻² sr⁻¹ V⁻¹ (Schottky FEG)
  const alpha = convAngle(S); // rad
  const Cs = 0.9e-3 * Math.pow(S.wd / 4, 1.5), Cc = 1.1e-3 * Math.pow(S.wd / 4, 1.1); // m
  const dE = 0.7; // eV
  const lam = wavelengthA(S.kV) * 1e-10;
  const dg = Math.sqrt((4 * I) / (Math.PI * Math.PI * Br * V)) / alpha;
  const ds = 0.5 * Cs * alpha ** 3;
  const dc = Cc * (dE / V) * alpha;
  const dd = (1.22 * lam) / alpha;
  const d = Math.sqrt(dg * dg + ds * ds + dc * dc + dd * dd);
  return { alpha, Cs, Cc, dg: dg * 1e9, ds: ds * 1e9, dc: dc * 1e9, dd: dd * 1e9, d: d * 1e9 }; // nm
}
// Probe size as a function of α with everything else fixed (for the optimisation curve).
export function probeVsAlpha(S, alpha) {
  const V = S.kV * 1e3, I = S.current * 1e-12, Br = 1e8;
  const Cs = 0.9e-3 * Math.pow(S.wd / 4, 1.5), Cc = 1.1e-3 * Math.pow(S.wd / 4, 1.1), lam = wavelengthA(S.kV) * 1e-10;
  const dg = Math.sqrt((4 * I) / (Math.PI * Math.PI * Br * V)) / alpha, ds = 0.5 * Cs * alpha ** 3, dc = Cc * (0.7 / V) * alpha, dd = (1.22 * lam) / alpha;
  return { dg: dg * 1e9, ds: ds * 1e9, dc: dc * 1e9, dd: dd * 1e9, d: Math.sqrt(dg * dg + ds * ds + dc * dc + dd * dd) * 1e9 };
}

// ---------------------------------------------------------------- materials
// dmax/Emax: secondary-electron yield maximum and its energy; cond: conductor; E2: second crossover (δ+η = 1)
export const MAT = {
  vac: { name: 'Vacuum', Z: 0, A: 1, rho: 0, dmax: 0, Emax: 1, cond: true, comp: {} },
  C: { name: 'Carbon', Z: 6, A: 12.01, rho: 2.0, dmax: 1.0, Emax: 0.3, cond: true, comp: { C: 1 }, color: '#6d7480' },
  Sn: { name: 'Tin', Z: 50, A: 118.7, rho: 7.29, dmax: 1.35, Emax: 0.5, cond: true, comp: { Sn: 1 }, color: '#c9ced6' },
  Ni: { name: 'Nickel', Z: 28, A: 58.69, rho: 8.9, dmax: 1.3, Emax: 0.55, cond: true, comp: { Ni: 1 }, cryst: 'fcc', a: 3.524, color: '#9fb4c7' },
  Al2O3: { name: 'Alumina inclusion', Z: 10.6, A: 20.4, rho: 3.95, dmax: 3.0, Emax: 0.45, cond: false, E2: 2.6, comp: { Al: 0.4, O: 0.6 }, color: '#e8a86a' },
  Si: { name: 'Silicon', Z: 14, A: 28.09, rho: 2.33, dmax: 1.1, Emax: 0.25, cond: true, comp: { Si: 1 }, cryst: 'dia', a: 5.431, color: '#7f8fa3' },
  SiO2: { name: 'Silicon dioxide', Z: 10.8, A: 20.0, rho: 2.2, dmax: 2.9, Emax: 0.42, cond: false, E2: 2.1, comp: { Si: 0.333, O: 0.667 }, color: '#5a6e86' },
  Cu: { name: 'Copper', Z: 29, A: 63.55, rho: 8.96, dmax: 1.3, Emax: 0.6, cond: true, comp: { Cu: 1 }, cryst: 'fcc', a: 3.615, color: '#e0915a' },
  W: { name: 'Tungsten', Z: 74, A: 183.8, rho: 19.3, dmax: 1.4, Emax: 0.65, cond: true, comp: { W: 1 }, color: '#e6e6f0' },
  Al: { name: 'Aluminium', Z: 13, A: 26.98, rho: 2.7, dmax: 0.97, Emax: 0.3, cond: true, comp: { Al: 1 }, cryst: 'fcc', a: 4.05, color: '#aab6c4' },
  Pt: { name: 'Platinum (FIB cap)', Z: 78, A: 195.1, rho: 21.45, dmax: 1.6, Emax: 0.72, cond: true, comp: { Pt: 1 }, color: '#f2f2f2' },
};
export const J = (Z) => (9.76 * Z + 58.5 * Math.pow(Z, -0.19)) * 1e-3; // mean ionisation potential, keV

// Backscatter coefficient (Reuter) and its tilt dependence (Arnal): η(θ) = 1/(1+cos θ)^(9/√Z)
export function eta(Z, tilt = 0) {
  if (!Z) return 0;
  const e0 = -0.0254 + 0.016 * Z - 1.86e-4 * Z * Z + 8.3e-7 * Z * Z * Z;
  if (!tilt) return e0;
  const p = 9 / Math.sqrt(Z), c = Math.cos(tilt);
  return Math.min(0.95, Math.max(e0, 1 / Math.pow(1 + c, p)));
}
// Universal secondary-electron yield curve
export function delta(m, E) {
  if (!m.dmax) return 0;
  const x = E / m.Emax;
  return m.dmax * 1.28 * Math.pow(x, -0.67) * (1 - Math.exp(-1.614 * Math.pow(x, 1.67)));
}
// Kanaya–Okayama range (µm)
export const rangeKO = (m, E) => (m.rho ? (0.0276 * m.A * Math.pow(E, 1.67)) / (Math.pow(m.Z, 0.889) * m.rho) : 0);
// Anderson–Hasler X-ray generation range (µm)
export const rangeX = (m, E0, Ec) => (m.rho && E0 > Ec ? (0.064 * (Math.pow(E0, 1.68) - Math.pow(Ec, 1.68))) / m.rho : 0);
// Charging: an uncoated insulator charges negatively when δ+η < 1 (above E2)
export const charges = (m, E, coated) => !m.cond && !coated && E > m.E2;

// ---------------------------------------------------------------- X-ray lines (keV)
export const XLINES = [
  { el: 'C', line: 'Kα', E: 0.277, Ec: 0.284, w: 1, y: 0.25 },
  { el: 'O', line: 'Kα', E: 0.525, Ec: 0.532, w: 1, y: 0.45 },
  { el: 'Al', line: 'Kα', E: 1.487, Ec: 1.56, w: 1, y: 0.9 },
  { el: 'Si', line: 'Kα', E: 1.74, Ec: 1.839, w: 1, y: 1.0 },
  { el: 'Ni', line: 'Lα', E: 0.851, Ec: 0.855, w: 0.25, y: 0.5 },
  { el: 'Ni', line: 'Kα', E: 7.478, Ec: 8.333, w: 1, y: 1.1 },
  { el: 'Ni', line: 'Kβ', E: 8.265, Ec: 8.333, w: 0.13, y: 1.1 },
  { el: 'Cu', line: 'Lα', E: 0.93, Ec: 0.933, w: 0.25, y: 0.5 },
  { el: 'Cu', line: 'Kα', E: 8.048, Ec: 8.979, w: 1, y: 1.1 },
  { el: 'Cu', line: 'Kβ', E: 8.905, Ec: 8.979, w: 0.13, y: 1.1 },
  { el: 'W', line: 'Mα', E: 1.775, Ec: 1.81, w: 1, y: 0.7 },
  { el: 'W', line: 'Lα', E: 8.398, Ec: 10.207, w: 1, y: 0.9 },
  { el: 'W', line: 'Lβ', E: 9.672, Ec: 10.207, w: 0.6, y: 0.9 },
  { el: 'Sn', line: 'Lα', E: 3.444, Ec: 3.929, w: 1, y: 0.9 },
  { el: 'Sn', line: 'Lβ', E: 3.663, Ec: 3.929, w: 0.55, y: 0.9 },
  { el: 'Pt', line: 'Mα', E: 2.048, Ec: 2.122, w: 1, y: 0.7 },
  { el: 'Pt', line: 'Lα', E: 9.442, Ec: 11.564, w: 1, y: 0.9 },
];
export const EL_COLOR = { C: '#9aa4b2', O: '#ff7d7d', Al: '#ffc15e', Si: '#5cb4ff', Ni: '#5fe3a8', Cu: '#ff9a4d', W: '#c99bff', Sn: '#e2e8f0', Pt: '#f0e36b' };
export const detEff = (E) => Math.exp(-Math.pow(0.35 / E, 2)) * (1 - Math.exp(-40 / Math.pow(E, 2.4)) * 0) * Math.exp(-E / 60);
export const edsFWHM = (E) => Math.sqrt(45.7 * 45.7 + 2.355 * 2.355 * 0.115 * 3.8 * E * 1000) / 1000;
// Relative ionisation efficiency (Bethe-like) for overvoltage U
export const ionQ = (U, Ec) => (U > 1 ? Math.log(U) / (U * Ec * Ec) : 0);

// ---------------------------------------------------------------- crystallography (cubic)
export const mat3 = {
  mul: (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j])),
  mv: (A, v) => [A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2], A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2], A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]],
  tmv: (A, v) => [A[0][0] * v[0] + A[1][0] * v[1] + A[2][0] * v[2], A[0][1] * v[0] + A[1][1] * v[1] + A[2][1] * v[2], A[0][2] * v[0] + A[1][2] * v[1] + A[2][2] * v[2]],
  T: (A) => [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]],
  rx: (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]],
  axisAngle: (u, a) => {
    const [x, y, z] = norm(u), c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
  },
};
export const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Orientation = matrix mapping crystal vectors to sample vectors. Uniform random via quaternion.
export function randomOri(r1, r2, r3) {
  const a = Math.sqrt(1 - r1), b = Math.sqrt(r1);
  const q = [a * Math.sin(2 * Math.PI * r2), a * Math.cos(2 * Math.PI * r2), b * Math.sin(2 * Math.PI * r3), b * Math.cos(2 * Math.PI * r3)];
  const [x, y, z, w] = q;
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
}
// 24 proper rotations of the cube
export const CUBIC = (() => {
  const out = [], perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) for (let s = 0; s < 8; s++) {
    const sg = [s & 1 ? -1 : 1, s & 2 ? -1 : 1, s & 4 ? -1 : 1];
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) M[i][p[i]] = sg[i];
    const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    if (det > 0) out.push(M);
  }
  return out;
})();
export function misorientation(A, B) {
  const D = mat3.mul(mat3.T(A), B);
  let best = Math.PI;
  for (const S of CUBIC) {
    const M = mat3.mul(D, S), tr = M[0][0] + M[1][1] + M[2][2];
    best = Math.min(best, Math.acos(clamp((tr - 1) / 2, -1, 1)));
  }
  return best;
}
// Σ3 annealing twin: 60° about <111>
export const twinOf = (O) => mat3.mul(O, mat3.axisAngle([1, 1, 1], Math.PI / 3));

// Inverse-pole-figure colour of sample direction d (default: surface normal Z)
export function ipfColor(O, d = [0, 0, 1]) {
  const v = mat3.tmv(O, d).map(Math.abs).sort((a, b) => a - b); // x ≤ y ≤ z
  let r = v[2] - v[1], g = v[1] - v[0], b = v[0] * Math.SQRT2;
  const m = Math.max(r, g, b) || 1;
  r /= m; g /= m; b /= m;
  return [Math.pow(r, 0.6) * 255, Math.pow(g, 0.6) * 255, Math.pow(b, 0.6) * 255];
}

// Electron scattering factor (Å): screened core + Mott–Bethe tail + Debye–Waller
const fElec = (Z, s) => (0.3 * Math.pow(Z, 0.8) * Math.exp(-3.5 * s * s) + (0.0239 * Z) / (s * s + 1)) * Math.exp(-0.4 * s * s);
const BASIS = {
  fcc: [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
  dia: [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5], [0.25, 0.25, 0.25], [0.75, 0.75, 0.25], [0.75, 0.25, 0.75], [0.25, 0.75, 0.75]],
};
// Kikuchi band list: plane normals (crystal frame) with width (sin θB) and strength.
const bandCache = new Map();
export function kikuchiBands(matKey, kV) {
  const key = matKey + kV;
  if (bandCache.has(key)) return bandCache.get(key);
  const m = MAT[matKey], basis = BASIS[m.cryst], lam = wavelengthA(kV);
  const fams = new Map();
  for (let h = -4; h <= 4; h++) for (let k = -4; k <= 4; k++) for (let l = -4; l <= 4; l++) {
    const n2 = h * h + k * k + l * l;
    if (!n2 || n2 > 20) continue;
    let re = 0, im = 0;
    const s = Math.sqrt(n2) / (2 * m.a);
    for (const [x, y, z] of basis) { const p = 2 * Math.PI * (h * x + k * y + l * z); re += Math.cos(p); im += Math.sin(p); }
    const F = Math.hypot(re, im) * fElec(m.Z, s);
    if (F < 0.5) continue;
    // one normal per ± pair
    const first = [h, k, l].find((v) => v !== 0);
    if (first < 0) continue;
    const fam = [h, k, l].map(Math.abs).sort((a, b) => b - a).join('');
    if (!fams.has(fam)) fams.set(fam, { fam, n2, F, normals: [] });
    fams.get(fam).normals.push({ hkl: [h, k, l], n: norm([h, k, l]) });
  }
  const list = [...fams.values()].sort((a, b) => a.n2 - b.n2);
  const Fm = Math.max(...list.map((f) => f.F));
  const bands = [];
  for (const f of list) {
    const d = m.a / Math.sqrt(f.n2), sB = lam / (2 * d);
    for (const nm of f.normals) bands.push({ ...nm, fam: f.fam, sB, w: Math.pow(f.F / Fm, 1.2) });
  }
  const out = { bands, fams: list.map((f) => f.fam) };
  bandCache.set(key, out);
  return out;
}
// Plane normals used by the indexer (strongest low-index families)
export function indexerNormals(matKey) {
  const fams = MAT[matKey].cryst === 'dia' ? ['111', '220', '311', '400'] : ['111', '200', '220', '311'];
  return kikuchiBands(matKey, 20).bands.filter((b) => fams.includes(b.fam));
}

// ---------------------------------------------------------------- Monte Carlo electron–solid simulation
// Single-scattering Monte Carlo: screened Rutherford elastic scattering, Joy–Luo continuous energy loss.
const NA = 6.022e23;
export class MonteCarlo {
  constructor(mKey, E0, tiltDeg, lineEc) {
    this.m = MAT[mKey]; this.mKey = mKey; this.E0 = E0; this.tilt = tiltDeg * DEG; this.Ec = lineEc;
    this.n = 0; this.nBSE = 0; this.traj = [];
    this.R = rangeKO(this.m, E0) * 1000; // nm
    this.bins = 60;
    this.bseE = new Float32Array(40); this.depthE = new Float32Array(this.bins); this.phi = new Float32Array(this.bins);
    this.lateral = new Float32Array(this.bins); this.maxDepth = 0;
    this.Jk = J(this.m.Z);
  }
  run(count, keepTraj = 150) {
    const m = this.m, Z = m.Z, A = m.A, rho = m.rho, E0 = this.E0, Jk = this.Jk, Ec = this.Ec;
    const zMax = this.R * 1.25, bins = this.bins;
    for (let e = 0; e < count; e++) {
      let x = 0, y = 0, z = 0, E = E0;
      let cx = 0, cy = Math.sin(this.tilt), cz = Math.cos(this.tilt);
      const keep = this.traj.length < keepTraj, pts = keep ? [[x, z, E]] : null;
      let steps = 0, bse = false;
      while (E > 0.05 && steps < 4000) {
        steps++;
        const al = (3.4e-3 * Math.pow(Z, 0.67)) / E;
        const sig = 5.21e-21 * ((Z * Z) / (E * E)) * ((4 * Math.PI) / (al * (1 + al))) * Math.pow((E + 511) / (E + 1024), 2);
        const lam = (A / (NA * rho * sig)) * 1e7; // nm
        const s = -lam * Math.log(Math.random() || 1e-9);
        const nx = x + s * cx, ny = y + s * cy, nz = z + s * cz;
        if (nz < 0) { // escaped through the surface: backscattered
          bse = true;
          this.bseE[Math.min(39, Math.floor((E / E0) * 40))]++;
          if (pts) pts.push([x + (-z / (cz || -1e-9)) * cx, 0, E]);
          break;
        }
        const dEds = 7.85e-3 * ((rho * Z) / (A * E)) * Math.log(Math.max(1.0001, (1.166 * (E + 0.85 * Jk)) / Jk));
        const dE = Math.min(E, dEds * s);
        // bookkeeping: energy deposited and X-rays generated vs depth, lateral spread
        const zm = (z + nz) / 2, bi = Math.min(bins - 1, Math.floor((zm / zMax) * bins));
        this.depthE[bi] += dE;
        if (E > Ec) this.phi[bi] += s * ionQ(E / Ec, Ec);
        const r = Math.hypot((x + nx) / 2, (y + ny) / 2), li = Math.min(bins - 1, Math.floor((r / zMax) * bins));
        this.lateral[li] += dE;
        x = nx; y = ny; z = nz; E -= dE;
        if (z > this.maxDepth) this.maxDepth = z;
        if (pts && (steps % 2 === 0 || E < 0.3)) pts.push([x, z, E]);
        // scattering
        const R = Math.random();
        const ct = 1 - (2 * al * R) / (1 + al - R), st = Math.sqrt(Math.max(0, 1 - ct * ct));
        const ph = 2 * Math.PI * Math.random(), cp = Math.cos(ph), sp = Math.sin(ph);
        if (Math.abs(cz) > 0.99999) { cx = st * cp; cy = st * sp; cz = ct * Math.sign(cz); }
        else {
          const tmp = Math.sqrt(1 - cz * cz);
          const ncx = st * (cx * cz * cp - cy * sp) / tmp + cx * ct;
          const ncy = st * (cy * cz * cp + cx * sp) / tmp + cy * ct;
          const ncz = -st * cp * tmp + cz * ct;
          cx = ncx; cy = ncy; cz = ncz;
        }
      }
      this.n++;
      if (bse) this.nBSE++;
      if (keep) this.traj.push({ pts, bse });
    }
  }
  get eta() { return this.n ? this.nBSE / this.n : 0; }
}

// ---------------------------------------------------------------- specimens
// Each specimen answers sample(x, y) → { h (µm), mat, grain, ori } at any magnification.
function voronoi(x, y, cell, seed) {
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
  let best = Infinity, second = Infinity, id = 0, ix = 0, iy = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = cx + i, gy = cy + j;
    const px = (gx + 0.15 + 0.7 * hash(gx, gy, seed)) * cell, py = (gy + 0.15 + 0.7 * hash(gx, gy, seed + 7)) * cell;
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < best) { second = best; best = d; id = gx * 73856093 ^ gy * 19349663; ix = gx; iy = gy; }
    else if (d < second) second = d;
  }
  return { id: id >>> 0, ix, iy, edge: Math.sqrt(second) - Math.sqrt(best) };
}
const oriCache = new Map();
function grainOri(id, seed, texture = null) {
  const key = id + '|' + seed;
  let o = oriCache.get(key);
  if (!o) {
    o = randomOri(hash(id, 1, seed), hash(id, 2, seed), hash(id, 3, seed));
    if (texture) o = mat3.mul(texture, mat3.axisAngle([0, 0, 1], hash(id, 4, seed) * 6.283));
    if (oriCache.size > 20000) oriCache.clear();
    oriCache.set(key, o);
  }
  return o;
}
// grain with optional annealing-twin lamellae
function twinned(x, y, g, seed, cell, prob) {
  const O = grainOri(g.id, seed);
  if (hash(g.id, 9, seed) > prob) return { O, t: 0 };
  const a = hash(g.id, 10, seed) * Math.PI, w = cell * (0.08 + 0.12 * hash(g.id, 11, seed));
  const u = x * Math.cos(a) + y * Math.sin(a) + hash(g.id, 12, seed) * cell;
  const band = Math.floor(u / w);
  return band % 3 === 0 ? { O: twinOf(O), t: 1 } : { O, t: 0 };
}

export const SPECIMENS = {
  sn: {
    id: 'sn', name: 'Tin spheres on carbon', short: 'Sn on C', fov: 20, fovMin: 0.3, fovMax: 400,
    note: 'The classic SEM resolution standard: tin spheres from nanometres to tens of micrometres on amorphous carbon.',
    sample(x, y, res = 0) {
      let h = 0.004 * vnoise(x * 40, y * 40, 3) + 0.01 * vnoise(x * 6, y * 6, 5), mat = 'C';
      // spheres at many scales: cell sizes from 60 µm down to ~40 nm (skipping those far below a pixel)
      for (let lv = 0, cell = 60; lv < 8; lv++, cell /= 2.6) {
        if (cell * 0.34 < res * 0.35) break;
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          const gx = cx + i, gy = cy + j;
          if (hash(gx, gy, 100 + lv) > 0.55) continue;
          const r = cell * (0.08 + 0.26 * hash(gx, gy, 200 + lv));
          const px = (gx + 0.5 + 0.5 * (hash(gx, gy, 300 + lv) - 0.5)) * cell, py = (gy + 0.5 + 0.5 * (hash(gx, gy, 400 + lv) - 0.5)) * cell;
          const d2 = (x - px) ** 2 + (y - py) ** 2;
          if (d2 < r * r) {
            const hs = Math.sqrt(r * r - d2) + r * 0.25;
            if (hs > h) { h = hs + 0.003 * r * vnoise(x / r * 9, y / r * 9, lv); mat = 'Sn'; }
          }
        }
      }
      return { h, mat, grain: -1, ori: null };
    },
    phases: [],
  },
  ni: {
    id: 'ni', name: 'Polycrystalline nickel (polished)', short: 'Ni', fov: 150, fovMin: 2, fovMax: 1500,
    note: 'Annealed, polished nickel: grains with annealing twins, a few alumina inclusions and polishing scratches.',
    sample(x, y) {
      const cell = 22;
      const g = voronoi(x, y, cell, 11);
      const tw = twinned(x, y, g, 11, cell, 0.55);
      let h = 0.004 * (hash(g.id, 5, 11) - 0.5) + 0.0015 * vnoise(x * 3, y * 3, 2);
      // polishing scratches
      for (let k = 0; k < 3; k++) {
        const a = 0.3 + k * 0.9, d = Math.abs(((x * Math.cos(a) + y * Math.sin(a) + k * 137) % 90) - 45);
        if (d < 0.25) h -= 0.02 * (1 - d / 0.25);
      }
      // alumina inclusions
      const ic = 55, ix = Math.floor(x / ic), iy = Math.floor(y / ic);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const gx = ix + i, gy = iy + j;
        if (hash(gx, gy, 71) > 0.45) continue;
        const r = 1 + 3.5 * hash(gx, gy, 72), px = (gx + hash(gx, gy, 73)) * ic, py = (gy + hash(gx, gy, 74)) * ic;
        const d2 = (x - px) ** 2 + (y - py) ** 2;
        if (d2 < r * r) return { h: 0.08 * Math.sqrt(1 - d2 / (r * r)), mat: 'Al2O3', grain: -1, ori: null };
      }
      return { h, mat: 'Ni', grain: g.id * 2 + tw.t, ori: tw.O, gb: g.edge };
    },
    phases: ['Ni'],
  },
  chip: {
    id: 'chip', name: 'Chip cross-section (FIB)', short: 'Chip', fov: 12, fovMin: 0.3, fovMax: 40,
    note: 'A FIB-polished cross-section of a microchip: Si substrate, oxide, copper interconnects with W vias, an Al pad and a Pt protective cap.',
    sample(x, y) {
      const X = ((x % 12) + 12) % 12;
      const curtain = 0.006 * vnoise(x * 3, 0.5, 9) + 0.003 * vnoise(x * 11, 0.5, 4);
      const out = (mat, extra = {}) => ({ h: curtain, mat, grain: -1, ori: null, ...extra });
      if (y > 5.2) return { h: -0.5, mat: 'vac', grain: -1, ori: null };
      if (y > 4.3) return out('Pt');
      if (y > 3.3) { const on = X > 2 && X < 10; return out(on ? 'Al' : 'SiO2'); }
      if (y < -2.5) {
        // single-crystal Si substrate, [001] along the surface normal
        return out('Si', { grain: 1, ori: mat3.axisAngle([0, 0, 1], 0.3) });
      }
      const cu = (lo, hi, w, pitch, off) => {
        const p = ((X - off) % pitch + pitch) % pitch;
        return y > lo && y < hi && p < w;
      };
      const nanoCu = (cell) => {
        const g = voronoi(x, y, cell, 23), tw = twinned(x, y, g, 23, cell, 0.6);
        return out('Cu', { grain: g.id * 2 + tw.t, ori: tw.O, gb: g.edge });
      };
      if (cu(-2.0, -1.4, 0.28, 0.6, 0.1)) return nanoCu(0.12);
      if (cu(-1.4, -0.8, 0.12, 1.2, 0.18)) return out('W');
      if (cu(-0.6, 0.3, 0.55, 1.2, 0.0)) return nanoCu(0.2);
      if (cu(0.3, 1.1, 0.18, 2.4, 0.2)) return out('W');
      if (cu(1.1, 2.7, 1.6, 3.0, 0.4)) return nanoCu(0.45);
      return out('SiO2');
    },
    phases: ['Cu', 'Si'],
  },
};

// ---------------------------------------------------------------- 4-quadrant BSE detector
// Segment sign: +1 added, −1 subtracted, 0 off. Directions are in the image frame (A right, B left, C up, D down).
export const SEG_DIR = { A: [1, 0], B: [-1, 0], C: [0, 1], D: [0, -1] };
export function segLabel(seg) {
  const on = ['A', 'B', 'C', 'D'].filter((k) => seg[k]);
  if (!on.length) return 'all off';
  return on.map((k, i) => (seg[k] < 0 ? (i ? ' − ' : '−') : i ? ' + ' : '') + k).join('');
}
export function segPreset(seg) {
  const k = ['A', 'B', 'C', 'D'].map((x) => seg[x]).join(',');
  return { '1,1,1,1': 'comp', '1,-1,0,0': 'topoX', '0,0,1,-1': 'topoY' }[k] ?? null;
}
export function segKind(seg) {
  const sum = seg.A + seg.B + seg.C + seg.D, dx = seg.A - seg.B, dy = seg.C - seg.D;
  if (!(seg.A || seg.B || seg.C || seg.D)) return 'no signal';
  if (sum === 0) return 'topography (difference)';
  if (dx === 0 && dy === 0) return 'composition';
  return 'mixed: composition + shading';
}
