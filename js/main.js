import * as P from './physics.js';
import { Sim } from './sim.js';
import * as R2 from './render2d.js';
import { Scene3D } from './scene3d.js';
import { modeInfo, changeText, dataRows } from './explain.js';
import { renderComponent } from './components.js';
import { defaultState, SESSION_KEYS } from './state.js';
import { PRESETS, newProfile, sanitizeProfile } from './profile.js';
import * as O from './ops.js';
import { analyze } from './analyze.js';
import { collectData, toNpz } from './export.js';
import { Acquisitions } from './acquire.js';
import { Voice, parseCommand, describe, EXAMPLES } from './voice.js';
import { AgentBridge } from './agent.js';
import { ScriptCore, b64, stateSummary } from './scripting.js';
import { PythonIDE } from './ide.js';
import { Scenarios, SCENARIOS } from './scenarios.js';
import { Panel } from './panel.js';
import { VirtualPanel } from './vpanel.js';
import { openCalibration, hiddenField } from './calibui.js';
import { AGENT, LINKS, SUPPORT } from './config.js';

const $ = (s, r = document) => r.querySelector(s);
const clamp = O.clamp;
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ } return null; };

// ------------------------------------------------------------------ state
const S = defaultState();
const sim = new Sim(S);
const scene = new Scene3D($('#gl'), $('#labels'));
const mainCv = $('#detMain'), secCv = $('#detSec');
let hoverIdx = -1;

const MODES = [
  ['se', 'SE · ETD', 'secondary electrons', 'Imaging'], ['inlens', 'In-lens', 'through-the-lens SE', 'Imaging'], ['bse', 'BSE', 'backscattered', 'Imaging'],
  ['ebsd', 'EBSD', 'orientation maps', 'Diffraction'], ['tkd', 'TKD', 'transmission Kikuchi', 'Diffraction'],
  ['eds', 'EDS', 'X-ray spectra', 'Spectroscopy'], ['cl', 'CL', 'cathodoluminescence', 'Spectroscopy'], ['mc', 'Interaction volume', 'Monte Carlo', 'Physics'],
];
const KEYS = '12345678';
const logMap = (min, max) => ({ to: (v) => (Math.log(v / min) / Math.log(max / min)) * 1000, from: (t) => min * Math.pow(max / min, t / 1000) });
const IMG = 'se inlens bse';

