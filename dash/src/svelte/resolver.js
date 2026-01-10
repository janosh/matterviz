/* eslint-disable global-require */

// Build-time component discovery.
// This pulls in ALL .svelte files shipped by matterviz under dist/.
//
// Users can select a component by:
// - base name: "Structure"
// - path key:  "structure/Structure" (recommended if ambiguous)
//
// NOTE: This runs in the webpack build; require.context is webpack-specific.
// Use the webpack alias 'matterviz-dist' (see webpack.config.js) to avoid
// package.json exports restrictions on deep imports.
const req = require.context('matterviz-dist', true, /\.svelte$/);

/** @type {Map<string, any>} */
const componentsByKey = new Map();
/** @type {Map<string, string[]>} */
const keysByBaseName = new Map();

for (const rawKey of req.keys()) {
  // rawKey is like "./structure/Structure.svelte"
  const key = rawKey.replace(/^\.\//, '').replace(/\.svelte$/, '');
  const mod = req(rawKey);
  const comp = mod && mod.default ? mod.default : mod;

  if (!comp) continue;

  componentsByKey.set(key, comp);

  const baseName = key.split('/').pop();
  const list = keysByBaseName.get(baseName) || [];
  list.push(key);
  keysByBaseName.set(baseName, list);
}

export function listComponentKeys() {
  return Array.from(componentsByKey.keys()).sort();
}

/**
 * Resolve a MatterViz component from an identifier.
 *
 * @param {string} id - e.g. "Structure" or "structure/Structure"
 * @returns {{ component: any | null, key: string | null, error: string | null, matches: string[] | null }}
 */
export function resolveMattervizComponent(id) {
  if (!id || typeof id !== 'string') {
    return {
      component: null,
      key: null,
      error: 'Missing component identifier',
      matches: null
    };
  }

  // normalize
  const norm = id.replace(/^\.\//, '').replace(/\.svelte$/, '');

  if (componentsByKey.has(norm)) {
    return { component: componentsByKey.get(norm), key: norm, error: null, matches: null };
  }

  // If the user gave a path but without the leading directories we may still not match;
  // no further normalization for now.

  // Try base-name resolution.
  if (keysByBaseName.has(norm)) {
    const matches = keysByBaseName.get(norm) || [];
    if (matches.length === 1) {
      const key = matches[0];
      return { component: componentsByKey.get(key), key, error: null, matches: null };
    }

    return {
      component: null,
      key: null,
      error: `Ambiguous component name "${id}". Use a path key instead.`,
      matches
    };
  }

  return {
    component: null,
    key: null,
    error: `Unknown component "${id}".`,
    matches: null
  };
}
