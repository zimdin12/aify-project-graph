// P0-5 — C++ virtual-override edge synthesizer (static, no clangd).
//
// WHY: clangd resolves a `base*->virt()` callsite to the *declared* base
// type's method, not the runtime overrides. Game engines are vtable-heavy
// (echoes `ISimDomain` has ~15 pure-virtual methods, implemented by
// `WorldBufferDomain`; renderer/system interfaces follow the same shape).
// Today a trace/impact through a base virtual dead-ends. This synthesizer
// closes that flow by linking each base virtual method to the derived
// overrides so traversal continues.
//
// DOCTRINE: partial dynamic-dispatch coverage is WORSE than none. We emit a
// COMPLETE override set per class (every matched base method, capped only to
// avoid pathological blowups, and the cap is reported), and we tag every edge
// `provenance:'INFERRED'` so it NEVER masquerades as ground truth. The
// The clangd-verified path is `code_intel_hierarchy kind=subtypes` on the
// OWNING CLASS (returns derived classes; their same-named methods are the
// overrides) — NOT on the method: validated on real clangd, kind=subtypes on a
// method resolves to its return type, not its overrides. kind=callers on the
// virtual method is the other verified angle. These INFERRED edges are the
// static best-effort backstop that exists even without a clangd collection.
//
// INTEGRATION: unlike the filesystem-scanning shader bridge, this needs the
// resolved graph (Method nodes + EXTENDS/IMPLEMENTS edges). So it runs as a
// post-resolution DB pass in the freshness orchestrator (alongside
// detectCommunities) rather than the pre-extract framework plugin pass.
//
// EDGE shape:
//   relation:   'OVERRIDDEN_BY'   (A::m -> B::m, FROM base virtual TO override)
//   provenance: 'INFERRED'
//   confidence: 0.7
//   source_file: ''  (so per-file deleteEdgesByFile() never reaps it; the
//                     synthesizer fully rebuilds the set each index instead)
//   extractor:  'virtual-overrides'
//
// The OVERRIDDEN_BY edge's `extra` is not a column on the edges table, so the
// {synthesized, base, derived} context is carried via the deterministic
// edge identity (from_id/to_id/relation) plus the extractor tag. Verbs that
// surface it read the override flavor from extractor='virtual-overrides'.

export const OVERRIDDEN_BY_RELATION = 'OVERRIDDEN_BY';
export const VIRTUAL_OVERRIDE_EXTRACTOR = 'virtual-overrides';

// C-family languages only for now. Both target games are C++. Cheap to extend
// to Java/C# later by widening this set (override semantics are the same
// "derived method with the same leaf name overrides a base virtual"), but we
// scope to the languages we can validate.
const CPP_FAMILY_LANGUAGES = new Set(['cpp', 'c']);

// Walk up the inheritance chain at most this many hops. Guards against
// pathological / cyclic EXTENDS graphs and keeps the per-class work bounded.
const MAX_INHERITANCE_DEPTH = 5;

// Cap overrides emitted per base method. A base virtual implemented by 100s of
// derived classes (rare, but possible in a plugin-heavy engine) would blow up
// the edge table; we keep the first N and flag that the set was capped.
const MAX_OVERRIDES_PER_BASE_METHOD = 50;

// Parse a parameter-arity hint from a stored signature string. Signatures look
// like `glm::vec3 gravityDirection() const` or
// `void registerChunks(std::span<const DomainChunkKey> chunks)`. We want a
// cheap arity (number of top-level comma-separated params) to prefer a
// signature/arity match over a bare name match when both base and derived
// expose a signature. Returns null when we can't confidently parse params
// (then the caller falls back to name-only matching — never fabricates).
function paramArity(signature) {
  if (!signature || typeof signature !== 'string') return null;
  const open = signature.indexOf('(');
  if (open < 0) return null;
  // Find the matching close paren for the first '(' (params list), respecting
  // nested template/parameter parens & angle brackets so
  // `f(std::span<const X>)` counts as arity 1, not 0.
  let depthParen = 0;
  let depthAngle = 0;
  let close = -1;
  for (let i = open; i < signature.length; i += 1) {
    const ch = signature[i];
    if (ch === '(') depthParen += 1;
    else if (ch === ')') {
      depthParen -= 1;
      if (depthParen === 0) { close = i; break; }
    } else if (ch === '<') depthAngle += 1;
    else if (ch === '>') depthAngle = Math.max(0, depthAngle - 1);
  }
  if (close < 0) return null;
  const inner = signature.slice(open + 1, close).trim();
  if (inner === '' || inner === 'void') return 0;
  // Count top-level commas (ignore commas inside <...>, (...), or [...]).
  let arity = 1;
  let a = 0; // angle depth
  let p = 0; // paren depth
  let b = 0; // bracket depth
  for (const ch of inner) {
    if (ch === '<') a += 1;
    else if (ch === '>') a = Math.max(0, a - 1);
    else if (ch === '(') p += 1;
    else if (ch === ')') p = Math.max(0, p - 1);
    else if (ch === '[') b += 1;
    else if (ch === ']') b = Math.max(0, b - 1);
    else if (ch === ',' && a === 0 && p === 0 && b === 0) arity += 1;
  }
  return arity;
}

