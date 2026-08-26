import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HARD_GATED_RELATIONS } from '../../../mcp/stdio/ingest/resolver.js';

// ⛔ THE ENUMERATION GUARD THAT WOULD HAVE CAUGHT THIS THE DAY IT LANDED.
//
// The resolver gates hard relations by language family, and `languageFamily` returns its input
// unchanged for anything it does not recognise — so a ref carrying only `extractor: 'node-web'` was
// gated into a family no node belongs to, and the routed target became an `External` stub beside the
// function it should have bound to.
//
// Someone hit this once and fixed the framework in front of them: the resolver's language map
// carries a lone `['laravel','php']` entry. Enumerated, laravel was 1 of 10 — nine framework tags
// were silently broken for as long as they had existed.
//
// ⇒ A RULE IN A LOOKUP TABLE CANNOT ENFORCE ITSELF. This enumerates the plugin DIRECTORY and RUNS
// each plugin, so a new framework plugin is covered the day it lands.
//
// ⚠ THE FIRST VERSION OF THIS FILE SCANNED SOURCE TEXT and the repo's suite-composition guard
// rejected it — correctly: a test that regexes implementation text cannot fail when the behaviour
// breaks, and CAN fail when a line is reflowed. It now drives `detect()` and `enrich()` for real.
//
// ⭐ AND SWITCHING IT ON FOUND FIVE MORE SITES THAN THE FIXTURES DID — including a PASSES_THROUGH in
// python_web that the Flask fixture never exercised, because that fixture only went through the
// INVOKES path.

const FRAMEWORK_DIR = resolve('mcp/stdio/ingest/frameworks');

// A minimal repository per plugin: enough to make `detect()` true and `enrich()` emit refs.
// ⚠ Every plugin file in the directory MUST appear here or the enumeration test fails — that is how
// a new plugin is forced into coverage instead of being silently uncovered.
const FIXTURES = {
  'node_web.js': {
    'package.json': '{"dependencies":{"express":"^4.0.0"}}',
    'src/routes.js': "const app = require('express')();\napp.post('/orders', requireAuth, createOrder);\n",
  },
  'nestjs.js': {
    'package.json': '{"dependencies":{"@nestjs/core":"^10.0.0"}}',
    'src/orders.controller.ts': "@Controller('orders')\nexport class OrdersController {\n  @Post()\n  @UseGuards(AuthGuard)\n  createOrder() { return 1; }\n}\n",
  },
  'python_web.js': {
    'requirements.txt': 'fastapi==0.110.0',
    // ⚠ TWO THINGS ARE LORE HERE. The plugin skips any .py file not mentioning
    // fastapi/flask/Blueprint, and `Depends(...)` is what triggers the PASSES_THROUGH path. Omitting
    // the first made this fixture emit NOTHING while an aggregate control still passed on other
    // plugins' refs; omitting the second let a mutant deleting this plugin's language survive.
    'app/main.py': 'from fastapi import FastAPI\n\n@app.post("/orders")\ndef create_order(payload = Depends(require_auth)):\n    return 1\n',
  },
  'django.js': {
    'requirements.txt': 'django==5.0',
    'app/urls.py': "from django.urls import path\nurlpatterns = [\n    path('articles/', views.year_archive),\n]\n",
  },
  'laravel.js': {
    'composer.json': '{"require":{"laravel/framework":"^11.0"}}',
    // ⚠ `Route::middleware(...)->post(...)` is what triggers laravel's PASSES_THROUGH chain. The
    // bare `Route::post` form reaches only INVOKES, and a mutant deleting a middleware language
    // survived against it.
    'routes/web.php': "<?php\nRoute::post('/orders', [OrderController::class, 'store']);\nRoute::middleware(['auth', 'throttle'])->group(function () {\n    Route::get('/admin', [AdminController::class, 'index']);\n});\n",
  },
  'rails.js': {
    Gemfile: "gem 'rails'",
    // ⚠ `resources` is what expands into routes here; the bare `get ... to:` line alone produced
    // nothing and left this plugin silently unchecked.
    'config/routes.rb': "Rails.application.routes.draw do\n  get 'orders', to: 'orders#index'\n  resources :articles\nend\n",
  },
  'spring.js': {
    'pom.xml': '<project><dependency>spring-boot</dependency></project>',
    'src/OrderController.java': '@RestController\npublic class OrderController {\n  @GetMapping("/orders")\n  public String list() { return ""; }\n}\n',
  },
  'cpp_frameworks.js': {
    'src/worker.cpp': 'void Worker::runTask() {\n    emit progressChanged(50);\n}\n',
  },
  // Emits only bridge / ungated relations (LOADS_SHADER, DECLARES_BINDING, IMPORTS), so it has no
  // hard-gated ref to carry a language on. Present here so the directory enumeration stays complete.
  'shader_bindings.js': { 'shaders/a.frag': 'layout(binding = 0) uniform sampler2D tex;\n' },
  'cmake.js': { 'CMakeLists.txt': 'add_executable(app main.cpp)\n' },
  'virtual_overrides.js': { 'src/a.cpp': 'class A { virtual void f(); };\n' },
};

