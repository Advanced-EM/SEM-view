// Analyses of what the microscope shows right now. Where the emskills registry (github.com/emskills-mcp/em-skills)
// has a skill for the same job, the analysis uses that skill's tool name:
//   calibrate_scale    = emskills scalebar-calibrate   magnification, scan aspect and shear from a cross grating
//   reconstruct_relief = emskills sem-topography       3D relief from the four BSE quadrants
//   phase_map          = emskills edax-phase-map       phases from EDS element maps
//   fit_eds            not in emskills (edax-phase-map is related)   peaks, energy scale and detector resolution
//   fit_resolution     not in emskills                 probe size from edge widths (25–75 %)
//   fit_focus          not in emskills                 focus and astigmatism from a through-focus pair
//   index_ebsd         not in emskills                 indexing rate and accuracy of an EBSD/TKD map
//   mc_summary         not in emskills                 backscatter coefficient and range from the Monte Carlo
//   fit_cl             not in emskills                 CL bands (indium content of InGaN wells) and dislocation density
//
// Each analysis reads the recorded data (export.js collectData) with its calibration, runs the fit from
// calibrate.js, and also returns the simulator's true values, so a measurement can be checked against the truth.
// Runs in browsers and in Node (semview-mcp, semview-py).
import * as P from './physics.js';
import { collectData, recordFrame } from './export.js';
import { fitGrating, fitEdgeResolution, fitEDSPeaks, edsPeakAt, reliefFromQuadrants, kmeans, prepSquare, fft2 } from './calibrate.js';

const r = (v, n = 3) => (v == null || !Number.isFinite(v) ? v : +v.toFixed(n));
const IMG = ['se', 'inlens', 'bse'];
const MKEYS = Object.keys(P.MAT);

// spectral second moments of an image (mid frequencies), for the through-focus astigmatism measurement
function spectralTensor(arr, n) {
  const { a, n: m } = prepSquare(arr, n, n), F = fft2(a, m);
  let sxx = 0, syy = 0, sxy = 0;
  for (let v = 0; v < m; v++) for (let u = 0; u < m; u++) {
    const fx = u < m / 2 ? u : u - m, fy = -(v < m / 2 ? v : v - m), rr = Math.hypot(fx, fy) / m;
    if (rr < 0.02 || rr > 0.3) continue;
    const p = F.re[v * m + u] ** 2 + F.im[v * m + u] ** 2;
    sxx += p * fx * fx; syy += p * fy * fy; sxy += p * fx * fy;
  }
  const t = sxx + syy || 1;
  return [sxx / t, syy / t, sxy / t];
}

// which elements a spectrum shows, from the X-ray line table (works on uploaded spectra too)
export function identifyElements(I, dE, kV = 30) {
  // pass 1: elements by their strongest line that no other element's line sits on (within 100 eV)
  const ALL = [...new Set(P.XLINES.map((l) => l.el))], seen = (l) => { const p = edsPeakAt(I, dE, l.E); return p.sigma > 7 && p.top > 0.15 * p.bg; };
  const usable = (el, l) => l.el === el && l.E > 0.9 && l.Ec < kV / 1.2 && l.E < I.length * dE;
  const clean = (el) => P.XLINES.filter((l) => usable(el, l) && !P.XLINES.some((o) => o.el !== el && Math.abs(o.E - l.E) < 0.1)).sort((a, b) => b.w - a.w)[0];
  const els = ALL.filter((el) => clean(el) && seen(clean(el)));
  // pass 2: a peak on an overlapped line belongs to this element when the elements it overlaps were ruled out
  for (const el of ALL) {
    if (els.includes(el) || clean(el)) continue;
    const L = P.XLINES.filter((l) => usable(el, l)).sort((a, b) => b.w - a.w)[0];
    if (L && seen(L) && P.XLINES.filter((o) => o.el !== el && Math.abs(o.E - L.E) < 0.1).every((o) => !els.includes(o.el) && clean(o.el))) els.push(el);
  }
  return els;
}
export const linesOf = (els, kV = 30) => P.XLINES.filter((l) => els.includes(l.el) && l.Ec < kV).map((l) => ({ E: l.E, w: l.w, label: `${l.el} ${l.line}` }));

