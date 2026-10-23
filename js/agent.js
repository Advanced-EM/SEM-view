// Agent bridge: connects the exhibit to a local semview-mcp server (tools/semview-mcp) so an AI agent can read the
// microscope, change settings, acquire images and answer the visitor's spoken questions.
//
// It connects only when the visitor clicks "Connect agent", only to the address in config.js (a local server by
// default), and it refuses control while a training task is running so the behavior data stays the visitor's own.

export class AgentBridge {
  // api: { urls (tried in turn), state(), run(ops) → [descriptions], command(text) → {done, ask}, acquire(withData) → {...}, say(text), busy() → reason|null, onStatus(status) }
  constructor(api) { this.api = api; this.ws = null; this.status = 'off'; }
  get connected() { return this.status === 'on'; }

  connect(i = 0) {
    if (this.ws) return;
    const urls = this.api.urls, url = urls[i];
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this.set('error', `Could not open ${url}`); return; }
    this.ws = ws; this.set('connecting');
    ws.onopen = () => { this.url = url; this.set('on'); ws.send(JSON.stringify({ event: 'hello', state: this.api.state() })); };
    ws.onclose = () => {
      const was = this.status; this.ws = null;
      // nothing listening here: try the next address before giving up
      if (was === 'connecting' && i + 1 < urls.length) { this.connect(i + 1); return; }
      this.set(was === 'connecting' ? 'error' : 'off', was === 'connecting' ? `No agent server at ${urls.join(' or ')}. Start semview-mcp from your agent (see tools/semview-mcp).` : '');
    };
    ws.onerror = () => { /* onclose follows */ };
    ws.onmessage = async (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (!m.id || !m.method) return;
      try { ws.send(JSON.stringify({ id: m.id, result: await this.handle(m.method, m.params ?? {}) })); }
      catch (err) { ws.send(JSON.stringify({ id: m.id, error: err.message ?? String(err) })); }
    };
  }
  disconnect() { this.ws?.close(); this.ws = null; this.set('off'); }
  set(status, msg = '') { this.status = status; this.api.onStatus?.(status, msg); }

  async handle(method, p) {
    if (method === 'state') return this.api.state();
    if (method === 'say') { this.api.say(String(p.text ?? '').slice(0, 600)); return { said: true }; }
    // scripts check for themselves whether a training task allows the call (js/scripting.js)
    if (method === 'script') return this.api.script(String(p.call ?? ''), p.args ?? {});
    const busy = this.api.busy();
    if (busy) throw new Error(busy);
    if (method === 'run') {
      if (!Array.isArray(p.ops) || p.ops.length > 12) throw new Error('ops must be a short list');
      return { done: this.api.run(p.ops), state: this.api.state() };
    }
    if (method === 'command') return this.api.command(String(p.text ?? ''));
    if (method === 'acquire') return this.api.acquire(!!p.data);
    if (method === 'analyze') return this.api.analyze(p.name ?? null);
    throw new Error(`unknown method ${method}`);
  }

  // the visitor said something the voice grammar doesn't handle: pass it on
  utterance(text) { if (this.connected) this.ws.send(JSON.stringify({ event: 'utterance', text })); }
}
