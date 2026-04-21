// Functionality overlay loader. Reads `.aify-graph/functionality.json`
// into an in-memory feature map, validates anchors against the code graph,
// and exposes cross-layer joins (file → features, symbol → features).
//
// File-backed (not DB-backed) per the A2 plan — lets the overlay shape
// evolve without locking us into schema decisions, and keeps hand-edits
// transparent/diffable.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// v0.1 schema:
//   {
//     version: "0.1",
//     features: [
//       {
//         id: "auth",
//         label: "Authentication",
//         description: "User login, session tokens, credential validation.",
//         anchors: {
//           symbols: ["authenticate", "verify_token", "User.__init__"],
//           files: ["src/auth/*", "src/users/session.py"],
//           routes: ["POST /auth/login"],
//           docs: ["docs/auth.md"]
//         },
//         source: "user",     // user | llm | clickup (Horizon B+)
//         tags: []
//       }
//     ]
//   }
export function overlayPath(repoRoot) {
  return join(repoRoot, '.aify-graph', 'functionality.json');
}

export function hasOverlay(repoRoot) {
  return existsSync(overlayPath(repoRoot));
}

export function loadFunctionality(repoRoot) {
  const path = overlayPath(repoRoot);
  if (!existsSync(path)) return { version: null, features: [], mtime: 0, path };
  try {
    const mtime = statSync(path).mtimeMs;
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const features = Array.isArray(raw.features) ? raw.features.map(normalizeFeature) : [];
    return { version: raw.version || '0.1', features, mtime, path };
  } catch (err) {
    return {
      version: null, features: [], mtime: 0, path,
      // Include a schema pointer so external tooling / humans know where to
      // look for the contract when the file fails to parse.
      error: `${err.message} (schema: docs/schemas/functionality.schema.json)`,
    };
  }
}

function normalizeFeature(f) {
  return {
    id: String(f.id || '').trim(),
    label: f.label || f.id || '',
    description: f.description || '',
    anchors: {
      symbols: Array.isArray(f.anchors?.symbols) ? f.anchors.symbols.filter(Boolean) : [],
      files: Array.isArray(f.anchors?.files) ? f.anchors.files.filter(Boolean) : [],
      routes: Array.isArray(f.anchors?.routes) ? f.anchors.routes.filter(Boolean) : [],
      docs: Array.isArray(f.anchors?.docs) ? f.anchors.docs.filter(Boolean) : [],
    },
    // v0.2: explicit feature→feature edges. depends_on is a hard dependency
    // (A breaks if B breaks). related_to is a weaker coupling (A touches B's
    // concepts but isn't strictly dependent). Both are user-curated;
    // algorithmic inference deliberately NOT auto-materialized here — would
    // be noisy through utility hubs. A separate skill-based "propose
    // dependencies" flow is deferred until v0.3.
    depends_on: Array.isArray(f.depends_on) ? f.depends_on.filter(Boolean) : [],
    related_to: Array.isArray(f.related_to) ? f.related_to.filter(Boolean) : [],
    // Contracts layer: doc/symbol refs this feature publishes or consumes.
    // Used by graph_consequences to bubble affected contracts on a change.
    contracts: Array.isArray(f.contracts) ? f.contracts.filter(Boolean) : [],
    source: f.source || 'user',
    tags: Array.isArray(f.tags) ? f.tags : [],
  };
}

// Return list of { from: featureId, to: featureId, kind: 'depends_on'|'related_to' }
// edges that point at features that DO NOT EXIST in the overlay. Surfaces
// broken-reference drift so the Trust line can flag it.
export function validateFeatureEdges(features) {
  const ids = new Set(features.map(f => f.id));
  const broken = [];
  for (const f of features) {
    for (const dep of f.depends_on) {
      if (!ids.has(dep)) broken.push({ from: f.id, to: dep, kind: 'depends_on' });
    }
    for (const rel of f.related_to) {
      if (!ids.has(rel)) broken.push({ from: f.id, to: rel, kind: 'related_to' });
    }
  }
  return broken;
}

// Check which anchors actually resolve in the current graph. Surfaces rot
// early so the brief's Trust line can steer agents away from stale
// feature maps.
export function validateAnchors(features, db) {
  if (!features.length) return { valid: [], broken: [] };
  const valid = [];
  const broken = [];

  for (const feature of features) {
    const resolved = {
      symbols: [], missing_symbols: [],
      files: [], missing_files: [],
      routes: [], missing_routes: [],
      docs: [], missing_docs: [],
    };

    for (const sym of feature.anchors.symbols) {
      const hit = db.get(
        `SELECT file_path FROM nodes
         WHERE label = $sym AND type IN ('Function','Method','Class','Interface','Type')
         LIMIT 1`, { sym });
      if (hit) resolved.symbols.push(sym);
      else resolved.missing_symbols.push(sym);
    }

    for (const file of feature.anchors.files) {
      // Accept File OR Directory nodes — feature anchors may point at a
      // directory glob where the graph indexes the dir but not individual
      // files under it (e.g. .md files in skill dirs).
      const pattern = file;
      const hit = db.get(
        `SELECT file_path FROM nodes
         WHERE type IN ('File','Directory') AND file_path GLOB $pattern
         LIMIT 1`, { pattern });
      if (hit) resolved.files.push(file);
      else resolved.missing_files.push(file);
    }

    for (const route of feature.anchors.routes) {
      const hit = db.get(
        `SELECT label FROM nodes WHERE type = 'Route' AND label = $route LIMIT 1`,
        { route });
      if (hit) resolved.routes.push(route);
      else resolved.missing_routes.push(route);
    }

    for (const doc of feature.anchors.docs) {
      const hit = db.get(
        `SELECT file_path FROM nodes
         WHERE type = 'Document' AND file_path = $doc
         LIMIT 1`, { doc });
      if (hit) resolved.docs.push(doc);
      else resolved.missing_docs.push(doc);
    }

    const totalDeclared = feature.anchors.symbols.length + feature.anchors.files.length
      + feature.anchors.routes.length + feature.anchors.docs.length;
    const totalResolved = resolved.symbols.length + resolved.files.length
      + resolved.routes.length + resolved.docs.length;
    const entry = { feature, resolved, totalDeclared, totalResolved };

    // A feature is "broken" if it has zero declared anchors (no way to
    // verify it maps to anything), zero resolved, or less than half of
    // declared anchors resolve. Zero-anchor was previously treated as
    // valid — dev audit 11b90fb flagged that a feature without anchors
    // can't be validated and should not silently pass.
    if (totalDeclared === 0 || totalResolved === 0 || totalResolved * 2 < totalDeclared) {
      broken.push(entry);
    } else {
      valid.push(entry);
    }
  }

  return { valid, broken };
}

// For a given file path, return the feature IDs whose anchors match it.
// Used by brief.plan generation to attribute files to features.
export function featuresForFile(features, filePath) {
  const matches = [];
  for (const f of features) {
    const globs = f.anchors.files;
    for (const g of globs) {
      if (globMatch(g, filePath)) {
        matches.push(f.id);
        break;
      }
    }
  }
  return matches;
}

// Lightweight glob — supports * (single-segment wildcard) and ** (multi).
// Not a full glob library; covers the common file-anchor cases in yaml.
function globMatch(pattern, path) {
  if (pattern === path) return true;
  // Escape regex specials, then translate * and ** to regex fragments.
  const regex = pattern
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*\*/g, '§§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§§/g, '.*');
  return new RegExp(`^${regex}$`).test(path);
}
