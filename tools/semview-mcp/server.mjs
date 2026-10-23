#!/usr/bin/env node
// semview-mcp: an MCP server that lets an AI agent (an emskills agent, Claude, …) use the SEM-view digital twin.
//
//   Live:      the exhibit (browser) connects to ws://127.0.0.1:8792 after the visitor clicks "Connect agent".
//              The agent can then read the state, change settings, acquire images, speak through the exhibit,
//              and receive the visitor's spoken questions (commands the exhibit itself doesn't understand).
//   Headless:  `simulate` runs the same simulator in Node, no browser needed, and writes NumPy .npz data;
//              `twin` drives one persistent headless SEM with the scripting calls (challenges, profile, analyses).
//
// Run it from an MCP client (stdio), e.g. in Claude Code: claude mcp add semview -- node /path/to/SEM-view/tools/semview-mcp/server.mjs
// Environment: SEMVIEW_PORT (8792), SEMVIEW_ORIGINS (comma-separated; default the exhibit's site and localhost),
//              SEMVIEW_OUT (folder for acquisitions and simulations; default ./semview-out).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { Sim } from '../../js/sim.js';
import { defaultState } from '../../js/state.js';
import * as P from '../../js/physics.js';
import * as O from '../../js/ops.js';
import { collectData, toNpz } from '../../js/export.js';
import { analyze, ANALYSES } from '../../js/analyze.js';
import { ScriptCore, settingsToOps } from '../../js/scripting.js';
import { describe } from '../../js/voice.js';

const PORT = +(process.env.SEMVIEW_PORT ?? 8792);
const ORIGINS = (process.env.SEMVIEW_ORIGINS ?? 'https://advanced-em.github.io').split(',').map((s) => s.trim()).filter(Boolean);
const OUT = resolve(process.env.SEMVIEW_OUT ?? 'semview-out');
const log = (...a) => console.error('[semview-mcp]', ...a); // stdout belongs to the MCP protocol

// ------------------------------------------------------------------ bridge to the exhibit
let page = null, nextId = 1;
const pending = new Map(), utterances = [], waiters = [];
const allowed = (origin) => !origin || ORIGINS.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT, verifyClient: ({ origin }) => allowed(origin) });
wss.on('listening', () => log(`waiting for the exhibit on ws://127.0.0.1:${PORT}`));
wss.on('error', (e) => log('websocket error:', e.message));
wss.on('connection', (ws) => {
  if (page) page.close(4000, 'replaced by a newer exhibit tab');
  page = ws; log('exhibit connected');
  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.t); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); }
    else if (m.event === 'utterance' && typeof m.text === 'string') {
      const u = { text: m.text.slice(0, 500), at: new Date().toISOString() };
      const w = waiters.shift(); if (w) w(u); else { utterances.push(u); if (utterances.length > 20) utterances.shift(); }
    }
  });
  ws.on('close', () => { if (page === ws) { page = null; log('exhibit disconnected'); } });
});

function call(method, params = {}, timeoutMs = 30000) {
  if (!page || page.readyState !== 1) return Promise.reject(new Error('No exhibit is connected. Open the exhibit and click "Connect agent" (Controls → Voice and agent).'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`the exhibit did not answer ${method} in time`)); }, timeoutMs);
    pending.set(id, { resolve, reject, t });
    page.send(JSON.stringify({ id, method, params }));
  });
}

const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: e.message ?? String(e) }] });
const safe = (fn) => async (args) => { try { return await fn(args); } catch (e) { return fail(e); } };

// ------------------------------------------------------------------ settings (the same names as the Python package)
const settings = {
  mode: z.enum(O.MODES).optional().describe('se (Everhart–Thornley SE), inlens (through-the-lens SE), bse (4-quadrant backscatter), ebsd, tkd, eds, mc (Monte Carlo interaction volume)'),
  specimen: z.enum(Object.keys(P.SPECIMENS)).optional().describe('sn tin spheres on carbon, ni polycrystalline nickel, grid 463 nm cross-grating standard, chip FIB chip cross-section'),
  kV: z.number().min(0.5).max(30).optional(),
  current_pA: z.number().min(1).max(20000).optional(),
  aperture_um: z.number().optional().describe('10, 20, 30, 60 or 120'),
  wd_mm: z.number().min(2).max(20).optional(),
  focus_um: z.number().optional().describe('focus offset on the knob'),
  stig_x: z.number().min(-2).max(2).optional(), stig_y: z.number().min(-2).max(2).optional(),
  fov_um: z.number().positive().max(1500).optional().describe('horizontal field of view'),
  tilt_deg: z.number().min(0).max(72).optional(),
  dwell_us: z.number().min(0.1).max(30).optional(),
  coated: z.boolean().optional(),
  bse: z.enum(['comp', 'topoX', 'topoY']).optional(),
  realistic: z.boolean().optional().describe('shot noise instead of the clean educational view'),
};

