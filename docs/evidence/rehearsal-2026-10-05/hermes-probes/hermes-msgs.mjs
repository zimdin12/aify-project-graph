// The messages of one hermes session: role, tool name, tool calls and content (truncated), plus the APG-name count in
// tool RESULTS (the harness record, not the model's reply). Read-only.
import Database from 'better-sqlite3';
const [dbPath, sid] = process.argv.slice(2);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const rows = db.prepare('select role, tool_name, tool_calls, content from messages where session_id = ? order by id').all(sid);
db.close();
const APG = /aify_project_graph|graph_[a-z]+|code_intel_[a-z]+/giu;
let inResults = 0;
for (const r of rows) {
  if (r.role === 'tool') inResults += (String(r.content ?? '').match(APG) ?? []).length;
  console.log(`${r.role}${r.tool_name ? ` [${r.tool_name}]` : ''}: calls=${String(r.tool_calls ?? '').slice(0, 160)} | ${String(r.content ?? '').replace(/\s+/gu, ' ').slice(0, 200)}`);
}
console.log(JSON.stringify({ session: sid, messages: rows.length, toolMessages: rows.filter((r) => r.role === 'tool').length, apgNamesInToolResults: inResults }));