const CONTROLS = [
  { sec: 'The specimen' },
  { chips: 'spec', opts: [['sn', 'Tin on carbon'], ['ni', 'Polycrystalline Ni'], ['chip', 'Chip cross-section'], ['grid', 'Cross grating'], ['gan', 'GaN / InGaN LED']] },
  { slider: 'fov', label: 'Field of view', dyn: () => ({ min: sim.spec.fovMin, max: sim.spec.fovMax }), log: true, fmt: (v) => `${R2.fmtLen(v)}  ×${Math.round(127000 / v).toLocaleString()}`, note: 'Drag the image to move the stage; scroll to zoom.' },
  { slider: 'tilt', label: 'Stage tilt', min: 0, max: 72, step: 1, fmt: (v) => `${v}°`, ends: ['flat', '', 'EBSD 70°'] },
  { toggles: [['coated', 'Carbon coating']] },

  { sec: 'The electron beam' },
  { slider: 'kV', label: 'Accelerating voltage', min: 0.5, max: 30, step: 0.5, fmt: (v) => `${v} kV` },
  { chips: 'kV', small: true, opts: [[1, '1 kV'], [5, '5 kV'], [15, '15 kV'], [20, '20 kV'], [30, '30 kV']] },
  { slider: 'current', label: 'Probe current', min: 1, max: 20000, log: true, fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} nA` : `${Math.round(v)} pA`), ends: ['imaging', '', 'EDS / EBSD'] },
  { chips: 'aperture', label: 'Aperture', opts: O.APERTURES.map((a) => [a, `${a} µm`]) },
  { slider: 'wd', label: 'Working distance', min: 2, max: 20, step: 0.5, fmt: (v) => `${v} mm`, ends: ['resolution', '', 'depth of field'] },

  { sec: 'Focus & astigmatism', modes: IMG },
  { slider: 'focus', label: 'Focus', dyn: () => { const r = O.focusRange(S); return { min: -r, max: r, step: r / 500 }; }, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(3)} µm`, ends: ['under', 'focus', 'over'], modes: IMG },
  { slider: 'stigX', label: 'Stigmator X', min: -2, max: 2, step: 0.005, fmt: (v) => `${v.toFixed(3)}`, modes: IMG },
  { slider: 'stigY', label: 'Stigmator Y', min: -2, max: 2, step: 0.005, fmt: (v) => `${v.toFixed(3)}`, modes: IMG },
  { buttons: [['autofocus', 'Auto focus + stigmation']], modes: IMG },
  { slider: 'dwell', label: 'Dwell time', min: 0.1, max: 30, log: true, fmt: (v) => `${v.toFixed(v < 1 ? 2 : 1)} µs`, ends: ['TV rate, noisy', '', 'slow, clean'], modes: IMG },

  { sec: 'Column alignment', modes: IMG },
  { p: 'An off-axis aperture makes the image walk sideways when the focus changes. Switch on the wobbler and center the aperture until the image only pulses.', modes: IMG },
  { toggles: [['wobble', 'Focus wobbler']], modes: IMG },
  { slider: 'apX', label: 'Aperture X', min: -40, max: 40, step: 0.05, fmt: (v) => `${v.toFixed(2)} µm`, modes: IMG },
  { slider: 'apY', label: 'Aperture Y', min: -40, max: 40, step: 0.05, fmt: (v) => `${v.toFixed(2)} µm`, modes: IMG },

  { sec: 'Detectors', modes: 'se bse ebsd tkd eds mc' },
  { slider: 'etdBias', label: 'ETD Faraday cage bias', min: -150, max: 300, step: 5, fmt: (v) => `${v > 0 ? '+' : ''}${v} V`, modes: 'se', ends: ['BSE only', '0', 'all SE'] },
  { chips: 'bseMode', label: 'Segment presets', modes: 'bse', opts: [['comp', 'A+B+C+D'], ['topoX', 'A−B'], ['topoY', 'C−D']] },
  { p: 'Or click the quadrants on the detector diagram to add (+), subtract (−) or switch off each segment.', modes: 'bse' },
  { chips: 'mapN', label: 'Map size', modes: 'ebsd tkd', opts: O.MAP_SIZES.map((n) => [n, `${n}²`]) },
  { slider: 'expo', label: 'Pattern exposure', min: 1, max: 50, step: 1, fmt: (v) => `${v} ms`, modes: 'ebsd tkd' },
  { slider: 'tkdThick', label: 'Foil thickness', min: 20, max: 400, step: 5, fmt: (v) => `${v} nm`, modes: 'tkd' },
  { chips: 'mapView', label: 'Show', modes: 'ebsd tkd', opts: [['ipf', 'IPF-Z'], ['bc', 'Band contrast'], ['mad', 'MAD']] },
  { toggles: [['showHough', 'Hough bands']], modes: 'ebsd tkd' },
  { buttons: [['remap', 'Restart map']], modes: 'ebsd tkd' },
  { chips: 'edsSel', label: 'Map element', modes: 'eds', dynOpts: () => [['all', 'All']].concat(sim.eds ? sim.eds.syms.map((s) => [s, s]) : []) },
  { sec: 'Cathodoluminescence', modes: 'cl' },
  { chips: 'clMode', label: 'Detector', modes: 'cl', opts: [['pan', 'Panchromatic (PMT)'], ['mono', 'One wavelength']] },
  { slider: 'clLam', label: 'Monochromator', min: 300, max: 800, step: 1, fmt: (v) => `${v} nm`, modes: 'cl', ends: ['UV', '', 'near-IR'] },
  { slider: 'clBand', label: 'Bandwidth', min: 2, max: 100, step: 1, fmt: (v) => `${v} nm`, modes: 'cl' },
  { p: 'Click a peak in the spectrum to image that band. Raise the voltage to reach the buried quantum wells; lower it for sharper dark spots at the dislocations.', modes: 'cl' },
  { slider: 'mcMax', label: 'Trajectories', min: 200, max: 6000, step: 100, fmt: (v) => v.toLocaleString(), modes: 'mc' },
  { buttons: [['remc', 'Restart simulation']], modes: 'mc' },

  { sec: 'Measure' },
  { pFn: () => `Analyses of what the detector shows, checked against the simulator's truth. In this mode: ${measureFor(S.mode).map((a) => a[1]).join(', ')}.` },
  { measure: true },

  { sec: 'Time' },
  { slider: 'speed', inv: 'none', label: 'Simulation speed', min: 0.1, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  { buttons: [['pause', 'Blank beam'], ['resetView', 'Reset view']] },
  { sec: 'Show' },
  { toggles: [['showLabels', 'Labels'], ['showElectrons', 'Electrons & signals'], ['showGlass', 'Chamber window'], ['autoRotate', 'Slow orbit']], grid: true },
  { sec: 'Training' },
  { p: 'Alignment tasks with a hidden answer, as on a real microscope: the knob readings are not the true optics. With your consent the session is recorded anonymously to study how people align and judge an instrument.' },
  { buttons: [['training', 'Open training tasks…']] },
  { buttons: [['replayFile', 'Replay a session file…'], ['lastSession', 'Download last session']] },
  { sec: 'Experiments' },
  { exp: 'charge', title: 'Charge it up', desc: 'An uncoated alumina inclusion at 15 kV. Watch it bloom and streak, then find the voltage where it stops.', icon: 'bolt' },
  { exp: 'nano', title: 'Nanograins: EBSD vs TKD', desc: 'Map copper interconnect grains with EBSD, then with TKD on a lamella. Compare.', icon: 'grid' },
  { exp: 'tour', title: 'Fly through the SEM', desc: 'From the electron gun down to every detector around the specimen.', icon: 'path' },
  { sec: 'Voice and agent' },
  { p: 'Type commands in AI mode (brain button, or /) or hold M and speak. An AI agent (for example Claude with the semview-mcp server, tools/semview-mcp) can run the microscope and answer questions out loud once you connect it.' },
  { buttons: [['agent', 'Connect agent'], ['panelcfg', 'Control panel…']] },
  { sec: 'Python scripting' },
  { p: 'Script the microscope in Python with NumPy, right here (Pyodide): set the beam, acquire calibrated data, run analyses, and test automation against hidden misalignments. The same script runs on a desktop, headless or driving this exhibit (tools/semview-py).' },
  { buttons: [['ide', 'Open the Python IDE']] },
  { sec: 'Digital twin' },
  { p: 'The instrument profile holds what belongs to one particular SEM: gun brightness and energy spread, lens aberrations, scan calibration, the EDS detector. Calibrate it from data, save the whole session, export what the detectors record.' },
  { chips: 'profile', label: 'Instrument profile', get: () => S.profile.preset, dynOpts: () => Object.entries(PRESETS).map(([k, v]) => [k, v.name.split(',')[0]]) },
  { twin: true },
  { buttons: [['calib', 'Calibrate from data…']] },
  { buttons: [['saveSession', 'Save session'], ['loadSession', 'Load session']] },
  { buttons: [['exportData', 'Export data (.npz)'], ['exportProfile', 'Export profile']] },
  { sec: 'Instrument readout' },
  { table: true },
];
const ICONS = {
  bolt: '<svg viewBox="0 0 32 32" fill="currentColor"><path d="M18 3 7 18h7l-2 11 11-16h-7z"/></svg>',
  grid: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 9l7-4 8 3 7-2v9l-6 4 3 8-8 1-6-5-5 2z M12 5l-1 9 9-6M11 14l-6 7M11 14l9 4 7-5M20 18l-3 10"/></svg>',
  path: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M16 3v5M10 10h12M16 8c-5 5 5 9 0 14M9 22h14M16 22v7"/><circle cx="16" cy="29" r="1.6" fill="currentColor"/></svg>',
};
// the analyses that fit each mode (Measure section and the command bar)
const MEASURES = [
  ['fit_resolution', 'Resolution', 'se inlens bse'], ['fit_focus', 'Focus & astigmatism', 'se inlens bse'], ['calibrate_scale', 'Scale (grating)', 'se inlens bse'],
  ['reconstruct_relief', '3D relief', 'bse'], ['fit_eds', 'EDS peaks', 'eds'], ['phase_map', 'Phases', 'eds'], ['index_ebsd', 'Map quality', 'ebsd tkd'], ['fit_cl', 'Bands & dislocations', 'cl'], ['mc_summary', 'η and range', 'mc'],
];
const measureFor = (m) => MEASURES.filter((a) => a[2].split(' ').includes(m));

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
    } else if (c.chips) {
      el = document.createElement('div'); el.className = 'ctl';
      el.innerHTML = `${c.label ? `<div class="row"><label>${c.label}</label></div>` : ''}<div class="chips${c.small ? ' small' : ''}"></div>`;
      bound.push({ c, el, box: el.querySelector('.chips') });
    } else if (c.buttons) {
      el = document.createElement('div'); el.className = 'ctl buttons';
      for (const [id, text] of c.buttons) { const b = document.createElement('button'); b.className = 'btn'; b.dataset.act = id; b.textContent = text; b.addEventListener('click', () => action(id)); el.appendChild(b); }
    } else if (c.toggles) {
      el = document.createElement('div'); el.className = 'ctl toggles' + (c.grid ? ' grid' : '');
      for (const [key, text] of c.toggles) { const b = document.createElement('button'); b.className = 'tog'; b.dataset.key = key; b.innerHTML = `<i></i>${text}`; b.addEventListener('click', () => toggle(key)); el.appendChild(b); }
    } else if (c.exp) {
      el = document.createElement('button'); el.className = 'exp'; el.dataset.exp = c.exp;
      el.innerHTML = `<span class="ico">${ICONS[c.icon]}</span><span><b>${c.title}</b><small>${c.desc}</small></span>`;
      el.addEventListener('click', () => action(c.exp));
    } else if (c.p || c.pFn) { el = document.createElement('p'); el.className = 'ctl note'; el.textContent = c.p ?? '';
    } else if (c.measure) { el = document.createElement('div'); el.className = 'chips small measure';
    } else if (c.twin) { el = document.createElement('table'); el.className = 'data twin'; el.innerHTML = '<tbody id="twinBody"></tbody>';
    } else if (c.table) { el = document.createElement('table'); el.className = 'data'; el.innerHTML = '<tbody id="dataBody"></tbody>'; }
    if (!bound.some((b) => b.el === el)) bound.push({ c, el });
    if (c.modes) el.dataset.modes = c.modes;
    panel.appendChild(el);
  }
}
function renderChips(b) {
  const opts = b.c.dynOpts ? b.c.dynOpts() : b.c.opts, sig = JSON.stringify(opts), cur = b.c.get ? b.c.get() : S[b.c.chips];
  if (b.box.dataset.sig !== sig) {
    b.box.dataset.sig = sig; b.box.innerHTML = '';
    for (const [v, text] of opts) { const el = document.createElement('button'); el.className = 'chip'; el.textContent = text; el.dataset.v = JSON.stringify(v); el.addEventListener('click', () => chip(b.c.chips, v)); b.box.appendChild(el); }
  }
  b.box.querySelectorAll('.chip').forEach((el) => el.classList.toggle('on', JSON.stringify(cur) === el.dataset.v));
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
    if (b.c.pFn) b.el.textContent = b.c.pFn();
    if (b.c.measure) {
      const ms = measureFor(S.mode), sig = ms.map((m) => m[0]).join();
      if (b.el.dataset.sig !== sig) { b.el.dataset.sig = sig; b.el.innerHTML = ms.map(([id, l]) => `<button class="chip" data-an="${id}">${l}</button>`).join(''); b.el.querySelectorAll('[data-an]').forEach((x) => (x.onclick = () => runAnalysis(x.dataset.an))); }
    }
  }
  document.querySelectorAll('[data-act="pause"]').forEach((b) => (b.textContent = S.paused ? 'Unblank beam' : 'Blank beam'));
  document.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
  document.querySelectorAll('.clarity button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.clarity));
  $('.exp[data-exp="tour"]')?.classList.toggle('on', !!scene.tour);
  renderInfo(); header();
}

