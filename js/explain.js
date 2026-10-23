// What each mode shows, what each control changes, and the instrument readout.
import * as P from './physics.js';
import { fmtLen } from './render2d.js';

const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
const under = (sim) => { const s = sim.spec.sample(sim.S.cx, sim.S.cy); return P.MAT[s.mat].rho ? P.MAT[s.mat] : P.MAT.C; };

export function modeInfo(S, sim) {
  const pr = sim.probe, m = under(sim), R = P.rangeKO(m, S.kV);
  const M = sim.map;
  switch (S.mode) {
    case 'se': return {
      title: 'Seeing <em>topography</em>',
      body: `The probe knocks <b>secondary electrons</b> (SE, below 50 eV) out of the top few nanometres. Their yield follows the <b>secant law</b>: tilted faces and edges emit more, so the image reads like a lit landscape. The <b>Everhart–Thornley detector</b> pulls them in with a positively biased Faraday cage. Surfaces facing it look brighter, and faces hidden behind features are shadowed: that’s where the “lighting” comes from. Uncoated insulators charge when the beam deposits more electrons than leave (above the <b>E2</b> crossover, right).`,
      stats: [['Probe size', `${f1(pr.d)} nm`, 'sets the ultimate resolution'], ['Magnification', `×${Math.round(127000 / S.fov).toLocaleString()}`, `field of view ${fmtLen(S.fov)}`], ['Interaction range', fmtLen(R), `${m.name}, Kanaya–Okayama`]],
    };
    case 'inlens': return {
      title: 'Surface detail <em>through the lens</em>',
      body: `An <b>in-lens</b> (through-the-lens) detector sits inside the column. The objective’s magnetic field captures the lowest-energy secondaries emitted right under the probe (SE1) and spirals them up to the detector, so it sees mostly the <b>true surface signal</b>, with little shadowing and little of the blurry SE2 excited by backscattered electrons far from the probe. It needs a <b>short working distance</b>: the collection efficiency drops fast beyond ~5 mm. Right: how aberrations, diffraction and the source set the probe size.`,
      stats: [['Probe size', `${f1(pr.d)} nm`, `α = ${f1(pr.alpha * 1000)} mrad`], ['Working distance', `${S.wd} mm`, 'shorter is better here'], ['Depth of field', fmtLen(2 * Math.max(S.fov / 256, pr.d / 1000) / pr.alpha), 'grows as α shrinks']],
    };
    case 'bse': return {
      title: 'Seeing <em>atomic number</em>',
      body: `<b>Backscattered electrons</b> (BSE) are primary electrons that bounce back out after elastic scattering from nuclei, still carrying much of their energy. Heavier atoms send more back: η rises with Z (right), so brightness maps <b>composition</b>. A four-quadrant solid-state detector under the pole piece adds all segments for composition (A+B+C+D) or subtracts opposite ones for <b>topography</b> (A−B). In crystals the backscatter yield also depends on how the beam lines up with atomic rows: <b>channelling contrast</b> makes grains in polished metals light up differently.`,
      stats: [['η here', f2(P.eta(m.Z, (S.tilt * Math.PI) / 180)), `${m.name}`], ['BSE escape depth', fmtLen(0.3 * R), '≈ 0.3 × range'], ['Segments', P.segLabel(S.seg), P.segKind(S.seg)]],
    };
    case 'ebsd': return {
      title: 'Crystal orientation <em>from Kikuchi bands</em>',
      body: `The specimen is tilted to <b>70°</b> so backscattered electrons leave toward a phosphor screen. Electrons diffracted by each lattice plane form a <b>Kikuchi band</b> whose centre line is the plane’s trace and whose width is 2θ<sub>B</sub>. A <b>Hough transform</b> finds the bands, their mutual angles are matched against the crystal’s interplanar angles, and the orientation drops out. Every pixel of the map is a full pattern, indexed live here. The colours (inverse pole figure) show which crystal direction points out of the surface. At grain boundaries and in fine grains, patterns from neighbours overlap and indexing fails.`,
      stats: [['Indexed', M ? `${M.done ? Math.round((100 * M.ok) / M.done) : 0} %` : '—', M ? `${M.done} / ${M.N * M.N} points` : ''], ['Mean error', M && M.ok ? `${(M.errSum / M.ok).toFixed(2)}°` : '—', 'vs the true orientation'], ['Spatial resolution', fmtLen(0.02 * R) + ' × ' + fmtLen((0.02 * R) / Math.cos(1.22)), 'across × along the tilt']],
    };
    case 'tkd': return {
      title: 'Kikuchi patterns <em>in transmission</em>',
      body: `<b>Transmission Kikuchi diffraction</b> (TKD, or t-EBSD) uses an electron-transparent lamella (~50–150 nm) held flat, with the detector <b>below</b> it. Patterns form from electrons diffracted as they leave the bottom surface, so the source volume is tiny, about <b>5–10 nm</b> laterally instead of tens of nm along a 70° slope. That resolves nanograins, like those in these copper interconnects, which conventional EBSD blurs into overlapping patterns. Same bands, same indexing, much smaller interaction volume.`,
      stats: [['Indexed', M ? `${M.done ? Math.round((100 * M.ok) / M.done) : 0} %` : '—', M ? `${M.done} / ${M.N * M.N}` : ''], ['Foil thickness', `${S.tkdThick} nm`, 'thin: sharp; thick: diffuse'], ['Lateral resolution', fmtLen(0.004 + (S.tkdThick / 1000) * 0.06), 'vs ~tens of nm in EBSD']],
    };
    case 'eds': {
      const e = sim.eds;
      return {
        title: 'Chemistry from <em>characteristic X-rays</em>',
        body: `Ionised atoms relax by emitting X-rays at element-specific energies. In a bulk sample they come from the whole <b>X-ray generation volume</b>, often a micrometre across at 15–20 kV, which sets the spatial resolution (not the probe size!). Each line needs <b>overvoltage</b> U = E₀/E<sub>c</sub> above ~1.5–2 to be excited efficiently, and low-energy lines are absorbed on their way out. The continuous background (bremsstrahlung) ends exactly at the beam energy: the <b>Duane–Hunt limit</b>, a direct check of the true kV.`,
        stats: [['X-ray range', e ? fmtLen(e.Rx) : '—', e?.mainLine ? `${e.mainLine.el} ${e.mainLine.line} in ${e.dom.name}` : ''], ['Counts', sim.acc ? Math.round(sim.acc.total).toLocaleString() : '—', sim.acc ? `${f1(sim.acc.t)} s` : ''], ['Resolution (Mn Kα)', '128 eV', 'silicon drift detector']],
      };
    }
    case 'cl': {
      const c = sim.cl;
      return {
        title: 'Seeing <em>light</em>: cathodoluminescence',
        body: `In semiconductors and insulators the beam lifts electrons across the band gap, making electron–hole pairs (one per ~3 E<sub>g</sub> of deposited energy). When they recombine they can emit <b>light</b> at the material’s own energies: the GaN band edge at 365 nm, the InGaN quantum wells near 450 nm, the ruby line of Cr³⁺ in alumina at 694 nm. A <b>parabolic mirror</b> above the specimen collects it for a photomultiplier (panchromatic) or a spectrometer. <b>Dislocations</b> show as dark spots, because carriers that diffuse into them recombine without light. Raise the voltage and the generation volume reaches the buried wells (depth-resolved CL), but grows wider, so the dark spots blur.`,
        stats: [['Generation volume', c ? fmtLen(2 * c.sg) : '—', 'across, sets the resolution'], ['Pairs per electron', c ? Math.round(c.gen).toLocaleString() : '—', `at ${S.kV} kV`], ['Window', S.clMode === 'pan' ? 'panchromatic' : `${S.clLam} ± ${S.clBand / 2} nm`, S.clMode === 'pan' ? 'photomultiplier' : 'spectrometer + CCD']],
      };
    }
    case 'mc': {
      const mc = sim.mc;
      return {
        title: 'Inside the <em>interaction volume</em>',
        body: `A <b>Monte Carlo</b> simulation, run live: each electron takes random steps between elastic collisions with nuclei (screened Rutherford cross-section) while losing energy continuously to the electrons (Bethe/Joy–Luo stopping power). Hundreds of trajectories build the pear-shaped <b>interaction volume</b>. Those that escape through the surface are the backscattered electrons (orange). Raise the voltage and the volume balloons; switch to a heavier material and it shrinks and backscatters more. Every SEM signal comes from a different part of this volume: SE from the top nanometres, BSE from ~⅓ of the range, X-rays from almost all of it.`,
        stats: [['η measured', mc ? f2(mc.eta) : '—', mc ? `Reuter: ${f2(P.eta(mc.m.Z, (S.tilt * Math.PI) / 180))}` : ''], ['Range', mc ? fmtLen(mc.R / 1000) : '—', 'Kanaya–Okayama'], ['Trajectories', mc ? mc.n.toLocaleString() : '—', mc ? mc.m.name : 'no material']],
      };
    }
  }
}