// ------------------------------------------------------------------ headless: one persistent twin, and one-shot simulations
function headlessCore() {
  const S = defaultState(), sim = new Sim(S);
  S.stigX = sim.astig[0]; S.stigY = sim.astig[1];
  const run = (op) => { O.runOpState(S, sim, op); return op.op === 'analyze' ? (op.result ?? { error: op.error }) : describe(op); };
  return new ScriptCore({ name: 'headless', S, sim, run, busy: () => null, scenarioApi: { S, sim, setSpec: (v) => O.specState(S, sim, v), setMode: (m) => O.modeState(S, sim, m) } });
}
const twin = headlessCore();

function simulate(a) {
  const core = headlessCore(), { out, steps, analysis, ...set } = a;
  core.set(set);
  O.settle(core.S, core.sim, steps);
  const data = collectData(core.sim, core.S);
  mkdirSync(OUT, { recursive: true });
  const file = out ? resolve(out) : join(OUT, `sim-${core.S.mode}-${core.S.spec}-${Date.now()}.npz`);
  writeFileSync(file, toNpz(data));
  let an;
  if (analysis) { try { an = analyze(core.sim, core.S, analysis === 'auto' ? undefined : analysis); } catch (e) { an = { error: e.message }; } }
  return { file, ...core.state(), arrays: Object.fromEntries(Object.entries(data.arrays).map(([k, v]) => [k, v.shape])), calibration: data.meta.calibration, analysis: an };
}

// ------------------------------------------------------------------ MCP tools
const server = new McpServer({ name: 'semview', version: '0.1.0' }, {
  instructions: 'SEM-view is a physics-based scanning electron microscope simulator (a digital twin): SE, in-lens and 4-quadrant BSE imaging, EBSD/TKD, EDS and a Monte Carlo of the interaction volume. Use simulate for one-off headless data and twin for a persistent headless instrument (challenges, instrument profile). The exhibit_* tools act on a live exhibit a visitor has open; a person may be watching and listening, so keep exhibit_say short and plain. Never change settings during a training task the visitor is doing (the exhibit refuses).',
});

server.registerTool('simulate', {
  title: 'Simulate an SEM-view acquisition (headless)',
  description: 'Run the SEM-view simulator without a browser and save what the detectors record as a NumPy .npz (SE/BSE images and the four BSE quadrants, EBSD Euler maps and patterns, EDS spectrum and element maps, Monte Carlo profiles) with metadata.json (calibrations, beam, state). Returns the file path, array shapes and the beam (probe size and its budget); feed the file to analysis skills (e.g. emskills scalebar-calibrate, sem-topography, edax-phase-map).',
  inputSchema: { ...settings, steps: z.number().int().min(1).max(4000).optional(), out: z.string().optional().describe('output .npz path'),
    analysis: z.enum(['auto', ...Object.keys(ANALYSES)]).optional().describe('also analyze the result: calibrate_scale (emskills scalebar-calibrate), reconstruct_relief (sem-topography), phase_map (edax-phase-map), fit_eds, fit_resolution, fit_focus, index_ebsd, mc_summary; auto picks by mode') },
  annotations: { readOnlyHint: false, openWorldHint: false },
}, safe(async (a) => text(simulate(a))));

server.registerTool('twin', {
  title: 'Drive the headless digital twin',
  description: 'One persistent headless SEM, with the same calls as the Python package (semview): info, state, set {settings}, command {text}, autofocus, profile {preset | fields}, analyze {name}, step {n}, challenge {id, seed} (sem-focus-stig, sem-aperture-align, sem-insulator, ebsd-setup), score, reveal, end_challenge. acquire returns array shapes and metadata and saves the .npz to disk.',
  inputSchema: { call: z.enum(['info', 'state', 'set', 'command', 'autofocus', 'profile', 'acquire', 'analyze', 'step', 'challenge', 'score', 'reveal', 'end_challenge']), args: z.record(z.string(), z.any()).optional() },
}, safe(async ({ call: c, args = {} }) => {
  const r = twin.call(c, args);
  if (c !== 'acquire') return text(r);
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `twin-${twin.S.mode}-${twin.S.spec}-${Date.now()}.npz`);
  writeFileSync(file, r.npz);
  return text({ file, arrays: r.arrays, calibration: r.meta.calibration, beam: r.meta.beam });
}));

server.registerTool('exhibit_status', {
  title: 'Exhibit status',
  description: 'Is a live exhibit connected, and what is it showing: mode, specimen, voltage, current, probe size, focus, stigmator, field of view, tilt, and whether a training task is running.',
  inputSchema: {}, annotations: { readOnlyHint: true },
}, safe(async () => text(page ? { connected: true, ...(await call('state')) } : { connected: false, how: 'Open the exhibit (https://advanced-em.github.io/SEM-view/) and click "Connect agent" in Controls → Voice and agent.' })));

server.registerTool('exhibit_set', {
  title: 'Change exhibit settings',
  description: 'Change the live microscope: mode, specimen, voltage, current, aperture, working distance, focus, stigmator, field of view, tilt, dwell, coating, BSE segments, realistic view. Settings apply in a sensible order (specimen, mode, beam). Returns what changed.',
  inputSchema: settings,
}, safe(async (a) => { const ops = settingsToOps(a); if (!ops.length) throw new Error('nothing to change'); return text(await call('run', { ops })); }));