// ------------------------------------------------------------------ state changes (all through ops.js, the same code headless scripts run)
function set(key, v, inv = key) {
  if (O.setState(S, sim, key, v, inv) === null) return;
  refresh();
  explain(key);
}
const UI_TOGGLES = ['showLabels', 'showElectrons', 'showGlass', 'autoRotate', 'showHough'];
function toggle(key) {
  if (key === 'coated' && scn.blocked('coat')) { blockedMsg('coat', 'Coating is not allowed in this task.'); refresh(); return; }
  if (key === 'wobble') { S.wobble = !S.wobble; refresh(); explain('wobble'); return; }
  if (UI_TOGGLES.includes(key)) { S[key] = !S[key]; if (key === 'showHough') sim.version++; refresh(); return; }
  set(key, !S[key]);
}
function chip(key, v) {
  if (key === 'spec') return setSpec(v);
  if (key === 'profile') return applyCalibration({ type: 'preset', preset: v });
  if (key === 'bseMode') { O.segState(S, sim, O.SEG_PRESETS[v]); refresh(); explain('seg'); return; }
  if (key === 'mapView' || key === 'edsSel') { S[key] = v; sim.invalidate(key); refresh(); explain(key); return; }
  set(key, v, key);
}
function segChanged() { O.segState(S, sim, S.seg); refresh(); explain('seg'); }
function setSpec(v) { if (!O.specState(S, sim, v)) return; refresh(); explain('spec'); }
function setMode(m) {
  if (!O.modeState(S, sim, m)) return;
  hoverIdx = -1;
  scn?.recorder.event('mode', { to: m });
  refresh(); explain(null);
  if (autoNarrate) N.speak('mode', modeText());
}
function cycleMode(d) { const i = MODES.findIndex((m) => m[0] === S.mode); setMode(MODES[(i + d + MODES.length) % MODES.length][0]); }
function moveStage(dx, dy) { S.cx += dx; S.cy += dy; sim.invalidate('stage'); }
const quietSpec = (v) => { S.spec = v; S.fov = P.SPECIMENS[v].fov; S.cx = 0; S.cy = 0; S.edsSel = 'all'; };
function blockedMsg(id, text) { scn.recorder.event('blocked', { id }); flashChange('Not in this task', text); }
function flashChange(title, html) { const box = $('#change'); box.hidden = false; box.innerHTML = `<small>${title}</small><p>${html}</p>`; box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }

function autofocus() {
  if (scn.blocked('autofocus')) { blockedMsg('autofocus', 'Auto focus is disabled: this task is about doing it yourself.'); return; }
  scn.recorder.event('button', { id: 'autofocus' });
  const f0 = S.focus, x0 = S.stigX, y0 = S.stigY, tg = O.autofocusTarget(S, sim), t0 = performance.now();
  const step = () => {
    const f = Math.min(1, (performance.now() - t0) / 1100), e = 1 - Math.pow(1 - f, 3);
    // a real auto focus sweeps through focus: swing past it once, then settle
    S.focus = +(f0 + (tg.focus - f0) * e + (f < 1 ? Math.sin(f * Math.PI * 2) * 0.15 * O.focusRange(S) * (1 - f) : 0)).toFixed(4);
    S.stigX = +(x0 + (tg.stigX - x0) * e).toFixed(3); S.stigY = +(y0 + (tg.stigY - y0) * e).toFixed(3);
    sim.invalidate('focus'); refresh();
    if (f < 1) requestAnimationFrame(step); else explain('autofocus');
  };
  step();
}

