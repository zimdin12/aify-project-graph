// THE FRAMEWORK PLUGIN REGISTRY — one list, so nothing has to remember to widen a second one.
//
// ⛔ WHY THIS FILE EXISTS, and it is an INSTRUMENT defect rather than a product one. The plugins were
// enumerated as a literal array inside `freshness/orchestrator.js`, and `scripts/audit-ref-conservation-
// across-run.mjs` built its population from `extractFile` ALONE. So every ref a framework plugin
// emitted was outside the population the conservation audit measured:
//
//   · `shader_bindings.js:183,200,249` pushes IMPORTS **refs** with targets.
//   · `orchestrator.js:592` resolves `specialPlugins.refs` through the SAME ref pipeline as the
//     generic extractor's.
//   · so those refs become edges, and the audit could never report one lost — it never counted it.
//
// The graph was right. The measurement was narrower than the thing it claimed to measure, and every
// number stayed self-consistent, which is why nothing collided.
//
// ⭐ THE RULE THIS ENCODES (dashboard-manager, 2026-09-26): **A POPULATION IS A CLOSED SET, SO DERIVE
// IT, NEVER LIST IT.** A list you must remember to update is a defect with a delay on it; a population
// you must remember to widen is the same defect whose symptom is a PERMANENT GREEN. Adding a plugin
// here cannot narrow the audit's population, because there is no second place to remember.
//
// ⚠ WHAT THIS REGISTRY IS NOT. It is the set applied via `applyFrameworkPlugins`. It deliberately does
// NOT include:
//   · `sweepFilesystem` (orchestrator.js:554) — a separate producer of `special.nodes/edges`.
//   · `synthesizeVirtualOverrides` (orchestrator.js:73) — applied by its own route, not as a plugin.
//   · the code-intel importer, which writes via `upsertLspEdge`.
// Those are real edge producers and are outside this list ON PURPOSE. Anything relying on this set
// must say which producers it covers rather than implying it covers all of them — the mistake this
// file was created to stop being repeatable.
import { laravelRoutesPlugin } from './laravel.js';
import { pythonWebPlugin } from './python_web.js';
import { djangoPlugin } from './django.js';
import { nodeWebPlugin } from './node_web.js';
import { nestjsPlugin } from './nestjs.js';
import { railsPlugin } from './rails.js';
import { springPlugin } from './spring.js';
import { cppFrameworksPlugin } from './cpp_frameworks.js';
import { shaderBindingsPlugin } from './shader_bindings.js';
import { cmakePlugin } from './cmake.js';

// ⛔ ORDER IS PRESERVED FROM THE ORIGINAL INLINE ARRAY. Plugins run in sequence over one shared
// `result`, so a reorder is a behaviour change, not a tidy-up.
export const FRAMEWORK_PLUGINS = [
  laravelRoutesPlugin,
  pythonWebPlugin,
  djangoPlugin,
  nodeWebPlugin,
  nestjsPlugin,
  railsPlugin,
  springPlugin,
  cppFrameworksPlugin,
  shaderBindingsPlugin,
  cmakePlugin,
];
