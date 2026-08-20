// PACKET TEXT BUDGET — the LEGACY clamp, kept as a compatibility surface.
//
// Phase 0 slice 4, MECHANICAL: the four bodies below are byte-identical to the ones that were in
// packet.js, comment blocks included.
//
// ⛔ THIS IS NOT THE OCCURRENCE CLAMP, AND THE DISTINCTION IS A SAFETY ONE. graph-senior-dev:
//
//   "clampToBudget(text, ...) is an exported compatibility/test surface; production now uses
//    clampOccurrences. It may move to a clearly named compatibility module with re-export, but do
//    not move it into the private occurrence authority as if both mechanisms had equal safety.
//    Deletion is a behavior/API decision, not a structural slice."
//
// So it does NOT go into packet-lists.js. `clampOccurrences` transforms typed occurrences BEFORE
// serialization and depends on the private PARTS map — it cannot forge a list because it never
// holds raw text. This one operates on the rendered STRING, after the fact. Putting them in one
// module would file two mechanisms with different forgery properties under one name, which is
// how the weaker one eventually gets used for the stronger one's job.
//
// ⚠ THE FILE NAME IS WHY THE GATE'S DISCOVERY PATTERN CHANGED. `/^packet(-[a-z]+)?\.js$/`
// allowed one hyphenated segment, so this module would have escaped PACKET_MODULES() entirely —
// no export allowlist, no cycle check, no unsealed-entry check. Found by trying to name the file.
//
// ⚠ ONLY `clampToBudget` IS EXPORTED. The three helpers stay private: exporting them would be the
// "export every moved helper, then allowlist it" pattern dev named as the Phase-0 failure mode.
// The token estimator lives in the input island and is already on its export allowlist. Island to
// island, never island to facade — so this satisfies "authority modules do not import their
// facade" rather than merely avoiding a cycle by luck.
import { esTokens } from './packet-input.js';

// Find the [start, end) line range of a section whose header is `head`
// (e.g. "TESTS:"). The body is the run of `- ` list items (and blank lines)
// following the header. Returns null when the section isn't present.
function findSectionRange(lines, head) {
  const idx = lines.findIndex((l) => l.startsWith(head));
  if (idx === -1) return null;
  let end = idx + 1;
  while (end < lines.length && (lines[end].startsWith('- ') || lines[end] === '')) end += 1;
  return { idx, end };
}

