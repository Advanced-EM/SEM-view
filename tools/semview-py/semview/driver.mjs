// Headless SEM-view for Python: one simulator in this process, driven by JSON lines on stdin.
//   request  {"id": 1, "call": "set", "args": {"mode": "bse"}}
//   reply    {"id": 1, "result": ...}  or  {"id": 1, "error": "..."}
// Byte results (the .npz from acquire) are sent as {"$bytes": "<base64>"}. Started by semview.connect("headless").
// The repository's js/ folder is found from SEMVIEW_ROOT, or from this file's place in the repository.
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.SEMVIEW_ROOT ? resolve(process.env.SEMVIEW_ROOT) : resolve(here, '../../..');
if (!existsSync(join(root, 'js', 'sim.js'))) {
  process.stdout.write(JSON.stringify({ id: 0, error: `SEM-view not found at ${root}: set SEMVIEW_ROOT to the repository folder` }) + '\n');
  process.exit(1);
}
const mod = (f) => import(pathToFileURL(join(root, 'js', f)).href);
const [{ Sim }, { defaultState }, ops, { ScriptCore, b64 }, { describe }] = await Promise.all([mod('sim.js'), mod('state.js'), mod('ops.js'), mod('scripting.js'), mod('voice.js')]);

const S = defaultState();
const sim = new Sim(S);
S.stigX = sim.astig[0]; S.stigY = sim.astig[1]; // a freshly aligned column, as the exhibit starts
const run = (op) => { ops.runOpState(S, sim, op); return op.op === 'analyze' ? (op.result ?? { error: op.error }) : describe(op); };
const core = new ScriptCore({
  name: 'headless', S, sim, run, busy: () => null,
  scenarioApi: { S, sim, setSpec: (v) => ops.specState(S, sim, v), setMode: (m) => ops.modeState(S, sim, m) },
});

const enc = (v) => (v instanceof Uint8Array ? { $bytes: b64(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
send({ id: 0, result: { ready: true, root } });
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  let m; try { m = JSON.parse(line); } catch { send({ id: null, error: 'not JSON' }); continue; }
  try { send({ id: m.id, result: enc(core.call(m.call, m.args)) }); }
  catch (e) { send({ id: m.id, error: e.message ?? String(e) }); }
}
