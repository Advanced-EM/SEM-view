// A nanoparticle megalibrary: a million positionally encoded nanoparticles on one membrane chip, made the
// way polymer pen lithography (PPL) makes them. A 10 × 10 array of pens each writes a 100 × 100 block of
// polymer dots loaded with metal salts; heating reduces each dot to one particle. The ink composition varies
// smoothly across the pen array (as if spray-coated from five metal-salt sources), and the dot size, so the
// particle size, grows along x within each block (longer dwell). The result is 1000 × 1000 particles,
// 15–25 nm across, on a 1 µm grid: every (i, j) is a different, known, synthesis condition.
//
// Physics kept: Vegard's law for the lattice parameter; Au, Ag and Cu mix with each other and Co with Ni,
// but the two groups do not, so particles with both segregate into two-domain heterostructures (often
// epitaxial, with a {111} interface); single-phase particles are sometimes Σ3-twinned; per-particle
// composition scatters around the ink (finite atom counts); large dots sometimes split off a satellite.
//
// This file is self-contained and identical in TEM-view and SEM-view, so both twins see the same library:
// the same particle at (i, j) has the same composition, shape and crystal orientation in each.
// Units: µm on the chip, nm for particles, Å for lattice parameters. The library is fixed by SEED.

export const LIB = {
  n: 1000, pitch_um: 1, pens: 10, block: 100, d_nm: [15, 25], seed: 2026,
  elements: ['Au', 'Ag', 'Cu', 'Co', 'Ni'],
  // spray sources across the pen array (u, v in 0..1) and their spread
  sources: { Au: [0.05, 0.1], Cu: [0.05, 0.5], Ag: [0.05, 0.9], Ni: [0.95, 0.25], Co: [0.95, 0.75] }, spread: 0.28,
};
const A0 = { Au: 4.078, Ag: 4.086, Cu: 3.615, Co: 3.544, Ni: 3.524 }; // fcc lattice parameters, Å (Co: fcc β-Co)
const Z = { Au: 79, Ag: 47, Cu: 29, Co: 27, Ni: 28 };
const NOBLE = ['Au', 'Ag', 'Cu'], MAG = ['Co', 'Ni'];

