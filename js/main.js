import * as P from './physics.js';
import { Sim } from './sim.js';
import * as R2 from './render2d.js';
import { Scene3D, Y } from './scene3d.js';
import { modeInfo, changeText, dataRows } from './explain.js';
import { renderComponent } from './components.js';

const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ state
const S = {
  mode: 'se', clarity: 'edu', spec: 'sn', fov: 20, cx: 0, cy: 0, tilt: 0, coated: false,
  kV: 5, current: 100, aperture: 30, wd: 5, focus: 0, stig: 0, dwell: 2,
  etdBias: 250, bseMode: 'comp', seg: { A: 1, B: 1, C: 1, D: 1 },
  mapN: 40, expo: 10, mapView: 'ipf', showHough: true, tkdThick: 90,
  edsSel: 'all', mcMax: 2500,
  speed: 1, paused: false, showLabels: true, showElectrons: true, showGlass: true, autoRotate: false,
};
const sim = new Sim(S);
const scene = new Scene3D($('#gl'), $('#labels'));
const mainCv = $('#detMain'), secCv = $('#detSec');
let hoverIdx = -1;

const MODES = [
  ['se', 'SE · ETD', 'secondary electrons', 'Imaging'], ['inlens', 'In-lens', 'through-the-lens SE', 'Imaging'], ['bse', 'BSE', 'backscattered', 'Imaging'],
  ['ebsd', 'EBSD', 'orientation maps', 'Diffraction'], ['tkd', 'TKD', 'transmission Kikuchi', 'Diffraction'],
  ['eds', 'EDS', 'X-ray spectra', 'Spectroscopy'], ['mc', 'Interaction volume', 'Monte Carlo', 'Physics'],
];
const KEYS = '1234567';
const logMap = (min, max) => ({ to: (v) => (Math.log(v / min) / Math.log(max / min)) * 1000, from: (t) => min * Math.pow(max / min, t / 1000) });
const IMG = 'se inlens bse';

