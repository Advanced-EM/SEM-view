// Instrument-physics cards for the labelled parts of the SEM.
import * as P from './physics.js';
import { fmtLen } from './render2d.js';

const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);

export const COMPONENTS = {
  'Electron gun': {
    kicker: 'Source',
    role: 'A Schottky field-emission gun: a hot, sharp, zirconia-coated tungsten tip, a stack of electrodes that extract and accelerate its electrons, and an ultra-high vacuum around it. Its brightness decides how much current fits into a small probe.',
    physics: 'From the top: the high-voltage cable and a ceramic insulator carry the emitter at −E₀ (the gun sits at the beam voltage, the column at ground). Below the tip, the <b>suppressor</b>, <b>extractor</b> and <b>gun lens</b> shape the field, and the grounded <b>anode</b> accelerates the electrons to their final energy E₀ = 0.5–30 keV. In <b>Schottky emission</b> the extraction field lowers the work-function barrier (the Schottky effect, Δφ = √(e³F/4πε₀)) and the hot tip emits thermionically over it; this differs from <b>cold field emission</b>, where electrons tunnel through a thin barrier at room temperature. The virtual source is ~15–30 nm across.',
    specs: [['Reduced brightness', '~10⁷–10⁸ A m⁻² sr⁻¹ V⁻¹'], ['Energy spread', '0.6–1.0 eV (cold FEG ~0.3 eV)'], ['Tip temperature', '~1800 K, always on'], ['Gun vacuum', '~10⁻⁹ mbar (cold FEG ~10⁻¹⁰)'], ['Emitter life', '1–2 years'], ['Probe current', '1 pA – 100+ nA']],
    metrology: 'Probe current is measured with a <b>Faraday cup</b> on the stage (or a picoammeter on the specimen) before every EDS/EBSD session, because quantitative analysis scales with it. Emission current, extractor voltage and gun vacuum are logged; the energy spread shows up as chromatic blur at low kV. Brightness follows from the probe size measured at a known current and convergence (Calibrate from data → Resolution &amp; gun).',
    limits: 'Brightness caps the current in a given probe: d<sub>source</sub> ∝ √I/(α√B<sub>r</sub>). Tungsten hairpins (thermionic, ~2700 K) are ~1000× less bright; LaB₆ ~10× less than a Schottky.',
    live: (S) => [['Instrument', S.profile?.gun ?? 'Schottky FEG'], ['Brightness', `${(S.profile?.Br ?? 1e8).toExponential(1)} A/m²·sr·V`], ['Energy spread', `${S.profile?.dE ?? 0.7} eV`], ['E₀', `${S.kV} keV`], ['Current', S.current >= 1000 ? `${f1(S.current / 1000)} nA` : `${Math.round(S.current)} pA`]],
  },
  'Emitter, suppressor & extractor': {
    kicker: 'Source',
    role: 'The heart of the gun: the emitter and the two electrodes closest to it, which set where and how strongly electrons leave the tip.',
    physics: 'A single-crystal <b>W(100) tip</b> (apex radius ~0.5–1 µm) is spot-welded to a <b>tungsten hairpin filament</b> that heats it to ~1800 K. A <b>ZrO₂ reservoir</b> on the shank supplies zirconium oxide that diffuses to the apex and lowers the work function of the (100) facet from 4.5 to ~2.8 eV. The <b>suppressor</b> cap, ~300–500 V negative of the tip, stops thermionic electrons from the hairpin and shank, so only the apex emits; the tip protrudes ~0.25 mm through it. The <b>extractor</b>, ~4–7 kV positive of the tip, makes the ~10⁹ V/m field at the apex that lowers the barrier. A gun lens electrode below focuses the emitted cone.',
    specs: [['Tip', 'W(100) + ZrO₂, apex ~0.5–1 µm'], ['Suppressor', '−300 to −500 V vs tip'], ['Extractor', '+4 to +7 kV vs tip'], ['Emission current', '~100–300 µA total'], ['Angular intensity', '~0.1–1 mA/sr']],
    metrology: 'Raising the extractor voltage increases the emission and the angular intensity, but also the energy spread and the tip’s wear; the gun is run at a fixed extractor setting and the emission is monitored. Tip “flashing” is not needed (unlike a cold FEG), because the hot tip stays clean.',
    limits: 'The ZrO₂ reservoir is used up over ~1–2 years; venting the gun or a vacuum burst can damage the tip.',
    live: (S) => [['Emitter', S.profile?.gun ?? 'Schottky FEG']],
  },
  'Ion getter pump': {
    kicker: 'Vacuum',
    role: 'Keeps the gun at ultra-high vacuum, so gas ions don’t bombard the tip and the emission stays stable.',
    physics: 'A high voltage between titanium cathodes and a cellular anode, in a strong magnetic field, ionizes gas molecules; the ions are buried in the titanium and sputtered titanium chemically binds more gas. No moving parts and no oil. Differential pumping apertures and a <b>gun isolation valve</b> keep the gun at ~10⁻⁹ mbar while the chamber is at ~10⁻⁵ mbar or vented for a sample exchange.',
    specs: [['Gun pressure', '~10⁻⁹ mbar'], ['Pumping speed', '~10–50 l/s per pump'], ['Pressure reading', 'from the pump current']],
    metrology: 'The pump current doubles as the gun’s pressure gauge; a rising reading warns of a leak or of outgassing after a bake-out.',
    limits: 'Saturates if the gun is vented; it is started only after the gun has been rough-pumped and baked.',
    live: () => [],
  },
  'Stigmator': {
    kicker: 'Probe forming',
    role: 'Cancels the objective’s two-fold astigmatism, so the probe is round instead of elliptical.',
    physics: 'Machining errors, magnetic inhomogeneity and contamination make the lens focus more strongly in one direction than the other: the probe then has two line foci, above and below the best focus. An <b>octupole</b> of small coils makes a quadrupole field of adjustable strength and direction; its two components are the <b>Stigmator X</b> and <b>Y</b> knobs. Some octupoles also shift the beam for alignment.',
    specs: [['Elements', '8 poles (two quadrupoles at 45°)'], ['Correction', 'two-fold astigmatism A1, X and Y']],
    metrology: 'At high magnification, go a little through focus: if small round features streak one way below focus and the perpendicular way above it, adjust X and then Y until they don’t, refocusing between. Auto-stigmation does the same with an image-sharpness or FFT metric.',
    limits: 'Must be redone after changes of voltage, working distance or aperture, and as contamination builds up.',
    live: (S, sim) => [['Stigmator X / Y', `${f2(S.stigX)} / ${f2(S.stigY)}`]],
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
    metrology: 'The aperture is centred with the <b>wobbler</b> (the image must not swing sideways while the objective current is modulated; try it with Aperture X and Y under Column alignment). Its effective size is checked from depth-of-field and probe-current measurements.',
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
  'CL mirror & spectrometer': {
    kicker: 'Spectroscopy',
    role: 'Collects the light the beam makes in the specimen and sends it to a photomultiplier or a spectrometer: cathodoluminescence.',
    physics: 'A <b>parabolic mirror</b> slides in between the pole piece and the specimen, with a hole for the beam; the beam spot sits at its focus, so the light leaves as a parallel beam to the side port. There a grating <b>spectrometer</b> with a CCD records spectra (or hyperspectral maps, a spectrum per pixel), or a <b>photomultiplier</b> takes fast panchromatic images; with a monochromator in front it images one band.',
    specs: [['Collection', 'up to ~1.4π sr'], ['Range', '~200–1700 nm (UV to near-IR detectors)'], ['Spectral resolution', '~0.1–2 nm'], ['Spatial resolution', '~10–100 nm (generation volume + diffusion)']],
    metrology: 'The wavelength scale is calibrated with an Hg/Ar lamp; the system response (mirror, grating, detector) with a calibrated lamp, so spectra from different settings can be compared. Mirror alignment is optimized on a bright, small emitter.',
    limits: 'Spatial resolution is set by the generation volume and carrier diffusion, not the probe; electron-beam damage and heating can quench the emission; cooling the stage sharpens bands.',
    live: (S, sim) => [['Window', S.clMode === 'pan' ? 'panchromatic' : `${S.clLam} ± ${S.clBand / 2} nm`], ['Working distance', `${S.wd} mm`]],
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
