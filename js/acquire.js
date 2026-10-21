// Acquisitions: "Acquire" records what the detector shows as a numbered exposure, with its data and settings,
// like the Acquire button of a microscope camera (as opposed to the live view). Kept for this session in a
// gallery; each can be downloaded as a PNG or as NumPy data (.npz).
import { collectData, toNpz } from './export.js';

const MAX = 24;
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

export class Acquisitions {
  constructor({ S, sim, mainCv, secCv, download, onChange }) {
    Object.assign(this, { S, sim, mainCv, secCv, download, onChange });
    this.list = []; this.n = 0;
  }

  acquire() {
    const S = this.S, sim = this.sim;
    const data = collectData(sim, S);
    if (!Object.keys(data.arrays).length) return null;
    // copy the arrays: the live buffers keep changing
    for (const a of Object.values(data.arrays)) a.data = a.data.slice();
    const a = {
      id: ++this.n, time: new Date(), mode: S.mode, spec: sim.spec.short, data,
      png: this.mainCv.toDataURL('image/png'), png2: this.secCv.toDataURL('image/png'),
      summary: summary(S, sim),
    };
    this.list.unshift(a);
    if (this.list.length > MAX) this.list.pop();
    this.onChange?.(a);
    return a;
  }
  remove(id) { this.list = this.list.filter((a) => a.id !== id); this.onChange?.(); }
  clear() { this.list = []; this.onChange?.(); }

  // gallery dialog
  render(el) {
    if (!this.list.length) {
      el.innerHTML = '<p class="eyebrow">Acquisitions</p><h2>Nothing <em>acquired</em> yet</h2><p>Press <b>Acquire</b> (the camera button above the detector image, or the <kbd>I</kbd> key) to record what the detector shows: the image or pattern, its data and the settings used.</p>';
      return;
    }
    el.innerHTML = `<p class="eyebrow">Acquisitions · this session</p><h2>${this.list.length} <em>acquisition${this.list.length > 1 ? 's' : ''}</em></h2>
      <p class="muted">Kept until the page is closed (at most ${MAX}). Download what you want to keep: PNG for the picture, .npz for the data and metadata (pixel sizes, optics, settings).</p>
      <div class="agrid">${this.list.map((a) => `
        <figure data-id="${a.id}">
          <div class="aimg"><img src="${a.png}" alt="Acquisition ${a.id}"><img src="${a.png2}" alt=""></div>
          <figcaption><b>#${a.id} · ${a.mode.toUpperCase()} · ${esc(a.spec)}</b><span>${a.time.toLocaleTimeString()}</span><small>${esc(a.summary)}</small>
            <div class="abtn"><button class="btn" data-png="${a.id}">PNG</button><button class="btn" data-npz="${a.id}">Data (.npz)</button><button class="btn" data-del="${a.id}">Delete</button></div></figcaption>
        </figure>`).join('')}</div>
      <div class="crow"><button class="btn" id="aClear">Delete all</button></div>`;
    const get = (id) => this.list.find((a) => a.id === +id);
    const name = (a) => `sem-view-${a.mode}-${a.spec.replace(/\W+/g, '')}-${a.id}`;
    el.querySelectorAll('[data-png]').forEach((b) => b.addEventListener('click', async () => { const a = get(b.dataset.png); this.download(await (await fetch(a.png)).blob(), `${name(a)}.png`); }));
    el.querySelectorAll('[data-npz]').forEach((b) => b.addEventListener('click', () => { const a = get(b.dataset.npz); this.download(new Blob([toNpz(a.data)], { type: 'application/zip' }), `${name(a)}.npz`); }));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { this.remove(+b.dataset.del); this.render(el); }));
    el.querySelector('#aClear').addEventListener('click', () => { this.clear(); this.render(el); });
  }
}

// the settings that matter for this mode, in one line
function summary(S, sim) {
  const pr = sim.probe, cur = S.current >= 1000 ? `${+(S.current / 1000).toFixed(2)} nA` : `${Math.round(S.current)} pA`;
  const fov = S.fov >= 1 ? `${+S.fov.toFixed(2)} µm` : `${Math.round(S.fov * 1000)} nm`, base = `${S.kV} kV, ${cur}, probe ${pr.d.toFixed(1)} nm`;
  const m = S.mode;
  if (m === 'se' || m === 'inlens') return `${base}, field ${fov}, WD ${S.wd} mm, dwell ${S.dwell} µs${m === 'se' ? `, grid ${S.etdBias} V` : ''}${S.tilt ? `, tilt ${S.tilt}°` : ''}`;
  if (m === 'bse') return `${base}, field ${fov}, quadrants ${['A', 'B', 'C', 'D'].map((q) => `${q}${S.seg[q] > 0 ? '+' : S.seg[q] < 0 ? '−' : '0'}`).join(' ')}`;
  if (m === 'ebsd' || m === 'tkd') return `${base}, tilt ${S.tilt}°, ${sim.map ? `${sim.map.done}/${sim.map.N ** 2} points` : 'no map'}, ${S.expo} ms per pattern`;
  if (m === 'eds') return `${base}, ${sim.acc ? Math.round(sim.acc.total).toLocaleString() : 0} X-rays in ${(sim.acc?.t ?? 0).toFixed(1)} s`;
  if (m === 'mc') return `${S.kV} kV, ${sim.mc ? sim.mc.n.toLocaleString() : 0} trajectories, tilt ${S.tilt}°`;
  return base;
}
