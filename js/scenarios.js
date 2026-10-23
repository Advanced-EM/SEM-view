// Training scenarios: alignment tasks with a hidden answer, recorded (with consent) for behavior research.
// Each scenario hides a seeded misalignment in S.mis, so the knob readings are not the true optics, and defines
// metrics the participant never sees until the end: how far the true instrument is from the target.
// The same scenarios run as scripting challenges (js/scripting.js), headless or in the exhibit.
import * as P from './physics.js';
import { Recorder } from './telemetry.js';
import { SHARE } from './config.js';

const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };
const r1 = (v, d = 1) => +(+v).toFixed(d);
const sgn = (rng) => (rng() < 0.5 ? -1 : 1);

// the image blur the misalignment adds (nm, from defocus and astigmatism) against the probe diameter:
// at or below one probe diameter the image is as sharp as the probe allows
export function blurRatio(S, sim) {
  const pr = sim.probe, F = sim.focusT(), [ax, ay] = sim.astigRes();
  const e = pr.alpha * Math.hypot(Math.abs(F) + Math.hypot(ax, ay) * 0.5, Math.hypot(ax, ay) * 0.5) * 1e3; // nm
  return { ratio: e / pr.d, blur_nm: e, probe_nm: pr.d };
}
const smooth = (E, w) => Math.round(E <= 1 ? 100 : 100 * Math.exp(-(((E - 1) / w) ** 2)));
// an alumina inclusion near the origin of the nickel specimen
const inclusion = () => P.SPECIMENS.ni.inclusion();

