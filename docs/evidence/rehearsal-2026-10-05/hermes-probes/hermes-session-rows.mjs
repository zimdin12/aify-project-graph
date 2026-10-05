// The session_model_usage rows for one hermes session (read-only).
import Database from 'better-sqlite3';
const [dbPath, sid] = process.argv.slice(2);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
for (const r of db.prepare('select task, model, api_call_count, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens from session_model_usage where session_id = ?').all(sid)) console.log(JSON.stringify(r));
const s = db.prepare('select model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, api_call_count, message_count, tool_call_count, cwd, profile_name from sessions where id = ?').get(sid);
console.log('sessions row:', JSON.stringify(s));
db.close();
