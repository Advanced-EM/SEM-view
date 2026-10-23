// Every analysis against the simulator: node tests/analyses.mjs
import { Sim } from '../js/sim.js';
import { defaultState } from '../js/state.js';
import * as O from '../js/ops.js';
import { analyze } from '../js/analyze.js';
const run = (setup, name) => {
  const S = defaultState(), sim = new Sim(S);
  setup(S, sim);
  O.settle(S, sim);
  const t = performance.now();
  try { const a = analyze(sim, S, name); console.log(`${a.analysis} (${(performance.now() - t).toFixed(0)} ms): ${a.summary}`); return a; }
  catch (e) { console.log(`${name} FAILED: ${e.message}`); process.exitCode = 1; }
};
run((S, sim) => { O.specState(S, sim, 'grid'); S.kV = 10; S.stigX = 0.7; S.stigY = -0.45; Object.assign(S.profile, { magCal: 1.03, scanAspect: 0.985, scanShear: 0.8 }); }, 'calibrate_scale');
run((S, sim) => { S.fov = 0.6; S.stigX = 0.7; S.stigY = -0.45; S.current = 30; }, 'fit_resolution');
run((S, sim) => { S.fov = 2; S.focus = 0.03; }, 'fit_focus');
run((S, sim) => { S.fov = 2; S.stigX = 0.7; S.stigY = -0.45; S.focus = -0.02; }, 'fit_focus');
run((S, sim) => { O.modeState(S, sim, 'bse'); S.kV = 10; S.fov = 6; S.stigX = 0.7; S.stigY = -0.45; S.dwell = 10; }, 'reconstruct_relief');
run((S, sim) => { O.specState(S, sim, 'chip'); O.modeState(S, sim, 'eds'); S.kV = 20; Object.assign(S.profile, { edsFWHM: 140, edsGain: 1.004, edsOffset: 12 }); }, 'fit_eds');
run((S, sim) => { O.specState(S, sim, 'chip'); O.modeState(S, sim, 'eds'); S.kV = 20; }, 'phase_map');
run((S, sim) => { O.modeState(S, sim, 'ebsd'); S.mapN = 24; }, 'index_ebsd');
run((S, sim) => { O.modeState(S, sim, 'mc'); S.spec = 'ni'; }, 'mc_summary');
run((S, sim) => { O.modeState(S, sim, 'cl'); S.kV = 5; }, 'fit_cl');
run((S, sim) => { O.specState(S, sim, 'ni'); O.modeState(S, sim, 'cl'); S.kV = 10; }, 'fit_cl');
