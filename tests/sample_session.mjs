// A recorded training session made headless (deterministic): the sample the HF tools and the Worker test use.
//   node tests/sample_session.mjs  → tools/analysis/sample/sem-focus-stig-example.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { Sim } from '../js/sim.js';
import { defaultState } from '../js/state.js';
import * as O from '../js/ops.js';
import { SCENARIOS } from '../js/scenarios.js';
import { Recorder } from '../js/telemetry.js';
import * as P from '../js/physics.js';

globalThis.innerWidth = 1440; globalThis.innerHeight = 900;
// a fake clock, so the session's timing is reproducible
let now = 0;
globalThis.performance = { now: () => now };
const S = defaultState(), sim = new Sim(S), api = { S, sim, setSpec: (v) => O.specState(S, sim, v), setMode: (m) => O.modeState(S, sim, m) };
const sc = SCENARIOS['sem-focus-stig'], info = sc.setup(api, P.mulberry32(42)), active = { id: 'sem-focus-stig', seed: 42, ...info };
const rec = new Recorder({ S, version: 'sample' });
rec.start({ experience: 'trained', scenario: { id: active.id, seed: 42, hidden: info.hidden, target: info.target }, metrics: () => sc.metrics(api, active) });
rec.sess.session.id = '5e3c9a71-0b4d-4c55-9f2e-7a1d8c2b6e40'; rec.sess.session.started = '2026-10-20T21:37:12.000Z';
// a plausible operator: focus in steps, then stigmator X, then Y, then focus again
const h = info.hidden.mis, plan = [];
for (let i = 1; i <= 8; i++) plan.push(['focus', h.focus * (i / 8) + 0.02 * Math.sin(i)]);
for (let i = 1; i <= 6; i++) plan.push(['stigX', h.stig[0] * (i / 6) + 0.05 * Math.cos(i)]);
for (let i = 1; i <= 6; i++) plan.push(['stigY', h.stig[1] * (i / 6) - 0.04 * Math.sin(i)]);
plan.push(['focus', h.focus + 0.01], ['stigX', h.stig[0] - 0.02], ['stigY', h.stig[1] + 0.015]);
for (const [k, v] of plan) {
  rec.noteSource(k === 'focus' ? 'mouse' : 'onscreen-panel');
  O.setState(S, sim, k, v);
  for (let s = 0; s < 6; s++) { now += 120; sim.update(0.12); rec.tick(); }
}
rec.event('acquire');
now += 900;
rec.event('judge', { rating: 4, cues: ['Image looks sharp', 'Small spheres look round'], note: '' });
const sess = rec.stop('done');
mkdirSync(new URL('../tools/analysis/sample/', import.meta.url), { recursive: true });
writeFileSync(new URL('../tools/analysis/sample/sem-focus-stig-example.json', import.meta.url), JSON.stringify(sess));
console.log(`${sess.events.length} events, final score ${sess.events.at(-1).m.score}`);
