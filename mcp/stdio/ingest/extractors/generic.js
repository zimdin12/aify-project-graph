import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { dependencyFingerprint, structuralFingerprint } from '../fingerprint.js';
import { nodeText, parseSource } from '../walker.js';
import { codeSymbolSiteId, siteKindOf, siteSpanOf } from '../identity/code-symbol-site-id.js';

function stableId(parts) {
  return createHash('sha1').update(parts.join('::')).digest('hex');
}

function lineNumber(node) {
  return node ? node.startPosition.row + 1 : 0;
}

function endLineNumber(node) {
  return node ? node.endPosition.row + 1 : 0;
}

function moduleNameForPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const withoutExt = normalized.slice(0, normalized.length - extname(normalized).length);
  return withoutExt
    .replace(/\/__(init|main)$/u, '')
    .replace(/\/index$/u, '')
    .replace(/\//g, '.');
}

function normalizeImportTarget(text) {
  return text.trim().replace(/^["'<]+|[>"']+$/g, '');
}

function buildImportTargets(node, source, rule, filePath) {
  const rawTargets = rule.extractTargets
    ? rule.extractTargets({ node, source, filePath })
    : extractTextsFromRule(node, source, rule);
  const normalized = rawTargets
    .map((target) => normalizeImportTarget(target))
    .filter(Boolean);

  if (rule.prefixFirst && normalized.length > 1) {
    const [prefix, ...rest] = normalized;
    return rest.map((target) => `${prefix}${rule.separator ?? '.'}${target}`);
  }

  return normalized;
}

// ⛔ THE MEMBER SEPARATOR IS SPLIT FIRST, AND THE ORDER IS THE WHOLE FIX.
//
// This took the FIRST whitespace-delimited token and then the leaf of that. For a method chained
// onto a constructor the first token is the `new` keyword, so `new Foo(1).bar()` produced target
// `new` — a callee nothing calls — AND SILENTLY LOST `bar`. Measured on a fresh full index of this
// repository at 6d2d699: 96 CALLS edges targeted `new`, each one standing where a real method-call
// edge belonged. `new Foo().a().b()` produced `new`, `new` and `Foo`, losing both `a` and `b`.
//
// ⚠ IT IS THE LOST EDGE THAT MATTERS, not the junk one. A stub target is visible in a census; a
// missing call is invisible by construction, and `graph_callers` on the real method simply answered
// with silence.
//
// Splitting on `::`/`->`/`.` first takes `bar` from `new Foo(1).bar`, and the trailing-token pass
// then strips any qualifier left on that final segment. The whitespace strip dates to the extractor's
// first commit with no test pinning it and no defect naming it.
function normalizeCallTarget(text) {
  const raw = text.trim();
  const parts = raw.split(/::|->|\./u);
  const leaf = (parts[parts.length - 1] ?? raw).trim();
  const tokens = leaf.split(/\s+/u);
  return tokens[tokens.length - 1] ?? leaf;
}

function buildCallTarget({ text, node, source, owner, config }) {
  if (typeof config.normalizeCallTarget === 'function') {
    return config.normalizeCallTarget({ text, node, source, owner }) ?? '';
  }
  return normalizeCallTarget(text);
}

function normalizeReferenceTarget(text) {
  const raw = text.trim();
  const parts = raw.split(/::|->|\./u);
  return parts[parts.length - 1] ?? raw;
}

function extractTextsFromRule(node, source, rule) {
  if (!rule.field && !rule.descendantTypes?.length) {
    const text = nodeText(node, source);
    return text ? [text] : [];
  }

  if (rule.field) {
    const text = nodeText(node.childForFieldName(rule.field), source);
    return text ? [text] : [];
  }

  if (rule.descendantTypes?.length) {
    const matches = [];
    const queue = [...node.namedChildren];
    while (queue.length) {
      const current = queue.shift();
      if (rule.descendantTypes.includes(current.type)) {
        const text = nodeText(current, source);
        if (text) matches.push(text);
      }
      queue.push(...current.namedChildren);
    }
    return matches;
  }

  return [];
}

function extractTextFromRule(node, source, rule) {
  return extractTextsFromRule(node, source, rule)[0] ?? '';
}

function extractNameFromRule(node, source, rule) {
  if (typeof rule.extractName === 'function') {
    return rule.extractName({ node, source });
  }

  return extractTextFromRule(node, source, rule);
}

function extractSymbolInfo(node, source, rule) {
  if (typeof rule.extractSymbolInfo === 'function') {
    return rule.extractSymbolInfo({ node, source }) ?? null;
  }

  const name = extractNameFromRule(node, source, rule).trim();
  return name ? { name } : null;
}

function buildSignature(node, source, rule) {
  const parts = [];
  if (rule.signatureFields?.length) {
    for (const field of rule.signatureFields) {
      const text = nodeText(node.childForFieldName(field), source).trim();
      if (text) parts.push(text);
    }
  }
  return parts.join(' ').trim();
}

function matchRule(node, rules = [], parent = null) {
  return rules.find((rule) =>
    rule.nodeTypes.includes(node.type)
    && (!rule.parentTypes?.length || (parent && rule.parentTypes.includes(parent.type)))
  );
}

function nodeWithin(candidate, container) {
  return Boolean(
    candidate
      && container
      && candidate.startIndex >= container.startIndex
      && candidate.endIndex <= container.endIndex
  );
}

function matchesAncestorField(node, ancestors, rules = [], source, fieldPredicate = () => true) {
  for (const ancestor of ancestors) {
    const rule = matchRule(ancestor, rules);
    if (!rule || !fieldPredicate(rule)) continue;

    if (rule.field) {
      const fieldNode = ancestor.childForFieldName(rule.field);
      if (nodeWithin(node, fieldNode)) {
        return true;
      }
    }

    if (rule.descendantTypes?.length) {
      const queue = [...ancestor.namedChildren];
      while (queue.length) {
        const current = queue.shift();
        if (rule.descendantTypes.includes(current.type) && nodeWithin(node, current)) {
          return true;
        }
        queue.push(...current.namedChildren);
      }
    }
  }

  return false;
}

function isInsideParameterList(ancestors) {
  const PARAMETER_TYPES = new Set([
    'parameters',
    'formal_parameters',
    'parameter_list',
    'typed_parameter',
    'simple_parameter',
    'required_parameter',
    'optional_parameter',
    'default_parameter',
    'variadic_parameter',
    'typed_default_parameter',
    'receiver',
  ]);

  return ancestors.some((ancestor) => PARAMETER_TYPES.has(ancestor.type));
}

function isInsideTypeAnnotation(ancestors) {
  const TYPE_ANNOTATION_TYPES = new Set([
    'type',
    'type_annotation',
    'predefined_type',
    'type_parameters',
    'generic_type',
  ]);

  return ancestors.some((ancestor) => TYPE_ANNOTATION_TYPES.has(ancestor.type));
}

function isReferenceCandidate({ node, owner, ancestors, config, source }) {
  if (!owner) return false;

  const target = normalizeReferenceTarget(nodeText(node, source));
  if (!target) return false;
  if (['self', 'this', 'cls', 'super', 'class'].includes(target)) return false;
  if (isInsideParameterList(ancestors)) return false;
  if (isInsideTypeAnnotation(ancestors)) return false;

  if (matchesAncestorField(
    node,
    ancestors,
    config.symbols,
    source,
    (rule) => Boolean(rule.field) || Boolean(rule.descendantTypes?.length),
  )) {
    return false;
  }

  if (matchesAncestorField(node, ancestors, config.refs?.imports ?? [], source, (rule) => Boolean(rule.field) || Boolean(rule.descendantTypes?.length))) {
    return false;
  }

  if (matchesAncestorField(node, ancestors, config.refs?.calls ?? [], source, (rule) => Boolean(rule.field))) {
    return false;
  }

  return true;
}

// ⚠ `id` IS AN EXPLICIT INPUT, NOT A DEFAULT WITH AN ESCAPE HATCH. Code symbol sites pass a
// `codeSymbolSiteId`; File and Module nodes pass nothing and keep the legacy name-derived scheme,
// which must stay byte-identical. Making the caller say which it wants is the point — the four
// copies of `stableId` in this tree are what a silent default would hide.
function makeBaseNode({
  type,
  label,
  filePath,
  startLine,
  endLine,
  language,
  confidence,
  extra,
  id,
}) {
  const qname = extra.qname ?? `${language}:${filePath}:${label}`;
  return {
    id: id ?? stableId([type, filePath, qname]),
    type,
    label,
    file_path: filePath,
    start_line: startLine,
    end_line: endLine,
    language,
    confidence,
    structural_fp: '',
    dependency_fp: '',
    extra,
  };
}

function pushUniqueEdge(edges, edge) {
  const exists = edges.some((candidate) =>
    candidate.relation === edge.relation
    && candidate.from_id === edge.from_id
    && candidate.to_id === edge.to_id
  );

  if (!exists) {
    edges.push(edge);
  }
}

function finalizeFingerprints(node, deps) {
  const structuralInput = {
    qname: node.extra.qname,
    signature: node.extra.signature ?? '',
    decorators: node.extra.decorators ?? [],
    parentClass: node.extra.parent_class ?? '',
    nodeType: node.type,
  };

  const dependencyInput = {
    outgoing: {
      calls: deps.calls,
      references: deps.references,
      usesTypes: deps.usesTypes,
      imports: deps.imports,
    },
  };

  node.structural_fp = structuralFingerprint(structuralInput);
  node.dependency_fp = dependencyFingerprint(dependencyInput);
}

export function extractFile({ filePath, source, config }) {
  // Optional per-language pre-parse normalization. MUST preserve byte offsets
  // (blank, never delete) so every reported line/column still points at the
  // ORIGINAL source. Symbol text is still sliced from `source`, not the parsed
  // text, so only the parse is affected.
  const parseText = typeof config.preParse === 'function'
    ? config.preParse(source)
    : source;
  const tree = parseSource({ source: parseText, config });
  const nodes = [];
  const edges = [];
  const refs = [];
  const lineCount = source.length === 0 ? 0 : source.split('\n').length;
  const pathBasedLabel = moduleNameForPath(filePath);
  // Language configs may override the module identity (e.g. PHP derives it
  // from the `namespace` directive so imports like `use App\Models\User`
  // actually resolve to the right module).
  const moduleLabel = typeof config.moduleFromAst === 'function'
    ? (config.moduleFromAst({ tree, source, filePath, defaultLabel: pathBasedLabel }) || pathBasedLabel)
    : pathBasedLabel;
  const fileLabel = basename(filePath);
  const symbolDeps = new Map();
  const symbolsById = new Map();
  // Undeclared duplicate spans are REPORTED, never repaired. See the emitter-slot note below.
  const duplicateSites = [];

  const fileNode = makeBaseNode({
    type: 'File',
    label: fileLabel,
    filePath,
    startLine: lineCount > 0 ? 1 : 0,
    endLine: lineCount,
    language: config.language,
    confidence: config.confidence?.node ?? 1.0,
    extra: { qname: filePath.replace(/\\/g, '/'), signature: '', decorators: [] },
  });

  const moduleNode = makeBaseNode({
    type: 'Module',
    label: moduleLabel,
    filePath,
    startLine: 1,
    endLine: lineCount,
    language: config.language,
    confidence: config.confidence?.node ?? 1.0,
    extra: { qname: moduleLabel, signature: '', decorators: [] },
  });

  nodes.push(fileNode, moduleNode);
  pushUniqueEdge(edges, {
    relation: 'CONTAINS',
    from_id: moduleNode.id,
    to_id: fileNode.id,
    from_label: moduleNode.label,
    to_label: fileNode.label,
    source_file: filePath,
    source_line: 1,
    confidence: config.confidence?.node ?? 1.0,
    extractor: config.language,
  });

  const MAX_VISIT_DEPTH = 80;
  const referenceRules = config.refs?.references ?? [
    { nodeTypes: ['identifier', 'type_identifier', 'name'] },
  ];

  const visit = (node, owner = null, parentClass = null, depth = 0, ancestors = [], lexicalScope = []) => {
    if (depth > MAX_VISIT_DEPTH) return;
    const parentNode = ancestors[ancestors.length - 1] ?? null;
    const symbolRule = matchRule(node, config.symbols, parentNode);
    let nextOwner = owner;
    let nextParentClass = parentClass;

    // ⛔ A SEPARATE SCOPE CHANNEL — never `parentClass`. Routing namespaces through parentClass
    // would flip `Function` to `Method` for every namespaced free function (see resolvedType
    // below) and carry that into containment edges, fingerprints and test detection. Only
    // languages that declare `config.lexicalScope` participate; everything else keeps the empty
    // chain and therefore byte-identical qnames.
    let nextLexicalScope = lexicalScope;
    const scopeRule = matchRule(node, config.lexicalScope ?? [], parentNode);
    if (scopeRule) {
      const scopeName = nodeText(node.childForFieldName(scopeRule.field ?? 'name'), source).trim();
      // An anonymous namespace has no name node. It is a real scope, but naming it here would
      // invent an identifier the source does not contain — linkage is step C's to model.
      if (scopeName) nextLexicalScope = [...lexicalScope, scopeName];
    }

    if (symbolRule) {
      const symbolInfo = extractSymbolInfo(node, source, symbolRule);
      const name = symbolInfo?.name?.trim() ?? '';
      if (name) {
        const parentClassLabel = symbolInfo?.parentClass ?? parentClass?.label ?? '';
        const parentClassQname = symbolInfo?.parentClassQname ?? parentClass?.extra?.qname ?? parentClassLabel;
        const syntheticOwnerTarget = symbolInfo?.parentClass ?? '';
        const explicitType = symbolInfo?.type ?? symbolRule.type;
        // ★ `type` IS DERIVED, NOT A RECORD OF WHICH RULE FIRED.
        //
        // A Function-rule match becomes type 'Method' whenever a parent class is
        // present — so reading the stored type as "which rule ran" is wrong, and it
        // is the natural inference for anyone debugging extraction. It cost a real
        // diagnosis: a node typed Method was attributed to the Method rule when the
        // Function rule had matched and a bogus parentClass flipped the type.
        //
        // The rule name is recorded on the node (extra.extracted_by) so provenance
        // is available instead of inferred — the same fix as labelling a field with
        // the metric it actually counts.
        const resolvedType = explicitType === 'Function' && parentClassLabel ? 'Method' : explicitType;
        const detectedType = config.testDetector?.({
          label: name,
          filePath,
          node,
          resolvedType,
          parentClass: parentClassLabel,
        }) ? 'Test' : resolvedType;
        // ⛔ COMPOSED, NOT A FALLBACK — and that distinction is the whole gate.
        //
        // `parentClassQname` above is `symbolInfo?.parentClassQname ?? …`, so symbolInfo WINS. For
        // `namespace alpha { void Widget::render() {} }` the C++ extractor returns `'Widget'` from
        // the written qualifier, which does not contain `alpha`. A lexical scope offered as a
        // default after that `??` chain would NEVER FIRE, and the lexical-relative form would keep
        // failing while the declaration side passed — a gate green on one half of its own case.
        //
        // ⚠ ANTI-DOUBLE-PREFIX. `void alpha::Widget::render()` written OUTSIDE the namespace
        // already carries `alpha` in symbolInfo, so blindly prepending would produce
        // `alpha.alpha.Widget`. Both forms must converge on one qname, so the prefix is skipped
        // when the base already opens with it.
        // ⛔ COMPOSE ONLY ONTO A *WRITTEN QUALIFIER*, NEVER ONTO AN IN-SCOPE CLASS NODE.
        //
        // My first version composed onto whatever `parentClassQname` held, guarded by a
        // `startsWith` check. My own anti-double-prefix control caught it producing
        // `alpha.src.exp.alpha.Widget.render`: a Class node in scope ALREADY carries the composed
        // scope in its qname (`src.exp.alpha.Widget`), but the scope sits mid-string after the
        // module label, so a prefix check cannot see it.
        //
        // The two sources are different kinds of thing and only one is scope-relative:
        //   symbolInfo.parentClassQname  — the qualifier AS WRITTEN (`Widget`), needs the scope
        //   parentClass.extra.qname      — an absolute qname, already scoped, must be left alone
        const scopePrefix = lexicalScope.join('.');
        const parentFromWrittenQualifier = Boolean(symbolInfo?.parentClassQname);
        const scopedParent = (() => {
          if (!parentClassQname) return '';
          if (!scopePrefix || !parentFromWrittenQualifier) return parentClassQname;
          if (parentClassQname === scopePrefix || parentClassQname.startsWith(`${scopePrefix}.`)) return parentClassQname;
          return `${scopePrefix}.${parentClassQname}`;
        })();
        const qname = scopedParent
          ? `${scopedParent}.${name}`
          : `${moduleLabel}.${scopePrefix ? `${scopePrefix}.` : ''}${name}`;
        const signature = buildSignature(node, source, symbolRule);
        // SITE IDENTITY. The occurrence's ADDRESS — exact byte span in a normalised repo-relative
        // path — never its name, signature or scope. `emitterSlot` breaks a tie only if two
        // symbols are emitted from one exact span; it stays 0 in practice, and it is local to the
        // span rather than a traversal ordinal, so identity never depends on visit order.
        // ⛔ AUTOMATIC COLLISION REPAIR WAS REMOVED, AND IT WAS MAKING THE RESULT TRUE BY
        // CONSTRUCTION. This used to be `while (symbolsById.has(siteId)) emitterSlot += 1`, which
        // silently minted a second unique id for a duplicate visit of the SAME occurrence. Under
        // that loop "0 within-file duplicate ids" could not fail, so the census I ran proved
        // nothing about distinct source occurrences — review caught it by reading the loop, not
        // the numbers.
        //
        // An emitter that genuinely produces several symbols from one exact span must pass an
        // EXPLICIT slot, local to that span. An undeclared duplicate is an extractor defect and is
        // recorded rather than papered over: emitting a phantom row would be a fabricated site,
        // and auto-incrementing would hide it.
        const { startByte, endByte } = siteSpanOf(node);
        const siteId = codeSymbolSiteId({ language: config.language, filePath, startByte, endByte });
        // ⛔ THIS REFUSES. An earlier version only PUSHED the duplicate onto a returned array and
        // carried on — and that array had zero readers anywhere in the tree, so extraction still
        // fell through to the old merge branch and the duplicate was swallowed exactly as before.
        // A returned field nobody consumes is not a report and not a refusal; it is the
        // unreachable-remedy shape this project keeps rediscovering. Measured across 782 files:
        // zero undeclared duplicates, so failing closed here costs nothing today and cannot
        // silently start merging tomorrow.
        if (symbolsById.has(siteId)) {
          duplicateSites.push({ filePath, label: name, type: detectedType, startByte, endByte, rule: symbolRule.type });
          const err = new Error(`undeclared duplicate symbol site in ${filePath}: "${name}" at bytes `
            + `${startByte}-${endByte} (rule ${symbolRule.type}) mints an id already emitted. An emitter that `
            + 'intends several symbols from one span must pass an explicit local slot; an undeclared '
            + 'duplicate is an extractor defect and is refused rather than merged.');
          err.code = 'APG_DUPLICATE_SYMBOL_SITE';
          err.duplicateSites = duplicateSites;
          throw err;
        }
        const createdNode = makeBaseNode({
          id: siteId,
          type: detectedType,
          // ⛔ THE DISPLAY LABEL IS THE SOURCE SPELLING, AND `name` IS NOW THE SEMANTIC TERMINAL.
          //
          // Those used to be the same string. Extracting the terminal structurally (so `a::W::~W`
          // composes to `a.W.~W` instead of `a.W::~W`) changed `name` from `W::~W` to `~W` — and
          // silently changed every LABEL consumer with it, to fix a QNAME defect. Fixing identity
          // is not licence to rewrite what the source says a symbol is called.
          //
          // So an extractor that knows the written spelling supplies `displayLabel`, and the label
          // stays byte-identical to its pre-fix value. The odd-looking pair this leaves — label
          // `W::~W` beside qname `a.W.~W` — is deliberate and stays its own contract.
          label: symbolInfo?.displayLabel ?? name,
          filePath,
          startLine: lineNumber(node),
          endLine: endLineNumber(node),
          language: config.language,
          confidence: symbolRule.confidence ?? config.confidence?.node ?? 1.0,
          extra: {
            qname,
            signature,
            decorators: [],
            parent_class: parentClassLabel,
            // The occurrence's address, carried as row metadata. Line numbers cannot order two
            // sites declared on ONE line, and the structural fingerprint needs a deterministic
            // order to tell same-shape twins apart.
            site_start_byte: startByte,
            site_end_byte: endByte,
            // What the extractor BELIEVES this occurrence is. A sibling field, never an id input:
            // hashing a classification would remint the site whenever the classification improved.
            // `unknown` is valid; absence must never be read as "definition".
            site_kind: siteKindOf(node),
            // Which RULE produced this node. `type` is derived (see above) and
            // cannot answer this; storing it makes extraction provenance readable
            // rather than inferable.
            extracted_by: symbolRule.type,
          },
        });

        const existingNode = symbolsById.get(createdNode.id);
        const activeNode = existingNode ?? createdNode;
        // OVERLOAD-SET MERGING, made visible.
        //
        // Node identity is stableId([type, filePath, qname]) and qname carries no
        // signature, so `render(int)` and `render(Widget&)` in one file produce the
        // SAME id and silently collapse into one node. Nothing recorded that it
        // happened, which is how a call from one overload to another came back as
        // "this function is recursive" (field report 2026-07-27).
        //
        // Splitting identity by signature is a graph-wide ID migration needing a
        // full reindex; it is tracked separately. What can land now is the DISCLOSURE:
        // a node that merges N declarations says so, and the resolver downgrades
        // self-edges on it because it genuinely cannot tell recursion from an
        // inter-overload call.
        if (existingNode && signature) {
          const sigs = existingNode.extra.overload_signatures
            ?? (existingNode.extra.overload_signatures = [existingNode.extra.signature].filter(Boolean));
          if (!sigs.includes(signature)) {
            sigs.push(signature);
            existingNode.extra.overloads = sigs.length;
            // Declaration lines of the merged siblings. The node's own start/end
            // range is deliberately NOT widened — downstream logic uses it to tell
            // a declaration from a call site, and a widened range would swallow
            // real call sites between the overloads.
            (existingNode.extra.overload_lines ??= [existingNode.start_line])
              .push(lineNumber(node));
          }
        }
        if (!existingNode) {
          nodes.push(createdNode);
          symbolsById.set(createdNode.id, createdNode);
          symbolDeps.set(createdNode.id, {
            calls: [],
            references: [],
            usesTypes: [],
            imports: [],
          });
        }

        const parentNode = parentClass ?? fileNode;
        pushUniqueEdge(edges, {
          relation: parentClass ? 'CONTAINS' : 'DEFINES',
          from_id: parentNode.id,
          to_id: activeNode.id,
          from_label: parentNode.label,
          to_label: activeNode.label,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: symbolRule.confidence ?? config.confidence?.node ?? 1.0,
          provenance: 'EXTRACTED',
          extractor: config.language,
        });

        if (!parentClass && syntheticOwnerTarget && detectedType === 'Method') {
          refs.push({
            from_target: syntheticOwnerTarget,
            to_id: activeNode.id,
            relation: 'CONTAINS',
            source_file: filePath,
            source_line: lineNumber(node),
            confidence: symbolRule.confidence ?? config.confidence?.node ?? 1.0,
            provenance: 'EXTRACTED',
            extractor: config.language,
          });
        }

        nextOwner = activeNode;
        nextParentClass = resolvedType === 'Class' ? activeNode : parentClass;
      }
    }

    const importRule = matchRule(node, config.refs?.imports, parentNode);
    if (importRule) {
      for (const target of buildImportTargets(node, source, importRule, filePath)) {
        refs.push({
          from_id: fileNode.id,
          from_label: fileNode.label,
          relation: 'IMPORTS',
          target,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: importRule.confidence ?? config.confidence?.import ?? config.confidence?.node ?? 1.0,
          provenance: 'EXTRACTED',
          extractor: config.language,
        });
      }
    }

    // ★ A DEFAULT ARGUMENT IS EVALUATED BY THE CALLER, NOT INSIDE THE FUNCTION.
    //
    //     int cylindricalIdFromWorldPos(const glm::vec3& worldPos,
    //                                   const glm::vec3& spinAxis = glm::vec3(0, 1, 0))
    //
    // That `glm::vec3(0,1,0)` is a call_expression sitting in the PARAMETER LIST. The
    // generic call rule matched it and attributed it as a call made BY
    // cylindricalIdFromWorldPos, which the function never makes — the caller does, at
    // the call site, only when the argument is omitted.
    //
    // ⛔ THIS IS THE ROOT OF THE `vec3` PHANTOM, and I fixed its consumers twice before
    // finding it. The bad ref made `vec3` look like a callee of every function whose
    // signature defaulted a glm type; `tests_adjacent` then used it as `via_symbol` and
    // SUPPRESSED `no_test_coverage` on untested symbols (fixed at the consumer), and
    // `graph_trace` later listed it in a callee list (found in field testing on real C++,
    // 2026-08-11, after the consumer fix).
    //
    // ★ THE RULE THAT KEEPS BEING RELEARNED: a fix at one layer does not cover the other
    // consumers of the same bad data. Two consumers patched, the data untouched, and it
    // resurfaced in a third. Fixed here so every reader of CALLS inherits it at once.
    //
    // Scoped deliberately: only call expressions whose nearest structural ancestor is a
    // parameter list are dropped. A default argument that calls a real function is also
    // not called by this function, so the exclusion is correct in general, not just for
    // constructors.
    // Reuses the existing `isInsideParameterList` predicate rather than a second list of
    // parameter node types — two lists of the same thing is how one of them goes stale.
    const callRule = isInsideParameterList(ancestors)
      ? null
      : matchRule(node, config.refs?.calls, parentNode);
    // File-scope / static-initializer calls (`static Reg r = doRegister();`,
    // `int g = compute();`) have no enclosing function, so nextOwner is null and
    // the edge was silently dropped. For languages that opt in (config.
    // fileScopeCalls — C/C++, where self-registration statics are a dominant
    // idiom), attribute these to the File node so "who calls X" surfaces the
    // registration site. Other languages keep the old behavior (drop) to avoid
    // perturbing their edge sets.
    const callOwner = nextOwner ?? (config.fileScopeCalls ? fileNode : null);
    if (callRule && callOwner) {
      const target = buildCallTarget({
        text: extractTextFromRule(node, source, callRule),
        node,
        source,
        owner: callOwner,
        config,
      });
      if (target) {
        const baseRef = {
          from_id: callOwner.id,
          from_label: callOwner.label,
          target,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: callRule.confidence ?? config.confidence?.call ?? config.confidence?.node ?? 1.0,
          provenance: 'EXTRACTED',
          extractor: config.language,
        };

        refs.push({
          ...baseRef,
          relation: 'CALLS',
        });

        if (callOwner.type === 'Test') {
          refs.push({
            ...baseRef,
            relation: 'TESTS',
          });
        }
        symbolDeps.get(callOwner.id)?.calls.push(target);
      }
    }

    const referenceRule = matchRule(node, referenceRules, parentNode);
    if (referenceRule && isReferenceCandidate({ node, owner: nextOwner, ancestors, config, source })) {
      const target = normalizeReferenceTarget(extractTextFromRule(node, source, referenceRule));
      if (target) {
        refs.push({
          from_id: nextOwner.id,
          from_label: nextOwner.label,
          relation: 'REFERENCES',
          target,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: referenceRule.confidence ?? config.confidence?.reference ?? config.confidence?.node ?? 1.0,
          provenance: 'EXTRACTED',
          extractor: config.language,
        });
        symbolDeps.get(nextOwner.id)?.references.push(target);
      }
    }

    for (const rule of config.refs?.extends ?? []) {
      if (!nextOwner || nextOwner.type !== 'Class') continue;
      if (!matchRule(node, [rule], parentNode)) continue;

      for (const targetText of extractTextsFromRule(node, source, rule)) {
        const target = normalizeReferenceTarget(targetText);
        if (!target) continue;
        refs.push({
          from_id: nextOwner.id,
          from_label: nextOwner.label,
          relation: 'EXTENDS',
          target,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: rule.confidence ?? config.confidence?.reference ?? config.confidence?.node ?? 1.0,
          provenance: 'EXTRACTED',
          extractor: config.language,
        });
        symbolDeps.get(nextOwner.id)?.references.push(target);
      }
    }

    for (const rule of config.refs?.implements ?? []) {
      if (!nextOwner || nextOwner.type !== 'Class') continue;
      if (!matchRule(node, [rule], parentNode)) continue;

      for (const targetText of extractTextsFromRule(node, source, rule)) {
        const target = normalizeReferenceTarget(targetText);
        if (!target) continue;
        refs.push({
          from_id: nextOwner.id,
          from_label: nextOwner.label,
          relation: 'IMPLEMENTS',
          target,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: rule.confidence ?? config.confidence?.reference ?? config.confidence?.node ?? 1.0,
          provenance: 'EXTRACTED',
          extractor: config.language,
        });
        symbolDeps.get(nextOwner.id)?.references.push(target);
      }
    }

    for (const rule of config.refs?.usesTypes ?? []) {
      if (!nextOwner) continue;
      if (!matchRule(node, [rule], parentNode)) continue;

      for (const targetText of extractTextsFromRule(node, source, rule)) {
        const target = normalizeReferenceTarget(targetText);
        if (!target) continue;
        refs.push({
          from_id: nextOwner.id,
          from_label: nextOwner.label,
          relation: 'USES_TYPE',
          target,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: rule.confidence ?? config.confidence?.reference ?? config.confidence?.node ?? 1.0,
          provenance: 'EXTRACTED',
          extractor: config.language,
        });
        symbolDeps.get(nextOwner.id)?.usesTypes.push(target);
      }
    }

    for (const child of node.namedChildren) {
      visit(child, nextOwner, nextParentClass, depth + 1, [...ancestors, node], nextLexicalScope);
    }
  };

  visit(tree.rootNode, null, null, 0, []);

  finalizeFingerprints(fileNode, {
    calls: [],
    references: [],
    usesTypes: [],
    imports: refs.filter((ref) => ref.relation === 'IMPORTS').map((ref) => ref.target),
  });
  finalizeFingerprints(moduleNode, {
    calls: [],
    references: [],
    usesTypes: [],
    imports: [],
  });

  for (const node of nodes) {
    if (!symbolDeps.has(node.id)) continue;
    finalizeFingerprints(node, symbolDeps.get(node.id));
  }

  // Language configs may append more refs/edges after the main walker. Used
  // for framework-specific patterns (e.g. PHP detects app(Foo::class),
  // facades, constructor injection) that don't fit the per-node rule shape.
  if (typeof config.postExtract === 'function') {
    const extra = config.postExtract({
      tree, source, filePath, nodes, edges, refs, fileNode, moduleNode, symbolsById,
    });
    if (extra?.refs) refs.push(...extra.refs);
    if (extra?.edges) edges.push(...extra.edges);
  }

  return { nodes, edges, refs, duplicateSites };
}