const CONTROLS = [
  { sec: 'The specimen' },
  { chips: 'spec', opts: [['sn', 'Tin on carbon'], ['ni', 'Polycrystalline Ni'], ['chip', 'Chip cross-section']] },
  { slider: 'fov', label: 'Field of view', dyn: () => ({ min: sim.spec.fovMin, max: sim.spec.fovMax }), log: true, fmt: (v) => `${R2.fmtLen(v)}  ×${Math.round(127000 / v).toLocaleString()}`, note: 'Drag the image to move the stage; scroll to zoom.' },
  { slider: 'tilt', label: 'Stage tilt', min: 0, max: 72, step: 1, fmt: (v) => `${v}°`, ends: ['flat', '', 'EBSD 70°'] },
  { toggles: [['coated', 'Carbon coating']] },

  { sec: 'The electron beam' },
  { slider: 'kV', label: 'Accelerating voltage', min: 0.5, max: 30, step: 0.5, fmt: (v) => `${v} kV` },
  { chips: 'kV', small: true, opts: [[1, '1 kV'], [5, '5 kV'], [15, '15 kV'], [20, '20 kV'], [30, '30 kV']] },
  { slider: 'current', label: 'Probe current', min: 1, max: 20000, log: true, fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} nA` : `${Math.round(v)} pA`), ends: ['imaging', '', 'EDS / EBSD'] },
  { chips: 'aperture', label: 'Aperture', opts: [[10, '10 µm'], [20, '20 µm'], [30, '30 µm'], [60, '60 µm'], [120, '120 µm']] },
  { slider: 'wd', label: 'Working distance', min: 2, max: 20, step: 0.5, fmt: (v) => `${v} mm`, ends: ['resolution', '', 'depth of field'] },

  { sec: 'Focus & astigmatism', modes: IMG },
  { slider: 'focus', label: 'Focus', dyn: () => { const r = Math.max(0.3, Math.min(60, S.fov * 0.6)); return { min: -r, max: r, step: r / 500 }; }, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} µm`, ends: ['under', 'focus', 'over'], modes: IMG },
  { slider: 'stig', label: 'Stigmator', min: -2, max: 2, step: 0.01, fmt: (v) => `${v.toFixed(2)}`, modes: IMG },
  { buttons: [['autofocus', 'Auto focus + stigmation']], modes: IMG },
  { slider: 'dwell', label: 'Dwell time', min: 0.1, max: 30, log: true, fmt: (v) => `${v.toFixed(v < 1 ? 2 : 1)} µs`, ends: ['TV rate, noisy', '', 'slow, clean'], modes: IMG },

  { sec: 'Detectors', modes: 'se bse ebsd tkd eds mc' },
  { slider: 'etdBias', label: 'ETD Faraday cage bias', min: -150, max: 300, step: 5, fmt: (v) => `${v > 0 ? '+' : ''}${v} V`, modes: 'se', ends: ['BSE only', '0', 'all SE'] },
  { chips: 'bseMode', label: 'Segment presets', modes: 'bse', opts: [['comp', 'A+B+C+D'], ['topoX', 'A−B'], ['topoY', 'C−D']] },
  { p: 'Or click the quadrants on the detector diagram to add (+), subtract (−) or switch off each segment.', modes: 'bse' },
  { chips: 'mapN', label: 'Map size', modes: 'ebsd tkd', opts: [[24, '24²'], [40, '40²'], [56, '56²']] },
  { slider: 'expo', label: 'Pattern exposure', min: 1, max: 50, step: 1, fmt: (v) => `${v} ms`, modes: 'ebsd tkd' },
  { slider: 'tkdThick', label: 'Foil thickness', min: 20, max: 400, step: 5, fmt: (v) => `${v} nm`, modes: 'tkd' },
  { chips: 'mapView', label: 'Show', modes: 'ebsd tkd', opts: [['ipf', 'IPF-Z'], ['bc', 'Band contrast'], ['mad', 'MAD']] },
  { toggles: [['showHough', 'Hough bands']], modes: 'ebsd tkd' },
  { buttons: [['remap', 'Restart map']], modes: 'ebsd tkd' },
  { chips: 'edsSel', label: 'Map element', modes: 'eds', dynOpts: () => [['all', 'All']].concat(sim.eds ? sim.eds.syms.map((s) => [s, s]) : []) },
  { slider: 'mcMax', label: 'Trajectories', min: 200, max: 6000, step: 100, fmt: (v) => v.toLocaleString(), modes: 'mc' },
  { buttons: [['remc', 'Restart simulation']], modes: 'mc' },

  { sec: 'Time' },
  { slider: 'speed', inv: 'none', label: 'Simulation speed', min: 0.1, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  { buttons: [['pause', 'Pause'], ['resetView', 'Reset view']] },
  { sec: 'Show' },
  { toggles: [['showLabels', 'Labels'], ['showElectrons', 'Electrons & signals'], ['showGlass', 'Chamber window'], ['autoRotate', 'Slow orbit']], grid: true },
  { sec: 'Experiments' },
  { exp: 'charge', title: 'Charge it up', desc: 'An uncoated alumina inclusion at 15 kV. Watch it bloom and streak, then find the voltage where it stops.', icon: 'bolt' },
  { exp: 'nano', title: 'Nanograins: EBSD vs TKD', desc: 'Map copper interconnect grains with EBSD, then with TKD on a lamella. Compare.', icon: 'grid' },
  { exp: 'tour', title: 'Fly through the SEM', desc: 'From the electron gun down to every detector around the specimen.', icon: 'path' },
  { sec: 'Instrument readout' },
  { table: true },
];
const ICONS = {
  bolt: '<svg viewBox="0 0 32 32" fill="currentColor"><path d="M18 3 7 18h7l-2 11 11-16h-7z"/></svg>',
  grid: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 9l7-4 8 3 7-2v9l-6 4 3 8-8 1-6-5-5 2z M12 5l-1 9 9-6M11 14l-6 7M11 14l9 4 7-5M20 18l-3 10"/></svg>',
  path: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M16 3v5M10 10h12M16 8c-5 5 5 9 0 14M9 22h14M16 22v7"/><circle cx="16" cy="29" r="1.6" fill="currentColor"/></svg>',
};

