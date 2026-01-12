// Build-time component discovery using Vite's import.meta.glob.
// This pulls in ALL .svelte files shipped by matterviz under dist/.
//
// Users can select a component by:
// - base name: "Structure"
// - path key:  "structure/Structure" (recommended if ambiguous)

// Eagerly import all Svelte components from matterviz dist
// The glob pattern uses the alias defined in vite.config.js
const modules = import.meta.glob(`/node_modules/matterviz/dist/**/*.svelte`, {
  eager: true,
})

// Map<string, any> - component key -> Svelte component
const componentsByKey = new Map()
// Map<string, string[]> - base name -> list of matching keys
const keysByBaseName = new Map()

for (const [rawPath, mod] of Object.entries(modules)) {
  // rawPath is like "/node_modules/matterviz/dist/structure/Structure.svelte"
  const match = rawPath.match(/\/node_modules\/matterviz\/dist\/(.+)\.svelte$/)
  if (!match) continue

  const key = match[1] // e.g. "structure/Structure"
  const comp = mod && mod.default ? mod.default : mod

  if (!comp) continue

  componentsByKey.set(key, comp)

  const baseName = key.split(`/`).pop()
  const list = keysByBaseName.get(baseName) || []
  list.push(key)
  keysByBaseName.set(baseName, list)
}

export function listComponentKeys() {
  return Array.from(componentsByKey.keys()).sort()
}

// Resolve a MatterViz component from an identifier.
// id: e.g. "Structure" or "structure/Structure"
// Returns: { component, key, error, matches }
export function resolveMattervizComponent(id) {
  const err = (error, matches = null) => ({ component: null, key: null, error, matches })
  const ok = (key) => ({
    component: componentsByKey.get(key),
    key,
    error: null,
    matches: null,
  })

  if (!id || typeof id !== `string`) return err(`Missing component identifier`)

  const norm = id.replace(/^\.\//, ``).replace(/\.svelte$/, ``)

  if (componentsByKey.has(norm)) return ok(norm)

  const matches = keysByBaseName.get(norm)
  if (matches?.length === 1) return ok(matches[0])
  if (matches?.length > 1) {
    return err(`Ambiguous component name "${id}". Use a path key instead.`, matches)
  }

  return err(`Unknown component "${id}".`)
}
