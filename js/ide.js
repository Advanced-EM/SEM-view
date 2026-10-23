// The Python IDE inside the exhibit: an editor, Python 3 (Pyodide, CPython compiled to WebAssembly) with NumPy,
// and the same `semview` package desktop scripts use (tools/semview-py), wired straight to this page.
// Everything loads on first open from public CDNs, and runs on this computer: no code is sent anywhere.
//
// Scripts run on the page's main thread, so the exhibit pauses while a script runs and redraws when it
// ends. A worker (and, later, WebGPU compute for the simulator) would let long scripts run alongside the
// display; the semview calls would not change.
import { b64 } from './scripting.js';

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const CM = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/';
const PKG = ['__init__.py', 'microscope.py', 'transports.py'];
const EXAMPLES = [
  ['quickstart.py', 'Quick start: set, acquire, show'],
  ['calibrate_magnification.py', 'Digital twin: calibrate on the cross grating'],
  ['bse_relief.py', 'BSE quadrants: 3D relief with NumPy'],
  ['ebsd_map.py', 'EBSD: an orientation map'],
  ['find_e2.py', 'Challenge: find E2 of an insulator'],
  ['auto_focus_stig.py', 'Test automation: your own auto focus and stigmation'],
];
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };
const esc = (t) => String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
const loadScript = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error(`could not load ${src}`)); document.head.appendChild(s); });
const loadCss = (href) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); };

export class PythonIDE {
  // core: the ScriptCore of this page; base: URL of the site root (for the semview package and examples)
  constructor({ core, base = new URL('./', location.href).href, onRun }) {
    this.core = core; this.base = base; this.onRun = onRun;
    this.py = null; this.loading = null; this.cm = null;
  }

