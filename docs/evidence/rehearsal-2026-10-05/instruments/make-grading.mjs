// Grading bundles for the rehearsal's 8 preregistered runs: each run under a random code, as a readable transcript plus
// its patch, with the ARM masked (roots, agent ids, project ids). The runtime stays visible: it is not the allocation.
// Usage: node make-grading.mjs <out-dir>  -> <out-dir>/R1..R8/{transcript.md,patch.diff}; the key goes to grading-key.json
// HERE (scratchpad), never into <out-dir>.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { callsInRow } from 'file:///C:/Docker/aify-project-graph/scripts/lib/hermes-layer-use.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: make-grading.mjs <out-dir>'); process.exit(2); }
const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1');
const IDS = ['claude-a-t1', 'claude-b-t1', 'hermes-a-t1', 'hermes-b-t1', 'claude-a-t2', 'claude-b-t2', 'hermes-a-t2', 'hermes-b-t2'].map((s) => `rh-${s}`);
const PROJECTS = ['01M454E43N0HCV24CTXK7W31B3', '01M454E43ZRMR399HKST6M9TMR', '01M454EKAWMMR7FNNGY63BQTX2'];
const CUT = 1500;

/** Every arm-identifying string replaced by a neutral one. PURE. */
function mask(text) {
  let t = String(text ?? '');
  t = t.replace(/[A-Za-z]:?[\\/]+(?:\\\\)?Docker[\\/]+(?:\\\\)?aify-trial-arms[\\/]+(?:\\\\)?[AB](?=[\\/])/giu, '<ARMS>/<ARM>');
  t = t.replace(/aify-trial-arms[\\/]+[AB]\b/giu, 'aify-trial-arms/<ARM>');
  t = t.replace(/C--Docker-aify-trial-arms-[AB]-/giu, 'C--Docker-aify-trial-arms-<ARM>-');
  t = t.replace(/rh-(?:claude|hermes)-[ab]-t[12]p?/giu, '<AGENT>');
  for (const p of PROJECTS) t = t.replaceAll(p, '<PROJECT-ID>');
  return t;
}
const cut = (s) => { const t = String(s ?? ''); return t.length > CUT ? `${t.slice(0, CUT)}\n…[${t.length - CUT} more chars cut]` : t; };

function claudeTranscript(dir) {
  const out = [];
  for (const line of readFileSync(`${dir}/stream.jsonl`, 'utf8').split('\n').filter(Boolean)) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.type === 'result') { out.push(`### FINAL\n${r.result ?? ''}`); continue; }
    for (const c of r.message?.content ?? []) {
      if (c.type === 'text' && r.type === 'assistant') out.push(`### assistant\n${c.text}`);
      if (c.type === 'tool_use') out.push(`### tool call: ${c.name}\n\`\`\`\n${cut(JSON.stringify(c.input, null, 1))}\n\`\`\``);
      if (c.type === 'tool_result') {
        const body = typeof c.content === 'string' ? c.content : (c.content ?? []).map((x) => x.text ?? '').join('');
        out.push(`### tool result${c.is_error ? ' (error)' : ''}\n\`\`\`\n${cut(body)}\n\`\`\``);
      }
    }
  }
  return out.join('\n\n');
}

function hermesTranscript(dir) {
  const out = [];
  for (const r of JSON.parse(readFileSync(`${dir}/rows.json`, 'utf8'))) {
    if (r.role === 'user') continue;
    if (r.role === 'assistant') {
      if (r.content) out.push(`### assistant\n${r.content}`);
      if (r.tool_calls) for (const c of callsInRow(r).calls ?? []) out.push(`### tool call: ${c.name}\n\`\`\`\n${cut(JSON.stringify(c.input, null, 1))}\n\`\`\``);
    }
    if (r.role === 'tool') out.push(`### tool result: ${r.tool_name}\n\`\`\`\n${cut(r.content)}\n\`\`\``);
  }
  const final = readFileSync(`${dir}/out.txt`, 'utf8').replace(/\nShell cwd was reset to .*$/su, '').trim();
  out.push(`### FINAL\n${final}`);
  return out.join('\n\n');
}

if (existsSync(`${HERE}grading-key.json`)) { console.error('grading-key.json exists; refusing to overwrite the allocation key'); process.exit(3); }
const order = [...IDS];
for (let i = order.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
const key = {};
order.forEach((id, i) => {
  const code = `R${i + 1}`;
  const dir = `${HERE}runs/${id}`;
  const meta = JSON.parse(readFileSync(`${dir}/meta.json`, 'utf8'));
  key[code] = id;
  mkdirSync(`${OUT}/${code}`, { recursive: true });
  const body = meta.runtime === 'claude' ? claudeTranscript(dir) : hermesTranscript(dir);
  writeFileSync(`${OUT}/${code}/transcript.md`, mask(`# ${code} — runtime: ${meta.runtime}, task: ${meta.task}\n\n${body}\n`));
  writeFileSync(`${OUT}/${code}/patch.diff`, mask(readFileSync(`${dir}/patch.diff`, 'utf8')));
});
writeFileSync(`${HERE}grading-key.json`, JSON.stringify(key, null, 1));
console.log(`wrote ${order.length} bundles to ${OUT}; key kept in scratchpad`);
