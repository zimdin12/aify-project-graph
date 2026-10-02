// Where one Claude Code session's records live on disk, and reading them whole or not at all.
//
// A session is `<projects>/<encoded cwd>/<id>.jsonl`, and each subagent it spawned is
// `<projects>/<encoded cwd>/<id>/subagents/agent-*.jsonl` (measured 2026-10-02, Claude Code 2.1.287). The directory
// is FOUND by the session id rather than derived from the cwd, so this does not copy the harness's path encoding,
// which is the harness's to change.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

/**
 * Parse a JSONL text. ⛔ A line that does not parse makes the whole file unreadable: a run whose transcript cannot be
 * parsed is VOID under the trial's protocol, never a run with fewer calls.
 */
export function parseJsonl(text, label) {
  const records = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue;
    try {
      records.push(JSON.parse(lines[i]));
    } catch {
      return { ok: false, reason: 'unparseable_line', detail: `${label}:${i + 1}` };
    }
  }
  return { ok: true, records };
}

/**
 * The records of one session and of every subagent it spawned, or a refusal.
 * @returns {{ ok: true, session: object[], subagents: object[][], files: string[] } | { ok: false, reason, detail }}
 */
export function readClaudeSession(sessionId, { projectsDir = DEFAULT_PROJECTS_DIR } = {}) {
  if (!/^[0-9a-f-]{36}$/u.test(String(sessionId))) {
    return { ok: false, reason: 'bad_session_id', detail: String(sessionId) };
  }
  const homes = readdirSync(projectsDir).filter((d) => existsSync(join(projectsDir, d, `${sessionId}.jsonl`)));
  if (homes.length !== 1) {
    return { ok: false, reason: homes.length === 0 ? 'session_not_found' : 'session_ambiguous', detail: homes };
  }
  const base = join(projectsDir, homes[0]);
  const sessionFile = join(base, `${sessionId}.jsonl`);
  const subDir = join(base, sessionId, 'subagents');
  const subFiles = existsSync(subDir)
    ? readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).sort().map((f) => join(subDir, f))
    : [];

  const session = parseJsonl(readFileSync(sessionFile, 'utf8'), sessionFile);
  if (!session.ok) return session;
  const subagents = [];
  for (const file of subFiles) {
    const parsed = parseJsonl(readFileSync(file, 'utf8'), file);
    if (!parsed.ok) return parsed;
    subagents.push(parsed.records);
  }
  return { ok: true, session: session.records, subagents, files: [sessionFile, ...subFiles] };
}