// Strip a trailing `const`/`noexcept`/`override`/`final` qualifier soup so two
// const-overloaded methods (`fastForwardHook(...) const` vs non-const) are
// distinguishable by const-ness. We fold const-ness into the match key because
// C++ allows const/non-const overloads of the same name+arity (echoes'
// `fastForwardHook` is exactly this case).
function isConstQualified(signature) {
  if (!signature || typeof signature !== 'string') return false;
  const close = signature.lastIndexOf(')');
  if (close < 0) return false;
  return /\bconst\b/.test(signature.slice(close + 1));
}

// Build the match key for a method. When a signature with parseable params is
// available we key on `name/arity[/const]` (signature-ish match). Otherwise we
// key on the bare leaf name (name-only fallback). The base and derived must
// produce the SAME key to be considered an override — this is the C++
// override-detection rule (same name in a derived class overriding a base
// virtual), tightened with arity/const-ness when we can read them.
function methodMatchKeys(method) {
  const name = method.label;
  if (!name) return [];
  const arity = paramArity(method.signature);
  const keys = [`name:${name}`];
  if (arity !== null) {
    const constTag = isConstQualified(method.signature) ? ':const' : '';
    keys.push(`sig:${name}/${arity}${constTag}`);
  }
  return keys;
}

// Pick the best derived↔base method pairing key. Prefer signature key when
// BOTH endpoints expose one; fall back to name-only otherwise. Returns the key
// string the two methods agree on, or null when they don't match at all.
function overrideKeyFor(baseMethod, derivedMethod) {
  if (baseMethod.label !== derivedMethod.label) return null;
  const baseKeys = new Set(methodMatchKeys(baseMethod));
  const derivedKeys = methodMatchKeys(derivedMethod);
  // Prefer the signature-qualified key (it's listed after the name key).
  const sigBase = [...baseKeys].find((k) => k.startsWith('sig:'));
  const sigDerived = derivedKeys.find((k) => k.startsWith('sig:'));
  if (sigBase && sigDerived) {
    return sigBase === sigDerived ? sigBase : null;
  }
  // One or both lack a parseable signature → fall back to name match.
  return `name:${baseMethod.label}`;
}

// Load every class-like node and its CONTAINS'd Method members from the DB,
// keyed by class id. Only Method nodes (the override targets) are collected —
// fields/nested types are irrelevant here.
function loadClassMethods(db) {
  const rows = db.all(`
    SELECT e.from_id AS class_id,
           n.id AS method_id,
           n.label AS label,
           n.language AS language,
           n.file_path AS file_path,
           json_extract(n.extra, '$.signature') AS signature
    FROM edges e
    JOIN nodes n ON n.id = e.to_id
    JOIN nodes c ON c.id = e.from_id
    WHERE e.relation = 'CONTAINS'
      AND n.type = 'Method'
      AND c.type IN ('Class', 'Interface', 'Type')
  `);
  const byClass = new Map();
  for (const r of rows) {
    let list = byClass.get(r.class_id);
    if (!list) { list = []; byClass.set(r.class_id, list); }
    list.push({
      id: r.method_id,
      label: r.label,
      language: r.language,
      file_path: r.file_path,
      signature: r.signature ?? '',
    });
  }
  return byClass;
}

// Map each class id -> its direct base class ids (EXTENDS + IMPLEMENTS), and
// each class id -> its language. Only class-like → class-like edges count.
function loadInheritance(db) {
  const rows = db.all(`
    SELECT e.from_id AS derived_id, e.to_id AS base_id,
           d.language AS derived_lang
    FROM edges e
    JOIN nodes d ON d.id = e.from_id
    JOIN nodes b ON b.id = e.to_id
    WHERE e.relation IN ('EXTENDS', 'IMPLEMENTS')
      AND d.type IN ('Class', 'Interface', 'Type')
      AND b.type IN ('Class', 'Interface', 'Type')
  `);
  const basesOf = new Map();   // derived_id -> Set(base_id)
  const langOf = new Map();     // class_id -> language
  for (const r of rows) {
    let set = basesOf.get(r.derived_id);
    if (!set) { set = new Set(); basesOf.set(r.derived_id, set); }
    set.add(r.base_id);
    if (r.derived_lang) langOf.set(r.derived_id, r.derived_lang);
  }
  return { basesOf, langOf };
}

