// Hardware control panel support (and ordinary game controllers as a stand-in).
//
// The same protocol as the TEM-view panel and Console (hardware in the TEM-view repository, hardware/panel): a USB
// HID joystick named "TEM-view Panel" with 8 axes and 16 buttons, so one physical Console drives both exhibits.
// Axes 0–1 are the stage joystick (absolute); axes 2–7 are rotary encoders sent as 16-bit wrapping counters, so
// the browser reads how far each knob turned since the last poll. Any browser with the Gamepad API works.
//
// On the SEM the knobs are those of a scanning microscope's hand panel: focus, magnification, probe current,
// the multifunction pair (stigmator X/Y, beam shift, aperture alignment, tilt) and a context knob (scan speed in
// imaging, tilt in EBSD/TKD, current in EDS, voltage in the Monte Carlo).
import { focusRange } from './ops.js';

export const AXES = [
  ['stageX', 'Stage X (joystick)'], ['stageY', 'Stage Y (joystick)'], ['focus', 'Focus'], ['mag', 'Magnification'],
  ['intensity', 'Probe current'], ['mfX', 'Multifunction X'], ['mfY', 'Multifunction Y'], ['context', 'Context knob'],
];
export { MF };
export const BUTTONS = [
  ['modePrev', 'Previous mode'], ['modeNext', 'Next mode'], ['mfSelect', 'Multifunction: stigmator / beam shift / aperture / tilt'], ['wobbler', 'Focus wobbler'],
  ['focusFine', 'Focus fine / coarse'], ['optFocus', 'Auto focus'], ['pause', 'Blank beam'], ['clarity', 'Educational / realistic'],
  ['labels', 'Labels'], ['narrate', 'Narration'], ['expand', 'Enlarge results'], ['calib', 'Calibration dialog'], ['acquire', 'Acquire'], ['talk', 'Talk (hold to speak)'],
];
const MF = [['stig', 'Stigmator X/Y'], ['shift', 'Beam shift'], ['aperture', 'Aperture X/Y'], ['tilt', 'Stage tilt']];

const DEFAULTS = {
  panel: {
    axes: { stageX: 0, stageY: 1, focus: 2, mag: 3, intensity: 4, mfX: 5, mfY: 6, context: 7 },
    buttons: { modePrev: 0, modeNext: 1, mfSelect: 2, wobbler: 3, focusFine: 4, optFocus: 5, pause: 6, clarity: 7, labels: 8, narrate: 9, expand: 10, calib: 11, acquire: 12, talk: 13 },
    invert: {}, sens: { focus: 1, mag: 1, intensity: 1, mf: 1, stage: 1, context: 1 }, counts: 4, // encoder counts per detent
  },
  standard: { // W3C "standard" gamepad layout
    axes: { stageX: 0, stageY: 1, mfX: 2, mfY: 3 },
    buttons: { mfSelect: 0, wobbler: 1, optFocus: 2, clarity: 3, magDown: 4, magUp: 5, focusDown: 6, focusUp: 7, focusFine: 8, pause: 9, acquire: 10, talk: 11, intensityUp: 12, intensityDown: 13, modePrev: 14, modeNext: 15 },
    invert: {}, sens: { focus: 1, mag: 1, intensity: 1, mf: 1, stage: 1, context: 1 },
  },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } return null; };

export class Panel {
  // api: { S, sim, set(key, v, inv), setRaw(key, v, inv), moveStage(dx, dy), cycleMode(d), action(id), toggle(name), refresh(), explain(key) }
  constructor(api) {
    this.api = api;
    this.pad = null; this.kind = null; this.prevAxes = null; this.prevButtons = [];
    this.mf = 'stig'; this.fine = false; this.wob = null; this.acc = {}; this.lastApply = 0; this.msg = ''; this.msgT = 0; this.repeat = {};
    this.maps = { panel: store('sem-panel-map-panel') ?? structuredClone(DEFAULTS.panel), standard: store('sem-panel-map-standard') ?? structuredClone(DEFAULTS.standard) };
    window.addEventListener('gamepadconnected', (e) => this.say(`Connected: ${shortName(e.gamepad.id)}`));
    window.addEventListener('gamepaddisconnected', () => { this.pad = null; this.say('Panel disconnected'); });
  }
  map() { return this.maps[this.kind ?? 'panel']; }
  saveMap() { store(`sem-panel-map-${this.kind}`, this.map()); }
  resetMap() { this.maps[this.kind] = structuredClone(DEFAULTS[this.kind]); this.saveMap(); }
  say(m) { this.msg = m; this.msgT = performance.now(); }