// ------------------------------------------------------------------ control builder
const panel = $('#controlsBody'), bound = [];
function sliderDef(c) { const d = { key: c.slider, min: c.min, max: c.max, step: c.step ?? 0.01, log: c.log, fmt: c.fmt }; if (c.dyn) Object.assign(d, c.dyn()); return d; }
function build() {
  for (const c of CONTROLS) {
    let el;
    if (c.sec) { el = document.createElement('h3'); el.className = 'sec'; el.textContent = c.sec; }
    else if (c.slider) {
      el = document.createElement('div'); el.className = 'ctl slider';
      el.innerHTML = `<div class="row"><label>${c.label}</label><span class="val"></span></div><input type="range">${c.ends ? `<div class="ends">${c.ends.map((e) => `<span>${e}</span>`).join('')}</div>` : ''}${c.note ? `<p class="note">${c.note}</p>` : ''}`;
      const input = el.querySelector('input');
      input.addEventListener('input', () => { const d = sliderDef(c); const v = d.log ? logMap(d.min, d.max).from(+input.value) : +input.value; set(d.key, d.log ? v : +(+v).toFixed(4), c.inv ?? d.key); });
      bound.push({ c, el, input, val: el.querySelector('.val') });
      el.dataset.b = bound.length - 1;
    } else if (c.chips) {
      el = document.createElement('div'); el.className = 'ctl';
      el.innerHTML = `${c.label ? `<div class="row"><label>${c.label}</label></div>` : ''}<div class="chips${c.small ? ' small' : ''}"></div>`;
      bound.push({ c, el, box: el.querySelector('.chips') });
    } else if (c.buttons) {
      el = document.createElement('div'); el.className = 'ctl buttons';
      for (const [id, text] of c.buttons) { const b = document.createElement('button'); b.className = 'btn'; b.dataset.act = id; b.textContent = text; b.addEventListener('click', () => action(id)); el.appendChild(b); }
    } else if (c.toggles) {
      el = document.createElement('div'); el.className = 'ctl toggles' + (c.grid ? ' grid' : '');
      for (const [key, text] of c.toggles) { const b = document.createElement('button'); b.className = 'tog'; b.dataset.key = key; b.innerHTML = `<i></i>${text}`; b.addEventListener('click', () => set(key, !S[key], key)); el.appendChild(b); }
    } else if (c.exp) {
      el = document.createElement('button'); el.className = 'exp'; el.dataset.exp = c.exp;
      el.innerHTML = `<span class="ico">${ICONS[c.icon]}</span><span><b>${c.title}</b><small>${c.desc}</small></span>`;
      el.addEventListener('click', () => action(c.exp));
    } else if (c.p) { el = document.createElement('p'); el.className = 'ctl note'; el.textContent = c.p;
    } else if (c.table) { el = document.createElement('table'); el.className = 'data'; el.innerHTML = '<tbody id="dataBody"></tbody>'; }
    if (!bound.some((b) => b.el === el)) bound.push({ c, el });
    if (c.modes) el.dataset.modes = c.modes;
    panel.appendChild(el);
  }
}
function renderChips(b) {
  const opts = b.c.dynOpts ? b.c.dynOpts() : b.c.opts, sig = JSON.stringify(opts);
  if (b.box.dataset.sig !== sig) {
    b.box.dataset.sig = sig; b.box.innerHTML = '';
    for (const [v, text] of opts) { const el = document.createElement('button'); el.className = 'chip'; el.textContent = text; el.dataset.v = JSON.stringify(v); el.addEventListener('click', () => chip(b.c.chips, v)); b.box.appendChild(el); }
  }
  b.box.querySelectorAll('.chip').forEach((el) => el.classList.toggle('on', JSON.stringify(S[b.c.chips]) === el.dataset.v));
}
function refresh() {
  document.body.dataset.mode = S.mode;
  for (const b of bound) {
    const vis = !b.el.dataset.modes || b.el.dataset.modes.split(' ').includes(S.mode);
    b.el.hidden = !vis;
    if (!vis) continue;
    if (b.input) {
      const d = sliderDef(b.c), lm = d.log ? logMap(d.min, d.max) : null, v = S[d.key];
      b.input.min = d.log ? 0 : d.min; b.input.max = d.log ? 1000 : d.max; b.input.step = d.log ? 1 : d.step;
      b.input.value = lm ? lm.to(v) : v;
      b.input.style.setProperty('--p', `${clamp(((+b.input.value - +b.input.min) / (+b.input.max - +b.input.min)) * 100, 0, 100)}%`);
      b.val.textContent = d.fmt(v);
    }
    if (b.box) renderChips(b);
    if (b.c.toggles) b.el.querySelectorAll('.tog').forEach((t) => t.classList.toggle('on', !!S[t.dataset.key]));
  }
  document.querySelectorAll('[data-act="pause"]').forEach((b) => (b.textContent = S.paused ? 'Resume' : 'Pause'));
  document.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
  document.querySelectorAll('.clarity button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.clarity));
  $('.exp[data-exp="tour"]')?.classList.toggle('on', !!scene.tour);
  renderInfo(); header();
}

// ------------------------------------------------------------------ state changes
function set(key, v, inv = key) {
  if (S[key] === v) return;
  S[key] = v;
  if (!['speed', 'showLabels', 'showElectrons', 'showGlass', 'autoRotate', 'paused', 'showHough'].includes(key)) sim.invalidate(inv);
  if (key === 'showHough') sim.version++;
  refresh();
  explain(key);
}
function chip(key, v) {
  if (key === 'spec') return setSpec(v);
  if (key === 'bseMode') {
    S.seg = { comp: { A: 1, B: 1, C: 1, D: 1 }, topoX: { A: 1, B: -1, C: 0, D: 0 }, topoY: { A: 0, B: 0, C: 1, D: -1 } }[v];
    return segChanged();
  }
  set(key, v, key);
}
function segChanged() {
  S.bseMode = P.segPreset(S.seg);
  sim.invalidate('seg');
  refresh();
  explain('seg');
}
function setSpec(v) {
  S.spec = v;
  const sp = P.SPECIMENS[v];
  S.fov = sp.fov; S.cx = 0; S.cy = v === 'chip' ? 0 : 0; S.edsSel = 'all';
  sim.invalidate('spec'); refresh(); explain('spec');
}
function setMode(m) {
  if (m === S.mode) return;
  const prev = S.mode;
  S.mode = m;
  if (m === 'ebsd') { if (S.spec === 'sn') setSpecQuiet('ni'); S.tilt = 70; S.kV = Math.max(S.kV, 20); S.current = Math.max(S.current, 3000); S.wd = Math.max(S.wd, 14); }
  if (m === 'tkd') { if (S.spec === 'sn') setSpecQuiet('chip'); S.tilt = 0; S.kV = Math.max(S.kV, 30); S.current = Math.max(S.current, 2000); S.wd = Math.min(S.wd, 5); }
  if (m === 'eds') { S.kV = Math.max(S.kV, 15); S.current = Math.max(S.current, 1000); if (prev === 'ebsd') S.tilt = 0; }
  if (IMG.includes(m) && (prev === 'ebsd')) S.tilt = 0;
  if (m === 'inlens') S.wd = Math.min(S.wd, 4);
  hoverIdx = -1;
  sim.invalidate('mode-all');
  refresh(); explain(null);
}
function setSpecQuiet(v) { S.spec = v; S.fov = P.SPECIMENS[v].fov; S.cx = 0; S.cy = 0; }

function action(id) {
  if (id === 'pause') { S.paused = !S.paused; refresh(); }
  if (id === 'resetView') scene.resetView();
  if (id === 'remap') { sim.stale.map = 1; sim.version++; }
  if (id === 'remc') { sim.stale.mc = 1; sim.version++; }
  if (id === 'autofocus') {
    const f0 = S.focus, s0 = S.stig, s1 = sim.astig + (Math.random() - 0.5) * 0.02, t0 = performance.now();
    const step = () => {
      const f = Math.min(1, (performance.now() - t0) / 1100), e = 1 - Math.pow(1 - f, 3);
      S.focus = +(f0 * (1 - e) + (f === 1 ? (Math.random() - 0.5) * 0.004 * S.fov : 0)).toFixed(4);
      S.stig = +(s0 + (s1 - s0) * e).toFixed(3);
      sim.invalidate('focus'); refresh();
      if (f < 1) requestAnimationFrame(step); else explain('autofocus');
    };
    step();
  }
  if (id === 'charge') {
    setSpecQuiet('ni');
    // find an alumina inclusion near the origin
    let best = null;
    for (let r = 0; r < 400 && !best; r += 3) for (let a = 0; a < 6.28 && !best; a += 0.2) { const x = r * Math.cos(a), y = r * Math.sin(a); if (P.SPECIMENS.ni.sample(x, y).mat === 'Al2O3') best = [x, y]; }
    if (best) { S.cx = best[0]; S.cy = best[1]; }
    Object.assign(S, { fov: 18, coated: false, kV: 15, current: 300, tilt: 0 });
    S.mode = 'se';
    sim.invalidate('all'); refresh();
    $('#change').hidden = false;
    $('#change').innerHTML = '<small>Experiment · charging</small><p>An alumina inclusion (an insulator) in nickel at <b>15 kV</b>, uncoated. More electrons arrive than leave (δ + η < 1 above E2 ≈ 2.6 kV), negative charge builds up and deflects the beam and the secondaries: blooming and streaks. Now drag the voltage down towards <b>2 kV</b>, or switch on the carbon coating.</p>';
  }
  if (id === 'nano') {
    setSpecQuiet('chip');
    Object.assign(S, { cx: 1.2, cy: 1.9, fov: 2 });
    setMode('ebsd');
    S.cx = 1.2; S.cy = 1.9; S.fov = 2; S.mapN = 40; S.kV = 20;
    sim.invalidate('all'); refresh();
    $('#change').hidden = false;
    $('#change').innerHTML = '<small>Experiment · nanograins</small><p>EBSD on a 1.6 µm copper line with ~0.4 µm grains. At 70° tilt the electrons sample an elongated volume, so neighbouring grains’ patterns overlap and many points fail or mis-index. When the map is done, switch to <b>TKD</b> (key 5): the same line as a thin lamella, with a ~10 nm source volume.</p>';
  }
  if (id === 'tour') {
    if (scene.tour) { scene.stopTour(); return; }
    scene.startTour(tourStops(), (st, i, n) => {
      const cap = $('#tourCap');
      if (!st) { cap.hidden = true; refresh(); return; }
      cap.hidden = false;
      cap.innerHTML = `<small>${i + 1} / ${n}</small><b>${st.title}</b><p>${st.text}</p>`;
      cap.classList.remove('in'); void cap.offsetWidth; cap.classList.add('in');
      refresh();
    });
  }
}
function tourStops() {
  return [
    { y: 6.6, pos: [2.4, 7.2, 4], title: 'The electron gun', text: `A heated, sharpened tungsten tip coated with zirconia emits electrons that are accelerated to ${S.kV} kV. Unlike a TEM, an SEM rarely goes above 30 kV: it looks at surfaces, not through them.` },
    { y: 5.0, pos: [3, 5.6, 4.6], title: 'Condenser & aperture', text: 'The condenser demagnifies the source and the aperture sets the convergence angle. Together they choose the trade-off between current, probe size and depth of field.' },
    { y: 3.2, pos: [2.8, 3.8, 4.4], title: 'Scan coils, in-lens detector, objective', text: 'Scan coils sweep the probe line by line. The conical objective focuses it to a nanometre spot and, in immersion mode, funnels secondary electrons up to the in-lens detector.' },
    { y: 1.0, pos: [3.2, 2.2, 4.6], title: 'Specimen & interaction volume', text: 'Beneath the spot the electrons scatter through a pear-shaped volume. Secondaries escape from the top nanometres, backscattered electrons from deeper, X-rays from almost everywhere.' },
    { y: 0.8, pos: [-4.2, 2.2, 4.6], target: [-1, 0.9, -0.5], title: 'The detectors', text: 'The Everhart–Thornley detector off to the side, the BSE diode under the pole piece, the EDS detector looking down at 35°, and the EBSD camera waiting for a 70° tilt.' },
    { y: 2.3, pos: scene.home.pos.toArray(), title: 'Probe → signals → detectors', text: 'Every SEM image is a map of one signal, built one pixel at a time as the probe scans. Change the voltage, current or detector and the physics recomputes.', dur: 6 },
  ];
}

// ------------------------------------------------------------------ text panels
function renderInfo() {
  const inf = modeInfo(S, sim);
  $('#infoTitle').innerHTML = inf.title;
  $('#infoBody').innerHTML = inf.body;
  $('#infoStats').innerHTML = inf.stats.map(([k, v, s]) => `<div><small>${k}</small><b>${v}</b><span>${s}</span></div>`).join('');
}
function explain(key) {
  const box = $('#change'), t = key ? changeText(key, S, sim) : null;
  if (!t) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<small>What just changed · ${t[0]}</small><p>${t[1]}</p>`;
  box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
}
function header() {
  const n = {
    se: ['Everhart–Thornley detector · SE image', 'Total electron yield vs voltage'],
    inlens: ['In-lens detector · SE image', 'Probe size vs convergence'],
    bse: ['BSE detector · ' + P.segLabel(S.seg), 'Backscatter coefficient & segments'],
    ebsd: ['EBSD orientation map', 'Kikuchi pattern & indexing'],
    tkd: ['TKD orientation map', 'Kikuchi pattern & indexing'],
    eds: ['EDS element map', 'X-ray spectrum'],
    mc: ['Monte Carlo trajectories · side view', 'Backscatter energies & depth profiles'],
  }[S.mode];
  $('#detTitle').textContent = n[0]; $('#secTitle').textContent = n[1];
}
function updateTable() { $('#dataBody').innerHTML = dataRows(S, sim).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join(''); }

// component cards
let openComp = null;
function showComponent(name, el) {
  const card = $('#comp');
  document.querySelectorAll('.lbl.active').forEach((l) => l.classList.remove('active'));
  if (openComp === name && !card.hidden) return closeComponent();
  openComp = name; el.classList.add('active');
  card.querySelector('.compBody').innerHTML = renderComponent(name, S, sim);
  card.hidden = false; card.scrollTop = 0;
  if (!document.body.classList.contains('stacked')) {
    const r = el.getBoundingClientRect(), W = 360, H = Math.min(card.offsetHeight, innerHeight - 40);
    const x = r.right + 14 + W < innerWidth - 360 ? r.right + 14 : Math.max(16, r.left - W - 14);
    card.style.left = `${x}px`; card.style.top = `${Math.max(16, Math.min(innerHeight - H - 16, r.top - 40))}px`;
  }
}
function closeComponent() { $('#comp').hidden = true; openComp = null; document.querySelectorAll('.lbl.active').forEach((l) => l.classList.remove('active')); }
scene.onLabel = showComponent;
$('#comp .close').addEventListener('click', closeComponent);
document.addEventListener('pointerdown', (e) => { if (openComp && !e.target.closest('#comp') && !e.target.closest('.lbl')) closeComponent(); });
setInterval(() => { if (openComp) { const b = $('#comp .compBody'), st = b.parentElement.scrollTop; b.innerHTML = renderComponent(openComp, S, sim); b.parentElement.scrollTop = st; } }, 700);

// ------------------------------------------------------------------ wiring
function wire() {
  const nav = $('.modes');
  let grp = null;
  MODES.forEach(([m, name, sub, g], i) => {
    if (!grp || grp.dataset.g !== g) { grp = document.createElement('div'); grp.className = 'grp'; grp.dataset.g = g; grp.innerHTML = `<small>${g}</small><div></div>`; nav.appendChild(grp); }
    const b = document.createElement('button'); b.dataset.mode = m; b.title = `${sub} (key ${KEYS[i]})`; b.innerHTML = `${name}<kbd>${KEYS[i]}</kbd>`;
    b.addEventListener('click', () => setMode(m)); grp.lastChild.appendChild(b);
  });
  document.querySelectorAll('.clarity button').forEach((b) => b.addEventListener('click', () => { S.clarity = b.dataset.v; sim.invalidate('clarity'); refresh(); explain('clarity'); }));
  $('#btnLabels').addEventListener('click', () => set('showLabels', !S.showLabels));
  $('#btnFull').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()));
  $('#btnHelp').addEventListener('click', () => ($('#help').hidden = false));
  $('#help').addEventListener('click', (e) => { if (e.target.id === 'help' || e.target.closest('.close')) $('#help').hidden = true; });
  let drag = null;
  const mapMode = () => S.mode === 'ebsd' || S.mode === 'tkd';
  mainCv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy, moved: false }; mainCv.setPointerCapture(e.pointerId); });
  mainCv.addEventListener('pointermove', (e) => {
    const r = mainCv.getBoundingClientRect();
    if (mapMode() && sim.map && !drag) {
      const N = sim.map.N, i = clamp(Math.floor(((e.clientX - r.left) / r.width) * N), 0, N - 1), j = clamp(Math.floor(((e.clientY - r.top) / r.height) * N), 0, N - 1), k = j * N + i;
      if (k < sim.map.done && k !== hoverIdx) { hoverIdx = k; sim.version++; }
      return;
    }
    if (!drag) return;
    const sc = (mapMode() && sim.map ? sim.map.fov : S.fov) / r.width;
    S.cx = drag.cx - (e.clientX - drag.x) * sc; S.cy = drag.cy + (e.clientY - drag.y) * sc; drag.moved = true;
    if (!mapMode()) sim.invalidate('stage');
  });
  const end = () => { if (drag?.moved) { if (mapMode()) sim.invalidate('stage'); explain(null); } drag = null; };
  mainCv.addEventListener('pointerup', end); mainCv.addEventListener('pointercancel', end);
  mainCv.addEventListener('pointerleave', () => { if (hoverIdx >= 0) { hoverIdx = -1; sim.version++; } });
  mainCv.addEventListener('wheel', (e) => { e.preventDefault(); set('fov', clamp(S.fov * Math.pow(1.0015, e.deltaY), sim.spec.fovMin, sim.spec.fovMax), 'fov'); }, { passive: false });
  secCv.addEventListener('pointerdown', (e) => {
    if (S.mode === 'bse' && R2.layout.quad) {
      // click a quadrant: + → − → off → +
      const r = secCv.getBoundingClientRect(), Q = R2.layout.quad;
      const x = e.clientX - r.left - Q.cx, y = Q.cy - (e.clientY - r.top), rad = Math.hypot(x, y);
      if (rad < Q.R * 0.25 || rad > Q.R) return;
      const a = Math.atan2(y, x), q = Math.abs(a) <= Math.PI / 4 ? 'A' : Math.abs(a) >= (3 * Math.PI) / 4 ? 'B' : a > 0 ? 'C' : 'D';
      S.seg = { ...S.seg, [q]: S.seg[q] === 1 ? -1 : S.seg[q] === -1 ? 0 : 1 };
      return segChanged();
    }
    if (S.mode !== 'eds' || !R2.layout.eds) return;
    const L = R2.layout.eds, x = e.clientX - secCv.getBoundingClientRect().left, E = ((x - L.x0) / L.w) * L.Emax;
    let best = null, bd = 0.25;
    for (const l of P.XLINES) if (sim.eds.comp[l.el] && Math.abs(l.E - E) < bd) { bd = Math.abs(l.E - E); best = l.el; }
    set('edsSel', best ?? 'all', 'edsSel');
  });
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const i = KEYS.indexOf(e.key);
    if (e.key.length === 1 && i >= 0 && !e.metaKey && !e.ctrlKey) setMode(MODES[i][0]);
    else if (e.key === ' ') { e.preventDefault(); action('pause'); }
    else if (e.key === 'l' || e.key === 'L') set('showLabels', !S.showLabels);
    else if (e.key === 'r' || e.key === 'R') scene.resetView();
    else if (e.key === 'c' || e.key === 'C') { S.clarity = S.clarity === 'edu' ? 'real' : 'edu'; sim.invalidate('clarity'); refresh(); explain('clarity'); }
    else if (e.key === 'Escape') { $('#help').hidden = true; closeComponent(); if (scene.tour) scene.stopTour(); }
  });
  window.addEventListener('resize', resize);
}
function resize() {
  const w = innerWidth, h = innerHeight, wide = w >= 1100;
  document.body.classList.toggle('stacked', !wide);
  if (wide) {
    const L = $('.explain').getBoundingClientRect(), Rr = $('.controls').getBoundingClientRect(), D = $('.detector').getBoundingClientRect();
    scene.resize(w, h, { left: L.right, right: w - Rr.left, bottom: h - D.top + 10, top: 70 });
  } else { const g = $('#gl').getBoundingClientRect(); scene.resize(g.width, g.height, { left: 0, right: 0, bottom: 0, top: 0 }); }
}

// ------------------------------------------------------------------ loop
let last = performance.now(), lastDraw = 0, lastVer = -1, lastSlow = 0, frames = 0, fpsT = 0, fps = 0;
const patCv = document.createElement('canvas'); patCv.width = patCv.height = 256;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    sim.update(dt);
    const live = S.clarity === 'real' && IMG.includes(S.mode) && !S.paused;
    if (sim.version !== lastVer || (live && now - lastDraw > 90)) {
      R2.draw(sim, S, mainCv, secCv, hoverIdx);
      lastVer = sim.version; lastDraw = now;
      if (IMG.includes(S.mode)) { scene.specTex.image = mainCv; scene.specTex.needsUpdate = true; }
      if ((S.mode === 'ebsd' || S.mode === 'tkd') && R2.layout.pat) {
        patCv.getContext('2d').drawImage(secCv, 0, 0, R2.layout.pat.sz, R2.layout.pat.sz, 0, 0, 256, 256);
        scene.patTex.image = patCv; scene.patTex.needsUpdate = true;
      }
    }
    scene.update(dt, S, sim);
  } catch (err) { console.error(err); }
  frames++;
  if (now - fpsT > 1000) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; }
  if (now - lastSlow > 300) { lastSlow = now; updateTable(); if (['ebsd', 'tkd', 'eds', 'mc'].includes(S.mode)) renderInfo(); $('#status').textContent = `· ${fps} fps`; }
  requestAnimationFrame(frame);
}

build(); wire(); refresh(); explain('spec'); resize();
requestAnimationFrame(() => { resize(); requestAnimationFrame(frame); });
window.__sem = { S, sim, scene, draw: () => R2.draw(sim, S, mainCv, secCv, hoverIdx) };
