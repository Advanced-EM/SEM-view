// Fits against the simulator's truth: node tests/fits.mjs
import { Sim } from '../js/sim.js';
import { defaultState } from '../js/state.js';
import * as C from '../js/calibrate.js';
const S = defaultState(); S.spec = 'grid'; S.fov = 4; S.kV = 10; S.stigX = 0.7; S.stigY = -0.45;
for (const [m, a, sh] of [[1, 1, 0], [1.04, 0.98, 1.2], [0.95, 1.02, -0.8]]) {
  Object.assign(S.profile, { magCal: m, scanAspect: a, scanShear: sh });
  const sim = new Sim(S); sim.computeImage();
  const f = C.fitGrating(sim.img.arr, 256, 256, { pixUm: S.fov / 256, pitchUm: 0.463 });
  console.log('grating true', m, a, sh, 'fit', f.magCal.toFixed(4), f.scanAspect.toFixed(4), f.scanShear.toFixed(3), 'rot', f.rotation_deg.toFixed(2));
}
Object.assign(S.profile, { magCal: 1, scanAspect: 1, scanShear: 0 });
S.spec = 'sn'; S.fov = 0.8;
for (const foc of [0, 0.02, 0.05]) { S.focus = foc; const sim = new Sim(S); sim.computeImage(); const f = C.fitEdgeResolution(sim.img.arr, 256, 256, { pixUm: S.fov / 256 }); console.log('edge focus', foc, 'probe', sim.probe.d.toFixed(2), 'fit', f.resolution_nm.toFixed(2), f.edges); }
S.focus = 0;
for (const [sx, sy] of [[0.7, -0.45], [0, 0], [1.2, -0.45], [0.7, 0.2]]) { S.stigX = sx; S.stigY = sy; S.fov = 2; const sim = new Sim(S); sim.computeImage(); const f = C.focusAnisotropy(sim.img.arr, 256, 256); console.log('stig', sx, sy, 'res', sim.astigRes().map((v) => v.toFixed(2)), 'ell', f.ellipticity.toFixed(3), 'axis', f.axis_deg.toFixed(1), 'sharp', sim.img.sharp.toFixed(3)); }