export const ANALYSES = {
  calibrate_scale: {
    skill: 'scalebar-calibrate', registry: true, label: 'scale calibration', modes: IMG,
    run(sim, S, data, opts = {}) {
      const img = data.arrays.image, c = data.meta.calibration, pitch = opts.pitch_um ?? sim.spec.pitch;
      if (!pitch) throw new Error('calibrate_scale needs a cross-grating standard: load the 463 nm grating ("load the grating"), or pass pitch_um');
      const f = fitGrating(img.data, img.shape[1], img.shape[0], { pixUm: c.pixel_um, pitchUm: pitch });
      if (f.periods_in_field < 4) throw new Error(`only ${r(f.periods_in_field, 1)} grating periods in the field: zoom out to see at least four`);
      const pr = S.profile;
      return { summary: `Magnification ×${r(f.magCal, 4)} of nominal (true ×${r(pr.magCal, 4)}); scan aspect ${r(f.scanAspect, 4)} (true ${r(pr.scanAspect, 4)}), shear ${r(f.scanShear, 2)}° (true ${r(pr.scanShear, 2)}°); true pixel ${r(f.pixel_um * 1000, 3)} nm`,
        result: { magnification_calibration: r(f.magCal, 5), scan_aspect: r(f.scanAspect, 5), scan_shear_deg: r(f.scanShear, 3), pixel_nm: r(f.pixel_um * 1000, 4), grating_rotation_deg: r(f.rotation_deg, 2), pitch_um: pitch, periods_in_field: r(f.periods_in_field, 1) },
        truth: { magnification_calibration: pr.magCal, scan_aspect: pr.scanAspect, scan_shear_deg: pr.scanShear }, fit: f };
    },
  },
  fit_resolution: {
    skill: null, registry: false, label: 'edge resolution', modes: IMG,
    run(sim, S, data) {
      const img = data.arrays.image, c = data.meta.calibration;
      const f = fitEdgeResolution(img.data, img.shape[1], img.shape[0], { pixUm: c.pixel_um });
      const pix = c.pixel_um * 1000, pr = sim.probe, advice = pr.d < 3 * pix ? ` The pixel (${r(pix, 2)} nm) is large next to the probe: zoom in for a reliable number.` : '';
      return { summary: `Resolution ${r(f.resolution_nm, 2)} nm from ${f.edges} edges (25–75 % width ${r(f.edge_25_75_nm, 2)} nm); true probe ${r(pr.d, 2)} nm.${advice}`,
        result: { resolution_nm: r(f.resolution_nm, 3), edge_25_75_nm: r(f.edge_25_75_nm, 3), edges: f.edges, pixel_nm: r(pix, 3) },
        truth: { probe_nm: r(pr.d, 3), source_nm: r(pr.dg, 3), spherical_nm: r(pr.ds, 3), chromatic_nm: r(pr.dc, 3), diffraction_nm: r(pr.dd, 3), aperture_misalignment_nm: r(pr.dm, 3) } };
    },
  },
  fit_focus: {
    skill: null, registry: false, label: 'focus and astigmatism', modes: IMG,
    // a through-focus pair: astigmatism stretches the spectrum one way below focus and the other way above it,
    // so the difference of the two spectra cancels the specimen's own direction and leaves the astigmatism
    run(sim, S) {
      const f0 = S.focus, px = sim.fovT() / 256, a = sim.probe.alpha, d = Math.min(Math.max((2 * px) / a, 0.002), 0.5 * Math.max(0.3, Math.min(60, S.fov * 0.6))), shots = {};
      for (const [k, f] of [['minus', f0 - d], ['zero', f0], ['plus', f0 + d]]) { S.focus = f; sim.computeImage(); shots[k] = { sharp: sim.img.sharp, T: spectralTensor(recordFrame(sim.img.arr, S), 256) }; }
      S.focus = f0; sim.invalidate('focus'); sim.computeImage(); sim.stale.img = 0;
      // sharpness parabola through the three focus settings → where the image is sharpest
      const [y0, y1, y2] = [shots.minus.sharp, shots.zero.sharp, shots.plus.sharp], den = y0 - 2 * y1 + y2;
      const best = den < 0 ? f0 + (d * (y0 - y2)) / (2 * den) : y2 > y0 ? f0 + d : f0 - d;
      const D = shots.plus.T.map((v, i) => v - shots.minus.T[i]), mag = Math.hypot((D[0] - D[1]) / 2, D[2]);
      // the stigmator vector points along twice the streak axis; its size is scaled to µm from the through-focus step
      const ang = Math.atan2(2 * D[2], D[0] - D[1]), est = [-11.7 * mag * d * Math.cos(ang), -11.7 * mag * d * Math.sin(ang)];
      const res = sim.astigRes(), streak = (0.5 * ang * 180) / Math.PI;
      return { summary: `Best focus at ${best >= 0 ? '+' : ''}${r(best, 3)} µm on the knob (true ${r(S.mis?.focus ?? 0, 3)} µm); residual astigmatism ${mag < 0.004 ? 'not detected' : `≈ (${r(est[0], 2)}, ${r(est[1], 2)}) µm: move the stigmator by (${r(-est[0], 2)}, ${r(-est[1], 2)})`} (true residual ${r(res[0], 2)}, ${r(res[1], 2)} µm)`,
        result: { best_focus_um: r(best, 4), through_focus_step_um: r(d, 4), sharpness: [y0, y1, y2].map((v) => r(v, 4)), astigmatism_um: est.map((v) => r(v, 3)), streak_axis_deg: r(streak, 1), anisotropy: r(mag, 4) },
        truth: { best_focus_um: S.mis?.focus ?? 0, astigmatism_residual_um: res.map((v) => r(v, 3)), stigmator_target: (S.mis?.stig ?? sim.astig).map((v) => r(v, 3)) } };
    },
  },
  reconstruct_relief: {
    skill: 'sem-topography', registry: true, label: '3D relief', modes: ['bse'],
    run(sim, S, data) {
      const n = sim.img.n, seg = Object.fromEntries([...'ABCD'].map((q) => [q, data.arrays[`segment_${q}`].data])), pix = sim.img.px;
      const h = reliefFromQuadrants(seg, n, { pixUm: pix });
      // compare with the true height (both with their means and tilts removed)
      const T = sim.img.H, plane = (a) => { let m = 0; for (const v of a) m += v; m /= a.length; return Float32Array.from(a, (v) => v - m); };
      const hm = plane(h), tm = plane(T);
      let e = 0, rq = 0, rt = 0;
      for (let k = 0; k < n * n; k++) { e += (hm[k] - tm[k]) ** 2; rq += hm[k] ** 2; rt += tm[k] ** 2; }
      const um = (v) => r(Math.sqrt(v / (n * n)) * 1000, 2);
      return { summary: `Relief reconstructed from quadrants A–D: roughness Rq ${um(rq)} nm (true ${um(rt)} nm), rms height error ${um(e)} nm over ${r(S.fov, 2)} µm`,
        result: { roughness_rq_nm: um(rq), rms_error_nm: um(e), pixel_um: r(pix, 5), method: 'shape from shading, Frankot–Chellappa integration' }, truth: { roughness_rq_nm: um(rt) }, height: h };
    },
  },
  fit_eds: {
    skill: null, related: 'edax-phase-map', registry: false, label: 'EDS peaks', modes: ['eds'],
    run(sim, S, data) {
      const sp = data.arrays.spectrum, dE = data.meta.calibration.energy_keV_per_bin, I = sp.data;
      if ((data.meta.calibration.total_counts ?? 0) < 5e4) throw new Error('not enough X-ray counts yet: let the spectrum build up for a few seconds, then fit again');
      // which elements show their strongest line (above 1 keV where it has one) clearly above the background
      const els = identifyElements(I, dE, S.kV);
      const lines = linesOf(els, S.kV);
      const f = fitEDSPeaks(I, dE, lines), pr = S.profile;
      return { summary: `Elements ${els.join(', ')}; resolution ${Math.round(f.fwhmMn)} eV at Mn Kα (true ${pr.edsFWHM} eV); energy gain ${r(f.gain, 4)} (true ${pr.edsGain}), zero ${r(f.offset_eV, 1)} eV (true ${pr.edsOffset} eV)`,
        result: { elements: els, peaks: f.found.map((p) => ({ line: p.label, keV: r(p.Emeas, 4), fwhm_eV: Math.round(p.fwhm), counts: Math.round(p.counts) })), gain: r(f.gain, 5), offset_eV: r(f.offset_eV, 2), fwhm_MnKa_eV: Math.round(f.fwhmMn) },
        truth: { fwhm_MnKa_eV: pr.edsFWHM, gain: pr.edsGain, offset_eV: pr.edsOffset, composition: Object.fromEntries(Object.entries(sim.eds.comp).map(([k, v]) => [k, r(v, 3)])) }, fit: f };
    },
  },
  phase_map: {
    skill: 'edax-phase-map', registry: true, label: 'phase map', modes: ['eds'],
    run(sim, S, data) {
      const e = sim.eds, n = e.n, syms = e.syms, live = (sim.acc?.total ?? 0) > 2e4, src = live ? sim.acc.maps : e.maps;
      // per-pixel element fractions (normalized), then k-means with the smallest k that explains the variance
      const X = new Float32Array(n * n * syms.length);
      for (let k = 0; k < n * n; k++) { let t = 0; for (const s of syms) t += src[s][k]; syms.forEach((s, d) => (X[k * syms.length + d] = t ? src[s][k] / t : 0)); }
      // the smallest k after which one more phase explains little more (an elbow in the k-means inertia)
      const runs = [1, 2, 3, 4, 5, 6].map((k) => kmeans(X, n * n, syms.length, k)), i1 = runs[0].inertia || 1;
      let km = runs[runs.length - 1];
      for (let k = 0; k < runs.length - 1; k++) if (runs[k].inertia < 0.06 * i1 || runs[k].inertia - runs[k + 1].inertia < 0.25 * runs[k].inertia) { km = runs[k]; break; }
      const K = km.centers.length, area = new Array(K).fill(0);
      for (const l of km.labels) area[l]++;
      const phases = km.centers.map((c, i) => ({ phase: i + 1, area_fraction: r(area[i] / (n * n), 3), composition: Object.fromEntries(syms.map((s, d) => [s, r(c[d], 3)]).filter(([, v]) => v > 0.02)) })).sort((a, b) => b.area_fraction - a.area_fraction);
      // the truth: materials of the scanned area
      const g = sim.sampleGrid(n, sim.fovT(), S.cx, S.cy), cnt = {};
      for (const m of g.M) cnt[MKEYS[m]] = (cnt[MKEYS[m]] ?? 0) + 1;
      return { summary: `${K} phase${K > 1 ? 's' : ''}: ${phases.map((p) => `${Object.entries(p.composition).map(([s, v]) => `${s}${Math.round(v * 100)}`).join('')} (${Math.round(p.area_fraction * 100)} %)`).join(', ')}${live ? '' : ' (from the expected maps: counts are still low)'}${e.Rx > 0.1 * S.fov ? `. The X-ray range (${r(e.Rx, 2)} µm) blurs features smaller than that together: lower the voltage for a finer map.` : ''}`,
        result: { phases, from_counts: live }, truth: { materials: Object.fromEntries(Object.entries(cnt).filter(([k]) => P.MAT[k].rho).map(([k, v]) => [P.MAT[k].name, r(v / (n * n), 3)])) }, labels: km.labels };
    },
  },
  index_ebsd: {
    skill: null, registry: false, label: 'EBSD/TKD map quality', modes: ['ebsd', 'tkd'],
    run(sim, S) {
      const M = sim.map;
      if (!M || M.done < 20) throw new Error('the map has hardly started: wait for more points');
      const errs = [], mads = [];
      for (let k = 0; k < M.done; k++) if (M.O[k]) { errs.push(M.err[k]); mads.push(M.mad[k]); }
      errs.sort((a, b) => a - b); mads.sort((a, b) => a - b);
      const med = (a) => (a.length ? a[a.length >> 1] : null), rate = errs.length / M.done, wrong = errs.filter((x) => x > 5).length;
      return { summary: `${Math.round(rate * 100)} % of ${M.done} points indexed (median MAD ${r(med(mads), 2)}°); against the true orientations: median error ${r(med(errs), 2)}°, ${wrong} mis-indexed (> 5°)`,
        result: { points: M.done, indexed_fraction: r(rate, 3), median_mad_deg: r(med(mads), 3), step_um: r(M.fov / M.N, 4) },
        truth: { median_error_deg: r(med(errs), 3), misindexed: wrong, correct_fraction: r((errs.length - wrong) / M.done, 3) } };
    },
  },
  fit_cl: {
    skill: null, registry: false, label: 'CL bands and defects', modes: ['cl'],
    run(sim, S) {
      const c = sim.cl, a = sim.clAcc, sp = a?.frames > 5 ? a.spec : c.spec;
      // peaks: local maxima above 4 % of the strongest, centre and width from a parabola through ln(I) in energy
      const lam = (b) => c.l0 + (b + 0.5) * c.dl, top = Math.max(...sp), bands = [];
      for (let b = 2; b < c.nb - 2; b++) {
        if (!(sp[b] > 0.04 * top && sp[b] >= sp[b - 1] && sp[b] > sp[b + 1] && sp[b] >= sp[b - 2] && sp[b] >= sp[b + 2])) continue;
        const [y0, y1, y2] = [sp[b - 1], sp[b], sp[b + 1]].map((v) => Math.log(Math.max(v, 1e-12))), d = y0 - 2 * y1 + y2;
        const lp = lam(b) + (d < 0 ? (0.5 * (y0 - y2) / d) * c.dl : 0), E = P.HC / lp;
        let hw = 0; for (let k = b; k < c.nb && sp[k] > sp[b] / 2; k++) hw++; for (let k = b; k >= 0 && sp[k] > sp[b] / 2; k--) hw++;
        bands.push({ wavelength_nm: r(lp, 1), energy_eV: r(E, 3), fwhm_nm: r(hw * c.dl, 0), intensity: r(sp[b] / top, 3) });
      }
      const name = (E) => (E > 3.3 && E < 3.5 ? 'GaN band edge' : E > 2.55 && E <= 3.0 && S.spec === 'gan' ? 'InGaN quantum wells' : E > 1.95 && E < 2.45 && S.spec === 'gan' ? 'GaN yellow band (defects)' : Math.abs(E - 1.786) < 0.03 ? 'Cr³⁺ R-line (ruby)' : E > 2.5 && E < 3.3 ? 'F centre / oxygen-vacancy band' : E > 1.7 && E < 2.1 ? 'non-bridging oxygen band' : 'unassigned');
      for (const b of bands) b.assignment = name(b.energy_eV);
      // indium content of the wells from their emission (inverting the bowed band gap)
      const qw = bands.find((b) => b.assignment === 'InGaN quantum wells');
      let xIn = null;
      if (qw) { let lo = 0, hi = 0.5; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (P.qwEmission(mid) > qw.energy_eV) lo = mid; else hi = mid; } xIn = r((lo + hi) / 2, 3); }
      // dislocations: dark spots in the band-edge (or panchromatic) image, local minima well below their surroundings
      let disl = null;
      if (S.spec === 'gan') {
        const n = c.n, img = c.img, R = Math.max(2, Math.round((sim.spec.diffusion * 1.5) / c.px));
        let found = 0;
        for (let j = R; j < n - R; j++) for (let i = R; i < n - R; i++) {
          const v = img[j * n + i];
          let isMin = true, ring = 0, cnt = 0;
          for (let dj = -R; dj <= R && isMin; dj++) for (let di = -R; di <= R; di++) { const w = img[(j + dj) * n + i + di]; if (w < v) { isMin = false; break; } if (Math.abs(dj) === R || Math.abs(di) === R) { ring += w; cnt++; } }
          if (isMin && v < 0.8 * (ring / cnt)) found++;
        }
        const area = ((n - 2 * R) * c.px) ** 2, truth = sim.spec.dislocations(S.cx, S.cy, sim.fovT()) / (sim.fovT() ** 2);
        disl = { counted: found, density_cm2: +(found / area * 1e8).toPrecision(3), truth_cm2: +(truth * 1e8).toPrecision(3), resolvable: c.sg < 0.5 * sim.spec.diffusion * 4 };
      }
      const xTrue = S.spec === 'gan' ? r(0.15, 3) : null;
      const summ = `${bands.map((b) => `${b.assignment} ${b.wavelength_nm} nm`).join(', ') || 'no luminescence here'}${xIn != null ? `; wells x(In) ≈ ${xIn} (true mean ${xTrue})` : ''}${disl ? `; ${disl.counted} dark spots → ${disl.density_cm2.toExponential(1)} cm⁻² (true ${disl.truth_cm2.toExponential(1)} cm⁻²)${S.clMode === 'pan' || S.clLam < 380 ? '' : ' (count on the panchromatic or band-edge image for the best contrast)'}` : ''}`;
      return { summary: summ, result: { bands, indium_fraction: xIn, dislocations: disl && { counted: disl.counted, density_cm2: disl.density_cm2 }, generation_spread_nm: r(c.sg * 1000, 0) },
        truth: { indium_fraction_mean: xTrue, dislocation_density_cm2: disl?.truth_cm2 ?? null, qw_depth_nm: sim.spec.qwDepth ? sim.spec.qwDepth * 1000 : null } };
    },
  },
  mc_summary: {
    skill: null, registry: false, label: 'Monte Carlo', modes: ['mc'],
    run(sim, S) {
      const mc = sim.mc;
      if (!mc || mc.n < 100) throw new Error('fewer than 100 trajectories so far: let the simulation run');
      const se = Math.sqrt((mc.eta * (1 - mc.eta)) / mc.n);
      return { summary: `η = ${r(mc.eta, 3)} ± ${r(se, 3)} from ${mc.n} electrons in ${mc.m.name} (Reuter ${r(P.eta(mc.m.Z, S.tilt * P.DEG), 3)}); deepest ${Math.round(mc.maxDepth)} nm vs Kanaya–Okayama ${Math.round(mc.R)} nm`,
        result: { eta: r(mc.eta, 4), eta_stderr: r(se, 4), trajectories: mc.n, max_depth_nm: Math.round(mc.maxDepth) }, truth: { eta_reuter: r(P.eta(mc.m.Z, S.tilt * P.DEG), 4), range_KO_nm: Math.round(mc.R) } };
    },
  },
};

