import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';

export class LspClient extends EventEmitter {
  constructor({ command, args = [], cwd, env, rootUri, timeoutMs = 10000 }) {
    super();
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.rootUri = rootUri || `file:///`;
    this.timeoutMs = timeoutMs;
    this.proc = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.diagnostics = new Map();
    this.started = false;
  }

  async start() {
    this.proc = spawn(this.command, this.args, { cwd: this.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', chunk => this._onData(chunk));
    this.proc.stderr.on('data', chunk => this.emit('stderr', chunk.toString('utf8')));
    this.proc.on('exit', code => this.emit('exit', code));
    this.proc.on('error', err => this.emit('error', err));

    const initResult = await this._request('initialize', {
      processId: process.pid,
      rootUri: this.rootUri,
      capabilities: {
        textDocument: {
          synchronization: { didOpen: true, didClose: true },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
          documentSymbol: { dynamicRegistration: false },
          publishDiagnostics: {}
        }
      }
    });
    this._notify('initialized', {});
    this.serverCapabilities = initResult?.capabilities || {};
    this.started = true;
    return initResult;
  }

  async shutdown() {
    if (!this.started) return;
    try {
      await this._request('shutdown', null);
      this._notify('exit', null);
    } catch { /* swallow */ }
    if (this.proc && !this.proc.killed) {
      try { this.proc.kill(); } catch { /* ignore */ }
    }
    this.started = false;
  }

  async didOpen(uri, languageId, text, version = 1) {
    return this._notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version, text }
    });
  }

  async didClose(uri) {
    return this._notify('textDocument/didClose', { textDocument: { uri } });
  }

  async references(uri, position, includeDeclaration = false) {
    return this._request('textDocument/references', {
      textDocument: { uri }, position, context: { includeDeclaration }
    });
  }

  async definition(uri, position) {
    return this._request('textDocument/definition', { textDocument: { uri }, position });
  }

  async hover(uri, position) {
    return this._request('textDocument/hover', { textDocument: { uri }, position });
  }

  async documentSymbol(uri) {
    return this._request('textDocument/documentSymbol', { textDocument: { uri } });
  }

  diagnosticsFor(uri) {
    return this.diagnostics.get(uri) || [];
  }

  _request(method, params) {
    const id = this.nextId++;
    const message = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request '${method}' timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this._send(message);
    });
  }

  _notify(method, params) {
    this._send({ jsonrpc: '2.0', method, params });
  }

  _send(message) {
    const json = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
    this.proc.stdin.write(header + json);
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd).toString('utf8');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) { this.buffer = this.buffer.slice(headerEnd + 4); continue; }
      const len = parseInt(m[1], 10);
      if (this.buffer.length < headerEnd + 4 + len) return;
      const body = this.buffer.slice(headerEnd + 4, headerEnd + 4 + len).toString('utf8');
      this.buffer = this.buffer.slice(headerEnd + 4 + len);
      try { this._handle(JSON.parse(body)); } catch { /* swallow */ }
    }
  }

  _handle(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'LSP error'));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'textDocument/publishDiagnostics') {
      const uri = msg.params?.uri;
      const diags = msg.params?.diagnostics || [];
      if (uri) this.diagnostics.set(uri, diags);
    }
  }
}
