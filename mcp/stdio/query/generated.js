// Generated-file classifier — P1-5.
//
// Generated C++/codegen files (protobuf, Qt moc/ui/qrc, FlatBuffers, reflection
// codegen, Dart codegen) pollute search/find when a generated stub shares a
// name with a hand-written symbol. We DOWN-rank these, never hide them: a
// query that explicitly names a generated file still finds it.
//
// Pure function, path-suffix/prefix table. Ranking-time classification keeps
// blast radius minimal (no ingest schema change required).
//
// Conservative by design — patterns must NOT catch hand-written files that
// merely resemble a generated prefix (e.g. `mocha_helpers.cpp` must NOT match
// the `moc_` Qt prefix; `generated_report.cpp` must NOT match `/generated/`).

// Each entry matches against a forward-slash-normalized path.
const GENERATED_PATTERNS = [
  // protobuf
  /\.pb\.(cc|h)$/i,
  // Qt meta-object compiler — prefix at a path segment boundary only.
  // `moc_widget.cpp`, `src/moc_foo.cpp` match; `mocha_helpers.cpp` does not.
  /(^|\/)moc_[^/]*\.(cc|cpp|cxx|h|hpp|hxx)$/i,
  // Qt uic — `ui_mainwindow.h`
  /(^|\/)ui_[^/]*\.h$/i,
  // Qt resource compiler — `qrc_resources.cpp`
  /(^|\/)qrc_[^/]*\.(cc|cpp|cxx)$/i,
  // FlatBuffers / general codegen suffix — `foo_generated.h`
  /_generated\.(h|hpp|cc|cpp)$/i,
  // explicit *.gen.* convention
  /\.gen\.(h|hpp|cc|cpp)$/i,
  // Dart codegen — `foo.g.dart`
  /\.g\.dart$/i,
  // codegen output directories — segment boundaries on both sides so
  // `generated_report.cpp` (a hand-written file) does NOT match.
  /(^|\/)generated\//i,
  /(^|\/)__generated__\//i,
];

/**
 * isGeneratedPath(path) → boolean
 * True when the path looks like compiler/codegen output that should sort LAST
 * among otherwise-equal candidates. Pure; safe on undefined/null.
 */
export function isGeneratedPath(path) {
  if (!path || typeof path !== 'string') return false;
  const p = path.replace(/\\/g, '/');
  for (const re of GENERATED_PATTERNS) {
    if (re.test(p)) return true;
  }
  return false;
}