function action(id) {
  if (id === 'pause') { S.paused = !S.paused; refresh(); }
  if (id === 'resetView') scene.resetView();
  if (id === 'remap') { sim.stale.map = 1; sim.version++; }
  if (id === 'remc') { sim.stale.mc = 1; sim.version++; }
  if (id === 'autofocus') autofocus();
  if (id === 'training') openTraining();
  if (id === 'replayFile') $('#fileReplay').click();
  if (id === 'lastSession') { if (scn.lastSession) scn.downloadSession(scn.lastSession); else flashChange('No recorded session yet', 'Run a training task with recording on, then download it here.'); }
  if (id === 'ide') ide.toggle();
  if (id === 'agent') { if (agent.connected || agent.status === 'connecting') agent.disconnect(); else agent.connect(); }
  if (id === 'panelcfg') { $('#panelCfg').hidden = false; hwPanel.renderConfig($('#panelCfg .pBody')); }
  if (id === 'calib') openCalibration({ S, sim, onApply: applyCalibration });
  if (id === 'saveSession') saveSession();
  if (id === 'loadSession') $('#fileSession').click();
  if (id === 'exportData') exportData();
  if (id === 'exportProfile') download(new Blob([JSON.stringify(S.profile, null, 1)], { type: 'application/json' }), `sem-view-profile-${S.profile.preset}.json`);
  if (scn?.active && ['charge', 'nano'].includes(id)) { flashChange('Not during a task', 'Finish or stop the training task first.'); return; }
  if (id === 'charge') {
    quietSpec('ni');
    let best = null;
    for (let r = 0; r < 400 && !best; r += 3) for (let a = 0; a < 6.28 && !best; a += 0.2) { const x = r * Math.cos(a), y = r * Math.sin(a); if (P.SPECIMENS.ni.sample(x, y).mat === 'Al2O3') best = [x, y]; }
    if (best) { S.cx = best[0]; S.cy = best[1]; }
    Object.assign(S, { fov: 18, coated: false, kV: 15, current: 300, tilt: 0 });
    S.mode = 'se';
    sim.invalidate('all'); refresh();
    flashChange('Experiment · charging', 'An alumina inclusion (an insulator) in nickel at <b>15 kV</b>, uncoated. More electrons arrive than leave (δ + η < 1 above E2 ≈ 2.6 kV), negative charge builds up and deflects the beam and the secondaries: blooming and streaks. Now drag the voltage down towards <b>2 kV</b>, or switch on the carbon coating.');
  }
  if (id === 'nano') {
    quietSpec('chip');
    setMode('ebsd');
    S.cx = 1.2; S.cy = 1.9; S.fov = 2; S.mapN = 40; S.kV = 20;
    sim.invalidate('all'); refresh();
    flashChange('Experiment · nanograins', 'EBSD on a 1.6 µm copper line with ~0.4 µm grains. At 70° tilt the electrons sample an elongated volume, so neighbouring grains’ patterns overlap and many points fail or mis-index. When the map is done, switch to <b>TKD</b> (key 5): the same line as a thin lamella, with a ~10 nm source volume.');
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
    { y: 6.6, pos: [2.4, 7.2, 4], title: 'The electron gun', text: `A sharp W(100) tip, welded to a hairpin heated to ~1800 K and coated with zirconia, sits in ultra-high vacuum kept by an ion pump. The extractor pulls electrons over a field-lowered barrier (Schottky emission), the suppressor blocks stray electrons from the shank, and the anode accelerates them to ${S.kV} kV. Unlike a TEM, an SEM rarely goes above 30 kV: it looks at surfaces, not through them.` },
    { y: 5.0, pos: [3, 5.6, 4.6], title: 'Condenser & aperture', text: 'The condenser demagnifies the source and the aperture sets the convergence angle. Together they choose the trade-off between current, probe size and depth of field. The aperture must sit on the optic axis: the wobbler shows when it does not.' },
    { y: 3.2, pos: [2.8, 3.8, 4.4], title: 'Scan coils, in-lens detector, objective', text: 'Scan coils sweep the probe line by line. The conical objective focuses it to a nanometre spot and, in immersion mode, funnels secondary electrons up to the in-lens detector. Its stigmator corrects astigmatism in X and Y.' },
    { y: 1.0, pos: [3.2, 2.2, 4.6], title: 'Specimen & interaction volume', text: 'Beneath the spot the electrons scatter through a pear-shaped volume. Secondaries escape from the top nanometres, backscattered electrons from deeper, X-rays from almost everywhere.' },
    { y: 0.8, pos: [-4.2, 2.2, 4.6], target: [-1, 0.9, -0.5], title: 'The detectors', text: 'The Everhart–Thornley detector off to the side, the four-quadrant BSE diode under the pole piece, the EDS detector looking down at 35°, and the EBSD camera waiting for a 70° tilt.' },
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
const EXTRA = {
  profile: () => ['Instrument profile', `${esc(S.profile.name)}: brightness ${S.profile.Br.toExponential(1)} A/m²·sr·V, energy spread ${S.profile.dE} eV, Cs ${S.profile.CsK} mm and Cc ${S.profile.CcK} mm at 4 mm. The probe-size budget (source, Cs, Cc, diffraction) now follows this gun and lens.`],
  calibrated: () => ['Calibrated', 'The instrument profile now carries what was measured from data. Every image, map and spectrum is simulated with it, and it is saved with the session.'],
  session: () => ['Session saved', 'The complete state, profile and calibrations as JSON. Load it here, or replay it headless: node tools/headless.mjs --session file.json.'],
  loaded: () => ['Session loaded', 'Settings, instrument profile and calibrations restored.'],
  exported: () => ['Data exported', 'A NumPy .npz: the arrays the detectors recorded and metadata.json (calibrations, beam, state). Load with numpy.load().'],
};
function explain(key) {
  const box = $('#change'), t = key ? (EXTRA[key]?.() ?? changeText(key, S, sim)) : null;
  if (!t) { box.hidden = true; return; }
  flashChange(`What just changed · ${t[0]}`, t[1]);
}
function header() {
  const n = {
    se: ['Everhart–Thornley detector · SE image', 'Total electron yield vs voltage'],
    inlens: ['In-lens detector · SE image', 'Probe size vs convergence'],
    bse: ['BSE detector · ' + P.segLabel(S.seg), 'Backscatter coefficient & segments'],
    ebsd: ['EBSD orientation map', 'Kikuchi pattern & indexing'],
    tkd: ['TKD orientation map', 'Kikuchi pattern & indexing'],
    eds: ['EDS element map', 'X-ray spectrum'],
    cl: [`CL detector · ${S.clMode === 'pan' ? 'panchromatic' : `${S.clLam} nm`}`, 'CL spectrum'],
    mc: ['Monte Carlo trajectories · side view', 'Backscatter energies & depth profiles'],
  }[S.mode];
  $('#detTitle').textContent = n[0] + (S.wobble && IMG.includes(S.mode) ? ' · wobbler' : ''); $('#secTitle').textContent = n[1];
}
function updateTwin() {
  const tb = $('#twinBody');
  if (!tb || tb.closest('[hidden]')) return;
  // what the current mode depends on; ✓ marks a value measured from data
  const pr = S.profile, cal = pr.calibrated || {}, ok = (k) => (cal[k] ? ' ✓' : ''), hid = (k, v) => (hiddenField(k) ? '?' : v), m = S.mode, rows = [];
  rows.push(['Gun', `${pr.gun}, ΔE ${pr.dE} eV`], ['Brightness', `${hid('Br', pr.Br.toExponential(1))} A/m²·sr·V${ok('gun')}`], ['Cs / Cc at 4 mm', `${pr.CsK} / ${pr.CcK} mm`]);
  if (m !== 'mc') rows.push(['Magnification calibration', `×${hid('magCal', pr.magCal.toFixed(4))}${ok('scale')}`], ['Scan aspect / shear', `${hid('scanAspect', pr.scanAspect.toFixed(4))} / ${hid('scanShear', pr.scanShear.toFixed(2))}°${ok('scale')}`]);
  if (m === 'eds') rows.push(['EDS resolution (Mn Kα)', `${hid('edsFWHM', Math.round(pr.edsFWHM))} eV${ok('eds')}`], ['EDS gain / zero', `${hid('edsGain', pr.edsGain.toFixed(4))} / ${hid('edsOffset', pr.edsOffset.toFixed(1))} eV${ok('eds')}`]);
  rows.push(['Measured from data', Object.keys(cal).length ? Object.keys(cal).map((k) => ({ scale: 'grating', gun: 'resolution', eds: 'EDS' })[k] ?? k).join(', ') : 'nothing yet']);
  tb.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}
function updateTable() { updateTwin(); $('#dataBody').innerHTML = dataRows(S, sim).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join(''); }

// ------------------------------------------------------------------ narration: the browser's speech voice
const N = {
  speaking: null,
  sayText(text) { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(String(text).replace(/<[^>]+>/g, '')); u.rate = 1.02; u.onend = () => { N.speaking = null; N.mark(); }; speechSynthesis.speak(u); } catch { /* no speech */ } },
  speak(id, text) { N.speaking = id; N.sayText(text); N.mark(); },
  stop() { try { speechSynthesis.cancel(); } catch { /* no speech */ } N.speaking = null; N.mark(); },
  toggle(id, text) { if (N.speaking === id) N.stop(); else N.speak(id, text); },
  mark() { $('#infoSpeak')?.classList.toggle('on', N.speaking === 'mode'); $('#compSpeak')?.classList.toggle('on', !!N.speaking && N.speaking === openComp); },
};
const modeText = () => { const i = modeInfo(S, sim); return `${i.title}. ${i.body}`; };
$('#infoSpeak').addEventListener('click', () => N.toggle('mode', modeText()));
// auto-narration (N): read each mode and component card aloud as it opens
let autoNarrate = store('sem-narrate') === '1';
function setAutoNarrate(on) {
  autoNarrate = on; store('sem-narrate', on ? '1' : '0');
  $('#btnNarrate').setAttribute('aria-pressed', String(on)); $('#btnNarrate').classList.toggle('on', on);
  if (on) N.speak(openComp ?? 'mode', openComp ? $('#comp .compBody').innerText : modeText()); else N.stop();
}
$('#btnNarrate').addEventListener('click', () => setAutoNarrate(!autoNarrate));
$('#btnNarrate').setAttribute('aria-pressed', String(autoNarrate));
$('#compSpeak').addEventListener('click', () => openComp && N.toggle(openComp, $('#comp .compBody').innerText));

// component cards
let openComp = null;
function showComponent(name, el) {
  const card = $('#comp');
  document.querySelectorAll('.lbl.active').forEach((l) => l.classList.remove('active'));
  if (openComp === name && !card.hidden) return closeComponent();
  openComp = name; el.classList.add('active');
  card.querySelector('.compBody').innerHTML = renderComponent(name, S, sim);
  card.hidden = false; card.scrollTop = 0;
  if (autoNarrate) N.speak(name, card.querySelector('.compBody').innerText);
  if (!document.body.classList.contains('stacked')) {
    const r = el.getBoundingClientRect(), W = 360, H = Math.min(card.offsetHeight, innerHeight - 40);
    const x = r.right + 14 + W < innerWidth - 360 ? r.right + 14 : Math.max(16, r.left - W - 14);
    card.style.left = `${x}px`; card.style.top = `${Math.max(16, Math.min(innerHeight - H - 16, r.top - 40))}px`;
  }
}
function closeComponent() { $('#comp').hidden = true; if (N.speaking === openComp) N.stop(); openComp = null; document.querySelectorAll('.lbl.active').forEach((l) => l.classList.remove('active')); }
scene.onLabel = showComponent;
$('#comp .close').addEventListener('click', closeComponent);
document.addEventListener('pointerdown', (e) => { if (openComp && !e.target.closest('#comp') && !e.target.closest('.lbl')) closeComponent(); });
setInterval(() => { if (openComp) { const b = $('#comp .compBody'), st = b.parentElement.scrollTop; b.innerHTML = renderComponent(openComp, S, sim); b.parentElement.scrollTop = st; } }, 700);

// ------------------------------------------------------------------ acquisitions
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const acq = new Acquisitions({
  S, sim, mainCv, secCv, download,
  onChange: (a) => {
    const c = $('#acqCount');
    c.hidden = !acq.list.length; c.textContent = acq.list.length;
    if (!a) return;
    const d = $('.detector'); d.classList.remove('shot'); void d.offsetWidth; d.classList.add('shot');
    hwPanel.say(`Acquired #${a.id}`);
    flashChange(`Acquired #${a.id}`, `${a.mode.toUpperCase()} on ${esc(sim.spec.short)}: ${esc(a.summary)}. Open the acquisitions (the stacked-frames button next to Acquire) to download the picture or the data.`);
  },
});
function acquireNow() { R2.draw(sim, S, mainCv, secCv, hoverIdx); const a = acq.acquire(); scn.recorder.event('acquire'); return a; }

// ------------------------------------------------------------------ analyses (Measure section, command bar, agent, scripts)
function runAnalysis(name) {
  let r;
  try { for (let i = 0; i < 3; i++) sim.update(0.05); r = analyze(sim, S, name); } catch (e) { flashChange('Measure', esc(e.message)); return null; }
  const reg = r.emskills.in_registry ? `emskills <b>${r.emskills.skill}</b> (${r.analysis})` : `not in the emskills registry yet${r.emskills.related ? `; related: ${r.emskills.related}` : ''}`;
  // during a training task the truth stays hidden: show the measurement only
  const summary = scn.active ? esc(r.summary).replace(/\s*\(true[^)]*\)/g, '').replace(/;?\s*true [^;.,]*[;.,]?/g, '') : esc(r.summary);
  flashChange(`Measured · ${r.analysis}`, `${summary}<br><span class="muted">${reg}</span>`);
  scn.recorder.event('button', { id: `analyze:${r.analysis}` });
  return r;
}

