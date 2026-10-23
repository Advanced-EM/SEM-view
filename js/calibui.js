// The digital twin's "Calibrate from data" dialog: fit the instrument profile from the live detectors or from your
// own files (they are read in this browser and never leave it), edit the profile by hand, or practise on a
// "mystery instrument" whose miscalibrations are hidden until you reveal them.
//   Magnification & scan   cross-grating image  → magnification calibration, scan aspect, scan shear
//   Resolution & gun       image with sharp edges → probe size; with the live beam settings, the gun brightness
//   EDS                    spectrum with known lines → detector resolution at Mn Kα, energy gain and zero offset
import { fitGrating, fitEdgeResolution, fitEDSPeaks } from './calibrate.js';
import { identifyElements, linesOf } from './analyze.js';
import { collectData } from './export.js';
import { readNpy } from './npy.js';
import { FIELDS, PRESETS, mysteryProfile, sanitizeProfile } from './profile.js';

const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const r = (v, n = 4) => +(+v).toFixed(n);
const fmt = (k, v) => (k === 'Br' ? (+v).toExponential(2) : +(+v).toPrecision(5));
// a mystery instrument: its profile is simulated but hidden in the dialog until calibrated or revealed
let mystery = null;
const CAL_KEYS = { scale: ['magCal', 'scanAspect', 'scanShear'], gun: ['Br'], eds: ['edsFWHM', 'edsGain', 'edsOffset'] };
export const hiddenField = (k) => !!mystery && !mystery.revealed && !mystery.cal.has(k) && Object.values(CAL_KEYS).flat().includes(k);