// Collect transitive base classes of `derivedId`, up to MAX_INHERITANCE_DEPTH
// hops, cycle-safe. Returns base ids in nearest-first order (so a method
// overridden through a deep chain still finds its declaring ancestor).
function transitiveBases(derivedId, basesOf) {
  const out = [];
  const seen = new Set([derivedId]);
  let frontier = [...(basesOf.get(derivedId) ?? [])];
  let depth = 0;
  while (frontier.length > 0 && depth < MAX_INHERITANCE_DEPTH) {
    const next = [];
    for (const baseId of frontier) {
      if (seen.has(baseId)) continue;
      seen.add(baseId);
      out.push(baseId);
      for (const grand of (basesOf.get(baseId) ?? [])) {
        if (!seen.has(grand)) next.push(grand);
      }
    }
    frontier = next;
    depth += 1;
  }
  return out;
}

/**
 * Synthesize C++ virtual-override OVERRIDDEN_BY edges into the DB.
 *
 * Pure DB-in / DB-out. Idempotent: clears every prior OVERRIDDEN_BY edge from
 * this extractor and rebuilds the complete set from the current graph, so a
 * removed override doesn't leave a stale edge behind. INSERT OR IGNORE on the
 * (from_id,to_id,relation) unique index makes re-runs safe.
 *
 * @returns {{ edges: number, basesWithOverrides: number, cappedBaseMethods: number }}
 */
export function synthesizeVirtualOverrides(db, { upsertEdge, deleteEdgesFrom } = {}) {
  if (typeof upsertEdge !== 'function') {
    throw new Error('synthesizeVirtualOverrides requires an upsertEdge(db, edge) function');
  }

  // Clear the prior synthesized set so stale overrides never linger. These
  // edges carry source_file='' (survive per-file reindex), so the only owner
  // that may delete them is this synthesizer. Delete by relation + extractor.
  db.run(
    `DELETE FROM edges WHERE relation = $relation AND extractor = $extractor`,
    { relation: OVERRIDDEN_BY_RELATION, extractor: VIRTUAL_OVERRIDE_EXTRACTOR },
  );

  const methodsByClass = loadClassMethods(db);
  const { basesOf } = loadInheritance(db);
  if (basesOf.size === 0) {
    return { edges: 0, basesWithOverrides: 0, cappedBaseMethods: 0 };
  }

  // base method id -> count of overrides already emitted (for the cap).
  const overrideCount = new Map();
  const basesWithOverrides = new Set();
  let cappedBaseMethods = 0;
  let edgeCount = 0;
  const capped = new Set();

  for (const [derivedId, derivedMethods] of methodsByClass) {
    if (!basesOf.has(derivedId)) continue; // no base → nothing to override
    const bases = transitiveBases(derivedId, basesOf);
    if (bases.length === 0) continue;

    for (const derivedMethod of derivedMethods) {
      // Language-gate: C-family only. Skip non-cpp/c derived methods.
      if (derivedMethod.language && !CPP_FAMILY_LANGUAGES.has(derivedMethod.language)) continue;

      // Find the NEAREST base that declares a matching method. "Nearest wins"
      // so an override is attributed to the closest ancestor that declares the
      // virtual (matches C++ override resolution and avoids double-linking a
      // grandparent when the parent also declares it).
      let matchedBaseMethod = null;
      for (const baseId of bases) {
        const baseMethods = methodsByClass.get(baseId);
        if (!baseMethods) continue;
        const candidate = baseMethods.find((bm) => {
          if (bm.language && !CPP_FAMILY_LANGUAGES.has(bm.language)) return false;
          return overrideKeyFor(bm, derivedMethod) !== null;
        });
        if (candidate) { matchedBaseMethod = candidate; break; }
      }

      // No matching base method → NOT an override. Skip; never fabricate.
      if (!matchedBaseMethod) continue;
      // Both endpoints must be real Method nodes (they are — loaded from
      // nodes table) and distinct (a class never overrides itself).
      if (matchedBaseMethod.id === derivedMethod.id) continue;

      const already = overrideCount.get(matchedBaseMethod.id) ?? 0;
      if (already >= MAX_OVERRIDES_PER_BASE_METHOD) {
        if (!capped.has(matchedBaseMethod.id)) {
          capped.add(matchedBaseMethod.id);
          cappedBaseMethods += 1;
        }
        continue;
      }

      upsertEdge(db, {
        from_id: matchedBaseMethod.id,
        to_id: derivedMethod.id,
        relation: OVERRIDDEN_BY_RELATION,
        // Empty source_file: this edge spans two files and is owned by the
        // synthesizer, not by any single file's extraction. Keeping it ''
        // means deleteEdgesByFile() during incremental reindex won't reap it.
        source_file: '',
        source_line: 0,
        confidence: 0.7,
        provenance: 'INFERRED',
        extractor: VIRTUAL_OVERRIDE_EXTRACTOR,
      });
      overrideCount.set(matchedBaseMethod.id, already + 1);
      basesWithOverrides.add(matchedBaseMethod.id);
      edgeCount += 1;
    }
  }

  return {
    edges: edgeCount,
    basesWithOverrides: basesWithOverrides.size,
    cappedBaseMethods,
  };
}
