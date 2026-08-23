// Input plumbing shared by the bar plots built from one-or-many structures ($lib/bond-angles,
// $lib/coordination): normalising the three accepted `structures` prop shapes and turning a
// dropped file into a new entry.

import { as_text, create_file_drop_handler } from '$lib/io'
import type { FileLoadCallback } from '$lib/io'
import type { AnyStructure } from '$lib/structure'
import { parse_structure_file } from '$lib/structure/parse'
import { to_error } from '$lib/utils'

export interface StructureEntry {
  label: string
  structure: AnyStructure
  color?: string
}

// A Record value is either a bare structure or one tagged with a plot colour
type RecordValue = AnyStructure | { structure: AnyStructure; color?: string }
export type StructureInput = AnyStructure | Record<string, RecordValue> | StructureEntry[]

// Normalize the three accepted input shapes to one array of { label, structure, color }.
// A lone structure is detected by its `sites` array rather than is_crystal(), so lattice-less
// molecules are not mistaken for a Record of structures.
export const to_structure_entries = (
  structures: StructureInput | undefined,
): StructureEntry[] => {
  if (!structures) return []
  if (Array.isArray(structures)) return structures
  if (`sites` in structures && Array.isArray(structures.sites)) {
    return [{ label: `Structure`, structure: structures as AnyStructure }]
  }
  const record = structures as Record<string, RecordValue>
  return Object.entries(record).map(([label, value]) =>
    `structure` in value ? { label, ...value } : { label, structure: value },
  )
}

// Run an analysis over every entry, reporting the structures it rejects (a NaN position, a
// degenerate lattice: neighbor_query throws on both) instead of letting the throw take the
// whole render down. Entries that compute are kept, so one bad dropped file does not blank
// the others. The failure rides back with the results because writing to a prop from inside
// a $derived is state_unsafe_mutation; callers hop it into `error_msg` with an $effect.
export const compute_structure_entries = <Data>(
  entries: readonly StructureEntry[],
  compute: (structure: AnyStructure) => Data,
): { entries: (StructureEntry & { data: Data })[]; error: string | undefined } => {
  const computed: (StructureEntry & { data: Data })[] = []
  const failures: string[] = []
  for (const entry of entries) {
    try {
      computed.push({ ...entry, data: compute(entry.structure) })
    } catch (exc) {
      failures.push(`${entry.label}: ${to_error(exc).message}`)
    }
  }
  return { entries: computed, error: failures.length > 0 ? failures.join(`; `) : undefined }
}

// Drop handler that parses each dropped file into a StructureEntry. Callers read as getters
// so a reactive prop is not captured at construction time; `on_file_drop` returning a
// callback replaces the parsing entirely so the caller can take over the drop.
export const create_structure_drop_handler = (opts: {
  allow: () => boolean
  on_entry: (entry: StructureEntry) => void
  on_error: (msg: string) => void
  set_loading: (loading: boolean) => void
  on_file_drop?: () => FileLoadCallback | undefined
}): ((event: DragEvent) => Promise<void>) =>
  create_file_drop_handler({
    allow: opts.allow,
    on_drop: (content, filename, metadata) => {
      const custom_handler = opts.on_file_drop?.()
      if (custom_handler) return custom_handler(content, filename, metadata)
      try {
        const structure = parse_structure_file(as_text(content), filename)
        if (!structure?.sites?.length) {
          opts.on_error(`${filename} has no sites, nothing to plot`)
          return
        }
        opts.on_entry({ label: filename || `Dropped structure`, structure })
      } catch (exc) {
        opts.on_error(`Failed to process structure: ${to_error(exc).message}`)
      }
    },
    on_error: opts.on_error,
    set_loading: opts.set_loading,
  })
