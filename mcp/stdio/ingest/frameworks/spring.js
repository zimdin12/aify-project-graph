// Spring plugin: @RequestMapping, @GetMapping, @PostMapping et al.
// on @Controller / @RestController classes.
//
// @RestController
// @RequestMapping("/api/users")
// public class UserController {
//   @GetMapping("/{id}")
//   public User find(@PathVariable Long id) { ... }  ← GET /api/users/{id} → find
// }

import { createFrameworkPlugin } from '../extractors/base.js';
import { walkFiles, tryReadFile, relPath, routeNode, invokesRef } from './_plugin_utils.js';

const MAPPING_TO_METHOD = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  PatchMapping: 'PATCH',
  DeleteMapping: 'DELETE',
};

function extractClassPrefix(content, classStart) {
  // Look backward from the class keyword for @RequestMapping(...) or
  // @RequestMapping(value = "/x") on either the class itself.
  const window = content.slice(Math.max(0, classStart - 400), classStart);
  const m = window.match(/@RequestMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]/);
  return m ? m[1] : '';
}

function extractControllers(content) {
  const ctrls = [];
  // Match @Controller or @RestController followed (possibly with gaps
  // for other annotations) by a class declaration.
  const re = /@(?:RestController|Controller)[\s\S]*?(?:public\s+|abstract\s+|final\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const classKeywordIdx = content.indexOf('class', m.index);
    if (classKeywordIdx === -1) continue;
    const openBrace = content.indexOf('{', classKeywordIdx);
    if (openBrace === -1) continue;
    // Match the class body by brace counting.
    let depth = 0;
    let close = -1;
    for (let i = openBrace; i < content.length; i += 1) {
      if (content[i] === '{') depth += 1;
      else if (content[i] === '}') {
        depth -= 1;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close === -1) continue;
    ctrls.push({
      className: m[1],
      prefix: extractClassPrefix(content, classKeywordIdx),
      body: content.slice(openBrace + 1, close),
      bodyOffset: openBrace + 1,
    });
  }
  return ctrls;
}

function extractMethods(body, classPrefix, file, bodyOffset, content) {
  const routes = [];
  const tokens = Object.keys(MAPPING_TO_METHOD).concat(['RequestMapping']);
  // Three shapes:
  //   @GetMapping                          — no args (bare, path = "")
  //   @GetMapping("/x")                    — path string
  //   @RequestMapping(value="/x", method=RequestMethod.GET)
  // `[^)]*` trailing group allows the RequestMapping method= parse.
  const re = new RegExp(
    `@(${tokens.join('|')})(?:\\s*\\(\\s*(?:value\\s*=\\s*)?(?:['"]([^'"]*)['"])?([^)]*)?\\))?`,
    'g',
  );
  let m;
  while ((m = re.exec(body)) !== null) {
    let method = MAPPING_TO_METHOD[m[1]];
    const pathSuffix = m[2] || '';
    const tail = m[3] || '';
    if (m[1] === 'RequestMapping') {
      // Parse `method = RequestMethod.GET` from the tail — default GET.
      const mm = tail.match(/method\s*=\s*RequestMethod\.([A-Z]+)/);
      method = mm ? mm[1] : 'GET';
    }

    const after = body.slice(m.index + m[0].length);
    // Skip intervening annotations, then `public|protected|private ReturnType name(`
    const sig = after.match(/(?:\s*@[^\n]*\n)*\s*(?:public\s+|protected\s+|private\s+|static\s+|final\s+)*[A-Za-z_<>,\[\]\s]+?([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (!sig) continue;
    const handler = sig[1];

    const fullPath = `/${[classPrefix, pathSuffix].filter(Boolean).join('/')}`.replace(/\/+/g, '/');
    const absoluteOffset = bodyOffset + m.index;
    routes.push({
      method,
      path: fullPath,
      handler,
      line: (content.slice(0, absoluteOffset).match(/\n/g) || []).length + 1,
      file,
    });
  }
  return routes;
}

export const springPlugin = createFrameworkPlugin({
  name: 'spring',

  async detect({ repoRoot }) {
    // Look for spring-boot in pom.xml / build.gradle / build.gradle.kts
    for (const f of ['pom.xml', 'build.gradle', 'build.gradle.kts']) {
      const raw = await tryReadFile(`${repoRoot}/${f}`);
      if (raw && /spring-boot|spring-web/i.test(raw)) return true;
    }
    return false;
  },

  async enrich({ repoRoot, result }) {
    const nodes = [...result.nodes];
    const refs = [...result.refs];
    const files = await walkFiles(repoRoot, ['.java', '.kt']);

    for (const abs of files) {
      const content = await tryReadFile(abs);
      if (!content) continue;
      if (!/@(?:Rest)?Controller/.test(content)) continue;
      const rp = relPath(repoRoot, abs);
      const lang = abs.endsWith('.kt') ? 'kotlin' : 'java';
      for (const ctrl of extractControllers(content)) {
        for (const r of extractMethods(ctrl.body, ctrl.prefix, rp, ctrl.bodyOffset, content)) {
          const label = `${r.method} ${r.path}`;
          const node = routeNode({ filePath: rp, label, language: lang, startLine: r.line });
          nodes.push(node);
          refs.push(invokesRef({
            node, target: r.handler, extractor: 'spring',
            sourceFile: rp, sourceLine: r.line,
          }));
        }
      }
    }
    return { nodes, edges: result.edges, refs };
  },
});
