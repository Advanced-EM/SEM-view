// Collect what the detectors recorded and its metadata, and package it as a NumPy .npz.
// Shared by Acquire, Export data, the analyses, the Python package and the MCP server (browser and Node).
import * as P from './physics.js';
import { npy, zip, jsonBytes } from './npy.js';
import { SESSION_KEYS } from './state.js';

const A = (data, shape, units) => ({ data, shape, units });
const DET_EFF = { se: 0.3, inlens: 0.25, bse: 0.35 };

// detected electrons per pixel for one frame: probe current × dwell × detector efficiency × signal.
// The educational view uses 12× the dose (a cleaner picture), as the display does.
export function frameCounts(S, mean) { return S.current * 6.24 * S.dwell * (DET_EFF[S.mode] ?? 0.3) * mean * (S.clarity === 'real' ? 1 : 12); }
export function recordFrame(arr, S, rng = P.poisson) {
  let mean = 0;
  for (let i = 0; i < arr.length; i++) mean += arr[i];
  mean = mean / arr.length || 1;
  const c = Math.max(0.5, frameCounts(S, mean)), out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = rng(Math.max(0, (arr[i] / mean) * c));
  return out;
}

// the four quadrants of the BSE diode, each recorded on its own (what sem-topography reconstructs from)
export function bseSegments(sim) {
  const I = sim.img, n = I.n, out = {};
  for (const q of 'ABCD') {
    const [ux, uy] = P.SEG_DIR[q], a = new Float32Array(n * n), { bse, bseB, nx, ny } = I.parts;
    for (let k = 0; k < n * n; k++) a[k] = Math.max(0, 0.25 * bseB[k] + 0.6 * bse[k] * (nx[k] * ux + ny[k] * uy));
    out[q] = a;
  }
  return out;
}

// Bunge Euler angles (°) of a crystal → sample rotation
export function euler(O) {
  const g = [[O[0][0], O[1][0], O[2][0]], [O[0][1], O[1][1], O[2][1]], [O[0][2], O[1][2], O[2][2]]]; // sample → crystal
  const Phi = Math.acos(Math.max(-1, Math.min(1, g[2][2])));
  let p1, p2;
  if (Math.abs(Math.sin(Phi)) < 1e-6) { p1 = Math.atan2(g[0][1], g[0][0]); p2 = 0; }
  else { p1 = Math.atan2(g[2][0], -g[2][1]); p2 = Math.atan2(g[0][2], g[1][2]); }
  const d = (r) => ((((r * 180) / Math.PI) % 360) + 360) % 360;
  return [d(p1), (Phi * 180) / Math.PI, d(p2)];
}