  // ---------------------------------------------------------------- window
  build() {
    const el = document.createElement('section');
    el.id = 'ide'; el.className = 'card ide'; el.hidden = true;
    el.setAttribute('aria-label', 'Python scripting');
    el.innerHTML = `
      <header class="idehead"><b>Python</b><span class="idestat">Not loaded</span><span class="sp"></span>
        <select class="ideex" aria-label="Examples"><option value="">Examples…</option>${EXAMPLES.map(([f, t]) => `<option value="${f}">${esc(t)}</option>`).join('')}</select>
        <button data-a="open" title="Open a .py file">Open</button><button data-a="save" title="Save as a .py file">Save</button>
        <button data-a="help" title="The semview calls">Help</button><button data-a="clear" title="Clear the output">Clear</button>
        <button data-a="run" class="run" title="Run (Ctrl+Enter or ⌘+Enter)">▶ Run</button><button data-a="close" class="x" aria-label="Close">×</button></header>
      <div class="idebody"><div class="ideed"><textarea spellcheck="false" aria-label="Python code"></textarea></div><div class="ideout" aria-live="polite"></div></div>
      <div class="idehelp" hidden>${HELP}</div>
      <input type="file" accept=".py,text/x-python,text/plain" hidden>`;
    document.body.appendChild(el);
    this.el = el; this.out = el.querySelector('.ideout'); this.stat = el.querySelector('.idestat'); this.ta = el.querySelector('textarea');
    this.ta.value = store('sem-ide-code') ?? DEFAULT_CODE;
    el.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => this.act(b.dataset.a); });
    el.querySelector('.ideex').onchange = (e) => { if (e.target.value) this.loadExample(e.target.value); e.target.value = ''; };
    el.querySelector('input[type=file]').onchange = async (e) => { const f = e.target.files[0]; if (f) this.setCode(await f.text()); e.target.value = ''; };
    el.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.run(); } e.stopPropagation(); });
    this.drag(el.querySelector('.idehead'));
  }
  drag(h) {
    h.onpointerdown = (e) => {
      if (e.button !== 0 || e.target.closest('button, select')) return;
      const r = this.el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      h.setPointerCapture(e.pointerId);
      h.onpointermove = (m) => Object.assign(this.el.style, { left: `${Math.max(0, Math.min(innerWidth - 120, m.clientX - dx))}px`, top: `${Math.max(0, Math.min(innerHeight - 40, m.clientY - dy))}px`, right: 'auto', bottom: 'auto' });
      h.onpointerup = h.onpointercancel = () => { h.onpointermove = null; };
    };
  }
  get open() { return !!this.el && !this.el.hidden; }
  toggle(on = !this.open) {
    if (!this.el) this.build();
    this.el.hidden = !on;
    document.getElementById('btnScript')?.classList.toggle('on', on);
    if (on) { this.editor(); this.ensurePython(); (this.cm ?? this.ta).focus(); }
  }
  act(a) {
    if (a === 'run') this.run();
    else if (a === 'close') this.toggle(false);
    else if (a === 'clear') this.out.innerHTML = '';
    else if (a === 'help') this.el.querySelector('.idehelp').hidden = !this.el.querySelector('.idehelp').hidden;
    else if (a === 'open') this.el.querySelector('input[type=file]').click();
    else if (a === 'save') { const b = new Blob([this.code()], { type: 'text/x-python' }), u = URL.createObjectURL(b), l = document.createElement('a'); l.href = u; l.download = 'semview_script.py'; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
  }

  // ---------------------------------------------------------------- editor (CodeMirror 5; a plain textarea if it cannot load)
  async editor() {
    if (this.cm || this.cmTried) return;
    this.cmTried = true;
    try {
      loadCss(`${CM}codemirror.min.css`);
      await loadScript(`${CM}codemirror.min.js`);
      await Promise.all([loadScript(`${CM}mode/python/python.min.js`), loadScript(`${CM}addon/edit/matchbrackets.min.js`)]);
      this.cm = window.CodeMirror.fromTextArea(this.ta, { mode: 'python', lineNumbers: true, indentUnit: 4, matchBrackets: true, theme: 'default', extraKeys: { Tab: (cm) => cm.replaceSelection('    ') } });
      this.cm.on('change', () => store('sem-ide-code', this.cm.getValue()));
    } catch { this.ta.oninput = () => store('sem-ide-code', this.ta.value); }
  }
  code() { return this.cm ? this.cm.getValue() : this.ta.value; }
  setCode(t) { if (this.cm) this.cm.setValue(t); else this.ta.value = t; store('sem-ide-code', t); }
  async loadExample(f) {
    try { const r = await fetch(new URL(`tools/semview-py/examples/${f}`, this.base)); if (!r.ok) throw new Error(r.status); this.setCode(await r.text()); }
    catch (e) { this.print(`Could not load the example ${f} (${e.message}).`, 'err'); }
  }

  // ---------------------------------------------------------------- Python
  ensurePython() {
    this.loading ??= (async () => {
      this.status('Loading Python (about 15 MB the first time)…');
      if (!window.loadPyodide) await loadScript(`${PYODIDE}pyodide.js`);
      const py = await window.loadPyodide({ indexURL: PYODIDE });
      await py.loadPackage('numpy');
      py.FS.mkdirTree('/home/pyodide/semview');
      for (const f of PKG) {
        const r = await fetch(new URL(`tools/semview-py/semview/${f}`, this.base));
        if (!r.ok) throw new Error(`could not load semview/${f} (${r.status})`);
        py.FS.writeFile(`/home/pyodide/semview/${f}`, await r.text());
      }
      // the page side of the semview package: one call, JSON in, JSON (plus the .npz bytes) out
      window.semviewScript = {
        call: (name, argsJson) => {
          try {
            const r = this.core.call(name, JSON.parse(argsJson || '{}'));
            let bytes = null, out = r;
            if (r && r.npz instanceof Uint8Array) { bytes = r.npz; out = { ...r }; delete out.npz; }
            return { json: JSON.stringify(out ?? null), bytes, error: null };
          } catch (e) { return { json: 'null', bytes: null, error: e.message ?? String(e) }; }
        },
      };
      window.semviewIDE = { showImage: (bytes, w, h, title) => this.image(bytes, w, h, title), showPlot: (bytes, n, title) => this.plot(bytes, n, title) };
      py.setStdout({ batched: (s) => this.print(s) });
      py.setStderr({ batched: (s) => this.print(s, 'err') });
      py.runPython('import sys; sys.path.insert(0, "/home/pyodide"); import semview');
      this.py = py;
      const v = py.runPython('import sys; sys.version.split()[0]');
      this.status(`Python ${v} · NumPy · semview ${py.runPython('semview.__version__')} · ${navigator.gpu ? 'WebGPU available (the simulator computes on the CPU today)' : 'CPU'}`);
      return py;
    })().catch((e) => { this.loading = null; this.status('Python could not load'); this.print(`Python could not load: ${e.message}. It needs a network connection the first time.`, 'err'); throw e; });
    return this.loading;
  }
  async run() {
    if (this.running) return;
    const code = this.code();
    this.running = true;
    const btn = this.el.querySelector('[data-a=run]'); btn.disabled = true;
    this.print(`▶ ${new Date().toLocaleTimeString()}`, 'run');
    try {
      const py = await this.ensurePython();
      this.status('Running… the exhibit pauses until the script ends');
      await new Promise((r) => setTimeout(r, 30)); // let the status paint before the script takes the thread
      await py.loadPackagesFromImports(code);
      const t0 = performance.now();
      await py.runPythonAsync(code);
      this.print(`✓ done in ${((performance.now() - t0) / 1000).toFixed(1)} s`, 'ok');
    } catch (e) {
      this.print(cleanError(e.message ?? String(e)), 'err');
    } finally {
      this.running = false; btn.disabled = false;
      if (this.py) this.status(this.stat.dataset.ready ?? 'Ready');
      this.onRun?.();
    }
  }

  // ---------------------------------------------------------------- output
  status(t) { this.stat.textContent = t; if (!/^(Running|Loading)/.test(t)) this.stat.dataset.ready = t; }
  print(t, cls = '') { const p = document.createElement('pre'); p.className = cls; p.textContent = t; this.out.appendChild(p); this.out.scrollTop = this.out.scrollHeight; }
  image(bytes, w, h, title) {
    const g = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const id = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) { id.data[4 * i] = id.data[4 * i + 1] = id.data[4 * i + 2] = g[i]; id.data[4 * i + 3] = 255; }
    cv.getContext('2d').putImageData(id, 0, 0);
    this.figure(cv, title);
  }
  plot(bytes, n, title) {
    const v = new Float32Array((bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).buffer.slice(0));
    const W = 480, H = 180, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d'), lo = Math.min(...v), hi = Math.max(...v);
    c.fillStyle = '#0b0e12'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#6fd6ff'; c.lineWidth = 1.5; c.beginPath();
    v.forEach((y, i) => { const X = 8 + (i / Math.max(1, n - 1)) * (W - 16), Y = H - 8 - ((y - lo) / ((hi - lo) || 1)) * (H - 16); i ? c.lineTo(X, Y) : c.moveTo(X, Y); });
    c.stroke();
    this.figure(cv, title);
  }
  figure(cv, title) {
    const f = document.createElement('figure');
    f.appendChild(cv);
    if (title) { const t = document.createElement('figcaption'); t.textContent = title; f.appendChild(t); }
    this.out.appendChild(f); this.out.scrollTop = this.out.scrollHeight;
  }
}