export const SCENARIOS = {
  'sem-focus-stig': {
    title: 'Focus and stigmate',
    short: 'Tin spheres at high magnification, out of focus and astigmatic by an unknown amount. Make the image as sharp as the probe allows.',
    brief: 'The image is out of focus and astigmatic, and the knob readings do not tell you by how much. Bring it to <b>best focus</b> with <b>no astigmatism</b>, using the Focus slider and the <b>Stigmator X</b> and <b>Y</b> sliders (or the control panel, <kbd>V</kbd>). Tip: go a little through focus either side; if small round particles streak one way below focus and the perpendicular way above it, there is astigmatism. Auto focus is disabled. Press <b>I\'m done</b> when it is as sharp as you can get it.',
    cues: ['Image looks sharp', 'Small spheres look round', 'No streaking when going through focus', 'Used the sharpness readout', 'Followed the probe-size plot', 'Guessed'],
    setup(api, rng) {
      const { S } = api;
      api.setSpec('sn');
      api.setMode('se');
      Object.assign(S, { fov: 1.2, cx: 0.4, cy: -0.3, kV: 10, current: 100, aperture: 30, wd: 5, dwell: 2, focus: 0, stigX: 0, stigY: 0, apX: 0, apY: 0, tilt: 0, clarity: 'edu', etdBias: 250, coated: false, wobble: false });
      // hidden: where focus really is (the knob must reach it) and the column's astigmatism, 0.6–1.6 µm
      const A = 0.6 + rng() * 1.0, th = rng() * Math.PI;
      S.mis = { focus: r1(sgn(rng) * (0.15 + rng() * 0.45), 3), stig: [r1(A * Math.cos(2 * th), 3), r1(A * Math.sin(2 * th), 3)] };
      return { hidden: { mis: S.mis }, target: { focus_um: S.mis.focus, stig: S.mis.stig, blur_ratio_max: 1 } };
    },
    metrics(api) {
      const { S, sim } = api, b = blurRatio(S, sim), [ax, ay] = sim.astigRes();
      return { score: smooth(b.ratio, 1.5), blur_ratio: r1(b.ratio, 3), blur_nm: r1(b.blur_nm, 2), probe_nm: r1(b.probe_nm, 2), focus_err_um: r1(sim.focusT(), 4), astig_x_um: r1(ax, 3), astig_y_um: r1(ay, 3), sharpness: r1(sim.img?.sharp ?? 0, 4), success: b.ratio <= 1.5 };
    },
    explain: (m) => `Defocus and astigmatism together blurred the image by ${m.blur_nm} nm, ${m.blur_ratio}× the ${m.probe_nm} nm probe (1 or less is as sharp as the probe allows, and up to 1.5 counts as aligned). You ended ${m.focus_err_um > 0 ? '+' : ''}${m.focus_err_um} µm from focus, with astigmatism (${m.astig_x_um}, ${m.astig_y_um}) µm left on the stigmator. Experts focus first, then correct X and Y in turn at a little higher magnification, and focus again.`,
    blocked: ['autofocus'],
  },
  'sem-aperture-align': {
    title: 'Center the aperture',
    short: 'The beam-limiting aperture is off axis: the image sways when the focus changes. Turn on the wobbler and center it.',
    brief: 'The objective aperture is off the optic axis by an unknown amount, so the image <b>moves sideways</b> whenever the focus changes and is slightly blurred. Switch on the <b>wobbler</b> (it swings the focus back and forth), then turn <b>Aperture X</b> and <b>Y</b> until the image only pulses in and out of focus without swaying. Press <b>I\'m done</b> when it stands still.',
    cues: ['Image stops swaying', 'Image looks sharper', 'Used the wobbler', 'Corrected X and Y separately', 'Guessed'],
    setup(api, rng) {
      const { S } = api;
      api.setSpec('grid');
      api.setMode('se');
      Object.assign(S, { fov: 6, cx: 0, cy: 0, kV: 10, current: 200, aperture: 30, wd: 5, dwell: 1, focus: 0, apX: 0, apY: 0, tilt: 0, clarity: 'edu', wobble: true });
      S.stigX = api.sim.astig[0]; S.stigY = api.sim.astig[1];
      const r = 10 + rng() * 20, a = rng() * 2 * Math.PI;
      S.mis = { ap: [r1(r * Math.cos(a), 2), r1(r * Math.sin(a), 2)] };
      return { hidden: { mis: S.mis }, target: { offset_um_max: 2 } };
    },
    metrics(api) {
      const { S, sim } = api, off = P.apertureOffset(S), o = Math.hypot(...off);
      return { score: o <= 2 ? 100 : Math.round(100 * Math.exp(-(((o - 2) / 7) ** 2))), offset_um: r1(o, 2), offset_x_um: r1(off[0], 2), offset_y_um: r1(off[1], 2), probe_nm: r1(sim.probe.d, 2), success: o <= 3 };
    },
    explain: (m) => `The aperture ended ${m.offset_um} µm from the optic axis (${m.offset_x_um}, ${m.offset_y_um}); within 2 µm scores 100 and within 3 µm counts as centered. An off-axis aperture sends the beam through the lens off center, so changing the focus also tilts the beam and the image walks; the wobbler makes that walk obvious. Center one axis at a time, reducing the sway to zero.`,
  },
  'sem-insulator': {
    title: 'Image an insulator without charging',
    short: 'An uncoated alumina inclusion at 15 kV charges. Find the best voltage that keeps it from charging; its true E2 is not the book value.',
    brief: 'The alumina inclusion is an <b>uncoated insulator</b>: above its second crossover energy E2 more electrons arrive than leave and it charges (bright blooms, streaks). Coating is not allowed. Find the <b>highest accelerating voltage at which it does not charge</b> (higher voltage gives a smaller probe and more signal) and get a sharp image. The real E2 of this inclusion differs from the textbook value on the yield plot. Press <b>I\'m done</b> when you are satisfied.',
    cues: ['Bright blooming gone', 'No streaks along the scan', 'Read the yield plot', 'Stepped the voltage down', 'Image looks sharp', 'Guessed'],
    setup(api, rng) {
      const { S } = api;
      api.setSpec('ni');
      api.setMode('se');
      const [x, y] = inclusion();
      Object.assign(S, { cx: x, cy: y, fov: 18, coated: false, kV: 15, current: 300, tilt: 0, aperture: 30, wd: 5, dwell: 2, focus: 0, clarity: 'edu', wobble: false });
      S.stigX = api.sim.astig[0]; S.stigY = api.sim.astig[1];
      S.mis = { E2: r1(1.8 + rng() * 1.6, 2) };
      return { hidden: { mis: S.mis }, target: { E2_kV: S.mis.E2 } };
    },
    metrics(api, sc) {
      const { S, sim } = api, E2 = sc.target.E2_kV, s = S.kV / E2, charging = S.kV > E2 && !S.coated;
      const score = charging ? Math.round(30 * Math.exp(-(s - 1) * 2)) : s >= 0.8 ? 100 : Math.round(100 * Math.exp(-(((0.8 - s) / 0.25) ** 2)));
      return { score, kV: S.kV, E2_kV: E2, ratio_to_E2: r1(s, 3), charging, coated: S.coated, success: !charging && s >= 0.7 };
    },
    explain: (m) => `This inclusion's E2 was ${m.E2_kV} kV. You ended at ${m.kV} kV${m.charging ? ', above E2, so it was still charging' : ` (${Math.round(m.ratio_to_E2 * 100)} % of E2), with no charging`}. Just below E2 the yield δ + η is a little above one, the surface charges slightly positive and stays stable; far below it the probe is larger and the signal weaker. Real insulators vary (contamination, crystallinity), so microscopists find E2 by stepping the voltage down until the blooming stops.`,
    blocked: ['coat'],
  },
  'ebsd-setup': {
    title: 'Set up an EBSD map',
    short: 'Start from imaging conditions on polycrystalline nickel. Choose tilt, voltage, current and working distance so the map indexes well.',
    brief: 'The microscope is in EBSD mode but still set up for imaging: flat stage, low voltage, low current, short working distance. Choose the <b>stage tilt</b>, <b>voltage</b>, <b>probe current</b> and <b>working distance</b> so that the patterns are bright and sharp, then let the map run. The goal: at least <b>85 % of points indexed correctly</b>. The map restarts after each change. Press <b>I\'m done</b> once at least 200 points have been mapped.',
    cues: ['Patterns look sharp', 'Band contrast map is bright', 'Few black (unindexed) points', 'Used the textbook 70° tilt', 'Guessed'],
    setup(api) {
      const { S } = api;
      api.setSpec('ni');
      api.setMode('ebsd');
      Object.assign(S, { tilt: 0, kV: 5, current: 100, wd: 5, mapN: 24, fov: 150, cx: 0, cy: 0, expo: 10, clarity: 'edu', wobble: false });
      S.mis = null;
      return { hidden: {}, target: { correct_fraction: 0.85 } };
    },
    metrics(api) {
      const { S, sim } = api, M = sim.map;
      if (!M || M.done < 30) return { score: 0, points: M?.done ?? 0, indexed_fraction: 0, correct_fraction: 0, tilt: S.tilt, kV: S.kV, success: false };
      let ok = 0, idx = 0;
      for (let k = 0; k < M.done; k++) if (M.O[k]) { idx++; if (M.err[k] <= 5) ok++; }
      const c = ok / M.done;
      return { score: Math.round(100 * Math.min(1, c / 0.85)), points: M.done, indexed_fraction: r1(idx / M.done, 3), correct_fraction: r1(c, 3), tilt: S.tilt, kV: S.kV, current_pA: S.current, wd_mm: S.wd, success: c >= 0.85 && M.done >= 200 };
    },
    explain: (m) => `${Math.round(m.correct_fraction * 100)} % of ${m.points} points were indexed within 5° of the true orientation (goal 85 %), at ${m.tilt}° tilt, ${m.kV} kV and ${m.current_pA} pA. Backscattered electrons leave a steeply tilted surface (≈70°) toward the camera, so tilt makes the patterns bright; 15–30 kV and nanoamps make them sharp and fast; a longer working distance puts the pattern center on the screen.`,
  },
};