  // called every frame
  poll(dt) {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const gp = pads.find((p) => /TEM-view/i.test(p.id)) ?? pads[0] ?? null;
    if (!gp) { this.pad = null; this.stageV = this.vstage; this.wobble(dt); this.flush(dt); return; }
    if (!this.pad || this.pad.index !== gp.index) { this.prevAxes = null; this.prevButtons = []; }
    this.pad = gp;
    this.kind = /TEM-view/i.test(gp.id) || gp.mapping !== 'standard' ? 'panel' : 'standard';
    const M = this.map(), ax = gp.axes, bt = gp.buttons.map((b) => b.value), inv = (k) => (M.invert[k] ? -1 : 1);
    const A = (k) => (M.axes[k] != null && M.axes[k] < ax.length ? ax[M.axes[k]] * inv(k) : 0);
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    const pressed = (k) => { const i = M.buttons[k]; return i != null && bt[i] > 0.5 && !(this.prevButtons[i] > 0.5); };
    const held = (k) => { const i = M.buttons[k]; return i != null ? bt[i] ?? 0 : 0; };
    const add = (k, v) => { if (v) this.acc[k] = (this.acc[k] ?? 0) + v; };
    if (this.kind === 'panel') {
      // encoders: wrapping 16-bit counters scaled to [-1, 1]; difference in counts since the last poll
      const cur = {};
      for (const k of ['focus', 'mag', 'intensity', 'mfX', 'mfY', 'context']) cur[k] = A(k);
      if (this.prevAxes) for (const k in cur) {
        // counters run from −32767 to 32767 and wrap (period 65535)
        let d = Math.round((cur[k] - this.prevAxes[k]) * 32767);
        if (d > 32767) d -= 65535; else if (d < -32767) d += 65535;
        add(k, d / (M.counts || 4));
      }
      this.prevAxes = cur;
    } else {
      // game controller: analog sticks and triggers act as rates, buttons step (with auto-repeat)
      add('mfX', dz(A('mfX')) * 12 * dt); add('mfY', dz(A('mfY')) * 12 * dt);
      add('focus', (held('focusUp') - held('focusDown')) * 14 * dt);
      for (const [k, key, d] of [['magUp', 'mag', 1], ['magDown', 'mag', -1], ['intensityUp', 'intensity', 1], ['intensityDown', 'intensity', -1]]) {
        if (held(k) > 0.5) { this.repeat[k] = (this.repeat[k] ?? -0.35) + dt; if (pressed(k) || this.repeat[k] > 0.12) { add(key, d); if (this.repeat[k] > 0.12) this.repeat[k] = 0; } } else this.repeat[k] = -0.35;
      }
    }
    // stage joystick: a rate, scaled to the field of view
    const sx = dz(A('stageX')), sy = dz(A('stageY'));
    this.stageV = sx || sy ? [sx, sy] : this.vstage;
    // buttons
    for (const [k] of BUTTONS) if (k !== 'talk' && pressed(k)) this.button(k);
    // talk is held: speech recognition runs from press to release
    const ti = M.buttons.talk;
    if (ti != null) { const now = bt[ti] > 0.5, was = this.prevButtons[ti] > 0.5; if (now !== was) this.api.talk?.(now); }
    this.prevButtons = bt;
    if (Object.keys(this.acc).length || this.stageV) this.api.noteSource?.(this.kind === 'panel' ? 'panel' : 'controller');
    this.wobble(dt);
    this.flush(dt);
  }

  // apply accumulated motion at most ~20× a second (each change recomputes part of the simulation)
  flush() {
    if (this.stageV) this.acc.stage = 1;
    const now = performance.now();
    if (now - this.lastApply > 50 && Object.keys(this.acc).length) { this.lastApply = now; this.apply(); }
  }

