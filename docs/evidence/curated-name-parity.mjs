// Does every CURATED tool-name string exist in the TOOLS registry?
//
// The mirror of dashboard-manager's `dashboard_state_save`: a name in a hand-maintained list that does
// not exist in the registry. Here it fails SILENTLY rather than loudly — `selectListedTools` does
// `TOOLS.filter(t => SET.has(t.name))`, so a misspelled name is simply dropped and the profile
// advertises fewer verbs than intended with no error anywhere.
import { readFileSync } from 'node:fs';

// PORTABLE BY CONSTRUCTION: the repo root is derived from this file's own location, never hardcoded.
// The first version of this probe carried an absolute `C:/Docker/...` path, which made "rerunnable"
// true on exactly one machine at exactly one checkout — a rederivability claim that was false the
// moment anyone else cloned it.
const repo = new URL('../..', import.meta.url);
const { TOOLS } = await import(new URL('mcp/stdio/tools/schema.js', repo));
const { HIDDEN_FULL_TOOL_NAMES } = await import(new URL('mcp/stdio/hidden-tools.js', repo));
const real = new Set(TOOLS.map((t) => t.name));
const src = readFileSync(new URL('mcp/stdio/server.js', repo), 'utf8');

function setNames(constName) {
  const re = new RegExp(`${constName}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`);
  const m = src.match(re);
  if (!m) return null;
  return [...new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))];
}

const sets = {
  LEAN_TOOL_NAMES: setNames('LEAN_TOOL_NAMES'),
  CODE_INTEL_TOOL_NAMES: setNames('CODE_INTEL_TOOL_NAMES'),
  MUTATING_TOOLS: setNames('MUTATING_TOOLS'),
  HIDDEN_FULL_TOOL_NAMES: [...HIDDEN_FULL_TOOL_NAMES],
};

console.log(`registry: ${real.size} tool names`);
let bad = 0;
let extractionOk = true;
for (const [k, v] of Object.entries(sets)) {
  if (!v || v.length === 0) {
    console.log(`  ?? ${k} — extraction found nothing; NOT a pass, the probe is blind here`);
    extractionOk = false;
    continue;
  }
  const absent = v.filter((n) => !real.has(n));
  bad += absent.length;
  console.log(`  ${absent.length ? '⛔' : 'ok'} ${k.padEnd(24)} names ${String(v.length).padStart(3)}`
    + `  absent-from-TOOLS ${absent.length}${absent.length ? '  ' + JSON.stringify(absent) : ''}`);
}
console.log('');
console.log(`TOTAL curated names absent from TOOLS: ${bad}`);
console.log(`POSITIVE CONTROL  every set extracted at least one name: ${extractionOk}`);
console.log(`POSITIVE CONTROL  a known real name is in the registry: ${real.has('graph_health')}`);
console.log(`NEGATIVE CONTROL  a fabricated name reports absent: ${!real.has('graph_zzq_fake')}`);
