// On-screen control panel: the same console as the hardware panel, driven by keyboard and mouse.
// It docks over the page or pops out into its own window (a second screen next to the microscope view).
// Input goes through Panel (panel.js), so knobs behave exactly like the hardware ones.
import { MF } from './panel.js';
import { LINKS } from './config.js';

// keys while the on-screen panel is open (they take precedence over the exhibit's other shortcuts)
export const KEYS = {
  q: ['focus', -1], w: ['focus', 1], a: ['mag', -1], s: ['mag', 1], z: ['intensity', -1], x: ['intensity', 1],
  o: ['context', -1], p: ['context', 1], h: ['mfX', -1], l: ['mfX', 1], j: ['mfY', 1], k: ['mfY', -1],
};
const BTN_KEYS = { Tab: 'mfSelect', f: 'focusFine', b: 'wobbler', g: 'optFocus', ',': 'modePrev', '.': 'modeNext', i: 'acquire' };
// the physical Console's page (the TEM-view Console drives this exhibit too)
const CONSOLE_URL = LINKS.console;
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const KNOBS = [
  ['intensity', 'Probe current', 'Z X'], ['focus', 'Focus', 'Q W', true], ['mag', 'Magnification', 'A S'],
  ['mfX', 'Multifunction X', 'H L'], ['mfY', 'Multifunction Y', 'K J'], ['context', 'Context', 'O P'],
];

export class VirtualPanel {
  constructor(panel) {
    this.panel = panel;
    this.where = null; // 'dock' | 'window'
    this.win = null; this.root = null; this.angle = {}; this.held = new Set();
    this.onKey = (e) => this.key(e, true);
    this.onKeyUp = (e) => this.key(e, false);
  }
  get open() { return !!this.where; }

  // ---------------------------------------------------------------- open / close
  openDock() {
    this.close();
    let el = document.getElementById('vpanel');
    if (!el) { el = document.createElement('div'); el.id = 'vpanel'; el.className = 'card vpanel'; document.body.appendChild(el); }
    el.hidden = false;
    this.root = el; this.where = 'dock'; this.panel.virtual = true;
    this.build(document, el);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    this.panel.say('On-screen panel: keys shown on each knob');
  }
  openWindow() {
    this.close();
    const w = window.open('', 'sem-panel', 'popup,width=900,height=420');
    if (!w) { this.openDock(); return false; } // pop-ups blocked: dock it instead
    w.document.title = 'SEM-view · control panel';
    const css = new URL('css/style.css', location.href).href;
    w.document.head.innerHTML = `<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${css}">`;
    w.document.body.className = 'vwin';
    w.document.body.innerHTML = '<div class="card vpanel inwin"></div>';
    this.win = w; this.root = w.document.querySelector('.vpanel'); this.where = 'window'; this.panel.virtual = true;
    this.build(w.document, this.root);
    for (const t of [window, w]) { t.addEventListener('keydown', this.onKey, true); t.addEventListener('keyup', this.onKeyUp, true); }
    w.addEventListener('beforeunload', () => { if (this.where === 'window') this.close(true); });
    w.focus();
    return true;
  }
  close(fromWindow = false) {
    for (const t of [window, this.win].filter(Boolean)) { t.removeEventListener('keydown', this.onKey, true); t.removeEventListener('keyup', this.onKeyUp, true); }
    if (this.where === 'dock' && this.root) this.root.hidden = true;
    if (this.where === 'window' && this.win && !fromWindow && !this.win.closed) this.win.close();
    this.held.clear(); this.panel.setStage(0, 0);
    this.where = null; this.win = null; this.root = null; this.panel.virtual = false;
  }