// ---------------------------------------------------------------------------------------------- runner
export class Scenarios {
  // api: { S, sim, version, setSpec, setMode, refresh, invalidateAll, download, applyFlat, snapshotState, restoreState, onEvent }
  constructor(api) {
    this.api = api;
    this.recorder = new Recorder({ S: api.S, version: api.version });
    this.api.noteSource ??= (src) => this.recorder.noteSource(src);
    this.active = null; this.lastSession = null; this.replay = null;
    this.el = (id, cls, html = '') => { let e = document.getElementById(id); if (!e) { e = document.createElement('div'); e.id = id; e.className = cls; document.body.appendChild(e); } e.innerHTML = html; e.hidden = false; return e; };
  }
  blocked(id) { return !!this.active && (SCENARIOS[this.active.id].blocked ?? []).includes(id); }

  // ---------------------------------------------------------------- the Training menu (top-right button)
  menu({ replay, last }) {
    const m = this.el('scnModal', 'modal', `<div class="card"><button class="close" aria-label="Close">×</button>
      <p class="eyebrow">Training mode</p><h2>Align the <em>SEM</em></h2>
      <p>Each task hides a misalignment, as on a real instrument: the knob readings are not the true values. Fix it from what you see, say how good you think it is, then see the truth.</p>
      <div class="scnlist">${Object.entries(SCENARIOS).map(([id, s]) => `<button class="scnpick" data-id="${id}"><b>${s.title}</b><small>${s.short}</small></button>`).join('')}</div>
      <div class="crow"><button class="btn" data-x="replay">Replay a session file…</button><button class="btn" data-x="last" ${this.lastSession ? '' : 'disabled'}>Download last session</button>${this.active ? '<button class="btn" data-x="stop">Stop the current task</button>' : ''}</div></div>`);
    const close = () => { m.hidden = true; };
    m.querySelector('.close').onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
    m.querySelectorAll('.scnpick').forEach((b) => { b.onclick = () => { if (this.active) this.finish('abandoned'); this.start(b.dataset.id); }; });
    m.querySelector('[data-x="replay"]').onclick = () => { close(); replay(); };
    m.querySelector('[data-x="last"]').onclick = () => { close(); last(); };
    m.querySelector('[data-x="stop"]')?.addEventListener('click', () => { close(); this.finish('gave_up'); });
  }

