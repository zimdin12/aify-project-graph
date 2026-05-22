// Plan #17 C: Django route detection — fills the gap codegraph has and
// APG didn't. Mirrors python_web.js's plugin shape so downstream verbs
// (graph_path / graph_consequences / graph_impact) treat the outputs the
// same way as FastAPI/Flask routes.
//
// Django routing lives in `urls.py` (one or more per project) and uses
// one of three function signatures:
//
//   path('articles/<int:year>/', views.year_archive, name='news-year')
//   re_path(r'^articles/(?P<year>[0-9]{4})/$', views.year_archive)
//   url(r'^articles/$', views.archive)              # legacy (Django <2.0)
//
// The view can be:
//   - A bare function reference:        views.year_archive
//   - A class-based view:               MyView.as_view()
//   - A dotted string (legacy):         'app.views.year_archive'
//   - An include() call to a sub-module: include('app.urls')
//
// We emit a Route node for each path()/re_path()/url() call we recognize,
// plus an INVOKES edge to the handler name (last segment of the dotted
// path or the symbol before .as_view()). include() calls don't get a
// Route node — they're discovery breadcrumbs, not endpoints.

import { createFrameworkPlugin } from '../extractors/base.js';
import { walkFiles, tryReadFile, relPath, routeNode, invokesRef } from './_plugin_utils.js';

const URLS_FILE_RE = /(^|\/)urls\.py$/;

// Loose regex for a single Django route call. The view-target is captured
// permissively so we can do per-form parsing on it afterwards. Whitespace
// flexible; pattern can be raw-string or plain.
const ROUTE_CALL_RE = /\b(path|re_path|url)\s*\(\s*((?:r?['"][^'"]*['"]|\w+\([^)]*\)))\s*,\s*([^,)]+)/g;

function unquote(s) {
  if (s == null) return s;
  const t = s.trim();
  const m = t.match(/^r?['"]([^'"]*)['"]$/);
  return m ? m[1] : t;
}

// Reduce a view-target expression to the handler name we should bind to.
//   - "MyView.as_view()"        -> "MyView"
//   - "views.year_archive"      -> "year_archive"
//   - "year_archive"            -> "year_archive"
//   - "'app.views.year_archive'" -> "year_archive"
//   - "include('app.urls')"     -> null (not a handler; signal up-tree)
function resolveHandler(viewExpr) {
  const trimmed = viewExpr.trim();
  if (trimmed.startsWith('include(') || trimmed.startsWith('include ')) return null;
  // Dotted string literal (legacy)
  const stringDotted = trimmed.match(/^['"]([^'"]+)['"]$/);
  if (stringDotted) {
    const parts = stringDotted[1].split('.');
    return parts[parts.length - 1] || null;
  }
  // ClassBasedView.as_view(...) — the class is the handler
  const asView = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*as_view\s*\(/);
  if (asView) return asView[1];
  // Plain dotted symbol: take the last segment
  const dotted = trimmed.match(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/);
  if (dotted) {
    const parts = dotted[0].split('.');
    return parts[parts.length - 1] || null;
  }
  return null;
}

function extractDjangoRoutes(content, file) {
  const routes = [];
  // Line index for offset → line lookup (1-based).
  const newlineOffsets = [];
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) newlineOffsets.push(i);
  const offsetToLine = (off) => {
    let lo = 0, hi = newlineOffsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (newlineOffsets[mid] < off) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1; // 1-based
  };

  let m;
  // reset lastIndex defensively since we declared the regex at module scope
  ROUTE_CALL_RE.lastIndex = 0;
  while ((m = ROUTE_CALL_RE.exec(content)) !== null) {
    const verb = m[1];               // 'path' | 're_path' | 'url'
    const pattern = unquote(m[2]);
    const viewExpr = m[3].trim();
    const handler = resolveHandler(viewExpr);
    if (!handler) continue;          // include() → skip; we don't emit Route for breadcrumbs
    routes.push({
      method: 'ANY',                 // Django doesn't bind HTTP verbs in URLConf; views do
      path: pattern,
      handler,
      line: offsetToLine(m.index),
      file,
      framework: 'django',
      verb
    });
  }
  return routes;
}

export const djangoPlugin = createFrameworkPlugin({
  name: 'django',

  async detect({ repoRoot }) {
    for (const f of ['requirements.txt', 'pyproject.toml', 'Pipfile', 'manage.py']) {
      const raw = await tryReadFile(`${repoRoot}/${f}`);
      if (raw && /django/i.test(raw)) return true;
    }
    return false;
  },

  async enrich({ repoRoot, result }) {
    const nodes = [...result.nodes];
    const refs = [...result.refs];
    const files = await walkFiles(repoRoot, ['.py']);

    for (const abs of files) {
      const rp = relPath(repoRoot, abs);
      if (!URLS_FILE_RE.test(rp)) continue;     // Django routes live in urls.py
      const content = await tryReadFile(abs);
      if (!content) continue;
      if (!/\b(path|re_path|url)\s*\(/.test(content)) continue;

      const routes = extractDjangoRoutes(content, rp);
      for (const r of routes) {
        const label = `${r.method} ${r.path}`;
        const node = routeNode({
          filePath: r.file, label, language: 'python',
          startLine: r.line, confidence: 0.75
        });
        nodes.push(node);
        refs.push(invokesRef({
          node, target: r.handler, extractor: 'django',
          sourceFile: r.file, sourceLine: r.line, confidence: 0.75,
        }));
      }
    }

    return { nodes, edges: result.edges, refs };
  },
});
