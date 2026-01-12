import type { Component } from 'svelte'

export interface ResolvedComponent {
  // The resolved Svelte component, or null if not found
  component: Component | null
  // The normalized component key (e.g. "structure/Structure")
  key: string | null
  // Error message if resolution failed
  error: string | null
  // Possible matches if the component name was ambiguous
  matches: string[] | null
}

// Get a sorted list of all available MatterViz component keys.
// Returns array like ["brillouin/BrillouinZone", "structure/Structure", ...]
export function list_component_keys(): string[]

// Resolve a MatterViz component from an identifier.
// id: Component identifier, e.g. "Structure" or "structure/Structure"
// Returns resolution result with component, key, error, and possible matches
// Full path recommended: resolve_matterviz_component("structure/Structure")
// Base name works if unambiguous: resolve_matterviz_component("Structure")
export function resolve_matterviz_component(id: string): ResolvedComponent
