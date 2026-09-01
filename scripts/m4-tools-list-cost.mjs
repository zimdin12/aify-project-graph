// M4, first half: what does tools/list actually COST per session?
//
// ⛔ MEASURED FROM THE REAL SERVER, NOT RECONSTRUCTED. selectListedTools is not exported, and a
// reimplementation here would measure my copy of the rule rather than the rule. This spawns the
// shipped server per profile and weighs the bytes it actually returns — the artifact the operation
// uses, not one that resembles it.
//
// CLAIM CEILING. Bytes are EXACT (the response is measured, not modelled). Tokens are an ESTIMATE
// at 4 bytes/token, named as such and never reported as a measurement — no tokenizer was run.
//
// CONTROLS, same pass:
//   POSITIVE — every profile must return a non-empty tool list; a spawn that fails would otherwise
//              report 0 bytes and read as "free".
//   NEGATIVE — an unrecognised profile must fall back to `default`, not to an empty or full list.
import { spawn } from 'node:child_process';

const REPO = 'C:/Docker/aify-project-graph';
const SERVER = `${REPO}/mcp/stdio/server.js`;

function askToolsList(profile) {
  return new Promise((resolve) => {
    const args = [SERVER];
    if (profile) args.push(`--toolset=${profile}`);
    const child = spawn(process.execPath, args, { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { child.kill(); } catch { /* handle */ } resolve(v); } };
    child.stdout.on('data', (b) => {
      out += b.toString('utf8');
      for (const line of out.split('\n')) {
        if (!line.trim().startsWith('{')) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2 && msg.result?.tools) {
            finish({ tools: msg.result.tools, bytes: Buffer.byteLength(JSON.stringify(msg.result), 'utf8') });
          }
        } catch { /* partial line */ }
      }
    });
    child.on('error', () => finish(null));
    setTimeout(() => finish(null), 30000);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'm4-probe', version: '0' } } })}\n`);
    setTimeout(() => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
    }, 400);
  });
}

const rows = [];
for (const profile of ['default', 'full', 'lean', 'code-intel', 'not-a-real-profile']) {
  const r = await askToolsList(profile);
  if (!r) { console.log(`${profile.padEnd(20)} VOID — no tools/list response`); rows.push({ profile, void: true }); continue; }
  const schemaBytes = r.tools.reduce((n, t) => n + Buffer.byteLength(JSON.stringify(t.inputSchema ?? {}), 'utf8'), 0);
  const descBytes = r.tools.reduce((n, t) => n + Buffer.byteLength(String(t.description ?? ''), 'utf8'), 0);
  rows.push({ profile, count: r.tools.length, bytes: r.bytes, schemaBytes, descBytes });
  console.log(`${profile.padEnd(20)} tools=${String(r.tools.length).padStart(3)}  bytes=${String(r.bytes).padStart(7)}`
    + `  ~tokens=${String(Math.round(r.bytes / 4)).padStart(6)}`
    + `  schema=${String(Math.round(100 * schemaBytes / r.bytes)).padStart(2)}%`
    + `  desc=${String(Math.round(100 * descBytes / r.bytes)).padStart(2)}%`);
}

// ── CONTROLS ────────────────────────────────────────────────────────────────────────────────
const byName = Object.fromEntries(rows.filter((r) => !r.void).map((r) => [r.profile, r]));
console.log('\nPOSITIVE CONTROL: every profile returned a non-empty list?',
  rows.every((r) => !r.void && r.count > 0) ? 'YES' : 'NO — a zero here would read as "free"');
const fallback = byName['not-a-real-profile'];
const dflt = byName.default;
console.log('NEGATIVE CONTROL: an unknown profile falls back to `default`?',
  fallback && dflt && fallback.count === dflt.count ? `YES (${fallback.count} tools, same as default)` : 'NO');
if (dflt && byName.full) {
  console.log(`\nDEFAULT vs FULL: ${dflt.count} vs ${byName.full.count} tools, `
    + `${dflt.bytes} vs ${byName.full.bytes} bytes `
    + `(default is ${Math.round(100 * dflt.bytes / byName.full.bytes)}% of full)`);
}