// the analysis that fits the current mode
export const defaultAnalysis = (mode, spec) => (IMG.includes(mode) && mode !== 'bse' ? (spec === 'grid' ? 'calibrate_scale' : 'fit_resolution') : { bse: 'reconstruct_relief', eds: 'fit_eds', ebsd: 'index_ebsd', tkd: 'index_ebsd', cl: 'fit_cl', mc: 'mc_summary' }[mode] ?? null);
export const ALIASES = { calibrate_magnification: 'calibrate_scale', relief: 'reconstruct_relief', autofocus: 'fit_focus', resolution: 'fit_resolution' };

// big arrays stay out of the JSON result (the IDE and agents get them through acquire)
export function analyze(sim, S, name, opts) {
  name = ALIASES[name] ?? name ?? defaultAnalysis(S.mode, S.spec);
  const a = ANALYSES[name];
  if (!a) throw new Error(`nothing to analyze in ${S.mode} mode: try imaging (resolution, focus, scale), BSE (relief), EDS (peaks, phases), EBSD, CL or the Monte Carlo`);
  if (!a.modes.includes(S.mode)) throw new Error(`${a.label} needs ${a.modes.map((m) => m.toUpperCase()).join(' or ')} mode; the microscope is in ${S.mode.toUpperCase()}`);
  const data = collectData(sim, S);
  const emskills = a.registry ? { skill: a.skill, tool: name, in_registry: true } : { skill: null, in_registry: false, related: a.related ?? null };
  const { fit, height, labels, ...out } = a.run(sim, S, data, opts);
  return { analysis: name, emskills, mode: S.mode, specimen: sim.spec.name, ...out };
}