function writeRepo(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

const pluginFileNames = () => readdirSync(FRAMEWORK_DIR).filter((f) => f.endsWith('.js') && !f.startsWith('_'));

async function loadPlugin(file) {
  const mod = await import(pathToFileURL(join(FRAMEWORK_DIR, file)).href);
  return Object.values(mod).find((v) => v && typeof v === 'object' && typeof v.detect === 'function' && typeof v.enrich === 'function');
}

describe('every framework plugin declares a language on the refs the resolver hard-gates', () => {
  let root;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'apg-fwlang-')); });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('⛔ EVERY plugin in the directory has a fixture — a new one cannot arrive uncovered', () => {
    // The whole failure being guarded against is "someone fixed the framework in front of them".
    // Enumerating the directory rather than a list is what makes that impossible to repeat quietly.
    const missing = pluginFileNames().filter((f) => !(f in FIXTURES));
    expect(missing, 'add a minimal fixture for this plugin so its refs are checked').toEqual([]);
  });

  // Plugins that legitimately emit NO hard-gated ref: their relations are bridge-exempt or ungated,
  // so there is nothing for a language to gate. Named individually — an unnamed plugin producing
  // nothing is a broken fixture, not an exemption.
  const NO_HARD_GATED_REFS = new Set(['shader_bindings.js', 'cmake.js', 'virtual_overrides.js']);

  // ⚠ A DECLARED GAP, NOT A SILENT ONE. laravel's middleware-chain PASSES_THROUGH refs are the one
  // language-carrying site no fixture here reaches: `Route::middleware([...])` was tried grouped,
  // grouped with `::class` tokens, and inline, and all three emit only the INVOKES ref. The chain
  // appears to need conventional groups from a Kernel file. A mutant deleting that site's language
  // therefore SURVIVES this guard — the other four sites' mutants are killed.
  // ⇒ Recorded here rather than left to be rediscovered, because an unstated gap in a green guard
  // reads as coverage.

  it('⭐ POSITIVE CONTROL: EVERY fixtured plugin emits hard-gated refs, not just some', async () => {
    // ⛔ THE FIRST VERSION OF THIS CONTROL SUMMED ACROSS PLUGINS and required the TOTAL to exceed a
    // threshold. python_web emitted ZERO — its fixture omitted the `fastapi` token the plugin greps
    // for — and the control passed anyway on other plugins' refs, so two mutants deleting a
    // language survived against a green suite.
    //
    // ⇒ AN AGGREGATE CONTROL HIDES PER-ITEM FAILURE. Assert per plugin.
    const silent = [];
    for (const file of pluginFileNames()) {
      if (NO_HARD_GATED_REFS.has(file)) continue;
      const plugin = await loadPlugin(file);
      if (!plugin) continue;
      writeRepo(root, FIXTURES[file]);
      if (!(await plugin.detect({ repoRoot: root }))) { silent.push(`${file} did not DETECT its fixture`); continue; }
      const out = await plugin.enrich({ repoRoot: root, result: { nodes: [], edges: [], refs: [] } });
      const gated = (out?.refs ?? []).filter((r) => HARD_GATED_RELATIONS.has(r.relation));
      if (gated.length === 0) silent.push(`${file} produced NO hard-gated ref`);
    }
    expect(silent, 'a fixture that produces nothing checks nothing — fix the fixture, or add the '
      + 'plugin to NO_HARD_GATED_REFS if it genuinely emits no gated relation').toEqual([]);
  });

  it('⛔ every hard-gated ref a plugin emits carries a language', async () => {
    const offenders = [];
    for (const file of pluginFileNames()) {
      const plugin = await loadPlugin(file);
      if (!plugin) continue;
      writeRepo(root, FIXTURES[file]);
      if (!(await plugin.detect({ repoRoot: root }))) continue;
      const out = await plugin.enrich({ repoRoot: root, result: { nodes: [], edges: [], refs: [] } });
      for (const ref of out?.refs ?? []) {
        if (!HARD_GATED_RELATIONS.has(ref.relation)) continue;
        if (!ref.language) offenders.push(`${file} emits ${ref.relation} -> ${ref.target} with no language`);
      }
    }
    expect(offenders, 'a hard-gated ref without a language cannot resolve — it becomes an External '
      + 'stub beside the real symbol. Carry the language the plugin already computed, as invokesRef '
      + 'does; do NOT add an entry to the resolver language map.').toEqual([]);
  });
});