// Tier-1 skeletonize: collapse list items in a section that share a leading
// directory prefix into one summary line, e.g.
//   - src/auth/login.js — anchor
//   - src/auth/logout.js — anchor
//   - src/auth/session.js — anchor
// becomes:
//   - 3 items under src/auth/* (+ first shown) ...
// We keep the first item verbatim (so the agent still has a concrete read) and
// summarize the rest sharing that directory. Returns true when it collapsed
// anything.
function skeletonizeSection(lines, range) {
  const body = lines.slice(range.idx + 1, range.end).filter((l) => l.startsWith('- '));
  if (body.length <= 2) return false;
  // Extract a path-ish token (first whitespace/em-dash-delimited field) per row.
  const dirOf = (line) => {
    const text = line.slice(2).trim();
    const pathTok = text.split(/\s+—\s+|\s+/)[0] ?? '';
    const slash = pathTok.lastIndexOf('/');
    return slash > 0 ? pathTok.slice(0, slash) : null;
  };
  const groups = new Map();
  for (const line of body) {
    const dir = dirOf(line);
    const key = dir ?? `__nodir__:${line}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }
  // Only worth collapsing if at least one dir-group has >= 2 members.
  const collapsible = [...groups.entries()].some(([k, v]) => !k.startsWith('__nodir__:') && v.length >= 2);
  if (!collapsible) return false;

  const newBody = [];
  for (const [key, members] of groups) {
    if (key.startsWith('__nodir__:') || members.length < 2) {
      newBody.push(...members);
      continue;
    }
    // Keep the first member concrete; summarize the rest.
    newBody.push(members[0]);
    newBody.push(`- ${members.length - 1} more under ${key}/* (collapsed — over budget)`);
  }
  lines.splice(range.idx + 1, range.end - (range.idx + 1), ...newBody);
  return true;
}

// Tier-2 collapse: replace a section's body with a single header+count line
// instead of deleting the section, preserving the signal that data exists.
function collapseSectionToCount(lines, head) {
  const range = findSectionRange(lines, head);
  if (!range) return false;
  const count = lines.slice(range.idx + 1, range.end).filter((l) => l.startsWith('- ')).length;
  if (count === 0) return false;
  lines.splice(range.idx, range.end - range.idx, `${head} ${count} omitted (over budget)`);
  return true;
}

export function clampToBudget(text, budgetTokens, targetSection = null) {
  // Skeletonize-before-drop (codegraph #564/#569): size to the answer, not the
  // cap. Three tiers, applied in escalating order, NEVER touching the section
  // that contains the packet target:
  //   Tier-1 — collapse list items sharing a directory prefix into a summary.
  //   Tier-2 — keep header + omitted-count instead of deleting the body.
  //   Tier-3 — drop the section entirely (last rail only).
  const lines = text.split('\n');
  // Priority order: trim the least-load-bearing sections first.
  //
  // ⛔ CLAMPABLE SECTIONS MUST BE BOUNDED KINDS ONLY, AND THAT IS NOW ENFORCED RATHER THAN
  // ASSUMED. skeletonizeSection REWRITES a section's rows into directory summaries. Do that
  // to a CANDIDATES block and its population line — "showing 3 of 9" — would go on describing
  // a row set that no longer exists: a false population claim manufactured by the budget
  // clamp, after the seal had already validated the packet. Nothing prevented it except this
  // array happening not to list a candidate head.
  //
  // ⚠ The clamp runs AFTER serialization by design (validating before it is what retired the
  // false-accusation class), so the seal cannot catch a clamp-introduced lie.
  //
  // ⇒ EVERY ENTRY BELOW MUST BE A BOUNDED KIND — one that makes no population claim. Enforced
  // by tests/unit/query/packet-seal.test.js, which reads this array and checks each head
  // against BOUNDED_KINDS. That test is the guard; I first wrote a runtime .filter() here too
  // and removed it, because mutation showed deleting the filter alone changes nothing
  // observable — it only ever mattered in combination with adding a candidate head, which the
  // test already catches. A safeguard that cannot be falsified on its own is decoration.
  const sectionHeads = ['RISKS:', 'TESTS:', 'CONTRACTS:', 'READ FIRST:'];
  const isTarget = (head) => targetSection && head.startsWith(targetSection);

  if (esTokens(lines.join('\n')) <= budgetTokens) return lines.join('\n');

  // Tier-1: skeletonize every non-target section once.
  for (const head of sectionHeads) {
    if (isTarget(head)) continue;
    const range = findSectionRange(lines, head);
    if (range) skeletonizeSection(lines, range);
    if (esTokens(lines.join('\n')) <= budgetTokens) return lines.join('\n');
  }

  // Tier-2: collapse non-target sections to header+count.
  for (const head of sectionHeads) {
    if (isTarget(head)) continue;
    collapseSectionToCount(lines, head);
    if (esTokens(lines.join('\n')) <= budgetTokens) return lines.join('\n');
  }

  // Tier-3 (last rail): drop non-target sections entirely.
  for (const head of sectionHeads) {
    if (isTarget(head)) continue;
    const range = findSectionRange(lines, head);
    if (!range) continue;
    lines.splice(range.idx, range.end - range.idx, `(${head.slice(0, -1)} dropped — over budget)`);
    if (esTokens(lines.join('\n')) <= budgetTokens) return lines.join('\n');
  }

  return lines.join('\n');
}
