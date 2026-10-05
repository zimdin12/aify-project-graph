// Did a Claude run's session hold the bridge instructions, and what did the run do? Read-only.
// Usage: node check-instructions.mjs <run-id> [<run-id> ...]
import { readFileSync, existsSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1');
const PROJECTS = 'C:/Users/Administrator/.claude/projects';
const NEEDLE = 'aify-dashboard holds the shared record';
for (const id of process.argv.slice(2)) {
  const meta = JSON.parse(readFileSync(`${HERE}runs/${id}/meta.json`, 'utf8'));
  const slug = meta.root.replace(/[:/\\]/gu, '-');
  const file = `${PROJECTS}/${slug}/${meta.sessionId}.jsonl`;
  const session = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const stream = readFileSync(`${HERE}runs/${id}/stream.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const uses = stream.flatMap((r) => r.message?.content ?? []).filter((c) => c.type === 'tool_use').map((c) => c.name);
  const text = stream.filter((r) => r.type === 'assistant').flatMap((r) => r.message.content).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
  console.log(JSON.stringify({
    id, sessionFile: session !== null, instructionsInSession: session === null ? null : session.split(NEEDLE).length - 1,
    toolSearch: uses.filter((u) => u === 'ToolSearch').length, dashboardCalls: uses.filter((u) => /dashboard_/u.test(u)).length,
    mentionsDashboard: /dashboard/iu.test(text), tools: uses.join(' '),
  }));
}
