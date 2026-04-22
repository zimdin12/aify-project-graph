// C++ framework plugin: Qt signals/slots + GTest + Catch2.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cppFrameworksPlugin } from '../../../mcp/stdio/ingest/frameworks/cpp_frameworks.js';

describe('cpp_frameworks plugin', () => {
  let repo;
  beforeEach(async () => { repo = await mkdtemp(join(tmpdir(), 'apg-cpp-')); });
  afterEach(async () => {
    for (let i = 0; i < 5; i += 1) {
      try { await rm(repo, { recursive: true, force: true }); return; } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  it('detects any repo with C++ source files', async () => {
    await writeFile(join(repo, 'main.cpp'), '#include <iostream>\nint main() { return 0; }\n');
    expect(await cppFrameworksPlugin.detect({ repoRoot: repo })).toBe(true);
  });

  it('emits CALLS edge for Qt `emit signal()` inside a method', async () => {
    await writeFile(join(repo, 'widget.cpp'),
`#include <QObject>
void MyWidget::onButtonClicked() {
    emit dataChanged(42);
}
`);
    const out = await cppFrameworksPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    const emitRef = out.refs.find(r => r.relation === 'CALLS' && r.target === 'dataChanged' && r.extractor === 'qt');
    expect(emitRef).toBeDefined();
    expect(emitRef.from_target).toBe('onButtonClicked');
  });

  it('wires Qt4 SIGNAL()/SLOT() connect as signal→slot CALLS', async () => {
    await writeFile(join(repo, 'main.cpp'),
`void wire() {
    connect(sender, SIGNAL(valueChanged(int)), receiver, SLOT(onValueChanged(int)));
}
`);
    const out = await cppFrameworksPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    const edge = out.refs.find(r => r.relation === 'CALLS' && r.from_label === 'valueChanged' && r.target === 'onValueChanged');
    expect(edge).toBeDefined();
  });

  it('wires Qt5 pointer-to-member connect as signal→slot CALLS', async () => {
    await writeFile(join(repo, 'main.cpp'),
`void wire() {
    connect(sender, &Sender::dataReady, receiver, &Receiver::handleData);
}
`);
    const out = await cppFrameworksPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    const edge = out.refs.find(r => r.relation === 'CALLS' && r.from_label === 'dataReady' && r.target === 'handleData');
    expect(edge).toBeDefined();
  });

  it('emits Test nodes for GTest TEST / TEST_F / TEST_P', async () => {
    await writeFile(join(repo, 'math_test.cpp'),
`TEST(MathSuite, Addition) { EXPECT_EQ(1 + 1, 2); }
TEST_F(DatabaseFixture, CanConnect) { }
TEST_P(ParameterizedSuite, HandlesAllValues) { }
`);
    const out = await cppFrameworksPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    const labels = out.nodes.filter(n => n.type === 'Test').map(n => n.label).sort();
    expect(labels).toEqual([
      'DatabaseFixture.CanConnect',
      'MathSuite.Addition',
      'ParameterizedSuite.HandlesAllValues',
    ]);
  });

  it('emits Test nodes for Catch2 TEST_CASE + SCENARIO', async () => {
    await writeFile(join(repo, 'spec.cpp'),
`TEST_CASE("vector can be sized", "[vector]") { }
SCENARIO("opening a door") { GIVEN("a door") { } }
`);
    const out = await cppFrameworksPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    const labels = out.nodes.filter(n => n.type === 'Test').map(n => n.label).sort();
    expect(labels).toEqual(['opening a door', 'vector can be sized']);
  });
});
