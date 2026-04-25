import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import python from '../../../mcp/stdio/ingest/languages/python.js';
import php from '../../../mcp/stdio/ingest/languages/php.js';
import c from '../../../mcp/stdio/ingest/languages/c.js';
import cpp from '../../../mcp/stdio/ingest/languages/cpp.js';
import typescript from '../../../mcp/stdio/ingest/languages/typescript.js';
import javascript from '../../../mcp/stdio/ingest/languages/javascript.js';
import java from '../../../mcp/stdio/ingest/languages/java.js';
import ruby from '../../../mcp/stdio/ingest/languages/ruby.js';
import rust from '../../../mcp/stdio/ingest/languages/rust.js';

function findNode(nodes, type, label) {
  return nodes.find((node) => node.type === type && node.label === label);
}

function findRef(refs, relation, fromLabel, target) {
  return refs.find((ref) =>
    ref.relation === relation
    && ref.from_label === fromLabel
    && ref.target === target
  );
}

describe('generic extractor', () => {
  it('extracts Python symbols, containment edges, imports, and calls', () => {
    const source = [
      'import os',
      '',
      'class Greeter:',
      '    def hello(self, name):',
      '        print(name)',
      '',
      'def run():',
      '    hello("world")',
      '    return Greeter',
      '',
    ].join('\n');

    const result = extractFile({
      filePath: 'src/greeter.py',
      source,
      config: python,
    });

    expect(findNode(result.nodes, 'File', 'greeter.py')).toBeTruthy();
    expect(findNode(result.nodes, 'Module', 'src.greeter')).toBeTruthy();
    expect(findNode(result.nodes, 'Class', 'Greeter')).toBeTruthy();
    expect(findNode(result.nodes, 'Method', 'hello')).toBeTruthy();
    expect(findNode(result.nodes, 'Function', 'run')).toBeTruthy();

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: 'CONTAINS', from_label: 'src.greeter', to_label: 'greeter.py' }),
        expect.objectContaining({ relation: 'DEFINES', from_label: 'greeter.py', to_label: 'Greeter' }),
        expect.objectContaining({ relation: 'DEFINES', from_label: 'greeter.py', to_label: 'run' }),
        expect.objectContaining({ relation: 'CONTAINS', from_label: 'Greeter', to_label: 'hello' }),
      ]),
    );

    expect(findRef(result.refs, 'IMPORTS', 'greeter.py', 'os')).toBeTruthy();
    expect(findRef(result.refs, 'CALLS', 'hello', 'print')).toBeTruthy();
    expect(findRef(result.refs, 'CALLS', 'run', 'hello')).toBeTruthy();
    expect(findRef(result.refs, 'REFERENCES', 'run', 'Greeter')).toBeTruthy();
  });

  it('extracts PHP classes, methods, imports, and function calls', () => {
    const source = [
      '<?php',
      'use App\\Http\\Controllers\\HomeController;',
      '',
      'function run() {',
      '  helper();',
      '}',
      '',
      'class Greeter {',
      '  public function hello($name) {',
      '    helper();',
      '  }',
      '}',
      '',
    ].join('\n');

    const result = extractFile({
      filePath: 'app/Greeter.php',
      source,
      config: php,
    });

    expect(findNode(result.nodes, 'File', 'Greeter.php')).toBeTruthy();
    expect(findNode(result.nodes, 'Module', 'app.Greeter')).toBeTruthy();
    expect(findNode(result.nodes, 'Function', 'run')).toBeTruthy();
    expect(findNode(result.nodes, 'Class', 'Greeter')).toBeTruthy();
    expect(findNode(result.nodes, 'Method', 'hello')).toBeTruthy();

    expect(findRef(result.refs, 'IMPORTS', 'Greeter.php', 'App\\Http\\Controllers\\HomeController')).toBeTruthy();
    expect(findRef(result.refs, 'CALLS', 'run', 'helper')).toBeTruthy();
    expect(findRef(result.refs, 'CALLS', 'hello', 'helper')).toBeTruthy();
  });

  it('extracts C functions and include dependencies with tier confidence', () => {
    const source = [
      '#include <stdio.h>',
      '',
      'int helper(void);',
      'int run(void) {',
      '  helper();',
      '  return 0;',
      '}',
      '',
    ].join('\n');

    const result = extractFile({
      filePath: 'src/run.c',
      source,
      config: c,
    });

    const fileNode = findNode(result.nodes, 'File', 'run.c');
    const functionNode = findNode(result.nodes, 'Function', 'run');
    expect(fileNode).toBeTruthy();
    expect(functionNode).toBeTruthy();
    expect(functionNode.confidence).toBe(0.75);

    expect(findRef(result.refs, 'IMPORTS', 'run.c', 'stdio.h')).toBeTruthy();
    expect(findRef(result.refs, 'CALLS', 'run', 'helper')).toMatchObject({
      confidence: 0.75,
      extractor: 'c',
    });
  });

  it('emits REFERENCES for non-call symbol usage inside call arguments', () => {
    const source = [
      'def get_db():',
      '    pass',
      '',
      'def route(Depends):',
      '    return Depends(get_db)',
      '',
    ].join('\n');

    const result = extractFile({
      filePath: 'service/routes.py',
      source,
      config: python,
    });

    expect(findRef(result.refs, 'CALLS', 'route', 'Depends')).toBeTruthy();
    expect(findRef(result.refs, 'REFERENCES', 'route', 'get_db')).toBeTruthy();
  });

  it('emits inheritance refs for class extension and interface implementation', () => {
    const pythonSource = [
      'class Base:',
      '    pass',
      '',
      'class Child(Base):',
      '    pass',
      '',
    ].join('\n');

    const pythonResult = extractFile({
      filePath: 'service/models.py',
      source: pythonSource,
      config: python,
    });

    expect(findRef(pythonResult.refs, 'EXTENDS', 'Child', 'Base')).toBeTruthy();

    const tsSource = [
      'interface Runner {}',
      'class Base {}',
      'class Child extends Base implements Runner {}',
      '',
    ].join('\n');

    const tsResult = extractFile({
      filePath: 'src/models.ts',
      source: tsSource,
      config: typescript,
    });

    expect(findRef(tsResult.refs, 'EXTENDS', 'Child', 'Base')).toBeTruthy();
    expect(findRef(tsResult.refs, 'IMPLEMENTS', 'Child', 'Runner')).toBeTruthy();
  });

  it('types test functions as Test and emits TESTS refs for their calls', () => {
    const source = [
      'def helper():',
      '    pass',
      '',
      'def test_helper():',
      '    helper()',
      '',
    ].join('\n');

    const result = extractFile({
      filePath: 'tests/test_helper.py',
      source,
      config: python,
    });

    expect(findNode(result.nodes, 'Test', 'test_helper')).toBeTruthy();
    expect(findRef(result.refs, 'CALLS', 'test_helper', 'helper')).toBeTruthy();
    expect(findRef(result.refs, 'TESTS', 'test_helper', 'helper')).toBeTruthy();
  });

  it('emits multiple import refs for Python from-import statements', () => {
    const source = [
      'from service.db import get_db, close_db',
      '',
    ].join('\n');

    const result = extractFile({
      filePath: 'service/routes.py',
      source,
      config: python,
    });

    expect(findRef(result.refs, 'IMPORTS', 'routes.py', 'service.db.get_db')).toBeTruthy();
    expect(findRef(result.refs, 'IMPORTS', 'routes.py', 'service.db.close_db')).toBeTruthy();
  });

  it('emits named TypeScript imports with module-qualified targets', () => {
    const source = [
      "import { foo, bar as baz } from './helpers';",
      '',
    ].join('\n');

    const result = extractFile({
      filePath: 'src/main.ts',
      source,
      config: typescript,
    });

    expect(findRef(result.refs, 'IMPORTS', 'main.ts', 'helpers.foo')).toBeTruthy();
    expect(findRef(result.refs, 'IMPORTS', 'main.ts', 'helpers.bar')).toBeTruthy();
  });

  it('emits USES_TYPE refs for signature annotations without downgrading them to REFERENCES', () => {
    const pythonSource = [
      'class Greeter:',
      '    pass',
      '',
      'def run(item: Greeter) -> Greeter:',
      '    return item',
      '',
    ].join('\n');

    const pythonResult = extractFile({
      filePath: 'service/types.py',
      source: pythonSource,
      config: python,
    });

    const pythonTypeRefs = pythonResult.refs.filter((ref) =>
      ref.from_label === 'run' && ref.relation === 'USES_TYPE' && ref.target === 'Greeter'
    );
    expect(pythonTypeRefs).toHaveLength(2);
    expect(findRef(pythonResult.refs, 'REFERENCES', 'run', 'Greeter')).toBeFalsy();

    const tsSource = [
      'interface Runner {}',
      'class Greeter {}',
      'function run(item: Greeter): Runner {',
      '  return item as unknown as Runner;',
      '}',
      '',
    ].join('\n');

    const tsResult = extractFile({
      filePath: 'src/types.ts',
      source: tsSource,
      config: typescript,
    });

    expect(findRef(tsResult.refs, 'USES_TYPE', 'run', 'Greeter')).toBeTruthy();
    expect(findRef(tsResult.refs, 'USES_TYPE', 'run', 'Runner')).toBeTruthy();
  });

  it('emits Java import refs from import_declaration descendants', () => {
    const source = [
      'import java.util.List;',
      'import com.example.Service;',
      '',
      'class Greeter {}',
      '',
    ].join('\n');

    const result = extractFile({
      filePath: 'src/Greeter.java',
      source,
      config: java,
    });

    expect(findRef(result.refs, 'IMPORTS', 'Greeter.java', 'java.util.List')).toBeTruthy();
    expect(findRef(result.refs, 'IMPORTS', 'Greeter.java', 'com.example.Service')).toBeTruthy();
  });

  it('limits Ruby imports to require statements', () => {
    const source = [
      'require "json"',
      'require_relative "lib/worker"',
      'foo(bar)',
      '',
    ].join('\n');

    const result = extractFile({
      filePath: 'app/main.rb',
      source,
      config: ruby,
    });

    expect(findRef(result.refs, 'IMPORTS', 'main.rb', 'json')).toBeTruthy();
    expect(findRef(result.refs, 'IMPORTS', 'main.rb', 'lib/worker')).toBeTruthy();
    expect(findRef(result.refs, 'IMPORTS', 'main.rb', 'foo')).toBeFalsy();
    expect(findRef(result.refs, 'CALLS', 'main.rb', 'foo')).toBeFalsy();
  });

  it('supports Rust impl blocks as class containers for methods', () => {
    const source = [
      'struct Greeter;',
      'impl Greeter {',
      '  fn run() {}',
      '}',
      '',
    ].join('\n');

    const result = extractFile({
      filePath: 'src/greeter.rs',
      source,
      config: rust,
    });

    expect(findNode(result.nodes, 'Class', 'Greeter')).toBeTruthy();
    expect(findNode(result.nodes, 'Method', 'run')).toBeTruthy();
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: 'CONTAINS', from_label: 'Greeter', to_label: 'run' }),
      ]),
    );
  });

  it('extracts out-of-class C++ method definitions as Method with parent class metadata', () => {
    const fixtureDir = join(process.cwd(), 'tests', 'fixtures', 'ingest', 'tiny-cpp-methods');
    const source = readFileSync(join(fixtureDir, 'Foo.cpp'), 'utf8');

    const result = extractFile({
      filePath: 'src/Foo.cpp',
      source,
      config: cpp,
    });

    const method = findNode(result.nodes, 'Method', 'bar');
    expect(method).toBeTruthy();
    expect(method.extra.parent_class).toBe('Foo');
    expect(method.extra.qname).toBe('Foo.bar');
    expect(result.refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: 'CONTAINS', from_target: 'Foo', to_id: method.id }),
      ]),
    );
  });

  it('emits REFERENCES for TypeScript and JavaScript decorators', () => {
    const fixtureDir = join(process.cwd(), 'tests', 'fixtures', 'ingest', 'tiny-typescript');
    const tsSource = readFileSync(join(fixtureDir, 'decorators.ts'), 'utf8');
    const jsSource = readFileSync(join(fixtureDir, 'decorators.js'), 'utf8');

    const tsResult = extractFile({
      filePath: 'src/decorators.ts',
      source: tsSource,
      config: typescript,
    });
    const jsResult = extractFile({
      filePath: 'src/decorators.js',
      source: jsSource,
      config: javascript,
    });

    expect(findRef(tsResult.refs, 'REFERENCES', 'AppController', 'Controller')).toBeTruthy();
    expect(findRef(tsResult.refs, 'REFERENCES', 'list', 'Get')).toBeTruthy();
    expect(findRef(tsResult.refs, 'REFERENCES', 'TodoStore', 'observable')).toBeTruthy();

    expect(findRef(jsResult.refs, 'REFERENCES', 'Widget', 'Component')).toBeTruthy();
    expect(findRef(jsResult.refs, 'REFERENCES', 'boot', 'action')).toBeTruthy();
  });

  it('extracts template-specialized C++ methods as Method with stripped template scope', () => {
    const fixtureDir = join(process.cwd(), 'tests', 'fixtures', 'ingest', 'tiny-cpp-methods');
    const source = readFileSync(join(fixtureDir, 'FooTemplate.cpp'), 'utf8');

    const result = extractFile({
      filePath: 'src/FooTemplate.cpp',
      source,
      config: cpp,
    });

    const method = findNode(result.nodes, 'Method', 'bar');
    expect(method).toBeTruthy();
    expect(method.extra.parent_class).toBe('Foo');
    expect(method.extra.qname).toBe('Foo.bar');
    expect(result.refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: 'CONTAINS', from_target: 'Foo', to_id: method.id }),
      ]),
    );
  });

  it('keeps C++ class context for explicit self and qualified method calls', () => {
    const source = `
class ChunkManager {
public:
  void tick();
  void isOpenAir();
};

void ChunkManager::tick() {
  isOpenAir();
  this->isOpenAir();
  ChunkManager::isOpenAir();
  World::ChunkManager<int>::isOpenAir();
  other.isOpenAir();
}
`;

    const result = extractFile({
      filePath: 'engine/voxel/ChunkManager.cpp',
      source,
      config: cpp,
    });

    const targets = result.refs
      .filter((ref) => ref.relation === 'CALLS' && ref.from_label === 'tick')
      .map((ref) => ref.target);

    expect(targets).toContain('ChunkManager.isOpenAir');
    expect(targets.filter((target) => target === 'ChunkManager.isOpenAir')).toHaveLength(2);
    expect(targets).toContain('World.ChunkManager.isOpenAir');
    expect(targets.filter((target) => target === 'isOpenAir')).toHaveLength(2);
    expect(targets).toContain('isOpenAir');
  });
});