server.registerTool('exhibit_action', {
  title: 'Exhibit action',
  description: 'Press a control on the live microscope: autofocus (auto focus and stigmation), blank_beam, unblank_beam, wobbler (focus wobbler on/off, for aperture alignment), restart_map (EBSD/TKD), restart_mc (Monte Carlo), narrate (the exhibit explains the current mode aloud).',
  inputSchema: { action: z.enum(['autofocus', 'blank_beam', 'unblank_beam', 'wobbler', 'restart_map', 'restart_mc', 'narrate']) },
}, safe(async ({ action }) => {
  const op = { autofocus: { op: 'action', v: 'autofocus' }, blank_beam: { op: 'beam', v: true }, unblank_beam: { op: 'beam', v: false }, wobbler: { op: 'wobbler' }, restart_map: { op: 'action', v: 'remap' }, restart_mc: { op: 'action', v: 'remc' }, narrate: { op: 'narrate' } }[action];
  return text(await call('run', { ops: [op] }));
}));

server.registerTool('exhibit_command', {
  title: 'Run a spoken-style command',
  description: 'Run a plain-language command with the exhibit\'s grammar, exactly as if the visitor had typed or said it: "switch to BSE", "20 kV", "load nickel", "focus plus 0.5", "auto focus", "acquire". Returns what was done, or that the command was not understood.',
  inputSchema: { text: z.string().min(1).max(300) },
}, safe(async ({ text: t }) => text(await call('command', { text: t }))));

server.registerTool('exhibit_acquire', {
  title: 'Acquire from the exhibit',
  description: 'Record what the live detectors show, like the Acquire button. Returns the detector image(s) and the settings; with save=true also writes the data (.npz) and images (.png) to disk and returns their paths, ready for analysis skills.',
  inputSchema: { save: z.boolean().optional() },
}, safe(async ({ save }) => {
  const r = await call('acquire', { data: !!save }, 60000);
  const content = [{ type: 'text', text: JSON.stringify({ id: r.id, mode: r.mode, specimen: r.spec, settings: r.summary }, null, 2) }];
  for (const png of [r.png, r.png2].filter(Boolean)) content.push({ type: 'image', data: png.split(',')[1], mimeType: 'image/png' });
  if (save) {
    mkdirSync(OUT, { recursive: true });
    const base = join(OUT, `exhibit-${r.mode}-${r.id}-${Date.now()}`), files = {};
    if (r.npz) { writeFileSync(`${base}.npz`, Buffer.from(r.npz, 'base64')); files.npz = `${base}.npz`; }
    if (r.png) { writeFileSync(`${base}.png`, Buffer.from(r.png.split(',')[1], 'base64')); files.png = `${base}.png`; }
    content.push({ type: 'text', text: JSON.stringify({ saved: files }) });
  }
  return { content };
}));

server.registerTool('exhibit_analyze', {
  title: 'Analyze what the exhibit shows',
  description: 'Measure the live data and compare with the truth: calibrate_scale (magnification, scan aspect and shear on the cross grating; emskills scalebar-calibrate), reconstruct_relief (3D from the BSE quadrants; emskills sem-topography), phase_map (EDS phases; emskills edax-phase-map), fit_eds (peaks, energy scale, resolution), fit_resolution (probe size from edges), fit_focus (focus and astigmatism, through focus), index_ebsd (map quality), mc_summary (backscatter coefficient, range). Omit name to pick by mode.',
  inputSchema: { name: z.enum(Object.keys(ANALYSES)).optional() }, annotations: { readOnlyHint: true },
}, safe(async ({ name }) => text(await call('analyze', { name }))));

server.registerTool('exhibit_say', {
  title: 'Speak through the exhibit',
  description: 'Show a caption and say it aloud in the exhibit (the browser\'s speech voice). Use it to answer the visitor\'s spoken questions. Keep it to two or three short sentences.',
  inputSchema: { text: z.string().min(1).max(600) },
}, safe(async ({ text: t }) => text(await call('say', { text: t }))));

server.registerTool('exhibit_wait_for_voice', {
  title: 'Wait for the visitor to speak',
  description: 'Wait for the next thing the visitor says or types that is not a built-in command (usually a question), up to timeout_s seconds. Answer it with exhibit_say, and act with exhibit_set / exhibit_action if they asked for something.',
  inputSchema: { timeout_s: z.number().min(1).max(600).optional() }, annotations: { readOnlyHint: true },
}, safe(async ({ timeout_s = 60 }) => {
  if (utterances.length) return text(utterances.shift());
  if (!page) throw new Error('No exhibit is connected.');
  const u = await new Promise((res) => { const t = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); res(null); }, timeout_s * 1000); const w = (v) => { clearTimeout(t); res(v); }; waiters.push(w); });
  return text(u ?? { text: null, note: `nothing said in ${timeout_s} s` });
}));

await server.connect(new StdioServerTransport());
log('ready (stdio)');