  // ---------------------------------------------------------------- input from the on-screen panel (keyboard, mouse)
  turn(axis, detents) { this.api.noteSource?.('onscreen-panel'); this.acc[axis] = (this.acc[axis] ?? 0) + detents; }
  setStage(vx, vy) { if (vx || vy) this.api.noteSource?.('onscreen-panel'); this.vstage = vx || vy ? [vx, vy] : null; }
  button(k) {
    if (this.pad && !this.virtual) this.api.noteSource?.(this.kind === 'panel' ? 'panel' : 'controller');
    if (k === 'talk') return;
    if (k === 'modePrev') this.api.cycleMode(-1);
    else if (k === 'modeNext') this.api.cycleMode(1);
    else if (k === 'mfSelect') { const L = this.mfList(), i = L.findIndex((m) => m[0] === this.mf); this.setMF(L[(i + 1) % L.length][0]); }
    else if (k === 'focusFine') { this.fine = !this.fine; this.say(`Focus ${this.fine ? 'fine' : 'coarse'}`); }
    else if (k === 'wobbler') this.toggleWobbler();
    else if (k === 'optFocus') { this.api.action('autofocus'); this.say('Auto focus'); }
    else this.api.toggle(k);
  }
  // turns not yet applied belong to the knob function they were made with, so apply them before switching
  setMF(k) { if (Object.keys(this.acc).length) this.apply(); this.mf = k; this.say(`Multifunction knobs: ${MF.find((m) => m[0] === k)[1]}`); }
  mfList() { return MF; }
  mfNow() { return this.mf; }
  // what each knob is doing right now, for the on-screen panel
  readouts() {
    const { S } = this.api, m = S.mode, f2 = (v) => v.toFixed(2), cur = S.current >= 1000 ? `${(S.current / 1000).toFixed(2)} nA` : `${Math.round(S.current)} pA`;
    const ctx = ['se', 'inlens', 'bse'].includes(m) ? ['Scan speed', `${S.dwell} µs dwell`] : m === 'ebsd' || m === 'tkd' ? ['Stage tilt', `${S.tilt}°`] : m === 'eds' ? ['Probe current', cur] : ['Voltage', `${S.kV} kV`];
    const mfv = this.mf === 'stig' ? `${f2(S.stigX)}, ${f2(S.stigY)}` : this.mf === 'aperture' ? `${f2(S.apX)}, ${f2(S.apY)} µm` : this.mf === 'tilt' ? `${S.tilt}°` : `${f2(S.cx)}, ${f2(S.cy)} µm`;
    return {
      focus: ['Focus', `${S.focus > 0 ? '+' : ''}${S.focus.toFixed(3)} µm · ${this.fine ? 'fine' : 'coarse'}`],
      mag: ['Magnification', `×${Math.round(127000 / S.fov).toLocaleString()}`],
      intensity: ['Probe current', cur],
      mf: [MF.find((x) => x[0] === this.mf)[1], mfv], context: ctx,
    };
  }

  apply() {
    const { S, sim } = this.api, M = this.map(), acc = this.acc;
    this.acc = {};
    const sens = M.sens, set = (k, v) => this.api.set(k, v, k);
    if (acc.focus) {
      // one detent: 0.4 % of the focus range (fine) or 2 % (coarse); the range follows the field of view
      const step = focusRange(S) * (this.fine ? 0.004 : 0.02) * sens.focus;
      set('focus', S.focus + acc.focus * step);
      this.say(`Focus ${S.focus > 0 ? '+' : ''}${S.focus.toFixed(3)} µm`);
    }
    if (acc.mag) { set('fov', S.fov * Math.pow(1.1, -acc.mag * sens.mag)); this.say(`Magnification ×${Math.round(127000 / S.fov).toLocaleString()}`); }
    if (acc.intensity) { set('current', S.current * Math.pow(1.12, acc.intensity * sens.intensity)); this.say(`Probe current ${S.current >= 1000 ? `${(S.current / 1000).toFixed(2)} nA` : `${Math.round(S.current)} pA`}`); }
    if (acc.mfX || acc.mfY) this.multifunction((acc.mfX ?? 0) * sens.mf, (acc.mfY ?? 0) * sens.mf);
    if (acc.context) this.context(acc.context * sens.context);
    if (acc.stage && this.stageV) { const f = S.fov * 0.05 * sens.stage; this.api.moveStage(this.stageV[0] * f, -this.stageV[1] * f); }
  }