// ------------------------------------------------------------------ the operation executor for voice, typed commands, the agent and scripts
let setAI = () => {};
function runOp(op) {
  switch (op.op) {
    case 'mode': setMode(op.v); break;
    case 'spec': setSpec(op.v); break;
    case 'set':
      if (op.k === 'clarity') { if (['edu', 'real'].includes(op.v)) { S.clarity = op.v; sim.invalidate('clarity'); refresh(); explain('clarity'); } }
      else if (op.k === 'coated' && op.v && scn.blocked('coat')) blockedMsg('coat', 'Coating is not allowed in this task.');
      else if (UI_TOGGLES.includes(op.k)) { S[op.k] = !!op.v; refresh(); }
      else { set(op.k, op.k === 'coated' ? !!op.v : op.v); op.v = S[op.k]; }
      break;
    case 'chip': if (op.k === 'bseMode' && O.SEG_PRESETS[op.v]) { if (S.mode !== 'bse') setMode('bse'); chip('bseMode', op.v); } else set(op.k, op.v); break;
    case 'seg': O.segState(S, sim, op.v); refresh(); explain('seg'); break;
    case 'nudge': set('focus', S.focus + op.d * O.focusRange(S) * 0.02); break;
    case 'zoom': set('fov', S.fov * op.f); break;
    case 'scale': set(op.k, S[op.k] * op.f); break;
    case 'stage': moveStage(op.dx ?? 0, op.dy ?? 0); break;
    case 'stageTo': S.cx = op.x; S.cy = op.y; sim.invalidate('stage'); break;
    case 'setWobble': S.wobble = !!op.v; refresh(); explain('wobble'); break;
    case 'action': if (op.v === 'autofocus') autofocus(); else if (['pause', 'remap', 'remc'].includes(op.v)) action(op.v); break;
    case 'beam': if (S.paused !== !!op.v) action('pause'); break;
    case 'analyze': { const r = runAnalysis(op.v ?? undefined); if (r) { op.result = r; op.v = r.analysis; } else op.error = $('#change p')?.textContent; break; }
    case 'acquire': acquireNow(); break;
    case 'wobbler': toggle('wobble'); break;
    case 'narrate': N.speak('mode', modeText()); break;
    case 'training': openTraining(); break;
    case 'cycle': cycleMode(op.d); break;
    case 'export': exportData(); break;
    case 'stopSpeech': N.stop(); break;
    default: break;
  }
  return op;
}
const opResult = (op) => (op.op === 'analyze' ? (op.result ?? { error: op.error }) : describe(op));