// ---------------------------------------------------------------- deterministic randomness
function h32(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041) + Math.imul(LIB.seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  h = Math.imul(h ^ (h >>> 15), 2246822519); h ^= h >>> 13;
  return h >>> 0;
}
export const rnd = (a, b, c) => h32(a, b, c) / 4294967296; // uniform in [0, 1)
function gaussR(a, b, c) { const u = (h32(a, b, c) + 1) / 4294967297, v = h32(a, b, c + 7919) / 4294967296; return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// ---------------------------------------------------------------- small 3D helpers
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export const mv3 = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
export const mul3 = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
function axisAngle(ax, t) {
  const [x, y, z] = norm3(ax), c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
}
// uniform random orientation (matrix taking crystal vectors to sample vectors: x, y in the chip plane, z its normal)
function randomOri(r1, r2, r3) {
  const a = Math.sqrt(1 - r1), b = Math.sqrt(r1);
  const [x, y, z, w] = [a * Math.sin(2 * Math.PI * r2), a * Math.cos(2 * Math.PI * r2), b * Math.sin(2 * Math.PI * r3), b * Math.cos(2 * Math.PI * r3)];
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
}
// Bunge Euler angles (φ1, Φ, φ2) in degrees of an orientation matrix, as EBSD software reports them
export function euler(O) {
  const G = [[O[0][0], O[1][0], O[2][0]], [O[0][1], O[1][1], O[2][1]], [O[0][2], O[1][2], O[2][2]]]; // sample → crystal
  const P = Math.acos(Math.max(-1, Math.min(1, G[2][2])));
  let p1, p2;
  if (Math.abs(Math.sin(P)) > 1e-6) { p1 = Math.atan2(G[2][0], -G[2][1]); p2 = Math.atan2(G[0][2], G[1][2]); }
  else { p1 = Math.atan2(G[0][1], G[0][0]); p2 = 0; }
  const d = (r) => +((((r * 180) / Math.PI) % 360 + 360) % 360).toFixed(2);
  return [d(p1), +((P * 180) / Math.PI).toFixed(2), d(p2)];
}

// ---------------------------------------------------------------- composition
const normComp = (c) => { let s = 0; for (const k in c) s += c[k]; const o = {}; for (const k in c) if (c[k] / s >= 0.01) o[k] = c[k] / s; let t = 0; for (const k in o) t += o[k]; for (const k in o) o[k] = +(o[k] / t).toFixed(4); return o; };
// the ink each pen carries
// except pen (9, 0), inked on its own with a binary Au–Co ink: the two metals do not mix, so every particle in its
// block separates into an Au crystal and a Co crystal
export const AUCO_PEN = [9, 0];
export function penComposition(pi, pj) {
  if (pi === AUCO_PEN[0] && pj === AUCO_PEN[1]) return { Au: 0.5, Co: 0.5 };
  const u = (pi + 0.5) / LIB.pens, v = (pj + 0.5) / LIB.pens, s2 = 2 * LIB.spread * LIB.spread, c = {};
  LIB.elements.forEach((el, k) => {
    const [cu, cv] = LIB.sources[el];
    c[el] = Math.exp(-((u - cu) ** 2 + (v - cv) ** 2) / s2) * (1 + 0.1 * gaussR(pi, pj, 100 + k));
  });
  for (const el in c) if (c[el] < 0.02) delete c[el];
  return normComp(c);
}
export const latticeA = (comp) => { let a = 0; for (const el in comp) a += comp[el] * A0[el]; return +a.toFixed(4); };
export const meanZ = (comp) => { let z = 0; for (const el in comp) z += comp[el] * Z[el]; return z; };
const sub = (comp, els) => { const o = {}; for (const el of els) if (comp[el]) o[el] = comp[el]; return normComp(o); };
const frac = (comp, els) => els.reduce((s, el) => s + (comp[el] || 0), 0);

// volume fraction of a unit sphere below the plane n·r = t is (1 + t)²(2 − t)/4: invert it
function planeFor(f) { let lo = -1, hi = 1; for (let k = 0; k < 40; k++) { const t = (lo + hi) / 2; if (((1 + t) ** 2 * (2 - t)) / 4 < f) lo = t; else hi = t; } return (lo + hi) / 2; }

// ---------------------------------------------------------------- one particle
const inks = new Map();
const inkOf = (pi, pj) => { const k = pi * LIB.pens + pj; if (!inks.has(k)) inks.set(k, penComposition(pi, pj)); return inks.get(k); };
// where a particle sits, whether its dot formed one, its size and in-plane shape (cheap: no crystal)
function place(i, j) {
  const pi = Math.floor(i / LIB.block), pj = Math.floor(j / LIB.block), bi = i % LIB.block;
  // where the particle formed inside its polymer dot
  const ox = Math.max(-60, Math.min(60, 20 * gaussR(i, j, 1))), oy = Math.max(-60, Math.min(60, 20 * gaussR(i, j, 2)));
  // size grows with dwell time along x in each pen's block; shape: rounded, a little elongated or faceted
  const [d0, d1] = LIB.d_nm, d = Math.max(d0, Math.min(d1, d0 + ((d1 - d0) * bi) / (LIB.block - 1) + 0.6 * gaussR(i, j, 4)));
  const asp = 1 + 0.3 * rnd(i, j, 5) ** 2, sq = rnd(i, j, 6) < 0.35 ? 2.5 + rnd(i, j, 7) : 2;
  return { pi, pj, ink: inkOf(pi, pj), x_um: i * LIB.pitch_um + ox / 1000, y_um: j * LIB.pitch_um + oy / 1000, present: rnd(i, j, 3) > 0.015, d, asp, sq };
}
function scatter(i, j, ink) {
  const comp = {};
  for (const el in ink) comp[el] = ink[el] * Math.exp(0.18 * gaussR(i, j, 20 + LIB.elements.indexOf(el)));
  return comp;
}
// A particle as a low-magnification view needs it: position (µm), volume (nm³), composition and lattice
// parameter, without building its crystal (fast enough for all million particles). The volume of the
// superellipse cap is (4/3)·c·area; the superellipse's area, 4ab·Γ(1 + 1/e)²/Γ(1 + 2/e), is fitted to within 1 %.
export function sketch(i, j) {
  const { x_um, y_um, present, d, sq, ink } = place(i, j);
  const c = scatter(i, j, ink);
  let s = 0;
  for (const el in c) s += c[el];
  for (const el in c) c[el] /= s;
  const area = (d / 2) ** 2 * (Math.PI + 0.55 * (sq - 2) - 0.13 * (sq - 2) ** 2);
  return { x_um, y_um, present, d_nm: d, vol_nm3: (4 / 3) * 0.43 * d * area, comp: c, a_A: latticeA(c) };
}
// the ink of the pen that wrote particle (i, j)
export const sketchInk = (i, j) => inkOf(Math.floor(i / LIB.block), Math.floor(j / LIB.block));
const cache = new Map();
export function inLibrary(i, j) { return Number.isInteger(i) && Number.isInteger(j) && i >= 0 && j >= 0 && i < LIB.n && j < LIB.n; }
export function particle(i, j) {
  if (!inLibrary(i, j)) return null;
  const key = i * LIB.n + j;
  if (cache.has(key)) return cache.get(key);
  const { pi, pj, ink, x_um, y_um, present, d, asp, sq } = place(i, j);
  const p = { i, j, pen: [pi, pj], x_um, y_um, present }, [d0, d1] = LIB.d_nm;
  Object.assign(p, { d_nm: +d.toFixed(2), a_nm: +((d / 2) * Math.sqrt(asp)).toFixed(3), b_nm: +(d / 2 / Math.sqrt(asp)).toFixed(3), c_nm: +(0.43 * d).toFixed(3), shape_exp: +sq.toFixed(3), rot: rnd(i, j, 8) * Math.PI });
  // composition: the pen's ink, scattered by the finite number of atoms in one dot
  p.comp = normComp(scatter(i, j, ink));
  // crystal domains
  const O = randomOri(rnd(i, j, 9), rnd(i, j, 10), rnd(i, j, 11));
  const fn = frac(p.comp, NOBLE), fm = frac(p.comp, MAG);
  if (fn >= 0.12 && fm >= 0.12) {
    // immiscible groups: a noble-metal domain and a Co–Ni domain, epitaxial (cube-on-cube, {111} interface) or not
    const epi = rnd(i, j, 12) < 0.6, cN = sub(p.comp, NOBLE), cM = sub(p.comp, MAG);
    const O2 = epi ? mul3(axisAngle([rnd(i, j, 13) - 0.5, rnd(i, j, 14) - 0.5, rnd(i, j, 15) - 0.5], 0.03), O) : randomOri(rnd(i, j, 16), rnd(i, j, 17), rnd(i, j, 18));
    const n = epi ? norm3(mv3(O, [1, 1, 1])) : norm3([gaussR(i, j, 30), gaussR(i, j, 31), gaussR(i, j, 32)]);
    // volume fractions from the atom fractions and each domain's atomic volume (a³/4 for fcc)
    const aN = latticeA(cN), aM = latticeA(cM), vN = fn * aN ** 3, vM = fm * aM ** 3, fv = vN / (vN + vM);
    p.phase = 'heterostructure';
    p.domains = [{ comp: cN, a_A: aN, O, frac: +fv.toFixed(3) }, { comp: cM, a_A: aM, O: O2, frac: +(1 - fv).toFixed(3) }];
    p.interface = { n, t: +planeFor(fv).toFixed(4), epitaxial: epi };
  } else if (rnd(i, j, 19) < 0.22) {
    // one Σ3 twin: 60° about <111>, across that {111} plane
    const n = norm3(mv3(O, [1, 1, 1])), t = 0.8 * (rnd(i, j, 33) - 0.5);
    const below = ((1 + t) ** 2 * (2 - t)) / 4;
    p.phase = 'twinned';
    p.domains = [{ comp: p.comp, a_A: latticeA(p.comp), O, frac: +below.toFixed(3) }, { comp: p.comp, a_A: latticeA(p.comp), O: mul3(O, axisAngle([1, 1, 1], Math.PI / 3)), frac: +(1 - below).toFixed(3) }];
    p.interface = { n, t: +t.toFixed(4), epitaxial: true };
  } else {
    p.phase = 'alloy';
    p.domains = [{ comp: p.comp, a_A: latticeA(p.comp), O, frac: 1 }];
    p.interface = null;
  }
  p.a_A = latticeA(p.comp);
  // big dots sometimes break up: a small satellite nearby
  if (rnd(i, j, 40) < 0.02 + (0.1 * (d - d0)) / (d1 - d0)) {
    const ang = rnd(i, j, 41) * 2 * Math.PI, r = d / 2 + 5 + 15 * rnd(i, j, 42), ds = 3 + 4 * rnd(i, j, 43);
    p.satellite = { dx_nm: +(r * Math.cos(ang)).toFixed(2), dy_nm: +(r * Math.sin(ang)).toFixed(2), d_nm: +ds.toFixed(2), comp: p.comp, a_A: p.a_A, O: randomOri(rnd(i, j, 44), rnd(i, j, 45), rnd(i, j, 46)) };
  } else p.satellite = null;
  if (cache.size > 4000) cache.delete(cache.keys().next().value);
  cache.set(key, p);
  return p;
}

// the particle grid node nearest a chip position (µm)
export function nearest(x_um, y_um) {
  const i = Math.round(x_um / LIB.pitch_um), j = Math.round(y_um / LIB.pitch_um);
  return inLibrary(i, j) ? [i, j] : null;
}

// ---------------------------------------------------------------- geometry (nm, relative to the particle centre)
// In-plane shape: a superellipse with semi-axes a, b rotated by rot; the height profile is elliptical with
// half-height c. rho(x, y) < 1 inside; the particle is 2c·√(1 − ρ²) thick there.
export function rho(p, x, y) {
  const c = Math.cos(p.rot), s = Math.sin(p.rot), u = (x * c + y * s) / p.a_nm, v = (-x * s + y * c) / p.b_nm, e = p.shape_exp;
  return e === 2 ? Math.sqrt(u * u + v * v) : Math.pow(Math.abs(u) ** e + Math.abs(v) ** e, 1 / e);
}
export function thicknessAt(p, x, y) {
  let t = 0;
  if (p.present) { const r = rho(p, x, y); if (r < 1) t += 2 * p.c_nm * Math.sqrt(1 - r * r); }
  const s = p.satellite;
  if (s && p.present) { const R = s.d_nm / 2, d2 = (x - s.dx_nm) ** 2 + (y - s.dy_nm) ** 2; if (d2 < R * R) t += 2 * Math.sqrt(R * R - d2); }
  return t;
}
// inside the particle body (3D, z from its mid-plane)?
export function inside(p, x, y, z) { const r = rho(p, x, y); return r * r + (z / p.c_nm) ** 2 < 1; }
// which crystal domain a point inside the particle belongs to
export function domainAt(p, x, y, z) {
  if (!p.interface) return 0;
  const c = Math.cos(p.rot), s = Math.sin(p.rot), u = (x * c + y * s) / p.a_nm, v = (-x * s + y * c) / p.b_nm, w = z / p.c_nm;
  // back to the unrotated frame so the plane is in sample coordinates, normalised to the unit sphere
  const nx = u * c - v * s, ny = u * s + v * c, n = p.interface.n;
  return nx * n[0] + ny * n[1] + w * n[2] < p.interface.t ? 0 : 1;
}

// what a grader needs: everything about one particle, in plain numbers
export function truth(i, j) {
  const p = particle(i, j);
  if (!p) return null;
  return {
    i, j, pen: p.pen, present: p.present, center_um: [+p.x_um.toFixed(5), +p.y_um.toFixed(5)], diameter_nm: p.d_nm,
    semi_axes_nm: [p.a_nm, p.b_nm, p.c_nm], shape_exponent: p.shape_exp, rotation_deg: +((p.rot * 180) / Math.PI).toFixed(2),
    composition: p.comp, ink: penComposition(...p.pen), phase: p.phase, lattice_A: p.a_A,
    domains: p.domains.map((d) => ({ composition: d.comp, lattice_A: d.a_A, volume_fraction: d.frac, euler_deg: euler(d.O) })),
    interface: p.interface ? { normal: p.interface.n.map((v) => +v.toFixed(4)), epitaxial: p.interface.epitaxial } : null,
    satellite: p.satellite ? { offset_nm: [p.satellite.dx_nm, p.satellite.dy_nm], diameter_nm: p.satellite.d_nm, euler_deg: euler(p.satellite.O) } : null,
  };
}

// a composition as a formula in at.%, in the library's element order: Au₈₃Cu₁₇
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
export function formula(comp) {
  const els = LIB.elements.filter((el) => comp[el]);
  if (els.length === 1) return els[0];
  return els.map((el) => el + String(Math.round(comp[el] * 100)).replace(/\d/g, (d) => SUBS[d])).join('');
}
// one particle in words: its composition and how its atoms arranged themselves
export function describe(p) {
  if (!p.present) return 'no particle formed at this node';
  const f = formula(p.comp);
  if (p.phase === 'heterostructure') {
    const [a, b] = p.domains;
    return `${f}, phase-separated into two crystals, ${formula(a.comp)} (a = ${a.a_A} Å) and ${formula(b.comp)} (a = ${b.a_A} Å), ${p.interface.epitaxial ? 'epitaxial across a {111} interface' : 'at a random orientation to each other'}`;
  }
  return `${f} alloy (a = ${p.a_A} Å)${p.phase === 'twinned' ? ', twinned on {111}' : ''}`;
}

// the layout a script needs to plan an acquisition (no answers in it)
export function layout() {
  return {
    particles: [LIB.n, LIB.n], pitch_um: LIB.pitch_um, pens: [LIB.pens, LIB.pens], block: LIB.block, diameter_nm: LIB.d_nm,
    elements: LIB.elements, origin: 'particle (0, 0) is at stage (0, 0) µm; particle (i, j) at (i·pitch, j·pitch)',
    note: 'Each pen writes a 100 × 100 block; ink composition varies across pens, dot size along x within a block. Particles sit within ~60 nm of their grid node.',
  };
}
