import type { ElementSymbol } from '$lib'
import type { PhaseDiagramData, PhaseEntry } from './types'

// Process phase diagram data to extract elements and categorize entries
export function process_pd_data(entries: PhaseEntry[]): PhaseDiagramData {
  const eps = 1e-6
  const stable_entries = entries.filter((entry) => {
    if (typeof entry.is_stable === `boolean`) return entry.is_stable
    const e_hull = entry.e_above_hull ?? Infinity // infinity fallback assumes unstable if e_above_hull undefined
    return e_hull <= eps
  })
  const unstable_entries = entries.filter((entry) => {
    if (typeof entry.is_stable === `boolean`) return !entry.is_stable
    const e_hull = entry.e_above_hull ?? Infinity // infinity fallback assumes unstable if e_above_hull undefined
    return e_hull > eps
  })

  // Extract unique elements and sort them for consistent ordering
  const elements = Array.from(
    new Set(entries.flatMap((entry) => Object.keys(entry.composition))),
  ).sort() as ElementSymbol[]

  // Find elemental references (pure element entries)
  const el_refs = Object.fromEntries(
    stable_entries
      .filter(is_elemental_entry)
      .map((entry) => [Object.keys(entry.composition)[0], entry]),
  )

  return { entries, stable_entries, unstable_entries, elements, el_refs }
}

// Check if entry represents a pure element
export function is_elemental_entry(entry: PhaseEntry): boolean {
  return Object.values(entry.composition).filter((v) => v > 0).length === 1
}