  // ---------------------------------------------------------------- start: consent first
  start(id) {
    if (this.replay) this.stopReplay();
    const exp = store('sem-exp') ?? 'novice';
    const m = this.el('scnModal', 'modal', `<div class="card"><button class="close" aria-label="Close">×</button>
      <p class="eyebrow">Training scenario · research</p><h2>${SCENARIOS[id].title}</h2>
      <p>You can record this session to help us understand how people align a microscope: which controls you use, in what order, and when you decide the result is good. It will be used to build better guidance and assistance for real microscopes through the digital twin.</p>
      <ul class="cons"><li><b>Recorded:</b> the settings you change and when, which input you used, your own rating at the end, and the true alignment quality computed by the simulator.</li>
        <li><b>Not recorded:</b> your name, email, location, or any images of you. The session gets a random id.</li>
        ${SHARE.url ? `<li><b>Shared only if you choose:</b> <i>Record and share</i> sends the anonymous session file to the research dataset${SHARE.dataset ? ` <b>${esc(SHARE.dataset)}</b> on Hugging Face` : ''} automatically when the task ends, to study alignment and train models that assist real microscopes; it may be included in published data. <i>Record only</i> keeps it on this computer.</li>` : '<li><b>Stays with you:</b> nothing is sent anywhere. At the end you can download the session file.</li>'}</ul>
      <div class="cgrid"><label>Your experience with electron microscopes<select id="scnExp">
        ${[['novice', 'Never used one'], ['student', 'Student / occasional user'], ['trained', 'Trained user'], ['expert', 'Expert / facility staff']].map(([k, l]) => `<option value="${k}" ${k === exp ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="crow">${SHARE.url ? '<button class="btn primary" id="scnShare">Record and share</button><button class="btn" id="scnRec">Record only</button>' : '<button class="btn primary" id="scnRec">Record and start</button>'}<button class="btn" id="scnNoRec">Start without recording</button></div></div>`);
    const close = () => { m.hidden = true; };
    m.querySelector('.close').onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
    const go = (rec, share = false) => { const e = m.querySelector('#scnExp').value; store('sem-exp', e); close(); this.begin(id, rec, e, share); };
    m.querySelector('#scnShare')?.addEventListener('click', () => go(true, true));
    m.querySelector('#scnRec').onclick = () => go(true);
    m.querySelector('#scnNoRec').onclick = () => go(false);
  }

  begin(id, record, experience, share = false) {
    const sc = SCENARIOS[id], seed = (Math.random() * 2 ** 31) | 0, rng = P.mulberry32(seed);
    const info = sc.setup(this.api, rng);
    this.api.invalidateAll();
    this.active = { id, seed, ...info, t0: performance.now(), record, share: record && share && !!SHARE.url };
    const metrics = () => sc.metrics(this.api, this.active);
    if (record) this.recorder.start({ experience, scenario: { id, seed, hidden: info.hidden, target: info.target }, metrics });
    this.api.onEvent?.('start', id);
    this.card();
  }
  card() {
    const sc = SCENARIOS[this.active.id];
    const c = this.el('scnCard', 'card scncard', `<div class="scnhead"><b>${sc.title}</b><span id="scnTime">0:00</span>${this.active.record ? `<i class="rec">● ${this.active.share ? 'recording · will share' : 'recording'}</i>` : ''}<span class="sp"></span><button data-x="brief" title="Show or hide the task">?</button></div>
      <p class="scnbrief">${sc.brief}</p>
      <div class="crow"><button class="btn primary" data-x="done">I'm done: it's aligned</button><button class="btn" data-x="give">Give up</button></div>`);
    c.querySelector('[data-x="brief"]').onclick = () => c.classList.toggle('mini');
    c.querySelector('[data-x="done"]').onclick = () => this.judge();
    c.querySelector('[data-x="give"]').onclick = () => this.finish('gave_up');
    sc.mount?.(this.api, c);
    this.draggable(c, c.querySelector('.scnhead'));
  }
  // the card can be moved by its header (it would otherwise cover the detector or the column); the spot is kept
  // for the rest of the visit, and a double-click on the header puts it back
  draggable(c, handle) {
    const place = (x, y) => {
      const r = c.getBoundingClientRect();
      x = Math.max(4, Math.min(innerWidth - r.width - 4, x)); y = Math.max(4, Math.min(innerHeight - 40, y));
      Object.assign(c.style, { left: `${x}px`, top: `${y}px`, transform: 'none' }); this.cardPos = [x, y];
    };
    if (this.cardPos) place(...this.cardPos);
    handle.title = 'Drag to move · double-click to put back';
    handle.onpointerdown = (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const r = c.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      handle.setPointerCapture(e.pointerId); c.classList.add('dragging');
      handle.onpointermove = (m) => place(m.clientX - dx, m.clientY - dy);
      handle.onpointerup = handle.onpointercancel = () => { handle.onpointermove = null; c.classList.remove('dragging'); };
    };
    handle.ondblclick = (e) => { if (e.target.closest('button')) return; this.cardPos = null; Object.assign(c.style, { left: '', top: '', transform: '' }); };
  }
  tick() {
    const now = performance.now(), dt = Math.min(0.1, (now - (this.lastTick ?? now)) / 1000); this.lastTick = now;
    if (this.active) SCENARIOS[this.active.id].tick?.(this.api, dt);
    this.recorder.tick();
    if (this.active) { const s = Math.floor((performance.now() - this.active.t0) / 1000), t = document.getElementById('scnTime'); if (t) t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
    this.replayTick();
  }

  // ---------------------------------------------------------------- the participant's own judgment
  judge() {
    const sc = SCENARIOS[this.active.id];
    const m = this.el('scnModal', 'modal', `<div class="card"><p class="eyebrow">Before we show the answer</p><h2>How well aligned is it?</h2>
      <div class="rate">${[1, 2, 3, 4, 5].map((r) => `<button data-r="${r}">${r}</button>`).join('')}</div><p class="muted">1 = still clearly off · 5 = as good as it gets</p>
      <h4>What did you use to decide?</h4><div class="cues">${sc.cues.map((c, i) => `<label><input type="checkbox" value="${i}">${c}</label>`).join('')}</div>
      <label class="note">Anything else? (optional, please no personal information)<input id="scnNote" maxlength="140" type="text"></label>
      <div class="crow"><button class="btn primary" id="scnSubmit" disabled>Show me the answer</button><button class="btn" id="scnBack">Keep adjusting</button></div></div>`);
    let rating = 0;
    m.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { rating = +b.dataset.r; m.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x === b)); m.querySelector('#scnSubmit').disabled = false; }));
    m.querySelector('#scnBack').onclick = () => { m.hidden = true; this.recorder.event('judge_cancel'); };
    m.querySelector('#scnSubmit').onclick = () => {
      const cues = [...m.querySelectorAll('.cues input:checked')].map((c) => sc.cues[+c.value]);
      this.recorder.event('judge', { rating, cues, note: m.querySelector('#scnNote').value.slice(0, 140) });
      m.hidden = true;
      this.finish('done', rating);
    };
  }

  // ---------------------------------------------------------------- the reveal
  finish(outcome, rating = null) {
    const a = this.active, sc = SCENARIOS[a.id], mt = sc.metrics(this.api, a), secs = (performance.now() - a.t0) / 1000;
    const sess = a.record ? this.recorder.stop(outcome) : null;
    if (sess) this.lastSession = sess;
    const changes = sess ? sess.events.filter((e) => e.k === 'change' && !['paused'].includes(e.key)) : [];
    const bySrc = {};
    for (const e of changes) bySrc[e.src] = (bySrc[e.src] ?? 0) + 1;
    sc.unmount?.(this.api);
    document.getElementById('scnCard').hidden = true;
    this.active = null;
    const m = this.el('scnModal', 'modal', `<div class="card"><button class="close" aria-label="Close">×</button>
      <p class="eyebrow">${outcome === 'done' ? 'Result' : 'Gave up'} · ${sc.title}</p>
      <h2>${mt.verdict ?? (mt.success ? 'Aligned ✓' : 'Not quite')} <em>${mt.score}/100</em></h2>
      ${rating ? `<p>You rated it <b>${rating}/5</b>${mt.success === rating >= 4 ? ', and the simulator agrees.' : mt.success ? ', but it was actually aligned.' : ', but it was still off.'}</p>` : ''}
      <p>${sc.explain(mt, a)}</p>
      <table class="data">${[['Time', `${Math.floor(secs / 60)} min ${Math.round(secs % 60)} s`], ...(sess ? [['Adjustments', `${changes.length} (${Object.entries(bySrc).map(([k, v]) => `${k} ${v}`).join(', ') || '—'})`]] : []), ...(mt.dose != null ? [['Dose used', `${mt.dose} e⁻/Å²`]] : [])].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <div class="crow">${sess ? '<button class="btn primary" id="scnDl">Download the session file</button><button class="btn" id="scnReplay">Replay</button>' : '<span class="muted">This session was not recorded.</span>'}<button class="btn" id="scnAgain">Try another one</button></div>
      ${sess && a.share ? '<div class="share"><h4>Shared with the research dataset</h4><div class="crow"><span class="muted" id="scnSent">Sending…</span></div></div>' : ''}
      ${sess && SHARE.url && !a.share ? `<div class="share"><h4>Share with the research dataset</h4>
        <p>Send this session (the anonymous file you can download above: settings, timing, your rating and cues, no personal data) to the open research dataset${SHARE.dataset ? ` <b>${esc(SHARE.dataset)}</b> on Hugging Face` : ''}, where it will be used to study alignment and to train models that assist real microscopes. Once sent it may be included in published data. Optional: the exhibit works the same either way.</p>
        <label class="note"><input type="checkbox" id="scnAgree"> I agree to share this session</label>
        <div class="crow"><button class="btn primary" id="scnSend" disabled>Send</button><span class="muted" id="scnSent"></span></div></div>` : ''}</div>`);
    m.querySelector('.close').onclick = () => { m.hidden = true; this.clear(); };
    m.querySelector('#scnAgain').onclick = () => { m.hidden = true; this.begin(a.id, a.record, store('sem-exp') ?? 'novice', a.share); };
    if (sess) {
      m.querySelector('#scnDl').onclick = () => this.downloadSession(sess);
      m.querySelector('#scnReplay').onclick = () => { m.hidden = true; this.startReplay(sess); };
      if (a.share) this.share(sess, null, m.querySelector('#scnSent'));
      const agree = m.querySelector('#scnAgree'), send = m.querySelector('#scnSend');
      if (agree) {
        agree.onchange = () => { send.disabled = !agree.checked; };
        send.onclick = () => this.share(sess, send, m.querySelector('#scnSent'));
      }
    }
    this.api.onEvent?.('end', a.id, mt);
  }
  // send one session to the collector (only after the visitor ticked the box); the receipt id lets them ask for removal
  async share(sess, btn, out) {
    if (btn) btn.disabled = true;
    out.textContent = 'Sending…';
    try {
      const r = await fetch(SHARE.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sess) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `error ${r.status}`);
      if (btn) btn.textContent = 'Sent ✓';
      out.innerHTML = `Sent ✓ Thank you. Session id <code>${esc(j.id ?? sess.session.id)}</code>: quote it to have it removed.`;
      this.recorder.sent = (this.recorder.sent ?? 0) + 1;
    } catch (e) {
      if (btn) btn.disabled = false;
      out.textContent = `Not sent (${e.message}). You can download the file instead.`;
    }
  }

  // the page is closing during a shared task: send what was recorded, marked abandoned
  flushOnExit() {
    const a = this.active;
    if (!a?.share || !this.recorder.active) return;
    const sess = this.recorder.stop('abandoned');
    try { navigator.sendBeacon(SHARE.url, new Blob([JSON.stringify(sess)], { type: 'text/plain' })); } catch { /* best effort */ }
  }

  // back to the normal exhibit: no hidden misalignment
  clear() { this.api.S.mis = null; this.api.S.wobble = false; this.api.invalidateAll(); }
  // the active scenario may take over the panel's multifunction knobs (alignment pads)
  mfOverride() { return (this.active && SCENARIOS[this.active.id].mf?.()) || null; }
  downloadSession(sess) {
    this.api.download(new Blob([JSON.stringify(sess)], { type: 'application/json' }), `sem-view-session-${sess.scenario?.id ?? 'free'}-${sess.session.id.slice(0, 8)}.json`);
  }

  // ---------------------------------------------------------------- replay: drive the exhibit from a recorded session
  startReplay(sess) {
    if (this.active) return;
    const snaps = sess.events.filter((e) => e.k === 'snap');
    if (!snaps.length) return;
    this.replay = { sess, snaps, saved: this.api.snapshotState(), t: 0, playing: true, speed: 1, last: performance.now(), T: sess.events[sess.events.length - 1].t };
    this.api.S.mis = sess.scenario?.hidden?.mis ?? null;
    const r = this.replay, marks = sess.events.filter((e) => ['acquire', 'judge', 'end', 'mode', 'button', 'blocked'].includes(e.k));
    const bar = this.el('replayBar', 'card replaybar', `<div class="rbhead"><b>Replay</b><span>${esc(sess.scenario?.id ?? 'free session')} · ${esc(sess.session.experience)} · ${r.T.toFixed(0)} s</span><span class="sp"></span>
      <button data-r="play">❚❚</button><select data-r="speed"><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option></select><button data-r="close" title="Leave the replay">×</button></div>
      <canvas class="rbchart"></canvas><input type="range" min="0" max="${r.T}" step="0.1" value="0" data-r="scrub"><p class="rblog"></p>`);
    r.bar = bar; r.marks = marks;
    bar.querySelector('[data-r="play"]').onclick = (e) => { r.playing = !r.playing; e.target.textContent = r.playing ? '❚❚' : '▶'; r.last = performance.now(); };
    bar.querySelector('[data-r="speed"]').onchange = (e) => { r.speed = +e.target.value; };
    bar.querySelector('[data-r="scrub"]').oninput = (e) => { r.t = +e.target.value; r.playing = false; bar.querySelector('[data-r="play"]').textContent = '▶'; this.applyAt(r.t); };
    bar.querySelector('[data-r="close"]').onclick = () => this.stopReplay();
    this.applyAt(0);
  }
  loadReplay(text) { this.startReplay(JSON.parse(text)); }
  applyAt(t) {
    const r = this.replay;
    let s = r.snaps[0];
    for (const x of r.snaps) { if (x.t <= t) s = x; else break; }
    if (s !== r.cur) { r.cur = s; this.api.applyFlat(s.state); }
    this.drawReplay(t, s);
  }
  replayTick() {
    const r = this.replay;
    if (!r || !r.playing) return;
    const now = performance.now();
    r.t = Math.min(r.T, r.t + ((now - r.last) / 1000) * r.speed); r.last = now;
    r.bar.querySelector('[data-r="scrub"]').value = r.t;
    this.applyAt(r.t);
    if (r.t >= r.T) { r.playing = false; r.bar.querySelector('[data-r="play"]').textContent = '▶'; }
  }
  drawReplay(t, s) {
    const r = this.replay, cv = r.bar.querySelector('.rbchart'), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    const q = cv.getContext('2d'), W = cv.width, H = cv.height, X = (x) => (x / (r.T || 1)) * W, Y = (v) => H - 4 * dpr - (v / 100) * (H - 8 * dpr);
    q.fillStyle = '#06080b'; q.fillRect(0, 0, W, H);
    // the true alignment score over time, with the target line and the decision points
    q.strokeStyle = 'rgba(255,255,255,0.15)'; q.beginPath(); q.moveTo(0, Y(100)); q.lineTo(W, Y(100)); q.stroke();
    q.strokeStyle = '#6fd6ff'; q.lineWidth = 1.5 * dpr; q.beginPath();
    r.snaps.forEach((x, i) => { const v = x.m?.score ?? 0; i ? q.lineTo(X(x.t), Y(v)) : q.moveTo(X(x.t), Y(v)); });
    q.stroke();
    for (const e of r.marks) { q.fillStyle = e.k === 'judge' ? '#ffb45e' : e.k === 'acquire' ? '#9be39b' : e.k === 'blocked' ? '#ff8a8a' : '#8a94a3'; q.fillRect(X(e.t) - dpr, 0, 2 * dpr, H); }
    q.fillStyle = '#fff'; q.fillRect(X(t) - dpr, 0, 2 * dpr, H);
    const recent = r.sess.events.filter((e) => e.k === 'change' && e.t <= t && e.t > t - 3 && e.key !== 'paused').slice(-4).map((e) => `${e.key} ${e.from}→${e.to} (${e.src})`);
    r.bar.querySelector('.rblog').textContent = `${t.toFixed(1)} s · true score ${s.m?.score ?? '—'}${s.m?.blur_ratio != null ? ` · blur ${s.m.blur_ratio}× probe` : ''}${s.m?.offset_um != null ? ` · aperture off ${s.m.offset_um} µm` : ''}${recent.length ? ' · ' + recent.join(' · ') : ''}`;
  }
  stopReplay() {
    const r = this.replay;
    if (!r) return;
    this.replay = null;
    r.bar.hidden = true;
    this.api.restoreState(r.saved);
  }
}
