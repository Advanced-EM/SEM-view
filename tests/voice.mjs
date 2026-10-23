// The command grammar: node tests/voice.mjs
import { interpret } from '../js/voice.js';
const cases = {
  'switch to BSE': [{ op: 'mode', v: 'bse' }], 'load nickel': [{ op: 'spec', v: 'ni' }], '20 kV': [{ op: 'set', k: 'kV', v: 20 }],
  'current 1 nA': [{ op: 'set', k: 'current', v: 1000 }], 'focus plus 0.5': [{ op: 'set', k: 'focus', v: 0.5 }], 'stigmator y minus 0.2': [{ op: 'set', k: 'stigY', v: -0.2 }],
  'field of view 500 nm': [{ op: 'set', k: 'fov', v: 0.5 }], 'tilt 70': [{ op: 'set', k: 'tilt', v: 70 }], 'coat the sample': [{ op: 'set', k: 'coated', v: true }],
  'load the grating and switch to bse': [{ op: 'spec', v: 'grid' }, { op: 'mode', v: 'bse' }], 'calibrate the magnification': [{ op: 'analyze', v: 'calibrate_scale' }],
  'reconstruct the relief': [{ op: 'analyze', v: 'reconstruct_relief' }], 'map the phases': [{ op: 'analyze', v: 'phase_map' }], ebsd: [{ op: 'mode', v: 'ebsd' }],
  topography: [{ op: 'chip', k: 'bseMode', v: 'topoX' }],
  cathodoluminescence: [{ op: 'mode', v: 'cl' }], 'load GaN': [{ op: 'spec', v: 'gan' }], 'wavelength 450': [{ op: 'set', k: 'clLam', v: 450 }],
  panchromatic: [{ op: 'set', k: 'clMode', v: 'pan' }], 'count the dislocations': [{ op: 'analyze', v: 'fit_cl' }], 'field of view 500 nm': [{ op: 'set', k: 'fov', v: 0.5 }], 'auto focus': [{ op: 'action', v: 'autofocus', said: 'Auto focus and stigmation' }],
};
let bad = 0;
for (const [t, want] of Object.entries(cases)) {
  const r = interpret(t, {}), got = JSON.stringify(r.ops ?? r.options?.[0]?.ops ?? r.ask);
  if (got !== JSON.stringify(want)) { bad++; console.log('FAIL', t, got); }
}
const q = interpret('why does the alumina charge?', {});
if (!q.ask) { bad++; console.log('FAIL question', JSON.stringify(q)); }
const near = interpret('swich to bse', {});
if (!near.options && !near.exact) { bad++; console.log('FAIL near miss', JSON.stringify(near)); }
console.log(bad ? `${bad} failed` : `all ${Object.keys(cases).length + 2} commands ok`);
process.exitCode = bad ? 1 : 0;