// ------------------------------------------------------------------ file readers
// TIFF: uncompressed 8/16/32-bit grayscale or RGB, strips; reads the pixel size that Thermo Fisher Scientific (tag 34682) and
// Zeiss (tag 34118) SEMs write into their own metadata
export function readTiff(buf) {
  const dv = new DataView(buf), le = dv.getUint16(0) === 0x4949, u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  if (u16(2) !== 42) throw new Error('not a TIFF file');
  const ifd = u32(4), n = u16(ifd), tags = {};
  const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 11: 4, 12: 8 };
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12, tag = u16(e), type = u16(e + 2), cnt = u32(e + 4), bytes = (size[type] ?? 1) * cnt, off = bytes <= 4 ? e + 8 : u32(e + 8);
    const vals = [];
    if (type === 2 || type === 1 || type === 7) tags[tag] = new TextDecoder().decode(new Uint8Array(buf, off, cnt)).replace(/\0+$/, '');
    else { for (let k = 0; k < Math.min(cnt, 4096); k++) vals.push(type === 3 ? u16(off + 2 * k) : u32(off + 4 * k)); tags[tag] = vals; }
  }
  const W = tags[256][0], H = tags[257][0], bps = tags[258]?.[0] ?? 8, spp = tags[277]?.[0] ?? 1;
  if ((tags[259]?.[0] ?? 1) !== 1) throw new Error('compressed TIFF: save it uncompressed, or as PNG');
  const strips = tags[273], data = new Float32Array(W * H), bpp = (bps / 8) * spp;
  let p = 0;
  for (let s = 0; s < strips.length && p < W * H; s++) {
    let o = strips[s];
    const len = tags[279][s];
    for (let k = 0; k < len / bpp && p < W * H; k++, o += bpp) data[p++] = bps === 8 ? dv.getUint8(o) : bps === 16 ? dv.getUint16(o, le) : dv.getFloat32(o, le);
  }
  // pixel size in µm, when the instrument wrote it
  let pixUm = null;
  const tfs = typeof tags[34682] === 'string' && /PixelWidth=([\d.eE+-]+)/.exec(tags[34682]);
  if (tfs) pixUm = +tfs[1] * 1e6;
  const zeiss = typeof tags[34118] === 'string' && /Image Pixel Size = ([\d.]+) (pm|nm|µm|um)/.exec(tags[34118]);
  if (zeiss) pixUm = +zeiss[1] * { pm: 1e-6, nm: 1e-3, 'µm': 1, um: 1 }[zeiss[2]];
  // Thermo Fisher images carry a data bar below the image: keep the square-ish top
  const Hc = tfs && H > W * 0.7 ? Math.min(H, Math.round(W * (H > W ? 1 : H / W))) : H;
  return { data: data.slice(0, W * Hc), w: W, h: Hc, pixUm };
}
async function readImage(file) {
  const buf = await file.arrayBuffer(), name = file.name.toLowerCase();
  if (name.endsWith('.npy')) { const a = readNpy(buf); return { data: a.data, w: a.shape[1], h: a.shape[0], pixUm: null }; }
  if (/\.tiff?$/.test(name)) return readTiff(buf);
  const bmp = await createImageBitmap(new Blob([buf])), cv = document.createElement('canvas');
  cv.width = bmp.width; cv.height = bmp.height;
  const c = cv.getContext('2d'); c.drawImage(bmp, 0, 0);
  const d = c.getImageData(0, 0, cv.width, cv.height).data, out = new Float32Array(cv.width * cv.height);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
  return { data: out, w: cv.width, h: cv.height, pixUm: null };
}
// EMSA/MSA (the standard EDS format) or two-column text (energy in keV or eV, counts)
export function readSpectrum(text) {
  const lines = text.split(/\r?\n/);
  let per = null, off = 0, unit = 1;
  const vals = [], pairs = [];
  for (const l of lines) {
    const h = /^#\s*([A-Z ]+?)\s*:\s*(.*)$/.exec(l);
    if (h) { if (h[1] === 'XPERCHAN') per = +h[2]; if (h[1] === 'OFFSET') off = +h[2]; if (h[1] === 'XUNITS' && /^eV/i.test(h[2])) unit = 1e-3; continue; }
    const nums = l.split(/[,;\s]+/).filter(Boolean).map(Number);
    if (!nums.length || nums.some((x) => !Number.isFinite(x))) continue;
    if (nums.length >= 2) pairs.push(nums); else vals.push(nums[0]);
  }
  if (per && (vals.length || pairs.length)) {
    const counts = vals.length ? vals : pairs.map((p) => p[1]), keV = per * unit, start = off * unit;
    return resample(counts.map((c, i) => [start + (i + 0.5) * keV, c]));
  }
  if (pairs.length > 20) { const eV = pairs.at(-1)[0] > 100; return resample(pairs.map(([e, c]) => [eV ? e / 1000 : e, c])); }
  throw new Error('not a spectrum: use an EMSA/MSA file, or two columns (energy, counts)');
}
// onto channels that start at 0 keV, as the fits expect
function resample(pts) {
  const dE = pts[1][0] - pts[0][0], n = Math.ceil(pts.at(-1)[0] / dE), out = new Float32Array(n);
  for (const [e, c] of pts) { const b = Math.floor(e / dE); if (b >= 0 && b < n) out[b] += c; }
  return { spec: out, dE };
}

