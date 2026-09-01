// A C++ declaration and its out-of-line definition are ONE symbol, and must group as one.
//
// ⛔ THE STATED INVARIANT WAS FALSE. symbol_lookup.js says "Overloads and the C++ decl/def split
// share a canonical key -> one group -> not ambiguous". Measured on the identity-callers fixture
// it does not hold, because the two qnames are built by different rules:
//   definition   src/widgets.cpp  qname alpha.Widget.render              (written qualifier, module-free)
//   declaration  src/widgets.h    qname src.widgets.alpha.Widget.render  (Class node's ABSOLUTE qname)
// So `alpha::Widget::render` returned REFUSED_AMBIGUOUS with selectedTargets=0, and no caller set
// could render even with a perfect edge layer.
//
// ⛔ WHY THE STRIP IS GATED ON lexical_scope. Removing the module prefix unconditionally would
// MERGE genuinely distinct symbols: in JavaScript src.alpha.Widget.render and
// src.beta.Widget.render are different classes that differ ONLY by module. The prefix is the sole
// discriminator where a language has no namespaces. Only rows carrying real namespace
// qualification (extra.lexical_scope, which only C++ declares) may drop it — and in C++ the
// namespace-qualified name IS the identity, so two headers declaring n::C::m are the same entity.
//
// ⚠ The prefix is stripped only when it ACTUALLY matches the module derived from that row's own
// file path. A language overriding its module label (PHP, via moduleFromAst) simply will not
// match, and nothing is stripped. Fail-safe, not "true today".
import { describe, it, expect } from 'vitest';
import { buildAmbiguousMatchMessage } from '../../../mcp/stdio/query/verbs/symbol_lookup.js';

const row = (file, qname, lexical) => ({
  type: 'Method', label: 'render', file_path: file, start_line: 1, confidence: 1,
  extra: JSON.stringify({ qname, parent_class: 'Widget',
    ...(lexical ? { lexical_scope: [{ segment: lexical, authority: 'lexical_ast' }] } : {}) }),
});

describe('canonical identity — decl/def collapse without merging distinct symbols', () => {
  it('★ a C++ decl and its out-of-line def are ONE identity, so there is no ambiguity to refuse', () => {
    const msg = buildAmbiguousMatchMessage('alpha::Widget::render', [
      row('src/widgets.cpp', 'alpha.Widget.render', 'alpha'),
      row('src/widgets.h', 'src.widgets.alpha.Widget.render', 'alpha'),
    ]);
    expect(msg, 'one entity must not be reported as two candidates').toBeNull();
  });

  it('⛔ NEGATIVE CONTROL: two C++ namespaces keep their separate identities', () => {
    // Without this, "decl/def collapse" could be an unconditional merge that destroys the very
    // discrimination M1 exists to provide.
    const msg = buildAmbiguousMatchMessage('render', [
      row('src/widgets.cpp', 'alpha.Widget.render', 'alpha'),
      row('src/widgets.cpp', 'beta.Widget.render', 'beta'),
    ]);
    expect(msg, 'alpha and beta are DISTINCT symbols and must still be reported').toMatch(/AMBIGUOUS MATCH/);
  });

  it('⛔ NEGATIVE CONTROL: two JS modules keep their separate identities', () => {
    // JS rows carry NO lexical_scope, so the module prefix must survive — it is the only thing
    // telling these two classes apart.
    const msg = buildAmbiguousMatchMessage('Widget.render', [
      row('src/alpha.js', 'src.alpha.Widget.render', null),
      row('src/beta.js', 'src.beta.Widget.render', null),
    ]);
    expect(msg, 'two distinct JS classes must not be merged by stripping their module').toMatch(/AMBIGUOUS MATCH/);
  });
});
