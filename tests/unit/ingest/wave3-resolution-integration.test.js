// Audit Wave 3 — end-to-end: a small multi-file TS project exercising NodeNext
// import rewrite + renamed default-export + `new Foo()` instantiation + arrow-fn
// symbols + import-evidence-first, all through the real extract→resolve pipeline.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { resolveRefs } from '../../../mcp/stdio/ingest/resolver.js';
import { buildImportContext } from '../../../mcp/stdio/ingest/import-resolution.js';
import typescript from '../../../mcp/stdio/ingest/languages/typescript.js';

function insertNode(db, n) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
    {
      start_line: n.start_line ?? 1, end_line: n.end_line ?? 1, language: 'typescript',
      confidence: 1,
      ...n,
      extra: typeof n.extra === 'string' ? n.extra : JSON.stringify(n.extra ?? {}),
    },
  );
}

describe('Wave 3 — multi-file TS resolution (integration)', () => {
  it('resolves a renamed NodeNext default import + new() + arrow-fn call across files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apg-w3-'));
    const db = openDb(join(dir, 'graph.sqlite'));
    try {
      const files = {
        'src/service.ts': 'export default class Service {\n  run() { return 1; }\n}\n',
        'src/handlers.ts': 'export const onClick = () => { return 2; };\n',
        'src/app.ts': [
          "import Svc from './service.js';",      // NodeNext + default import, renamed
          "import { onClick } from './handlers.js';",
          'function main() {',
          '  const s = new Svc();',               // instantiation → CALLS Service
          '  s.run();',
          '  onClick();',                          // call to an arrow-fn const
          '}',
          '',
        ].join('\n'),
      };

      const allRefs = [];
      for (const [filePath, source] of Object.entries(files)) {
        const r = extractFile({ filePath, source, config: typescript });
        for (const node of r.nodes) insertNode(db, node);
        allRefs.push(...r.refs);
      }

      const ctx = buildImportContext({ repoRoot: dir, fileSet: new Set(Object.keys(files)) });
      const { edges } = resolveRefs({ db, importContext: ctx, refs: allRefs });

      const edgeTo = (label, relation) => edges.some((e) => {
        if (e.relation !== relation) return false;
        const to = db.get('SELECT label FROM nodes WHERE id = $id', { id: e.to_id });
        return to && to.label === label;
      });

      // `new Svc()` resolved through the NodeNext .js→.ts rewrite + default export.
      expect(edgeTo('Service', 'CALLS')).toBe(true);

      // onClick (arrow-fn const) call resolved via import evidence.
      expect(edgeTo('onClick', 'CALLS')).toBe(true);

      // The arrow-fn const and default-export marker exist as graph nodes.
      const onClickNode = db.get("SELECT type FROM nodes WHERE label = 'onClick'");
      expect(onClickNode?.type).toBe('Function');
      const svc = db.get("SELECT json_extract(extra,'$.isDefaultExport') AS d FROM nodes WHERE label = 'Service'");
      expect(svc?.d).toBeTruthy();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
