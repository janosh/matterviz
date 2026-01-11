import type { Component } from 'svelte'

export interface ResolvedComponent {
  /** The resolved Svelte component, or null if not found */
  component: Component | null
  /** The normalized component key (e.g. "structure/Structure") */
  key: string | null
  /** Error message if resolution failed */
  error: string | null
  /** Possible matches if the component name was ambiguous */
  matches: string[] | null
}

/**
 * Get a sorted list of all available MatterViz component keys.
 * @returns Array of component keys like ["brillouin/BrillouinZone", "structure/Structure", ...]
 */
export function listComponentKeys(): string[]

/**
 * Resolve a MatterViz component from an identifier.
 *
 * @param id - Component identifier, e.g. "Structure" or "structure/Structure"
 * @returns Resolution result with component, key, error, and possible matches
 *
 * @example
 * // Full path (recommended)
 * const result = resolveMattervizComponent("structure/Structure")
 *
 * @example
 * // Base name (works if unambiguous)
 * const result = resolveMattervizComponent("Structure")
 */
export function resolveMattervizComponent(id: string): ResolvedComponent