export function changeText(key, S, sim) {
  const pr = sim.probe, m = under(sim), R = P.rangeKO(m, S.kV);
  switch (key) {
    case 'kV': return ['Accelerating voltage', `<b>${S.kV} kV</b>. Higher voltage gives a smaller probe (less chromatic blur, more brightness) but the electrons penetrate deeper: the range in ${m.name.toLowerCase()} is now <b>${fmtLen(R)}</b>. Surface detail washes out, edges glow, and BSE and X-ray resolution worsen. Low kV (1–5) is surface-sensitive and avoids charging on insulators; high kV is needed to excite K-lines of heavier elements for EDS and to get strong EBSD patterns.`];
    case 'current': return ['Probe current', `<b>${S.current >= 1000 ? f1(S.current / 1000) + ' nA' : Math.round(S.current) + ' pA'}</b>. More current means more signal and less noise, but the source must be imaged larger to deliver it: the probe grows to <b>${f1(pr.d)} nm</b>. Imaging uses pA to ~100 pA; EDS and EBSD use nA for count rate.`];
    case 'aperture': return ['Aperture', `A <b>${S.aperture} µm</b> aperture gives a convergence α = <b>${f1(pr.alpha * 1000)} mrad</b>. Small α: less aberration, larger depth of field, but the diffraction limit and lower current. Large α: more current, bigger aberration disks. The curve in In-lens mode shows the optimum.`];
    case 'wd': return ['Working distance', `<b>${S.wd} mm</b>. A shorter working distance reduces the objective’s aberrations (C<sub>s</sub> ∝ WD<sup>~1.5</sup>) and improves in-lens collection; a longer one increases depth of field and leaves room for tilting, EDS and EBSD geometry (EBSD typically uses 10–20 mm).`];
    case 'fov': return ['Magnification', `Field of view <b>${fmtLen(S.fov)}</b>, ×${Math.round(127000 / S.fov).toLocaleString()} on a 127 mm display. Each pixel is ${fmtLen(S.fov / 256)}. SEM magnification is just the ratio of display size to scanned size, so it must be calibrated against a certified pitch standard.`];
    case 'tilt': return ['Stage tilt', `Tilted <b>${S.tilt}°</b>. Tilting increases SE yield (secant law) and the BSE coefficient, and foreshortens the image by cos θ along the tilt axis. EBSD needs ~70° so the backscattered, diffracted electrons head toward the screen.`];
    case 'coated': return ['Carbon coating', S.coated ? 'A few nm of evaporated carbon now drains the charge from insulators to ground. Charging vanishes at any kV, at the cost of burying the finest surface detail.' : 'Uncoated: insulators (alumina, silica) will charge above their second crossover E2 unless you drop the voltage.'];
    case 'focus': return ['Focus', `Defocus <b>${S.focus >= 0 ? '+' : ''}${f2(S.focus)} µm</b> spreads the probe into a disk of diameter 2α·Δf. At this α that’s <b>${fmtLen(2 * pr.alpha * Math.abs(S.focus))}</b>. Tall features also go out of focus: depth of field ≈ 2×(pixel or probe)/α.`];
    case 'stigX': case 'stigY':
    case 'stig': return ['Stigmator', `Astigmatism focuses the beam at two different heights in two directions, so under- and over-focus smear the image in perpendicular directions. The stigmator’s quadrupole field cancels it. Correct when the image is sharpest, and when going through focus no longer streaks features sideways.`];
    case 'autofocus': return ['Auto focus & stigmation', 'The software swept the focus and stigmator to maximise image sharpness (the gradient/FFT metric shown on the image), the same principle as SMART resolution measurement on a gold-on-carbon standard.'];
    case 'dwell': return ['Dwell time', `<b>${S.dwell} µs</b> per pixel: ${Math.round(S.current * 6.24 * S.dwell)} primary electrons land on each pixel. Signal-to-noise grows as √(dwell); slow scans also give insulators more time to charge and let drift smear the image.`];
    case 'etdBias': return ['ETD grid bias', S.etdBias >= 0 ? `<b>+${S.etdBias} V</b> on the Faraday cage attracts low-energy secondaries from all around, even from behind obstacles: soft shadows, mostly SE contrast.` : `<b>${S.etdBias} V</b> repels secondaries: only backscattered electrons flying straight at the detector are counted. Hard shadows, like side-lit topography.`];
    case 'bseMode':
    case 'seg': {
      const k = P.segKind(S.seg), lab = P.segLabel(S.seg);
      const txt = {
        composition: 'Summing opposite segments cancels the slope effects (a tilted facet sends more electrons to one side and fewer to the other), leaving <b>atomic-number</b> and <b>channelling</b> contrast.',
        'topography (difference)': 'Subtracting segments cancels what they have in common, atomic-number contrast, and keeps the imbalance caused by <b>surface slopes</b>: a shaded-relief image lit from the direction of the positive segment(s).',
        'mixed: composition + shading': 'An unbalanced combination: composition contrast plus a directional shading from the segments that don’t cancel. A single segment behaves like an oblique light source.',
        'no signal': 'All segments are off: nothing is detected. Click a quadrant to switch it on.',
      }[k];
      return ['BSE segments', `<b>${lab}</b>. ${txt}`];
    }
    case 'spec': return ['Specimen', sim.spec.note];
    case 'clarity': return S.clarity === 'real' ? ['Physically realistic', 'Grayscale, true shot noise at the chosen current and dwell, raw Kikuchi patterns with background, accumulated EDS counts.'] : ['Educational clarity', 'Tinted images with 12× less noise, background-corrected patterns with zone axes labelled, and clean element maps.'];
    case 'mapN': return ['Map size', `${S.mapN}×${S.mapN} points, a step of ${fmtLen(S.fov / S.mapN)}. Real EBSD maps run at hundreds to thousands of patterns per second.`];
    case 'expo': return ['Exposure', `<b>${S.expo} ms</b> per pattern. Longer exposure gives cleaner bands and higher indexing rates, but slower maps and more drift.`];
    case 'mapView': return ['Map display', { ipf: 'Inverse pole figure: colour shows which crystal direction points along the surface normal (red [001], green [101], blue [111]). Twins show as colour jumps across straight boundaries.', bc: 'Band contrast: how strong the Kikuchi bands are. It looks like an image of the microstructure: dark at boundaries, scratches and strained regions.', mad: 'Mean angular deviation: how well the detected bands fit the solution. Green is < 0.5°, red is poor.' }[S.mapView]];
    case 'tkdThick': return ['Foil thickness', `<b>${S.tkdThick} nm</b>. Too thin: few diffracted electrons and weak bands. Too thick: electrons scatter many times and patterns become diffuse. TKD works best around 50–150 nm for metals.`];
    case 'edsSel': return ['Element map', S.edsSel === 'all' ? 'All elements overlaid.' : `Mapping <b>${S.edsSel}</b>. The map is blurred by the X-ray generation volume, not the probe. Drop the kV (keeping enough overvoltage) to sharpen it.`];
    case 'mcMax': return ['Trajectories', `Up to <b>${S.mcMax.toLocaleString()}</b> electrons. The statistics (η, depth profiles) settle as √N.`];
    case 'apX': case 'apY': { if (S.mis?.ap) return ['Aperture alignment', `Aperture knobs at <b>${f1(S.apX)}, ${f1(S.apY)} µm</b>. The true offset is hidden in this task: watch whether the image still sways with the wobbler.`]; const o = P.apertureOffset(S), r = Math.hypot(o[0], o[1]); return ['Aperture alignment', `The aperture is <b>${f1(r)} µm</b> off the optic axis${r > 3 ? ': the beam crosses the objective off center, so the image walks sideways as the focus changes and the probe picks up ' + f1(pr.dm) + ' nm of extra blur. Switch on the wobbler and turn X and Y until the image only pulses in and out of focus' : ', close enough: the image no longer sways with the wobbler'}.`]; }
    case 'wobble': return ['Focus wobbler', S.wobble ? 'The focus now swings back and forth a few times a second. If the image <b>moves sideways</b> as well as blurring, the aperture is off axis: center it with Aperture X and Y until it only pulses.' : 'Wobbler off: the focus is back at its set value.'];
    case 'clLam': case 'clBand': return ['Monochromator', `Imaging <b>${S.clLam} ± ${S.clBand / 2} nm</b>. ${S.clLam < 380 ? 'The GaN band edge: brightest between dislocations, which are dark.' : S.clLam < 500 && S.spec === 'gan' ? 'The InGaN quantum wells: their emission shifts with the local indium content, so two nearby wavelengths show complementary patterns.' : Math.abs(S.clLam - 694) < 10 ? 'The Cr³⁺ R-line of ruby: traces of chromium in the alumina inclusions.' : 'Click the peaks in the spectrum to image a band.'}`];
    case 'clMode': return ['CL detector', S.clMode === 'pan' ? 'Panchromatic: all the light goes to a photomultiplier, fast and bright, colour-blind (shown here in its true colours in the educational view).' : 'Monochromatic: the spectrometer passes one band to the detector, so the image shows where that emission comes from.'];
    case 'mode': return null;
  }
  return null;
}

