// Screenshots of the exhibit's interface for the guides (docs/guides/fig/sop3_*, sop4_*), taken in headless Chrome
// so they can be retaken whenever the interface changes:
//   node tools/shots.mjs            all of them
//   node tools/shots.mjs sop4       only names containing "sop4"
// It serves the repository itself, drives Chrome over the DevTools protocol, and starts the real semview-mcp server
// for the "agent connected" states (run `npm install` in tools/semview-mcp first). The Python IDE needs a network
// connection (Pyodide loads from its CDN). Set CHROME=/path/to/chrome if Chrome is not in the usual place.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(new URL('..', import.meta.url).pathname), out = join(root, 'docs/guides/fig');
const only = process.argv[2] ?? '';
const chromePath = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!chromePath) { console.error('Chrome not found: set CHROME=/path/to/chrome'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ the site, served locally
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.py': 'text/plain', '.json': 'application/json', '.pdf': 'application/pdf' };
const site = createServer((req, res) => {
  const p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  if (!p.startsWith(root) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }); res.end(readFileSync(p));
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const base = `http://localhost:${site.address().port}/`;

// ------------------------------------------------------------------ Chrome over the DevTools protocol
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'semview-shots-'))}`, 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ } }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  // page errors, so a broken page says why
  else if (m.method === 'Runtime.exceptionThrown') console.error('page error:', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') console.error('page:', m.params.entry.text, m.params.entry.url ?? '');
};
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => { const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'script error'); return r.result?.result?.value; };
await cdp('Runtime.enable'); await cdp('Log.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false });

async function open(path = '') {
  await cdp('Page.navigate', { url: base + path });
  await sleep(500);
  const up = await js(`for (let i = 0; i < 60 && !window.__sem; i++) await new Promise((r) => setTimeout(r, 500)); return !!window.__sem;`);
  if (!up) throw new Error(`the exhibit did not start at ${base + path} (no network for three.js, or no WebGL?)`);
  await sleep(1500);
  // a fixed instrument state for every picture; no narration, no remembered panels
  await js(`localStorage.clear(); document.body.classList.remove('foldL', 'foldR'); window.__sem.S.showElectrons = true; window.__sem.voice.hold = true; return 1;`);
}
// crop to the union of some elements (with a margin), in CSS pixels
async function shot(name, selectors, pad = 14, extra = '') {
  if (only && !name.includes(only)) return;
  const r = await js(`${extra}; await new Promise((r) => setTimeout(r, 700));
    if (${JSON.stringify(selectors)}[0] === 'viewport') return { x: 0, y: 0, width: innerWidth, height: innerHeight };
    const rs = ${JSON.stringify(selectors)}.map((s) => document.querySelector(s)).filter((e) => e && !e.hidden).map((e) => e.getBoundingClientRect());
    if (!rs.length) return null;
    const x0 = Math.max(0, Math.min(...rs.map((b) => b.left)) - ${pad}), y0 = Math.max(0, Math.min(...rs.map((b) => b.top)) - ${pad});
    const x1 = Math.min(innerWidth, Math.max(...rs.map((b) => b.right)) + ${pad}), y1 = Math.min(innerHeight, Math.max(...rs.map((b) => b.bottom)) + ${pad});
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };`);
  if (!r) { console.log(`${name}: nothing to capture`); return; }
  const img = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 88, clip: { ...r, scale: 1 } });
  if (!img.result?.data) throw new Error(`${name}: ${JSON.stringify(img.error ?? img)}`);
  writeFileSync(join(out, `${name}.jpg`), Buffer.from(img.result.data, 'base64'));
  console.log(`${name}.jpg  ${Math.round(r.width)}×${Math.round(r.height)}`);
}
const say = (text) => `window.__sem.voice.handle(${JSON.stringify(text)}, true); await new Promise((r) => setTimeout(r, 900));`;
const openBar = `document.querySelector('#btnAI').click();`;
const scrollTo = (label) => `{ const h = [...document.querySelectorAll('#controlsBody h3.sec')].find((e) => e.textContent === ${JSON.stringify(label)}); h.scrollIntoView({ block: 'start' }); document.querySelector('.controls').scrollTop -= 8; }`;
// a section of the controls: its heading down to the next heading
const section = (label) => `${scrollTo(label)} { const s0 = [...document.querySelectorAll('#controlsBody h3.sec')].find((e) => e.textContent === ${JSON.stringify(label)}); let e = s0.nextElementSibling; s0.id = 'shotFrom'; while (e && e.tagName !== 'H3') { if (!e.hidden) e.id = 'shotTo'; e = e.nextElementSibling; } }`;

// ------------------------------------------------------------------ SOP-03: commands and the agent
await open();
await shot('sop3_cover_ui', ['viewport'], 0, `${openBar} ${say('load the grating and switch to bse')}`);
await open();
await shot('sop3_cmd_exact', ['#voiceBubble', '#cmdBar'], 14, `${openBar} ${say('switch to BSE and 20 kV')}`);
await shot('sop3_cmd_confirm', ['#voiceBubble', '#cmdBar'], 14, `${say('swich to sec')}`);
await js(`window.__sem.voice.escape(); return 1;`);
await shot('sop3_cmd_unknown', ['#voiceBubble', '#cmdBar'], 14, `${say('who invented the SEM?')}`);
await js(`window.__sem.voice.escape(); window.__sem.runOp({ op: 'spec', v: 'grid' }); window.__sem.runOp({ op: 'mode', v: 'se' }); window.__sem.runOp({ op: 'set', k: 'kV', v: 10 }); window.__sem.runOp({ op: 'set', k: 'fov', v: 4 }); for (let i = 0; i < 4; i++) window.__sem.sim.update(0.05); return 1;`);
await shot('sop3_cmd_scale', ['#voiceBubble', '#cmdBar'], 14, `${openBar} ${say('calibrate the magnification')}`);
await js(`window.__sem.voice.escape(); window.__sem.runOp({ op: 'mode', v: 'cl' }); for (let i = 0; i < 6; i++) window.__sem.sim.update(0.05); return 1;`);
await shot('sop3_cmd_cl', ['#voiceBubble', '#cmdBar'], 14, `${openBar} ${say('count the dislocations')}`);

// the agent: the real MCP server, connected from the exhibit
if (!only || 'sop3_panel sop3_cmd_agent'.includes(only) || only.startsWith('sop3')) {
  const mcp = spawn(process.execPath, [join(root, 'tools/semview-mcp/server.mjs')], { stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, SEMVIEW_OUT: join(tmpdir(), 'semview-shots-out') } });
  await sleep(1500);
  await open();
  await js(`document.querySelector('[data-act=agent]').click(); await new Promise((r) => setTimeout(r, 2500)); window.__sem.voice.escape(); return document.querySelector('[data-act=agent]').textContent;`);
  await shot('sop3_panel', ['#shotFrom', '#shotTo'], 10, section('Voice and agent'));
  await shot('sop3_cmd_agent', ['#voiceBubble', '#cmdBar'], 14, `${openBar} ${say('why do we tilt to 70 degrees for EBSD?')}`);
  mcp.kill();
}

// ------------------------------------------------------------------ SOP-04: the Python IDE
await open();
await shot('sop4_buttons', ['.chead'], 6);
await shot('sop4_controls_sec', ['#shotFrom', '#shotTo'], 10, section('Python scripting'));
if (!only || only.startsWith('sop4')) {
  await open('?script=quickstart');
  const ready = `for (let i = 0; i < 120; i++) { const s = document.querySelector('.idestat')?.textContent ?? ''; if (/^Python \\d/.test(s)) break; await new Promise((r) => setTimeout(r, 500)); }`;
  const runIt = `document.querySelector('#ide [data-a=run]').click(); for (let i = 0; i < 240 && /Running/.test(document.querySelector('.idestat').textContent) || i < 4; i++) await new Promise((r) => setTimeout(r, 500));`;
  await js(`${ready} return 1;`);
  await shot('sop4_ide_quickstart', ['#ide'], 4, `${runIt}`);
  await shot('sop4_ide_help', ['#ide'], 4, `document.querySelector('#ide [data-a=help]').click();`);
  await js(`document.querySelector('#ide [data-a=help]').click(); document.querySelector('#ide [data-a=clear]').click(); return 1;`);
  await js(`window.__sem.scriptCore.end_challenge?.(); const sel = document.querySelector('.ideex'); sel.value = 'auto_focus_stig.py'; sel.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 1000)); return 1;`);
  await shot('sop4_ide_auto', ['#ide'], 4, `${runIt}`);
}

ws.close(); chrome.kill(); site.close();