// ------------------------------------------------------------------ dialog
export function openCalibration({ S, sim, onApply, el = document.getElementById('calib') }) {
  const body = el.querySelector('.calibBody');
  let tab = 'scale';
  const tabs = [['scale', 'Magnification & scan'], ['res', 'Resolution & gun'], ['eds', 'EDS'], ['profile', 'Profile']];
  const render = () => {
    body.innerHTML = `<p class="eyebrow">Digital twin · calibrate from data</p><h2>${esc(S.profile.name)}</h2>
      <p class="muted">Fit the instrument profile from what this microscope records, or from your own files (read in this browser, never uploaded). ${mystery ? '<b>A mystery instrument is loaded:</b> its miscalibrations are hidden until you reveal them.' : ''}</p>
      <div class="chips ctabs">${tabs.map(([k, l]) => `<button class="chip${k === tab ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="cpane">${PANES[tab]()}</div>
      <div class="crow"><button class="btn" data-x="mystery">${mystery ? 'New mystery instrument' : 'Practise: load a mystery instrument'}</button>${mystery ? '<button class="btn" data-x="reveal">Reveal the hidden values</button>' : ''}</div>
      <div class="cres" id="cRes"></div>`;
    body.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); }));
    body.querySelector('[data-x="mystery"]').onclick = () => { const p = mysteryProfile(Math.random); mystery = { truth: structuredClone(p), cal: new Set(), revealed: false }; onApply({ type: 'profile', profile: p, replace: true }); render(); out('<p>A mystery instrument is loaded. Calibrate it on the grating (magnification, scan), on tin spheres (resolution) and with EDS, then reveal.</p>'); };
    body.querySelector('[data-x="reveal"]')?.addEventListener('click', () => {
      const keys = Object.values(CAL_KEYS).flat();
      out(`<table class="data"><tr><td></td><td>hidden</td><td>you measured</td></tr>${keys.map((k) => `<tr><td>${FIELDS.find((f) => f[0] === k)[1]}</td><td>${fmt(k, mystery.truth[k])}</td><td>${mystery.cal.has(k) ? fmt(k, S.profile[k]) : '—'}</td></tr>`).join('')}</table>`);
      mystery.revealed = true;
    });
    WIRE[tab]?.();
  };
  const out = (html) => { const o = body.querySelector('#cRes'); if (o) o.innerHTML = html; };
  const fail = (e) => out(`<p class="err">${esc(e.message ?? e)}</p>`);
  const source = (id, accept, note) => `<div class="crow"><label><input type="radio" name="${id}" value="live" checked> What the detector shows now</label><label><input type="radio" name="${id}" value="file"> A file <input type="file" accept="${accept}" data-file="${id}"></label></div><p class="muted">${note}</p>`;
  const pick = (id) => body.querySelector(`input[name="${id}"]:checked`).value;
  const fileOf = (id) => body.querySelector(`[data-file="${id}"]`).files[0];
  const liveImage = () => {
    if (!['se', 'inlens', 'bse'].includes(S.mode) || !sim.img) throw new Error('switch to an imaging mode (SE, in-lens or BSE) first');
    const d = collectData(sim, S).arrays.image;
    return { data: d.data, w: d.shape[1], h: d.shape[0], pixUm: S.fov / sim.img.n };
  };
  const applyBtn = (label, r0) => { out(r0.html + `<div class="crow"><button class="btn primary" id="cApply">${label}</button></div>`); body.querySelector('#cApply').onclick = () => { onApply(r0.result); for (const k of CAL_KEYS[r0.result.type] ?? []) mystery?.cal.add(k); out(r0.html + '<p class="ok">Applied to the instrument profile ✓</p>'); }; };

  const PANES = {
    scale: () => `${source('sc', '.tif,.tiff,.png,.jpg,.jpeg,.npy', 'Image a cross grating so that at least four periods fill the field (load the 463 nm grating here). For a file, give the nominal pixel size, unless the TIFF records it.')}
      <div class="cgrid"><label>Grating pitch (nm)<input type="number" id="cPitch" value="463" step="0.1"></label><label>Nominal pixel size (nm, files)<input type="number" id="cPix" step="0.01" placeholder="from the TIFF"></label></div>
      <div class="crow"><button class="btn primary" id="cFit">Fit the grating</button></div>`,
    res: () => `${source('rs', '.tif,.tiff,.png,.jpg,.jpeg,.npy', 'Image small, sharp particles (tin spheres, gold islands) with the pixel at most a third of the probe. From the live image the gun brightness follows from the probe-size budget at the present current and aperture.')}
      <div class="cgrid"><label>Nominal pixel size (nm, files)<input type="number" id="cPix" step="0.01" placeholder="from the TIFF"></label></div>
      <div class="crow"><button class="btn primary" id="cFit">Measure the resolution</button></div>`,
    eds: () => `${source('es', '.msa,.emsa,.txt,.csv', 'A spectrum with several well-separated lines, collected long enough (over 10⁵ counts). Live: the EDS mode spectrum. Files: EMSA/MSA or two columns (energy, counts).')}
      <div class="cgrid"><label>Beam voltage (kV, files)<input type="number" id="cKV" value="20" step="0.5"></label></div>
      <div class="crow"><button class="btn primary" id="cFit">Fit the peaks</button></div>`,
    profile: () => `<div class="cgrid"><label>Start from a preset<select id="cPreset">${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}" ${k === S.profile.preset ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label></div>
      <div class="cgrid">${FIELDS.map(([k, l, u]) => `<label>${l}${u ? ` (${u})` : ''}<input type="${hiddenField(k) ? 'text' : 'number'}" data-f="${k}" value="${hiddenField(k) ? 'hidden' : S.profile[k]}" ${hiddenField(k) ? 'disabled' : ''} step="any"></label>`).join('')}</div>
      <div class="crow"><button class="btn primary" id="cSave">Apply these values</button><button class="btn" id="cLoadP">Load a profile file…</button><input type="file" id="cProf" accept=".json" hidden></div>`,
  };
  const WIRE = {
    scale: () => body.querySelector('#cFit').onclick = async () => {
      try {
        const im = pick('sc') === 'live' ? liveImage() : await readImage(fileOf('sc') ?? Promise.reject(new Error('choose a file')));
        const pix = im.pixUm ?? (+body.querySelector('#cPix').value / 1000);
        if (!(pix > 0)) throw new Error('enter the nominal pixel size: this file does not record it');
        const f = fitGrating(im.data, im.w, im.h, { pixUm: pix, pitchUm: +body.querySelector('#cPitch').value / 1000 });
        if (f.periods_in_field < 4) throw new Error(`only ${f.periods_in_field.toFixed(1)} periods in the field: zoom out`);
        applyBtn('Apply magnification and scan', { html: `<table class="data"><tr><td>Magnification (true / nominal)</td><td>×${r(f.magCal, 5)}</td></tr><tr><td>Scan aspect (y / x)</td><td>${r(f.scanAspect, 5)}</td></tr><tr><td>Scan shear</td><td>${r(f.scanShear, 3)}°</td></tr><tr><td>True pixel size</td><td>${r(f.pixel_um * 1000, 4)} nm</td></tr><tr><td>Grating rotation</td><td>${r(f.rotation_deg, 2)}°</td></tr></table>`,
          result: { type: 'scale', magCal: f.magCal, scanAspect: f.scanAspect, scanShear: f.scanShear, source: pick('sc') === 'live' ? 'live' : fileOf('sc').name } });
      } catch (e) { fail(e); }
    },
    res: () => body.querySelector('#cFit').onclick = async () => {
      try {
        const live = pick('rs') === 'live', im = live ? liveImage() : await readImage(fileOf('rs') ?? Promise.reject(new Error('choose a file')));
        const pix = im.pixUm ?? (+body.querySelector('#cPix').value / 1000);
        if (!(pix > 0)) throw new Error('enter the nominal pixel size');
        const f = fitEdgeResolution(im.data, im.w, im.h, { pixUm: pix });
        let html = `<table class="data"><tr><td>Resolution (probe diameter)</td><td>${r(f.resolution_nm, 2)} nm</td></tr><tr><td>Edge width 25–75 %</td><td>${r(f.edge_25_75_nm, 2)} nm from ${f.edges} edges</td></tr>`;
        if (!live) { out(html + '</table>'); return; }
        // the source-image term is what is left of the measured probe after the lens and diffraction terms
        const pr = sim.probe, dg2 = f.resolution_nm ** 2 - pr.ds ** 2 - pr.dc ** 2 - pr.dd ** 2 - pr.dm ** 2;
        if (dg2 <= 0) { out(html + '<tr><td>Gun brightness</td><td>not measurable: the probe is limited by aberrations and diffraction here. Raise the current or use a larger aperture.</td></tr></table>'); return; }
        const dg = Math.sqrt(dg2) * 1e-9, Br = (4 * S.current * 1e-12) / (Math.PI * Math.PI * S.kV * 1e3 * dg * dg * pr.alpha * pr.alpha);
        html += `<tr><td>Source-image term</td><td>${r(Math.sqrt(dg2), 2)} nm at ${S.current} pA, α ${r(pr.alpha * 1e3, 2)} mrad</td></tr><tr><td>Reduced brightness</td><td>${Br.toExponential(2)} A/m²·sr·V</td></tr></table>`;
        applyBtn('Apply the brightness', { html, result: { type: 'gun', Br: +Br.toPrecision(3), resolution_nm: f.resolution_nm, source: 'live' } });
      } catch (e) { fail(e); }
    },
    eds: () => body.querySelector('#cFit').onclick = async () => {
      try {
        let spec, dE, kV;
        if (pick('es') === 'live') {
          if (S.mode !== 'eds' || !sim.acc) throw new Error('switch to EDS and let the spectrum build up');
          spec = sim.acc.spec; dE = sim.eds.dE; kV = S.kV;
          if (sim.acc.total < 1e5) throw new Error(`only ${Math.round(sim.acc.total).toLocaleString()} counts so far: wait for more than 100,000`);
        } else { const f = fileOf('es'); if (!f) throw new Error('choose a file'); ({ spec, dE } = readSpectrum(await f.text())); kV = +body.querySelector('#cKV').value; }
        const els = identifyElements(spec, dE, kV), f = fitEDSPeaks(spec, dE, linesOf(els, kV));
        applyBtn('Apply the EDS calibration', { html: `<p>Elements ${els.join(', ')}; ${f.found.length} peaks fitted.</p><table class="data"><tr><td>Resolution at Mn Kα</td><td>${Math.round(f.fwhmMn)} eV</td></tr><tr><td>Energy gain</td><td>${r(f.gain, 5)}</td></tr><tr><td>Zero offset</td><td>${r(f.offset_eV, 1)} eV</td></tr>${f.found.map((p) => `<tr><td>${p.label}</td><td>${r(p.Emeas, 4)} keV (table ${p.E}), FWHM ${Math.round(p.fwhm)} eV</td></tr>`).join('')}</table>`,
          result: { type: 'eds', fwhmMn: f.fwhmMn, gain: f.gain, offset: f.offset_eV, source: pick('es') === 'live' ? 'live' : fileOf('es').name } });
      } catch (e) { fail(e); }
    },
    profile: () => {
      body.querySelector('#cPreset').onchange = (e) => { mystery = null; onApply({ type: 'preset', preset: e.target.value }); render(); };
      body.querySelector('#cSave').onclick = () => {
        try {
          const p = { ...structuredClone(S.profile) };
          body.querySelectorAll('[data-f]:not([disabled])').forEach((i) => { p[i.dataset.f] = +i.value; });
          onApply({ type: 'profile', profile: sanitizeProfile(p) }); out('<p class="ok">Applied ✓</p>');
        } catch (e) { fail(e); }
      };
      body.querySelector('#cLoadP').onclick = () => body.querySelector('#cProf').click();
      body.querySelector('#cProf').onchange = async (e) => { try { mystery = null; onApply({ type: 'profile', profile: sanitizeProfile(JSON.parse(await e.target.files[0].text())), replace: true }); render(); } catch (err) { fail(err); } };
    },
  };
  el.hidden = false;
  el.onclick = (e) => { if (e.target === el || e.target.closest('.close')) el.hidden = true; };
  render();
}
