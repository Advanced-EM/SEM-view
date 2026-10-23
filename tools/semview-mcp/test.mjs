// Test the MCP server as an agent would: list tools, simulate headless, drive the twin; with --live, also an open exhibit.
//   node test.mjs            headless only
//   node test.mjs --live     then open the exhibit and click "Connect agent" within 90 s
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'semview-'));
const client = new Client({ name: 'semview-test', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [new URL('./server.mjs', import.meta.url).pathname], env: { ...process.env, SEMVIEW_OUT: out, SEMVIEW_PORT: process.env.SEMVIEW_PORT ?? '8792' }, stderr: 'inherit' }));
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
const body = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

const { tools } = await client.listTools();
ok(tools.length === 10, `10 tools: ${tools.map((t) => t.name).join(', ')}`);

let r = await client.callTool({ name: 'simulate', arguments: { mode: 'bse', specimen: 'ni', kV: 15, analysis: 'auto' } });
const sim = JSON.parse(body(r));
ok(!r.isError && existsSync(sim.file) && sim.arrays.segment_A, `simulate wrote ${sim.file.split('/').pop()} (${Object.keys(sim.arrays).join(', ')}); ${sim.analysis?.summary}`);
r = await client.callTool({ name: 'twin', arguments: { call: 'challenge', args: { id: 'sem-aperture-align', seed: 4 } } });
ok(!r.isError && JSON.parse(body(r)).id === 'sem-aperture-align', 'twin challenge started');
r = await client.callTool({ name: 'twin', arguments: { call: 'score' } });
ok(!r.isError && JSON.parse(body(r)).offset_um > 5, `twin score before: ${JSON.parse(body(r)).offset_um} µm off axis`);
r = await client.callTool({ name: 'twin', arguments: { call: 'acquire' } });
ok(!r.isError && existsSync(JSON.parse(body(r)).file), 'twin acquire saved an .npz');
r = await client.callTool({ name: 'exhibit_set', arguments: { mode: 'bse' } });
ok(r.isError && /No exhibit is connected/.test(body(r)), 'exhibit_set without an exhibit explains how to connect');

if (process.argv.includes('--live')) {
  console.log('waiting up to 90 s for the exhibit to connect…');
  let st;
  for (let i = 0; i < 90; i++) { st = JSON.parse(body(await client.callTool({ name: 'exhibit_status', arguments: {} }))); if (st.connected) break; await new Promise((s) => setTimeout(s, 1000)); }
  ok(st.connected, `exhibit connected: ${st.mode} on ${st.specimen_name}`);
  r = await client.callTool({ name: 'exhibit_set', arguments: { specimen: 'ni', mode: 'bse', kV: 15 } });
  ok(!r.isError && /nickel/i.test(body(r)), `exhibit_set: ${JSON.parse(body(r)).done.join(' · ')}`);
  r = await client.callTool({ name: 'exhibit_command', arguments: { text: 'zoom in and acquire' } });
  ok(!r.isError && JSON.parse(body(r)).understood, `exhibit_command: ${JSON.parse(body(r)).done?.join(' · ')}`);
  r = await client.callTool({ name: 'exhibit_acquire', arguments: { save: true } });
  const saved = JSON.parse(r.content.at(-1).text).saved;
  ok(!r.isError && r.content.some((c) => c.type === 'image') && existsSync(saved.npz), `exhibit_acquire: image + ${saved.npz.split('/').pop()}`);
  r = await client.callTool({ name: 'exhibit_analyze', arguments: { name: 'reconstruct_relief' } });
  ok(!r.isError, `exhibit_analyze: ${JSON.parse(body(r)).summary}`);
  r = await client.callTool({ name: 'exhibit_say', arguments: { text: 'This is nickel in backscattered electrons: the grains differ by channelling contrast.' } });
  ok(!r.isError, 'exhibit_say');
}
await client.close();