const voice = new Voice({
  ctx: () => ({ mode: S.mode, paused: S.paused }),
  run: (op) => { scn.recorder.noteSource('voice'); runOp(op); },
  agent: { get connected() { return agent.connected; }, utterance: (t) => agent.utterance(t) },
  onEvent: (kind, data) => { if (kind === 'voice') scn.recorder.event('voice', data); $('#btnMic')?.classList.toggle('on', kind === 'listening' && data === true); },
});
const busy = (who) => () => (scn?.active ? `A training task is running in the exhibit; ${who} cannot change settings until it ends.` : scn?.replay ? 'A session replay is playing.' : null);
const agent = new AgentBridge({
  urls: AGENT.urls,
  state: () => ({ ...stateSummary(S, sim), training_task: scn?.active?.id ?? null }),
  busy: busy('the agent'),
  run: (ops) => ops.filter((op) => op.op !== 'export').map((op) => { scn.recorder.noteSource('agent'); return scriptCore.run(op); }),
  analyze: (name) => { for (let i = 0; i < 3; i++) sim.update(0.05); return analyze(sim, S, name ?? undefined); },
  // desktop Python (tools/semview-py, connect("live")): the same calls as the IDE; bytes travel as base64
  script: (call, args) => { const enc = (v) => (v instanceof Uint8Array ? { $bytes: b64(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v); return enc(scriptCore.call(call, args)); },
  command: (text) => {
    const r = parseCommand(text, { paused: S.paused, mode: S.mode });
    if (!r.ops) return { understood: false, text };
    return { understood: true, done: r.ops.filter((op) => op.op !== 'export').map((op) => opResult(runOp(op))) };
  },
  acquire: (withData) => {
    const a = acquireNow();
    if (!a) throw new Error('nothing to acquire in this mode yet');
    return { id: a.id, mode: a.mode, spec: a.spec, summary: a.summary, png: a.png, png2: a.png2, npz: withData ? b64(toNpz(a.data)) : undefined };
  },
  say: (text) => { voice.flash(`<span class="mic agent"></span><b>Agent</b><p>${esc(text)}</p>`, Math.max(5000, text.length * 70)); N.sayText(text); },
  onStatus: (status, msg) => {
    const b = document.querySelector('[data-act="agent"]');
    if (b) b.textContent = status === 'on' ? 'Agent connected · Disconnect' : status === 'connecting' ? 'Connecting…' : 'Connect agent';
    b?.classList.toggle('on', status === 'on');
    if (msg) voice.flash(`<b>Agent</b><p>${esc(msg)}</p>`, 7000);
    else if (status === 'on') voice.flash('<span class="mic agent"></span><b>Agent connected</b><p>Ask a question with the microphone (hold M) or the command bar; the agent can also run the microscope.</p>', 5000);
  },
});

// ------------------------------------------------------------------ training scenarios and telemetry
const scn = new Scenarios({
  S, sim, version: document.querySelector('script[src*="main.js"]')?.getAttribute('src')?.split('v=')[1] ?? 'dev',
  setSpec: (v) => O.specState(S, sim, v), setMode: (m) => { if (m !== S.mode) O.modeState(S, sim, m); }, download,
  invalidateAll: () => { sim.invalidate('all'); refresh(); },
  // replay: set the recorded settings
  applyFlat: (st) => {
    if (st.mode && st.mode !== S.mode) O.modeState(S, sim, st.mode);
    for (const [k, v] of Object.entries(st)) { if (k === 'mode' || k === 'paused') continue; if (k.startsWith('seg.')) S.seg[k.slice(4)] = v; else if (k in S) S[k] = v; }
    sim.invalidate('all'); refresh();
  },
  snapshotState: () => structuredClone(Object.fromEntries(SESSION_KEYS.map((k) => [k, S[k]]))),
  restoreState: (st) => { Object.assign(S, structuredClone(st)); sim.invalidate('all'); refresh(); },
  onEvent: (kind) => { if (kind === 'start' || kind === 'end') refresh(); },
});
window.addEventListener('pagehide', () => scn.flushOnExit());
const openTraining = () => scn.menu({ replay: () => $('#fileReplay').click(), last: () => action('lastSession') });
// which input caused each change
window.addEventListener('pointerdown', (e) => scn.recorder.noteSource(e.pointerType === 'touch' ? 'touch' : 'mouse'), true);
window.addEventListener('wheel', () => scn.recorder.noteSource('mouse'), true);
window.addEventListener('keydown', () => scn.recorder.noteSource('keyboard'), true);

// ------------------------------------------------------------------ Python scripting
const scriptCore = new ScriptCore({
  name: 'exhibit', S, sim,
  run: (op) => opResult(runOp(op)),
  busy: busy('scripts'),
  refresh: () => refresh(),
  get scenarioApi() { return scn.api; },
});
const ide = new PythonIDE({ core: scriptCore, onRun: () => refresh() });
$('#btnScript').addEventListener('click', () => ide.toggle());

// ------------------------------------------------------------------ control panel and Console
const hwPanel = new Panel({
  S, sim,
  set: (k, v, inv) => set(k, v, inv), setRaw: (k, v, inv) => { O.setState(S, sim, k, v, inv); },
  moveStage: (dx, dy) => moveStage(dx, dy), cycleMode, refresh: () => refresh(), explain: (k) => explain(k),
  action: (id) => action(id),
  toggle: (name) => ({ pause: () => action('pause'), clarity: () => { S.clarity = S.clarity === 'edu' ? 'real' : 'edu'; sim.invalidate('clarity'); refresh(); explain('clarity'); }, labels: () => toggle('showLabels'),
    narrate: () => N.toggle('mode', modeText()), expand: () => setExpanded(!document.body.classList.contains('detBig')), calib: () => action('calib'), acquire: () => acquireNow() })[name]?.(),
  talk: (on) => (on ? voice.start() : voice.stop()),
  noteSource: (src) => scn.recorder.noteSource(src),
  openVirtual: (where) => (where === 'window' ? vPanel.openWindow() : vPanel.openDock()),
  mfOverride: () => scn.mfOverride(),
  consoleUrl: LINKS.console,
});
const vPanel = new VirtualPanel(hwPanel);

// ------------------------------------------------------------------ digital twin: profile, calibration, sessions, export
function applyCalibration(r) {
  const pr = structuredClone(S.profile), when = new Date().toISOString();
  if (r.type === 'preset') { S.profile = newProfile(r.preset); sim.invalidate('all'); refresh(); explain('profile'); return; }
  if (r.type === 'profile') { S.profile = r.replace ? r.profile : { ...r.profile, calibrated: pr.calibrated }; sim.invalidate('all'); refresh(); explain(r.replace ? 'profile' : 'calibrated'); return; }
  if (r.type === 'scale') { Object.assign(pr, { magCal: +r.magCal.toFixed(5), scanAspect: +r.scanAspect.toFixed(5), scanShear: +r.scanShear.toFixed(3) }); pr.calibrated.scale = { magCal: r.magCal, scanAspect: r.scanAspect, scanShear: r.scanShear, source: r.source, when }; }
  if (r.type === 'gun') { pr.Br = r.Br; pr.calibrated.gun = { Br: r.Br, resolution_nm: r.resolution_nm, kV: S.kV, current_pA: S.current, source: r.source, when }; }
  if (r.type === 'eds') { Object.assign(pr, { edsFWHM: +r.fwhmMn.toFixed(1), edsGain: +r.gain.toFixed(5), edsOffset: +r.offset.toFixed(2) }); pr.calibrated.eds = { fwhmMn: r.fwhmMn, gain: r.gain, offset_eV: r.offset, source: r.source, when }; }
  S.profile = pr;
  sim.invalidate('all'); refresh(); explain('calibrated');
}
function saveSession() {
  const state = Object.fromEntries(SESSION_KEYS.filter((k) => k !== 'mis').map((k) => [k, S[k]]));
  download(new Blob([JSON.stringify({ format: 'sem-view-session/1', saved: new Date().toISOString(), note: 'Scanning with Electrons (SEM-view) session', state }, null, 1)], { type: 'application/json' }), `sem-view-session-${stamp()}.json`);
  explain('session');
}
// a saved session, or an instrument profile on its own
function loadSessionFile(text) {
  const o = JSON.parse(text);
  if (o.format?.startsWith('sem-view-profile')) { applyCalibration({ type: 'profile', profile: sanitizeProfile(o), replace: true }); return; }
  if (!o.format?.startsWith('sem-view-session') || !o.state) throw new Error('not an SEM-view session or profile');
  const st = o.state, d = defaultState();
  for (const k of SESSION_KEYS) {
    if (!(k in st) || k === 'mode' || k === 'mis') continue;
    if (k === 'profile') S.profile = sanitizeProfile(st.profile);
    else if (k === 'spec') { if (P.SPECIMENS[st.spec]) S.spec = st.spec; }
    else if (k === 'seg') { if (st.seg && typeof st.seg === 'object') S.seg = { ...d.seg, ...st.seg }; }
    else if (typeof st[k] === typeof d[k]) S[k] = st[k];
  }
  if (O.MODES.includes(st.mode)) S.mode = st.mode;
  sim.invalidate('all'); refresh(); explain('loaded');
}
function exportData() {
  const data = collectData(sim, S);
  if (!Object.keys(data.arrays).length) return;
  download(new Blob([toNpz(data)], { type: 'application/zip' }), `sem-view-${S.mode}-${S.spec}-${stamp()}.npz`);
  explain('exported');
}

// ------------------------------------------------------------------ results panel: enlarge in place, or pop out into a separate window
let redraw = false;
function setExpanded(on) { document.body.classList.toggle('detBig', on); $('#btnExpand').setAttribute('aria-pressed', on); redraw = true; }
let pop = null;
function openPopout() {
  if (pop && !pop.closed) { pop.focus(); return; }
  pop = window.open('', 'sem-results', 'popup,width=1320,height=760');
  if (!pop) { setExpanded(true); return; } // pop-ups blocked: enlarge in place instead
  pop.document.title = 'Scanning with Electrons · results';
  pop.document.body.innerHTML = `<style>
    html, body { margin: 0; height: 100%; background: #05070a; color: #e9edf2; font: 500 11px "IBM Plex Mono", ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; }
    body { display: flex; flex-direction: column; padding: 12px; box-sizing: border-box; gap: 8px; }
    header { display: flex; gap: 16px; } header span:last-child { color: #8a94a3; margin-left: auto; }
    main { flex: 1; display: flex; gap: 12px; min-height: 0; }
    canvas { border-radius: 8px; background: #06080b; height: 100%; }
    #m { aspect-ratio: 1; max-width: 58%; } #s { flex: 1; min-width: 0; }
    @media (max-aspect-ratio: 4/3) { main { flex-direction: column; } #m { height: auto; width: 100%; max-width: none; } #s { height: 40%; flex: none; } }
  </style><header><span id="t1"></span><span id="t2"></span></header><main><canvas id="m"></canvas><canvas id="s"></canvas></main>`;
  // the same guard as in the page: narrow panels must never pass a negative arc radius
  const proto = pop.CanvasRenderingContext2D.prototype, arc = proto.arc;
  proto.arc = function (x, y, r, ...rest) { return arc.call(this, x, y, Math.max(0, r), ...rest); };
  pop.addEventListener('resize', () => (redraw = true));
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.close(); });
  $('#btnPopout').classList.add('on');
  redraw = true;
}
function drawPopout() {
  if (!pop) return;
  if (pop.closed) { pop = null; $('#btnPopout').classList.remove('on'); return; }
  const d = pop.document, m = d.getElementById('m'), sc = d.getElementById('s');
  if (!m) return;
  d.getElementById('t1').textContent = $('#detTitle').textContent;
  d.getElementById('t2').textContent = $('#secTitle').textContent;
  R2.draw(sim, S, m, sc, hoverIdx);
}

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
  $('#btnLabels').addEventListener('click', () => toggle('showLabels'));
  $('#btnFull').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()));
  $('#btnHelp').addEventListener('click', () => ($('#help').hidden = false));
  $('#temLink').href = LINKS.tem;
  // the explanation panel grows up from the bottom: stop it below the hero, so the buttons under the title stay visible
  { const hero = $('.hero'), fitHero = () => document.documentElement.style.setProperty('--heroB', `${Math.round(hero.getBoundingClientRect().bottom)}px`);
    new ResizeObserver(fitHero).observe(hero); addEventListener('resize', fitHero); fitHero(); }
  if (SUPPORT.coffee) { $('#btnCoffee').href = SUPPORT.coffee; $('#btnCoffee').hidden = false; }
  $('#btnTem').href = LINKS.tem;
  $('#btnNews').addEventListener('click', openNews);
  $('#newsModal').addEventListener('click', (e) => { if (e.target.id === 'newsModal' || e.target.closest('.close')) $('#newsModal').hidden = true; });
  document.querySelectorAll('[data-fold]').forEach((b) => b.addEventListener('click', () => fold(b.dataset.fold)));
  for (const k of ['L', 'R']) if (store(`sem-fold${k}`) === '1') document.body.classList.add(`fold${k}`);
  $('#help').addEventListener('click', (e) => { if (e.target.id === 'help' || e.target.closest('.close')) $('#help').hidden = true; });
  $('#btnTrain').addEventListener('click', openTraining);
  $('#btnPanel').addEventListener('click', () => action('panelcfg'));
  $('#panelCfg').addEventListener('click', (e) => { if (e.target.id === 'panelCfg' || e.target.closest('.close')) $('#panelCfg').hidden = true; });
  $('#btnAcquire').addEventListener('click', acquireNow);
  $('#btnGallery').addEventListener('click', () => { $('#gallery').hidden = false; acq.render($('#gallery .gBody')); });
  $('#gallery').addEventListener('click', (e) => { if (e.target.id === 'gallery' || e.target.closest('.close')) $('#gallery').hidden = true; });
  $('#btnExpand').addEventListener('click', () => setExpanded(!document.body.classList.contains('detBig')));
  $('#btnPopout').addEventListener('click', openPopout);
  const readFile = (inp, fn, what) => inp.addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { fn(await f.text()); } catch (err) { flashChange(`Could not ${what} ${esc(f.name)}`, esc(err.message)); } });
  readFile($('#fileSession'), loadSessionFile, 'load');
  readFile($('#fileReplay'), (t) => scn.loadReplay(t), 'replay');

  // AI mode: the command bar
  const bar = $('#cmdBar'), inp = $('#cmdInput'), hist = []; let hi = 0;
  setAI = (on) => {
    bar.hidden = !on;
    $('#btnAI').classList.toggle('on', on); $('#btnAI').setAttribute('aria-pressed', String(on));
    if (on) inp.focus(); else { inp.blur(); voice.escape(); }
  };
  $('#btnAI').addEventListener('click', () => setAI(bar.hidden));
  $('#cmdList').innerHTML = EXAMPLES.map((e) => `<option value="${esc(e)}"></option>`).join('');
  bar.addEventListener('submit', (e) => { e.preventDefault(); const v = inp.value.trim(); if (!v) return; hist.push(v); hi = hist.length; inp.value = ''; scn.recorder.noteSource('keyboard'); voice.handle(v, true); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && hist.length) { e.preventDefault(); hi = Math.max(0, hi - 1); inp.value = hist[hi]; }
    else if (e.key === 'ArrowDown' && hist.length) { e.preventDefault(); hi = Math.min(hist.length, hi + 1); inp.value = hist[hi] ?? ''; }
    else if (e.key === 'Escape') setAI(false);
  });
  const mic = $('#btnMic');
  mic.addEventListener('pointerdown', (e) => { e.preventDefault(); mic.setPointerCapture(e.pointerId); voice.start(); });
  for (const ev of ['pointerup', 'pointercancel']) mic.addEventListener(ev, () => voice.stop());

  // the detector image: drag to move the stage, scroll to zoom; hover an EBSD map for its pattern
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
  mainCv.addEventListener('wheel', (e) => { e.preventDefault(); set('fov', S.fov * Math.pow(1.0015, e.deltaY), 'fov'); }, { passive: false });
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
    if (S.mode === 'cl' && R2.layout.cl) {
      const L = R2.layout.cl, x = e.clientX - secCv.getBoundingClientRect().left, lam = L.l0 + ((x - L.x0) / L.w) * (L.l1 - L.l0);
      if (lam >= L.l0 && lam <= L.l1) set('clLam', Math.round(lam));
      return;
    }
    if (S.mode !== 'eds' || !R2.layout.eds) return;
    const L = R2.layout.eds, x = e.clientX - secCv.getBoundingClientRect().left, E = ((x - L.x0) / L.w) * L.Emax;
    let best = null, bd = 0.25;
    for (const l of P.XLINES) if (sim.eds.comp[l.el] && Math.abs(l.E - E) < bd) { bd = Math.abs(l.E - E); best = l.el; }
    chip('edsSel', best ?? 'all');
  });
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
    if (vPanel.open && /^[qwaszxophljkfbgi,.]$/i.test(e.key)) return; // the on-screen panel owns these keys
    const i = KEYS.indexOf(e.key), k = e.key.toLowerCase();
    if (e.key.length === 1 && i >= 0) setMode(MODES[i][0]);
    else if (e.key === ' ') { e.preventDefault(); action('pause'); }
    else if (k === 'l') toggle('showLabels');
    else if (k === 'e') toggle('showElectrons');
    else if (k === 'n') setAutoNarrate(!autoNarrate);
    else if (e.key === '[') fold('L');
    else if (e.key === ']') fold('R');
    else if (k === 'r') scene.resetView();
    else if (k === 'c') { S.clarity = S.clarity === 'edu' ? 'real' : 'edu'; sim.invalidate('clarity'); refresh(); explain('clarity'); }
    else if (k === 'v') vPanel.openDock();
    else if (k === 'i') acquireNow();
    else if (k === 't') openTraining();
    else if (k === 'p') { e.preventDefault(); ide.toggle(); } // no stray "p" in the editor it focuses
    else if (k === 'x') setExpanded(!document.body.classList.contains('detBig'));
    else if (k === 'm' && !e.repeat) voice.start();
    else if (e.key === '/') { e.preventDefault(); setAI(true); }
    else if (e.key === 'Escape') {
      $('#help').hidden = true; $('#newsModal').hidden = true; closeComponent(); setExpanded(false); setAI(false); if (scene.tour) scene.stopTour();
      if (agent.connected || agent.status === 'connecting') { agent.disconnect(); voice.flash('<b>Agent disconnected</b><p>Press Connect agent (Controls → Voice and agent) to reconnect.</p>', 3500); }
    }
  });
  window.addEventListener('keyup', (e) => { if ((e.key === 'm' || e.key === 'M') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) voice.stop(); });
  window.addEventListener('resize', resize);
}
// collapse the explanation (L) or the controls (R) to a tab at the screen edge, giving the instrument more room
function fold(side, on = !document.body.classList.contains(`fold${side}`)) {
  document.body.classList.toggle(`fold${side}`, on);
  store(`sem-fold${side}`, on ? '1' : '0');
  resize();
}
// news: the shared TEM-view / SEM-view mailing list
function openNews() {
  $('#newsBody').innerHTML = `<p>New techniques, training tasks and the Console, for SEM-view and TEM-view: get an email when they ship.</p>
    ${SUPPORT.subscribe ? `<form id="newsForm" class="newsform" novalidate>
      <label>Name<input name="name" autocomplete="name" required maxlength="100"></label>
      <label>Email<input type="email" name="email" placeholder="you@example.org" autocomplete="email" required></label>
      <label><span>Institution <small>(optional)</small></span><input name="institution" autocomplete="organization" maxlength="160"></label>
      <fieldset><legend>I am a</legend>${['student', 'staff', 'faculty', 'hobbyist'].map((r) => `<label class="role"><input type="radio" name="role" value="${r}" required>${r[0].toUpperCase() + r.slice(1)}</label>`).join('')}</fieldset>
      <input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
      <button class="btn primary" type="submit">Subscribe</button>
    </form><p class="muted" id="newsMsg">Only used for SEM-view and TEM-view news, a few emails a year. Reply to any of them to unsubscribe.</p>` : ''}
    <p class="muted">Or follow the release notes on <a href="${LINKS.repo}/releases" target="_blank" rel="noopener">GitHub</a>.</p>`;
  $('#newsModal').hidden = false;
  const f = $('#newsForm');
  if (!f) return;
  f.name.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#newsMsg'), btn = f.querySelector('button[type=submit]'), email = f.email.value.trim(), name = f.name.value.trim(), role = f.role.value;
    const bad = (text, el) => { msg.textContent = text; msg.className = 'err'; el?.focus(); };
    if (!name) return bad('Please enter your name.', f.name);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad('Please enter a valid email address.', f.email);
    if (!role) return bad('Please choose student, staff, faculty or hobbyist.', f.querySelector('[name=role]'));
    btn.disabled = true; btn.textContent = 'Subscribing…';
    try {
      const r = await fetch(SUPPORT.subscribe, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ email, name, institution: f.institution.value.trim(), role, website: f.website.value, source: 'sem-view' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `error ${r.status}`);
      $('#newsBody').innerHTML = `<p class="thanks"><b>Thanks for subscribing${j.already ? '' : `, ${esc(name.split(' ')[0])}`}!</b></p><p>${j.already ? 'This address is already on the list' : 'News will go to'} <b>${esc(email)}</b>.</p>`;
    } catch (err) {
      msg.textContent = `Could not subscribe: ${err.message}. Please try again later.`; msg.className = 'err';
      btn.disabled = false; btn.textContent = 'Subscribe';
    }
  });
}
function resize() {
  const w = innerWidth, h = innerHeight, wide = w >= 1100;
  document.body.classList.toggle('stacked', !wide);
  if (wide) {
    const L = $('.explain').getBoundingClientRect(), Rr = $('.controls').getBoundingClientRect(), D = $('.detector').getBoundingClientRect();
    const bc = document.body.classList;
    scene.resize(w, h, { left: bc.contains('foldL') ? 0 : L.right, right: bc.contains('foldR') ? 0 : w - Rr.left, bottom: h - D.top + 10, top: 70 });
  } else { const g = $('#gl').getBoundingClientRect(); scene.resize(g.width, g.height, { left: 0, right: 0, bottom: 0, top: 0 }); }
}

