// Run the simulator without a browser and save what the detectors record as a NumPy .npz.
//   node tools/headless.mjs --mode bse --spec ni --kV 15 --out bse.npz
//   node tools/headless.mjs --session my-session.json --out run.npz
// Options: any setting of the Python package with dashes or underscores (--mode, --specimen/--spec, --kV,
// --current_pA, --fov_um, --focus_um, --tilt_deg, --dwell_us, --coated, --realistic, ...), --session <file saved
// from the exhibit>, --steps <n>, --analysis <name|auto>, --out <file.npz>. Load the result with numpy.load();
// metadata.json inside the archive holds calibrations, beam and state.
import { readFileSync, writeFileSync } from 'node:fs';
import { Sim } from '../js/sim.js';
import { defaultState, SESSION_KEYS } from '../js/state.js';
import { sanitizeProfile } from '../js/profile.js';
import * as O from '../js/ops.js';
import { collectData, toNpz } from '../js/export.js';
import { analyze } from '../js/analyze.js';
import { ScriptCore } from '../js/scripting.js';
import { describe } from '../js/voice.js';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) if (args[i].startsWith('--')) { const k = args[i].slice(2).replace(/-/g, '_'), v = args[i + 1]; if (v === undefined || v.startsWith('--')) opt[k] = true; else { opt[k] = v; i++; } }

const S = defaultState(), sim = new Sim(S);
S.stigX = sim.astig[0]; S.stigY = sim.astig[1];
if (opt.session) {
  const ses = JSON.parse(readFileSync(opt.session, 'utf8'));
  for (const k of SESSION_KEYS) if (k in (ses.state ?? {})) S[k] = k === 'profile' ? sanitizeProfile(ses.state.profile) : ses.state[k];
  sim.invalidate('all');
}
const { session, steps, out, analysis, spec, ...set } = opt;
if (spec) set.specimen = spec;
for (const k of Object.keys(set)) if (set[k] === true || set[k] === 'true') set[k] = true; else if (set[k] === 'false') set[k] = false; else if (!['mode', 'specimen', 'bse'].includes(k)) set[k] = +set[k];
const core = new ScriptCore({ name: 'headless', S, sim, run: (op) => { O.runOpState(S, sim, op); return describe(op); }, busy: () => null });
if (Object.keys(set).length) console.log(core.set(set).join(' · '));
O.settle(S, sim, steps === undefined ? undefined : +steps);
const data = collectData(sim, S);
const file = out ?? `sem-view-${S.mode}-${S.spec}.npz`;
writeFileSync(file, toNpz(data));
console.log(`${file}: ${Object.entries(data.arrays).map(([k, v]) => `${k} ${v.shape.join('×')}`).join(', ')}`);
console.log(`probe ${data.meta.beam.probe_nm} nm at ${S.kV} kV, ${S.current} pA`);
if (analysis) { try { console.log(analyze(sim, S, analysis === true || analysis === 'auto' ? undefined : analysis).summary); } catch (e) { console.log(`analysis: ${e.message}`); } }