export function collectData(sim, S) {
  const m = S.mode, arrays = {}, cal = {}, pr = sim.probe;
  if (['se', 'inlens', 'bse'].includes(m) && sim.img) {
    const I = sim.img;
    arrays.image = A(recordFrame(I.arr, S), [I.n, I.n], 'detected electrons per pixel');
    if (m === 'bse') { const sg = bseSegments(sim); for (const q of 'ABCD') arrays[`segment_${q}`] = A(recordFrame(sg[q], S), [I.n, I.n], `quadrant ${q} electrons per pixel`); }
    Object.assign(cal, { pixel_um: S.fov / I.n, pixel_um_true: I.px, fov_um: S.fov, detector: m === 'se' ? 'ETD' : m === 'inlens' ? 'in-lens' : `BSE ${P.segLabel(S.seg)}`, segments: m === 'bse' ? { A: 'right (+x)', B: 'left (−x)', C: 'top (+y)', D: 'bottom (−y)' } : undefined });
  } else if ((m === 'ebsd' || m === 'tkd') && sim.map) {
    const M = sim.map, N = M.N, eu = [new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N)];
    for (let k = 0; k < N * N; k++) { const e = M.O[k] ? euler(M.O[k]) : [NaN, NaN, NaN]; for (let c = 0; c < 3; c++) eu[c][k] = e[c]; }
    arrays.euler_phi1 = A(eu[0], [N, N], 'deg (Bunge), NaN = not indexed'); arrays.euler_Phi = A(eu[1], [N, N], 'deg'); arrays.euler_phi2 = A(eu[2], [N, N], 'deg');
    arrays.band_contrast = A(M.bc, [N, N], 'a.u.'); arrays.mad = A(M.mad, [N, N], 'deg');
    const pat = sim.patternAt(Math.floor(N / 2) * N + Math.floor(N / 2));
    if (pat?.pat) arrays.pattern_center = A(pat.pat, [144, 144], 'Kikuchi pattern intensity');
    Object.assign(cal, { step_um: M.fov / N, map_points: N * N, points_done: M.done, geometry: m === 'ebsd' ? 'EBSD, sample tilted toward the camera' : 'TKD, on-axis below a thin foil', tilt_deg: S.tilt });
  } else if (m === 'eds' && sim.eds) {
    const e = sim.eds, a = sim.acc;
    arrays.spectrum = A(a?.total ? a.spec : e.spec, [e.nb], a?.total ? 'counts' : 'probability per channel');
    for (const [sym, map] of Object.entries(a?.maps ?? {})) arrays[`map_${sym}`] = A(map, [e.n, e.n], 'X-ray counts');
    Object.assign(cal, { energy_keV_per_bin: e.dE, energy_start_keV: 0, map_pixel_um: S.fov / e.n, live_time_s: a?.t ?? 0, total_counts: a?.total ?? 0, takeoff_deg: 35 });
  } else if (m === 'cl' && sim.cl) {
    const c = sim.cl, a = sim.clAcc, n = c.n;
    arrays.image = A(recordFrame(c.img, S), [n, n], `${S.clMode === 'pan' ? 'panchromatic' : `${S.clLam} ± ${S.clBand / 2} nm`} CL, photons per pixel`);
    arrays.spectrum = A(a?.frames ? a.spec : c.spec, [c.nb], a?.frames ? 'counts' : 'relative intensity');
    arrays.wavelength_nm = A(Float32Array.from({ length: c.nb }, (_, b) => c.l0 + (b + 0.5) * c.dl), [c.nb], 'nm (bin centres)');
    // hyperspectral cube: every pixel's spectrum, binned 2× in space and to 4 nm
    const m2 = n / 2, nl = c.nb / 2, cube = new Float32Array(m2 * m2 * nl);
    for (const comp of c.list) {
      const sE = comp.w / 2.355;
      for (let j = 0; j < m2; j++) for (let i = 0; i < m2; i++) {
        let A0 = 0, E0 = 0;
        for (const [dj, di] of [[0, 0], [0, 1], [1, 0], [1, 1]]) { const k = (2 * j + dj) * n + 2 * i + di; A0 += comp.A[k]; E0 += comp.E[k] * comp.A[k]; }
        if (!A0) continue;
        E0 /= A0;
        for (let b = 0; b < nl; b++) { const lam = c.l0 + (b + 0.5) * 2 * c.dl, E = P.HC / lam; cube[(j * m2 + i) * nl + b] += (A0 * Math.exp(-0.5 * ((E - E0) / sE) ** 2) * (P.HC / (lam * lam)) * 2 * c.dl) / (sE * 2.5066) * P.ccdQE(lam); }
      }
    }
    arrays.hyperspectral = A(cube, [m2, m2, nl], 'relative intensity; axes: y, x, wavelength (4 nm bins from 300 nm)');
    Object.assign(cal, { pixel_um: S.fov / n, cube_pixel_um: (2 * S.fov) / n, wavelength_start_nm: c.l0, wavelength_nm_per_bin: c.dl, cube_nm_per_bin: 2 * c.dl, window_nm: c.window, mode: S.clMode, generation_spread_um: c.sg, acquisition_s: a?.t ?? 0 });
  } else if (m === 'mc' && sim.mc) {
    const mc = sim.mc;
    arrays.backscatter_energy = A(mc.bseE, [mc.bseE.length], 'electrons per E/E0 bin'); arrays.energy_vs_depth = A(mc.depthE, [mc.bins], 'keV deposited per depth bin');
    arrays.phi_rho_z = A(mc.phi, [mc.bins], 'X-ray generation per depth bin'); arrays.energy_vs_radius = A(mc.lateral, [mc.bins], 'keV deposited per radius bin');
    Object.assign(cal, { depth_bin_nm: (mc.R * 1.25) / mc.bins, trajectories: mc.n, eta_measured: mc.eta, material: mc.m.name });
  }
  const state = Object.fromEntries(SESSION_KEYS.filter((k) => k !== 'mis').map((k) => [k, S[k]]));
  const meta = {
    format: 'sem-view-data/1', generator: 'Scanning with Electrons (SEM-view)', created: new Date().toISOString(),
    simulated: true, mode: m, specimen: sim.spec.name, calibration: cal,
    beam: { kV: S.kV, current_pA: S.current, aperture_um: S.aperture, wd_mm: S.wd, convergence_mrad: +(pr.alpha * 1e3).toFixed(3), probe_nm: +pr.d.toFixed(3), dwell_us: S.dwell, tilt_deg: S.tilt },
    arrays: Object.fromEntries(Object.entries(arrays).map(([k, v]) => [k, { shape: v.shape, units: v.units }])),
    state,
  };
  return { arrays, meta };
}

export function toNpz({ arrays, meta }) {
  const files = Object.entries(arrays).map(([k, v]) => ({ name: `${k}.npy`, bytes: npy(v.data, v.shape) }));
  files.push({ name: 'metadata.json', bytes: jsonBytes(meta) });
  return zip(files);
}
