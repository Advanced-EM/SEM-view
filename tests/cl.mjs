// Cathodoluminescence: depth resolution and dislocation contrast. node tests/cl.mjs
import { Sim } from '../js/sim.js';
import { defaultState } from '../js/state.js';
import * as O from '../js/ops.js';
const run = (kV, mode = 'pan', lam = 450) => {
  const S = defaultState(), sim = new Sim(S);
  O.specState(S, sim, 'gan'); Object.assign(S, { mode: 'cl', kV, current: 2000, clMode: mode, clLam: lam, clBand: 20 }); sim.invalidate('all');
  const t = performance.now(); sim.update(0.05);
  const c = sim.cl, peak = (lo, hi) => { let m = 0, at = 0; for (let b = 0; b < c.nb; b++) { const l = c.l0 + (b + 0.5) * c.dl; if (l >= lo && l <= hi && c.spec[b] > m) { m = c.spec[b]; at = l; } } return [m, at]; };
  const [nbe, ln] = peak(340, 390), [qw, lq] = peak(420, 500);
  let mn = Infinity, mx = 0; for (const v of c.img) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  console.log(`${kV} kV ${mode}${mode === 'mono' ? ' ' + lam : ''}: GaN edge ${nbe.toExponential(2)} at ${ln} nm, QW ${qw.toExponential(2)} at ${lq} nm, QW/edge ${(qw / nbe).toFixed(2)}, contrast ${(1 - mn / mx).toFixed(2)}, blur ${(c.sg * 1000).toFixed(0)} nm, ${(performance.now() - t).toFixed(0)} ms`);
  return { qw, nbe };
};
const a = run(2), b = run(5), c = run(15);
run(5, 'mono', 365); run(5, 'mono', 450);
const ok = a.qw / a.nbe < b.qw / b.nbe && b.qw / b.nbe < c.qw / c.nbe;
console.log(ok ? 'ok   the wells light up as the voltage reaches them' : 'FAIL depth dependence'); if (!ok) process.exitCode = 1;
