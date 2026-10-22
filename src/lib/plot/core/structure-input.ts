// Input plumbing shared by the bar plots built from one-or-many structures (#lib/bond-angles,
// #lib/coordination): normalising the three accepted `structures` prop shapes and turning a
// dropped file into a new entry.

import { deliver_raw_file, open_material } from '#lib/file-viewer/open.js'
import type { MaterialSource } from '#lib/file-viewer/open.js'
import { raw_file_drop_zone } from '#lib/io/file-drop.js'
import type { FileLoadCallback } from '#lib/io/index.js'
import { parse_warnings_notice } from '#lib/labels.js'
import type { AnyStructure } from '#lib/structure/index.js'
import { materialize_frame_result } from '#lib/trajectory/frame.js'
import { to_error } from 'svelte-widgets/utils'
import type { Attachment } from 'svelte/attachments'

export interface StructureEntry {
  label: string
  structure: AnyStructure
  color?: string
}

// Sites of one input structure counted by a hovered plot element, for a linked structure viewer
// to highlight. `neighbor_indices`: partner atoms (bond-angle outer atoms, RDF pair partners),
// with periodic images mapped to their base site.
export interface StructureSiteHighlight {
  label: string
  structure: AnyStructure
  site_indices: number[]
  neighbor_indices?: number[]
}

// Deduped union of a highlight's sites and their partners, for a viewer that rings both
export const highlight_site_union = (
  highlight: Pick<StructureSiteHighlight, `site_indices` | `neighbor_indices`> | undefined,
): number[] =>
  highlight
    ? [...new Set([...highlight.site_indices, ...(highlight.neighbor_indices ?? [])])]
    : []

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

// Open a dropped file as a structure through open_material (worker parse, decompression): a
// volumetric file (CHGCAR, .cube) carries one, a trajectory contributes its first frame
const open_dropped_structure = async (
  source: MaterialSource,
): Promise<{ structure: AnyStructure; warnings: readonly string[] }> => {
  const opened = await open_material(source)
  try {
    if (opened.type === `structure`)
      return { structure: opened.data, warnings: opened.warnings ?? [] }
    if (opened.type === `isosurface`) {
      return { structure: opened.data.structure, warnings: opened.warnings ?? [] }
    }
    if (opened.type === `trajectory`) {
      const { frame_count, warnings } = opened.data
      const { structure } = await materialize_frame_result(opened.data.read_frame(0))
      const note = frame_count > 1 ? [`${frame_count} frames; plotted frame 1`] : []
      return { structure, warnings: [...warnings, ...note] }
    }
    throw new Error(`${opened.filename} is ${opened.type}, not a structure`)
  } finally {
    opened.dispose()
  }
}

// Drop zone for the plots computed from dropped files. A host's `on_file_drop` takes the raw
// file; else `intercept` may claim it (returning true, e.g. XRD's measured patterns); else it
// opens through open_dropped_structure into `on_structure`, whose throw rejects that file
// (e.g. a molecule where a cell is needed) and is reported with the drop. The drop's parse
// warnings, named by file, reach `on_warning` as one notice; each drop clears both messages.
// Callers read as getters so a reactive prop is not captured at construction time.
export const structure_drop_zone = ({
  on_file_drop,
  intercept,
  on_structure,
  on_error,
  on_warning,
  set_loading,
  ...opts
}: {
  allow: () => boolean
  on_file_drop: () => FileLoadCallback | undefined
  intercept?: (content: string | ArrayBuffer, filename: string) => Promise<boolean>
  on_structure: (structure: AnyStructure, filename: string) => Promise<void> | void
  on_error: (msg: string | undefined) => void
  on_warning: (msg: string | undefined) => void
  set_loading: (loading: boolean) => void
  on_dragover?: (over: boolean) => void
}): Attachment<HTMLElement> => {
  let warnings: string[] = []
  return raw_file_drop_zone({
    ...opts,
    on_error,
    set_loading: (loading) => {
      set_loading(loading)
      if (!loading) return
      warnings = []
      on_error(undefined)
      on_warning(undefined)
    },
    on_drop: (source) =>
      deliver_raw_file(source, async (content, filename, metadata) => {
        const host_drop = on_file_drop()
        if (host_drop) return host_drop(content, filename, metadata)
        if (await intercept?.(content, filename)) return
        const dropped = await open_dropped_structure({ data: content, filename, ...metadata })
        await on_structure(dropped.structure, filename)
        warnings.push(...dropped.warnings.map((msg) => `${filename}: ${msg}`))
        on_warning(parse_warnings_notice(warnings))
      }),
  })
}