// Python tracebacks: keep the user's part, drop Pyodide's own frames
const cleanError = (m) => { const lines = m.split('\n'); const i = lines.findIndex((l) => l.includes('File "<exec>"')); return (i > 0 ? ['Traceback (most recent call last):', ...lines.slice(i)] : lines).join('\n').trim(); };

const DEFAULT_CODE = `# Python in the exhibit. Ctrl+Enter (⌘+Enter) runs. Help lists the calls; Examples has more.
import semview as sv

sem = sv.connect()                      # this exhibit
sem.set(mode="bse", specimen="ni", kV=15, current_pA=1000, fov_um=60)
img = sem.acquire()
print(img, img.calibration["pixel_um"], "µm per pixel")
sv.show(img, "BSE, polycrystalline nickel: channelling contrast")
print(sem.analyze("reconstruct_relief")["summary"])
`;

const HELP = `<p><b>import semview as sv</b> · <b>sem = sv.connect()</b> gives this exhibit. The same script runs on a desktop
(<code>pip install -e tools/semview-py</code>), headless or driving an open exhibit: <code>sv.connect("live")</code>.</p>
<table>
<tr><td><code>sem.set(**settings)</code></td><td>mode, specimen, kV, current_pA, aperture_um, wd_mm, focus_um, stig_x, stig_y, aperture_x_um, aperture_y_um, fov_um, stage_um, tilt_deg, dwell_us, coated, etd_bias_V, bse, segments, realistic, beam, wobbler, map_size, exposure_ms, foil_nm, trajectories</td></tr>
<tr><td><code>sem.state()</code></td><td>current settings and beam: probe size and its budget, depth of field, sharpness, charging</td></tr>
<tr><td><code>sem.command(text)</code></td><td>a plain-language command: "focus plus 0.5", "20 kV"</td></tr>
<tr><td><code>sem.autofocus()</code></td><td>the instrument's auto focus and stigmation</td></tr>
<tr><td><code>sem.profile(**fields)</code></td><td>the digital twin's instrument profile: preset, Br, dE, CsK, CcK, magCal, scanAspect, scanShear, edsFWHM, edsGain, edsOffset</td></tr>
<tr><td><code>a = sem.acquire()</code></td><td>record the detectors: <code>a.image</code>, <code>a["segment_A"]</code>, <code>a.arrays</code>, <code>a.calibration</code>, <code>a.meta</code></td></tr>
<tr><td><code>sem.analyze(name)</code></td><td>calibrate_scale, fit_resolution, fit_focus, reconstruct_relief, fit_eds, phase_map, index_ebsd, mc_summary, with the true values</td></tr>
<tr><td><code>sem.challenge(id, seed)</code></td><td>sem-focus-stig, sem-aperture-align, sem-insulator or ebsd-setup: a hidden misalignment for your algorithm; <code>sem.score()</code>, <code>sem.reveal()</code>, <code>sem.end_challenge()</code></td></tr>
<tr><td><code>sv.show(x, title)</code></td><td>draw an image (2D) or a profile (1D) here</td></tr>
</table>
<p>The exhibit pauses while a script runs. Scripts cannot change settings during a training task, and challenge
runs are never recorded or shared.</p>`;