// ------------------------------------------------------------------ loop
let last = performance.now(), lastDraw = 0, lastVer = -1, lastSlow = 0, frames = 0, fpsT = 0, fps = 0;
const patCv = document.createElement('canvas'); patCv.width = patCv.height = 256;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    hwPanel.poll(dt);
    scn.tick();
    if (!ide.running) sim.update(dt);
    const live = S.clarity === 'real' && IMG.includes(S.mode) && !S.paused;
    if (sim.version !== lastVer || (live && now - lastDraw > 90) || redraw) {
      redraw = false;
      drawPopout(); // first, so the page's own canvases leave R2.layout set for their clicks and hovers
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
  if (now - lastSlow > 300) {
    lastSlow = now; updateTable();
    hwPanel.hud($('#panelHud')); vPanel.update();
    if (!$('#panelCfg').hidden && hwPanel.pad) { if (!$('#pLive')) hwPanel.renderConfig($('#panelCfg .pBody')); hwPanel.renderLive($('#pLive')); }
    if (['ebsd', 'tkd', 'eds', 'cl', 'mc'].includes(S.mode)) renderInfo();
    $('#status').textContent = `· ${fps} fps`;
  }
  requestAnimationFrame(frame);
}

build(); wire(); refresh(); explain('spec'); resize();
requestAnimationFrame(() => { resize(); requestAnimationFrame(frame); });
window.__sem = { S, sim, scene, scn, voice, agent, runOp, scriptCore, panel: hwPanel, draw: () => R2.draw(sim, S, mainCv, secCv, hoverIdx) };
// deep links: ?train=<task id> opens that training task; ?script=<example> opens the Python IDE with that example
{
  const q = new URLSearchParams(location.search), id = q.get('train');
  if (id && SCENARIOS[id]) setTimeout(() => scn.start(id), 600);
  if (q.has('script')) { const ex = q.get('script'); setTimeout(() => { ide.toggle(true); if (ex && /^[a-z0-9_]+$/.test(ex)) ide.loadExample(`${ex}.py`); }, 800); }
}