  // ---------------------------------------------------------------- layout
  build(doc, root) {
    root.innerHTML = `
      <div class="vhead"><b>Control panel</b><span>keyboard · mouse · drag or scroll a knob</span><span class="sp"></span>
        <a class="vget" href="${CONSOLE_URL}" target="_blank" rel="noopener" title="The physical TEM-view Console (it drives SEM-view too)">Get the hardware ↗</a>
        ${this.where === 'dock' ? '<button data-act="popout" title="Open in a separate window">⧉</button>' : '<button data-act="dock" title="Dock in the exhibit">▣</button>'}
        <button data-act="close" title="Close (V)">×</button></div>
      <div class="vbody">
        <div class="vside">
          <div class="knobs">${KNOBS.slice(0, 3).map(knob).join('')}</div>
          <div class="vbtns">
            ${btn('modePrev', '◀ Mode', ',')}${btn('modeNext', 'Mode ▶', '.')}${btn('focusFine', 'Fine', 'F')}${btn('wobbler', 'Wobbler', 'B')}${btn('optFocus', 'Auto focus', 'G')}${btn('pause', 'Blank', 'Space')}${btn('acquire', 'Acquire', 'I')}${btn('talk', 'Talk', 'M')}
          </div>
        </div>
        <div class="vside">
          <div class="knobs">${KNOBS.slice(3).map(knob).join('')}</div>
          <div class="vrow">
            <div class="mfsel">${MF.map(([k, l]) => `<button data-mf="${k}">${l}</button>`).join('')}<kbd>Tab</kbd></div>
            <div class="stagepad" title="Stage: drag, or hold the arrow keys"><i></i><small>Stage ← ↑ → ↓</small></div>
          </div>
        </div>
      </div>
      <p class="vmsg"></p>`;
    root.querySelector('[data-act="close"]').onclick = () => this.close();
    root.querySelector('[data-act="popout"]')?.addEventListener('click', () => this.openWindow());
    root.querySelector('[data-act="dock"]')?.addEventListener('click', () => this.openDock());
    root.querySelectorAll('[data-btn]').forEach((b) => {
      if (b.dataset.btn === 'talk') { // hold to talk
        b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); this.panel.api.talk?.(true); });
        for (const ev of ['pointerup', 'pointercancel']) b.addEventListener(ev, () => this.panel.api.talk?.(false));
      } else b.addEventListener('click', () => this.panel.button(b.dataset.btn));
    });
    root.querySelectorAll('[data-mf]').forEach((b) => b.addEventListener('click', () => this.panel.setMF(b.dataset.mf)));
    root.querySelectorAll('.knob').forEach((k) => this.wireKnob(k, doc));
    this.wirePad(root.querySelector('.stagepad'), doc);
    if (this.where === 'dock') this.wireDrag(root.querySelector('.vhead'), root);
    this.update();
  }
  wireKnob(el, doc) {
    const axis = el.dataset.axis;
    let y0 = null, acc = 0;
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.turn(axis, e.deltaY < 0 ? 1 : -1); }, { passive: false });
    el.addEventListener('pointerdown', (e) => { y0 = e.clientY; acc = 0; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (y0 === null) return;
      acc += (y0 - e.clientY) / 14; y0 = e.clientY; // 14 px of drag per detent, up = clockwise
      const n = Math.trunc(acc);
      if (n) { this.turn(axis, n); acc -= n; }
    });
    const end = () => { y0 = null; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  wirePad(el, doc) {
    let on = false;
    const set = (e) => {
      const r = el.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * 2 - 1, y = ((e.clientY - r.top) / r.height) * 2 - 1;
      const cx = Math.max(-1, Math.min(1, x)), cy = Math.max(-1, Math.min(1, y));
      this.panel.setStage(cx, cy);
      el.querySelector('i').style.transform = `translate(${cx * 34}px, ${cy * 34}px)`;
    };
    el.addEventListener('pointerdown', (e) => { on = true; el.setPointerCapture(e.pointerId); set(e); });
    el.addEventListener('pointermove', (e) => { if (on) set(e); });
    const end = () => { on = false; this.panel.setStage(0, 0); el.querySelector('i').style.transform = ''; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  wireDrag(handle, root) {
    let d = null;
    handle.addEventListener('pointerdown', (e) => { if (e.target.closest('button, a')) return; const r = root.getBoundingClientRect(); d = { x: e.clientX - r.left, y: e.clientY - r.top }; handle.setPointerCapture(e.pointerId); });
    handle.addEventListener('pointermove', (e) => {
      if (!d) return;
      root.style.left = `${Math.max(0, Math.min(innerWidth - 120, e.clientX - d.x))}px`; root.style.top = `${Math.max(0, Math.min(innerHeight - 60, e.clientY - d.y))}px`;
      root.style.bottom = 'auto'; root.style.transform = 'none';
    });
    handle.addEventListener('pointerup', () => { d = null; });
  }

  // ---------------------------------------------------------------- input
  turn(axis, n) {
    this.panel.turn(axis, n);
    this.angle[axis] = (this.angle[axis] ?? 0) + n * 18;
    const k = this.root?.querySelector(`.knob[data-axis="${axis}"] .dial`);
    if (k) k.style.transform = `rotate(${this.angle[axis]}deg)`;
  }
  key(e, down) {
    if (!this.open) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'v' && down) { e.preventDefault(); e.stopPropagation(); this.close(); return; }
    if (k === 'm' && !down && this.where === 'window') { this.panel.api.talk?.(false); return; }
    if (ARROWS[k]) {
      e.preventDefault(); e.stopPropagation();
      if (down) this.held.add(k); else this.held.delete(k);
      let vx = 0, vy = 0;
      for (const h of this.held) { vx += ARROWS[h][0]; vy += ARROWS[h][1]; }
      this.panel.setStage(Math.sign(vx), Math.sign(vy));
      return;
    }
    if (!down) return;
    // in its own window the exhibit's Space shortcut can't hear the key, so the panel handles it there
    if (k === ' ' && this.where === 'window') { e.preventDefault(); this.panel.button('pause'); return; }
    if (k === 'm' && this.where === 'window') { e.preventDefault(); if (!e.repeat) this.panel.api.talk?.(true); return; }
    if (KEYS[k]) { e.preventDefault(); e.stopPropagation(); const [axis, d] = KEYS[k]; this.turn(axis, d * (e.shiftKey ? 5 : 1)); return; }
    if (BTN_KEYS[e.key] ?? BTN_KEYS[k]) { e.preventDefault(); e.stopPropagation(); this.panel.button(BTN_KEYS[e.key] ?? BTN_KEYS[k]); }
  }

  // ---------------------------------------------------------------- live readouts (called a few times a second)
  update() {
    if (!this.open) return;
    if (this.where === 'window' && (!this.win || this.win.closed)) { this.close(true); return; }
    const r = this.root, ro = this.panel.readouts(), P = this.panel;
    for (const [axis, key] of [['focus', 'focus'], ['mag', 'mag'], ['intensity', 'intensity'], ['mfX', 'mf'], ['mfY', 'mf'], ['context', 'context']]) {
      const el = r.querySelector(`.knob[data-axis="${axis}"]`);
      if (!el) continue;
      if (axis !== 'mfX' && axis !== 'mfY') el.querySelector('b').textContent = ro[key][0];
      el.querySelector('em').textContent = axis === 'mfY' ? '' : ro[key][1];
    }
    const avail = new Set(P.mfList().map((m) => m[0])), mf = P.mfNow();
    r.querySelectorAll('[data-mf]').forEach((b) => { b.hidden = !avail.has(b.dataset.mf); b.classList.toggle('on', b.dataset.mf === mf); });
    r.querySelector('[data-btn="focusFine"]')?.classList.toggle('on', P.fine);
    r.querySelector('[data-btn="wobbler"]')?.classList.toggle('on', !!P.wob);
    r.querySelector('[data-btn="pause"]')?.classList.toggle('on', P.api.S.paused);
    const msg = r.querySelector('.vmsg');
    msg.textContent = `${P.api.S.mode.toUpperCase()} · ${P.msg}`;
    msg.classList.toggle('fresh', performance.now() - P.msgT < 2500);
  }
}

const knob = ([axis, label, keys, big]) => `<div class="knob${big ? ' big' : ''}" data-axis="${axis}" tabindex="0"><div class="dial"><i></i></div><b>${label}</b><em></em><kbd>${keys}</kbd></div>`;
const btn = (k, l, key) => `<button class="vbtn" data-btn="${k}">${l}<kbd>${key}</kbd></button>`;
