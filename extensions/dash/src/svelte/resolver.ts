// Build-time component discovery using Vite's import.meta.glob.
// This pulls in ALL .svelte files shipped by matterviz under dist/.
//
// Users can select a component by:
// - base name: "Structure"
// - path key:  "structure/Structure" (recommended if ambiguous)

import type { Component } from 'svelte'

// Eagerly import all Svelte components from matterviz dist.
// The import.meta.glob uses a direct node_modules path (leading slash is
// project-root relative) rather than a Vite alias.
const modules = import.meta.glob(`/node_modules/matterviz/dist/**/*.svelte`, {
  eager: true,
}) as Record<string, { default?: Component }>

const components_by_key = new Map<string, Component>()
const keys_by_base_name = new Map<string, string[]>()

for (const [raw_path, mod] of Object.entries(modules)) {
  // raw_path is like "/node_modules/matterviz/dist/structure/Structure.svelte"
  const match = raw_path.match(/\/node_modules\/matterviz\/dist\/(.+)\.svelte$/)
  if (!match) continue

  const key = match[1] // e.g. "structure/Structure"
  const comp = mod?.default
  if (!comp) {
    if (import.meta.env.DEV) {
      console.warn(`Module at ${raw_path} has no default export, skipping`)
    }
    continue
  }

  components_by_key.set(key, comp)

  const base_name = key.split(`/`).pop() as string
  const list = keys_by_base_name.get(base_name) || []
  list.push(key)
  keys_by_base_name.set(base_name, list)
}

interface ResolveResult {
  component: Component | null
  key: string | null
  error: string | null
  matches: string[] | null
}

export function list_component_keys(): string[] {
  return Array.from(components_by_key.keys()).sort()
}

// Resolve a MatterViz component from an identifier.
// id: e.g. "Structure" or "structure/Structure"
export function resolve_matterviz_component(id: string): ResolveResult {
  const err = (error: string, matches: string[] | null = null): ResolveResult => ({
    component: null,
    key: null,
    error,
    matches,
  })
  const ok = (key: string): ResolveResult => ({
    component: components_by_key.get(key) ?? null,
    key,
    error: null,
    matches: null,
  })

  if (!id || typeof id !== `string`) return err(`Missing component identifier`)

  const norm = id.replace(/^\.\//, ``).replace(/\.svelte$/, ``)

  if (components_by_key.has(norm)) return ok(norm)

  const matches = keys_by_base_name.get(norm)
  if (matches?.length === 1) return ok(matches[0])
  if (matches && matches.length > 1) {
    return err(`Ambiguous component name "${id}". Use a path key instead.`, matches)
  }

  return err(`Unknown component "${id}".`)
}