  // multifunction X/Y: stigmator, beam shift, aperture alignment or stage tilt
  multifunction(dx, dy) {
    const o = this.api.mfOverride?.();
    if (o) { o.apply(dx, dy); this.say(o.label()); return; }
    const { S } = this.api, set = (k, v) => this.api.set(k, v, k), fine = this.fine ? 0.2 : 1;
    if (this.mf === 'stig') { set('stigX', S.stigX + dx * 0.02 * fine); set('stigY', S.stigY + dy * 0.02 * fine); this.say(`Stigmator ${S.stigX.toFixed(3)}, ${S.stigY.toFixed(3)}`); }
    else if (this.mf === 'aperture') { set('apX', S.apX + dx * 0.4 * fine); set('apY', S.apY + dy * 0.4 * fine); this.say(`Aperture ${S.apX.toFixed(2)}, ${S.apY.toFixed(2)} µm`); }
    else if (this.mf === 'tilt') { set('tilt', S.tilt + (dx - dy)); this.say(`Tilt ${S.tilt}°`); }
    else { const f = S.fov * 0.01; this.api.moveStage(dx * f, dy * f); this.say('Beam shift'); }
  }

  // the context knob does whatever matters most in the current mode
  context(d) {
    const { S } = this.api, m = S.mode, set = (k, v) => this.api.set(k, v, k);
    if (['se', 'inlens', 'bse'].includes(m)) { set('dwell', S.dwell * Math.pow(1.25, d)); this.say(`Dwell ${S.dwell} µs`); }
    else if (m === 'ebsd' || m === 'tkd') { set('tilt', S.tilt + d); this.say(`Tilt ${S.tilt}°`); }
    else if (m === 'eds') { set('current', S.current * Math.pow(1.12, d)); this.say(`Probe current ${Math.round(S.current)} pA`); }
    else { set('kV', Math.round((S.kV + d * 0.5) * 2) / 2); this.say(`${S.kV} kV`); }
  }

  // focus wobbler: the simulator swings the focus; an off-axis aperture makes the image sway
  toggleWobbler() { const { S } = this.api; S.wobble = !S.wobble; this.wob = S.wobble; this.say(S.wobble ? 'Wobbler on' : 'Wobbler off'); this.api.refresh(); }
  wobble() { this.wob = !!this.api.S.wobble; }

  // heads-up display
  hud(el) {
    if (!this.pad || this.virtual) { el.hidden = true; return; } // the on-screen panel shows the same itself
    el.hidden = false;
    const fresh = performance.now() - this.msgT < 2500;
    el.innerHTML = `<b>${esc(shortName(this.pad.id))}</b><span>${this.kind === 'panel' ? 'panel' : 'controller'}</span>
      <div class="mf">${this.mfList().map(([k, l]) => `<i class="${k === this.mf ? 'on' : ''}">${l}</i>`).join('')}</div>
      <small>focus ${this.fine ? 'fine' : 'coarse'}${this.wob ? ' · wobbler' : ''}</small>
      <p class="${fresh ? 'fresh' : ''}">${esc(this.msg)}</p>`;
  }