export function dataRows(S, sim) {
  const pr = sim.probe, m = under(sim);
  const rows = [
    ['Accelerating voltage', `${S.kV} kV`],
    ['Probe current', S.current >= 1000 ? `${f1(S.current / 1000)} nA` : `${Math.round(S.current)} pA`],
    ['Convergence α', `${f1(pr.alpha * 1000)} mrad`],
    // during a training task the readout is the nominal probe: the extra blur of a hidden misalignment is not shown
    ['Probe diameter', `${f1(S.mis ? Math.sqrt(pr.d * pr.d - pr.dm * pr.dm) : pr.d)} nm`],
    ['  source / Cs / Cc / diffr.', `${f1(pr.dg)} / ${f1(pr.ds)} / ${f1(pr.dc)} / ${f1(pr.dd)}`],
    ['Cs / Cc at this WD', `${f2(pr.Cs * 1000)} / ${f2(pr.Cc * 1000)} mm`],
    ['Depth of field', fmtLen(2 * Math.max(S.fov / 256, pr.d / 1000) / pr.alpha)],
    ['Magnification', `×${Math.round(127000 / S.fov).toLocaleString()}`],
    ['Pixel size', fmtLen(S.fov / 256)],
    ['Material under beam', m.name],
    ['Range (K–O)', fmtLen(P.rangeKO(m, S.kV))],
    ['η / δ', `${f2(P.eta(m.Z))} / ${f2(P.delta(m, S.kV))}`],
    ['Electrons per pixel', Math.round(S.current * 6.24 * S.dwell).toLocaleString()],
  ];
  if (!m.cond) rows.push(['Charging (E2)', P.charges(m, S.kV, S.coated) ? `yes: ${S.kV} > ${m.E2} kV` : 'no']);
  return rows;
}
