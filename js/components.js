// Instrument-physics cards for the labelled parts of the SEM.
import * as P from './physics.js';
import { fmtLen } from './render2d.js';

const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);

export const COMPONENTS = {
  'Electron gun': {
    kicker: 'Source',
    role: 'A Schottky field-emission gun: the brightness of the source decides how much current fits into a small probe.',
    physics: 'A ZrO-coated W(100) tip at ~1800 K; the zirconia lowers the work function to ~2.8 eV and the extraction field thins the barrier. The virtual source is ~15–25 nm. Cold-FEG tips give a smaller energy spread (0.3 eV) for low-kV work; tungsten hairpins (thermionic) are ~1000× less bright.',
    specs: [['Reduced brightness', '~5 × 10⁷ A m⁻² sr⁻¹ V⁻¹'], ['Energy spread', '0.6–0.8 eV'], ['Probe current range', '1 pA – 100 nA'], ['Current stability', '< 0.5 %/h']],
    metrology: 'Probe current is measured with a <b>Faraday cup</b> on the stage (or a picoammeter on the specimen), before every EDS/EBSD session, because quantitative analysis scales with it. Emission stability is logged; the energy spread shows up as chromatic blur at low kV.',
    limits: 'Brightness caps current in a given probe size: d<sub>source</sub> ∝ √I/(α√B).',
    live: (S) => [['kV', `${S.kV}`], ['Current', S.current >= 1000 ? `${f1(S.current / 1000)} nA` : `${Math.round(S.current)} pA`]],
  },
  'Condenser lens': {
    kicker: 'Probe forming',
    role: 'Demagnifies the source; together with the aperture it sets the probe current (the “spot size”).',
    physics: 'A magnetic round lens. Stronger excitation gives a smaller source image and less current. Modern columns vary the current continuously and keep the probe focused automatically.',
    specs: [['Current range', '~6 decades'], ['Demagnification', '10³–10⁴ overall']],
    metrology: 'Current versus condenser setting is calibrated with the Faraday cup; lenses are normalised (cycled) so settings are reproducible despite hysteresis.',
    limits: 'Current and probe size trade off directly.',
    live: (S, sim) => [['Probe diameter', `${f1(sim.probe.d)} nm`]],
  },
  'Beam-limiting aperture': {
    kicker: 'Probe forming',
    role: 'Sets the convergence angle α and so balances aberrations against diffraction, current and depth of field.',
    physics: 'The probe diameter is a quadrature sum: source image ∝ √I/α, spherical ½Cₛα³, chromatic Cc(ΔE/E)α and diffraction 1.22λ/α. There is an optimum α for every current and voltage.',
    specs: [['Typical sizes', '10–120 µm'], ['α range', '~1–15 mrad'], ['Depth of field', 'DoF ≈ 2 × resolution / α']],
    metrology: 'The aperture is centred with the <b>wobbler</b> (the image must not swing while the objective current is modulated). Its effective size is checked from depth-of-field and probe-current measurements.',
    limits: 'Contamination on the edge charges and adds astigmatism.',
    live: (S, sim) => [['Aperture', `${S.aperture} µm`], ['α', `${f1(sim.probe.alpha * 1000)} mrad`]],
  },
  'In-lens SE detector': {
    kicker: 'Detector',
    role: 'Collects secondary electrons that the objective field channels up the column: high-resolution surface imaging.',
    physics: 'In immersion or semi-immersion objectives, SE emitted near the axis spiral up the lens field to a detector above it. Mostly SE1 (generated at the probe) is collected; SE2/SE3 from backscattered electrons are largely excluded.',
    specs: [['Best WD', '< 5 mm'], ['Signal', 'SE1-rich, little shadowing']],
    metrology: 'Resolution is measured on <b>gold-on-carbon</b> or tin-on-carbon standards, from edge profiles (25–75 % rise distance) or FFT-based methods such as <b>SMART</b>, because visible gap criteria are subjective.',
    limits: 'Loses efficiency at long WD, and the field can distort magnetic specimens.',
    live: (S) => [['WD', `${S.wd} mm`], ['Relative efficiency', f2(1 / (1 + (S.wd / 5) ** 2))]],
  },
  'Scan coils': {
    kicker: 'Scanning',
    role: 'Double-deflection coils raster the probe; magnification is simply display size ÷ scanned size.',
    physics: 'Two deflection stages pivot the beam near the objective so it moves across the specimen while staying on-axis through the lens. Dwell time per pixel ranges from 25 ns (TV rate) to tens of µs.',
    specs: [['Dwell', '0.025–100 µs/pixel'], ['Frame', 'up to 16k × 16k pixels']],
    metrology: 'Magnification and pixel size are calibrated with <b>certified pitch standards</b> (e.g. NIST SRM 2069, or 1 µm / 100 nm gratings) in both scan directions. Scan linearity, orthogonality and drift are checked the same way; many tools apply automatic drift correction by image registration.',
    limits: 'Scan non-linearity, stage drift and electrical noise distort images at high magnification.',
    live: (S) => [['Field of view', fmtLen(S.fov)], ['Pixel', fmtLen(S.fov / 256)], ['Dwell', `${S.dwell} µs`]],
  },
  'Objective lens': {
    kicker: 'Resolution',
    role: 'Focuses the probe onto the specimen; its aberrations at the chosen working distance set the resolution.',
    physics: 'This is a conical immersion lens whose field reaches the specimen, shrinking Cₛ and Cc at short working distance. Field-free (pinhole) lenses keep the specimen out of the field for magnetic samples and EBSD, at the cost of resolution.',
    specs: [['Cₛ, Cc', '~0.5–3 mm (grow with WD)'], ['Resolution', '~0.5–1 nm at 15 kV, ~1–2 nm at 1 kV']],
    metrology: 'Focus and astigmatism are tuned by maximising image sharpness; <b>through-focus</b> series reveal astigmatism as perpendicular streaking. Working distance is calibrated by focusing on a known height.',
    limits: 'Chromatic aberration dominates at low kV; beam deceleration or monochromators counter it.',
    live: (S, sim) => [['WD', `${S.wd} mm`], ['Cₛ / Cc', `${f2(sim.probe.Cs * 1000)} / ${f2(sim.probe.Cc * 1000)} mm`], ['Focus', `${f2(S.focus)} µm`]],
  },
  'Specimen & stage': {
    kicker: 'Sample',
    role: 'A five-axis stage (x, y, z, tilt, rotation) holding a conductive stub. The specimen itself generates every signal.',
    physics: 'Signals come from different depths of the interaction volume: SE from ~1–10 nm, BSE from ~⅓ of the range, X-rays from most of it. Insulators charge unless coated or imaged below E2; low vacuum/variable pressure neutralises charge with gas ions.',
    specs: [['Travel', '~50–150 mm'], ['Tilt', '−10 to 70°+'], ['Drift', '< 1–3 nm/min (good stages)']],
    metrology: '<b>Eucentric height</b> is set so tilting doesn’t move the region of interest. Samples are grounded with carbon tape or paint; conductive coatings (C for EDS, Au/Pt/Ir for imaging) are a few nm thick, measured with a quartz crystal monitor.',
    limits: 'Charging, contamination (hydrocarbon build-up under the beam), beam damage and drift.',
    live: (S, sim) => { const s = sim.spec.sample(S.cx, S.cy); return [['Material under beam', P.MAT[s.mat].name], ['Tilt', `${S.tilt}°`], ['Coated', S.coated ? 'carbon' : 'no']]; },
  },
  'Everhart–Thornley detector': {
    kicker: 'Detector',
    role: 'The classic SE detector: a biased Faraday cage, scintillator, light pipe and photomultiplier.',
    physics: 'The cage (−50 to +300 V) attracts or repels low-energy SE. A +10 kV potential on the scintillator accelerates them enough to produce light; photons travel down the light pipe to a photomultiplier with gains of 10⁶. Being off to one side gives the familiar directional “lighting”.',
    specs: [['Cage bias', '−150 … +300 V'], ['Scintillator bias', '+10–12 kV'], ['Bandwidth', 'MHz (TV-rate capable)']],
    metrology: 'Brightness and contrast (PMT gain, offset) are set against a histogram so no pixels clip. For quantitative comparisons the gain must be fixed and the probe current measured.',
    limits: 'Mixes SE with BSE-generated SE2/SE3; shadowing depends on the geometry.',
    live: (S) => [['Cage bias', `${S.etdBias} V`], ['Collects', S.etdBias >= 0 ? 'SE + some BSE' : 'direct BSE only']],
  },
  'BSE detector': {
    kicker: 'Detector',
    role: 'An annular, four-segment semiconductor (or scintillator) detector under the pole piece: composition and channelling contrast.',
    physics: 'Backscattered electrons (keV energies) create electron-hole pairs in a Si diode. Summing segments gives atomic-number contrast; subtracting opposite ones gives topography. At low kV, energy filtering or in-column BSE detectors select low-loss electrons for surface-sensitive Z contrast.',
    specs: [['Segments', '4 (A–D) or more'], ['Threshold energy', '~1–2 keV'], ['Z resolution', 'ΔZ ≈ 0.1 at high Z with averaging']],
    metrology: 'Quantitative BSE (mean-Z mapping) calibrates signal against standards of known Z (C, Al, Si, Cu, Au) at fixed current and gain. <b>ECCI</b> (channelling contrast imaging) is used to image dislocations in bulk samples.',
    limits: 'Poor efficiency at low kV; topographic and compositional contrasts mix unless separated.',
    live: (S) => [['Segments', P.segLabel(S.seg)], ['Contrast', P.segKind(S.seg)]],
  },
  'EDS detector': {
    kicker: 'Spectroscopy',
    role: 'A silicon drift detector counting X-rays from the specimen: identifies and quantifies elements.',
    physics: 'Each X-ray makes ~E/3.8 eV electron-hole pairs, drifted to a tiny anode for low noise; resolution is Fano-limited (~125–130 eV at Mn Kα). The take-off angle (~35°) sets the absorption path of X-rays leaving the sample.',
    specs: [['Resolution', '~125–130 eV (Mn Kα)'], ['Area', '10–150 mm²'], ['Count rate', 'up to ~10⁶ cps']],
    metrology: 'The energy scale is calibrated on a Cu or Co standard; quantification uses <b>ZAF / φ(ρz)</b> matrix corrections with or without standards. The Duane–Hunt limit verifies the actual beam energy; the Faraday-cup current is needed for standards-based analysis.',
    limits: 'Spatial resolution = X-ray generation volume (µm at high kV); peak overlaps; light elements are absorbed.',
    live: (S, sim) => (sim.eds ? [['X-ray range', fmtLen(sim.eds.Rx)], ['E₀', `${S.kV} keV`]] : [['E₀', `${S.kV} keV`]]),
  },
  'EBSD detector': {
    kicker: 'Diffraction',
    role: 'A phosphor screen and fast camera facing the 70°-tilted specimen; records Kikuchi patterns for orientation mapping.',
    physics: 'Backscattered electrons diffracted by lattice planes form Kikuchi bands on the screen (a gnomonic projection, so plane traces are straight lines). Newer detectors use direct-electron CMOS sensors for sharper, energy-filtered patterns.',
    specs: [['Speed', '~1,000–7,000 patterns/s'], ['Angular precision', '~0.1–0.5° (Hough); ~0.01° (HR-EBSD)'], ['Spatial resolution', '~20–50 nm (×3 along tilt)']],
    metrology: 'The <b>pattern centre</b> and detector distance must be calibrated (on a known single crystal, or by moving the detector), because orientation accuracy depends on them. <b>HR-EBSD</b> cross-correlates patterns to measure elastic strain ~10⁻⁴.',
    limits: 'Surface preparation (damage-free polish), tilt-induced foreshortening and drift, overlapping patterns at boundaries.',
    live: (S, sim) => (sim.map ? [['Indexed', `${sim.map.done ? Math.round((100 * sim.map.ok) / sim.map.done) : 0} %`], ['Mean error', sim.map.ok ? `${(sim.map.errSum / sim.map.ok).toFixed(2)}°` : '—']] : []),
  },
  'TKD detector': {
    kicker: 'Diffraction',
    role: 'On-axis transmission Kikuchi diffraction: the detector sits beneath an electron-transparent lamella.',
    physics: 'Patterns form from electrons diffracted near the exit surface of a thin foil, so the source volume is ~5–10 nm. On-axis geometry puts the pattern centre in the middle of the screen with high signal.',
    specs: [['Spatial resolution', '~2–10 nm'], ['Foil thickness', '~50–150 nm (metals)']],
    metrology: 'Pattern-centre calibration as for EBSD; foil thickness can be checked by EELS in a TEM or from the pattern quality.',
    limits: 'Needs FIB or electropolished lamellae; thicker regions give diffuse patterns.',
    live: (S) => [['Foil', `${S.tkdThick} nm`]],
  },
  'Vacuum chamber': {
    kicker: 'Environment',
    role: 'High vacuum keeps electrons from scattering off gas and protects the gun; ports carry detectors.',
    physics: 'The chamber runs ~10⁻⁴–10⁻⁶ mbar, the gun ~10⁻⁹ mbar with differential pumping. Variable-pressure/ESEM modes admit 10–2000 Pa of gas to neutralise charging and image wet samples.',
    specs: [['Chamber', '~10⁻⁵ mbar'], ['Gun', '~10⁻⁹ mbar'], ['VP / ESEM', '10–2600 Pa']],
    metrology: 'Contamination rate is checked by scanning a small area for minutes and looking for a dark carbon square; plasma cleaning reduces it.',
    limits: 'Hydrocarbon contamination; outgassing samples.',
    live: () => [],
  },
};

export function renderComponent(name, S, sim) {
  const c = COMPONENTS[name];
  if (!c) return null;
  const live = c.live(S, sim) || [];
  const rows = (r) => r.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  return `<p class="eyebrow">${c.kicker} · instrument physics</p><h3>${name}</h3><p class="role">${c.role}</p>
    <h4>How it works</h4><p>${c.physics}</p>
    ${live.length ? `<h4>Right now</h4><table class="kv live">${rows(live)}</table>` : ''}
    <h4>Typical specifications</h4><table class="kv">${rows(c.specs)}</table>
    <h4>Measurement &amp; calibration</h4><p>${c.metrology}</p>
    <h4>What limits it</h4><p>${c.limits}</p>`;
}