  // configuration dialog: live inputs, mapping, inversion, sensitivity
  renderConfig(el) {
    const gp = this.pad, M = gp ? this.map() : null;
    const vbtns = `<div class="crow"><button class="btn primary" data-vp="dock">On-screen panel (V)</button><button class="btn" data-vp="window">Pop out panel</button><span class="muted">Drive the microscope with the keyboard and mouse: the same knobs and buttons as the hardware panel.</span></div>`;
    const wireV = () => el.querySelectorAll('[data-vp]').forEach((b) => b.addEventListener('click', () => { el.closest('.modal').hidden = true; this.api.openVirtual(b.dataset.vp); }));
    if (!gp) {
      el.innerHTML = `<p class="eyebrow">Control panel</p><h2>Connect a <em>panel</em>, or use the keyboard</h2>${vbtns}
        <p>Plug in a TEM-view panel or Console, or any game controller, over USB or Bluetooth, then <b>press one of its buttons</b>: browsers only reveal a controller after it has been used.</p>
        <p class="muted">The panel is a USB joystick ("TEM-view Panel", 8 axes, 16 buttons); the same hardware drives both exhibits. Its reference firmware and wiring are in the TEM-view repository under <code>hardware/panel</code>.</p>
        <p><a href="${this.api.consoleUrl}" target="_blank" rel="noopener">The TEM-view Console</a>: the physical panel, in development for Kickstarter.</p>`;
      wireV();
      return;
    }
    const opt = (n, sel) => `<option value="-1">—</option>${Array.from({ length: n }, (_, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${i}</option>`).join('')}`;
    const axisRows = (this.kind === 'panel' ? AXES : AXES.filter(([k]) => ['stageX', 'stageY', 'mfX', 'mfY'].includes(k)));
    const btnList = this.kind === 'panel' ? BUTTONS : [...BUTTONS.filter(([k]) => !['labels', 'narrate', 'expand', 'calib'].includes(k)), ['focusUp', 'Focus + (trigger)'], ['focusDown', 'Focus − (trigger)'], ['magUp', 'Magnification +'], ['magDown', 'Magnification −'], ['intensityUp', 'Current +'], ['intensityDown', 'Current −']];
    el.innerHTML = `<p class="eyebrow">Control panel · ${this.kind === 'panel' ? 'TEM-view / SEM-view panel protocol' : 'standard game controller'}</p>
      <h2>${esc(shortName(gp.id))}</h2>
      <p class="muted">Turn a knob or press a button to see its number light up, then assign it below. Settings are saved in this browser.</p>
      <div class="pgrid">
        <div><h4>Axes</h4><table class="data pin">${axisRows.map(([k, l]) => `<tr><td>${l}</td><td><select data-ax="${k}">${opt(gp.axes.length, M.axes[k])}</select> <label class="inv"><input type="checkbox" data-inv="${k}" ${M.invert[k] ? 'checked' : ''}>invert</label></td></tr>`).join('')}</table></div>
        <div><h4>Buttons</h4><table class="data pin">${btnList.map(([k, l]) => `<tr><td>${l}</td><td><select data-bt="${k}">${opt(gp.buttons.length, M.buttons[k])}</select></td></tr>`).join('')}</table></div>
      </div>
      <h4>Live input</h4><div class="plive" id="pLive"></div>
      <h4>Sensitivity</h4><div class="cgrid">${Object.keys(M.sens).map((k) => `<label>${k}<input type="number" step="0.1" min="0.1" max="10" data-sens="${k}" value="${M.sens[k]}"></label>`).join('')}${this.kind === 'panel' ? `<label>Encoder counts per detent<input type="number" step="1" min="1" max="8" id="pCounts" value="${M.counts}"></label>` : ''}</div>
      <div class="crow"><button class="btn" id="pReset">Reset to defaults</button></div>${vbtns}`;
    wireV();
    el.querySelectorAll('[data-ax]').forEach((s) => s.addEventListener('change', () => { const v = +s.value; if (v < 0) delete M.axes[s.dataset.ax]; else M.axes[s.dataset.ax] = v; this.prevAxes = null; this.saveMap(); }));
    el.querySelectorAll('[data-bt]').forEach((s) => s.addEventListener('change', () => { const v = +s.value; if (v < 0) delete M.buttons[s.dataset.bt]; else M.buttons[s.dataset.bt] = v; this.saveMap(); }));
    el.querySelectorAll('[data-inv]').forEach((c) => c.addEventListener('change', () => { M.invert[c.dataset.inv] = c.checked; this.saveMap(); }));
    el.querySelectorAll('[data-sens]').forEach((c) => c.addEventListener('change', () => { M.sens[c.dataset.sens] = clamp(+c.value || 1, 0.1, 10); this.saveMap(); }));
    el.querySelector('#pCounts')?.addEventListener('change', (e) => { M.counts = clamp(Math.round(+e.target.value) || 4, 1, 8); this.saveMap(); });
    el.querySelector('#pReset').addEventListener('click', () => { this.resetMap(); this.renderConfig(el); });
  }
  renderLive(el) {
    const gp = this.pad;
    if (!gp || !el) return;
    el.innerHTML = `<div>${gp.axes.map((v, i) => `<span class="ax"><b>${i}</b><i style="--v:${((v + 1) / 2) * 100}%"></i></span>`).join('')}</div>
      <div>${gp.buttons.map((b, i) => `<span class="bt ${b.value > 0.5 ? 'on' : ''}">${i}</span>`).join('')}</div>`;
  }
}

const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const shortName = (id) => String(id).replace(/\s*\(.*?Vendor.*?\)\s*/i, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);
