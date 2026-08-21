// Acquisition for the structure viewer: `data_url` fetches, `structure_string` parsing and
// drag-and-drop, including volumetric files (CHGCAR, cube) whose volumes merge into the loaded
// set when they describe the cell already on screen. Headless; Structure.svelte owns the
// bindable props and hands them over as accessors.
import * as io from '$lib/io'
import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface/types'
import {
  auto_isosurface_settings,
  label_file_volumes,
  lattices_match,
  materialize_layers,
  merge_imported_volumes,
} from '$lib/isosurface/types'
import { parse_volumetric_file } from '$lib/isosurface/parse'
import { to_error } from '$lib/utils'
import { untrack } from 'svelte'
import type { Attachment } from 'svelte/attachments'
import type { AnyStructure, StructureHandlerData } from './index'
import { parse_structure_file } from './parse'

export type StructureDocument = {
  structure: AnyStructure | undefined
  volumetric_data: VolumetricData[] | undefined
  isosurface_settings: IsosurfaceSettings
  active_volume_idx: number
}

export interface StructureLoaderInputs {
  document: () => StructureDocument
  set_document: (document: StructureDocument) => void
  set_loading: (loading: boolean) => void
  set_error: (message: string | undefined) => void
  set_dragover: (over: boolean) => void
  data_url: () => string | undefined
  structure_string: () => string | undefined
  allow_file_drop: () => boolean
  // The structure the viewer last produced by editing, so an edited URL-loaded structure still
  // counts as URL-owned (the caller did not supply it)
  last_edited_structure: () => AnyStructure | undefined
  // Host takes over dropped/fetched content instead of the built-in parsers
  on_file_drop: () =>
    | ((
        content: string | ArrayBuffer,
        filename: string,
        metadata: io.FileLoadMeta,
      ) => Promise<void> | void)
    | undefined
  on_file_load?: (data: StructureHandlerData) => void
  on_error?: (data: StructureHandlerData) => void
  on_notice?: (message: string) => void
}

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? `` : `s`}`

// Parse one text payload into the next document. Volumetric files whose cell matches the
// current structure append their volumes (or replace a re-imported source in place) so
// several fields can coexist; anything else replaces structure and volumes. Plain structure
// files keep loaded volumes only when they describe the same cell (mixed CHGCAR + POSCAR
// drops in either order). Throws when nothing could parse the content.
function open_structure_text(
  current: StructureDocument,
  text: string,
  filename: string,
  source_filename = filename,
): { document: StructureDocument; notice?: string } {
  const current_lattice =
    current.structure && `lattice` in current.structure
      ? current.structure.lattice.matrix
      : undefined
  const volumetric = parse_volumetric_file(text, filename)
  if (volumetric) {
    const incoming = label_file_volumes(volumetric.volumes, filename, source_filename)
    const same_cell = lattices_match(current_lattice, volumetric.structure.lattice?.matrix)
    if (same_cell && current.structure) {
      if (current.volumetric_data?.length) {
        // Materialize the implicit single surface into explicit layers so existing surfaces
        // survive the switch to multi-volume mode
        const merged = merge_imported_volumes(
          current.volumetric_data,
          materialize_layers(current.isosurface_settings, current.active_volume_idx),
          incoming,
          current.active_volume_idx,
        )
        return {
          document: {
            structure: current.structure,
            volumetric_data: merged.volumes,
            isosurface_settings: { ...current.isosurface_settings, layers: merged.layers },
            active_volume_idx: merged.first_touched_idx,
          },
          notice:
            merged.n_added > 0
              ? `Added ${plural(merged.n_added, `volume`)} from ${filename}`
              : `Reloaded volumes from ${filename}`,
        }
      }
      return {
        document: {
          structure: current.structure,
          volumetric_data: incoming,
          isosurface_settings: auto_isosurface_settings(incoming[0].data_range),
          active_volume_idx: 0,
        },
        notice: `Added ${plural(incoming.length, `volume`)} from ${filename}`,
      }
    }
    // Parsers set pbc so the header lattice conforms to Crystal's lattice type
    return {
      document: {
        structure: volumetric.structure,
        volumetric_data: incoming,
        isosurface_settings: auto_isosurface_settings(incoming[0].data_range),
        active_volume_idx: 0,
      },
    }
  }
  const parsed = parse_structure_file(text, filename)
  if (!parsed) throw new Error(`Failed to parse structure from ${filename}`)
  const same_cell = lattices_match(
    current_lattice,
    `lattice` in parsed ? parsed.lattice?.matrix : undefined,
  )
  return {
    document: {
      structure: parsed,
      volumetric_data: same_cell ? current.volumetric_data : [],
      isosurface_settings: current.isosurface_settings,
      active_volume_idx: same_cell ? current.active_volume_idx : 0,
    },
  }
}

export function create_structure_loader(inputs: StructureLoaderInputs) {
  const report_error = (message: string, filename?: string): void => {
    inputs.set_error(message)
    inputs.on_error?.({ error_msg: message, filename })
  }

  // Parse `content` into the document and tell the host. Errors propagate so a multi-file
  // drop aggregates every failure into one message.
  function load_text(
    content: string | ArrayBuffer,
    filename: string,
    metadata?: io.FileLoadMeta,
  ): void {
    const { document, notice } = open_structure_text(
      inputs.document(),
      io.as_text(content),
      filename,
      metadata?.source_filename,
    )
    inputs.set_document(document)
    if (notice) inputs.on_notice?.(notice)
    inputs.on_file_load?.({
      structure: document.structure,
      filename,
      ...metadata,
      file_size: io.content_byte_size(content),
      total_atoms: document.structure?.sites.length ?? 0,
    })
  }

  // === data_url ===
  const url_loader = io.create_data_url_loader<AnyStructure>()
  // Runs before the request effect below so an edit of a URL-loaded structure is re-attributed
  // to the URL instead of reading as a caller-supplied structure
  $effect.pre(() => {
    const { structure } = inputs.document()
    if (structure && structure === inputs.last_edited_structure()) {
      if (url_loader.loaded_url === inputs.data_url()) url_loader.claim(structure)
    }
  })
  $effect(() =>
    url_loader.request({
      url: inputs.data_url(),
      // A host on_file_drop owns the structure; its presence is not a caller-supplied cancel
      current_value: inputs.on_file_drop() ? undefined : inputs.document().structure,
      set_loading: inputs.set_loading,
      clear_error: () => inputs.set_error(undefined),
      on_load: async ({ content, filename, metadata, mark_owned }) => {
        const on_file_drop = inputs.on_file_drop()
        try {
          if (on_file_drop) {
            await on_file_drop(content, filename, metadata)
            mark_owned()
          } else {
            load_text(content, filename, metadata)
            // Read back rather than keep the parsed object: a $state-bound parent stores a
            // proxy of it, and the ownership check compares identities
            mark_owned(inputs.document().structure)
          }
        } catch (error) {
          console.error(`Failed to load structure from URL:`, error)
          report_error(
            `Failed to ${on_file_drop ? `load` : `parse`} structure: ${to_error(error).message}`,
            filename,
          )
        }
      },
      on_error: (error, filename) => {
        console.error(`Failed to load structure from URL:`, error)
        report_error(`Failed to load structure: ${error.message}`, filename)
      },
    }),
  )

  // === structure_string (synchronous, so no loading state) ===
  $effect(() => {
    const [structure_string, data_url] = [inputs.structure_string(), inputs.data_url()]
    if (!structure_string || data_url) return
    untrack(() => {
      inputs.set_error(undefined)
      try {
        load_text(structure_string, `string`)
      } catch (error) {
        report_error(
          `Failed to parse structure from string: ${to_error(error).message}`,
          `string`,
        )
      }
    })
  })

  // === drag and drop ===
  const drop_zone: Attachment<HTMLElement> = io.file_drop_zone({
    allow: inputs.allow_file_drop,
    on_drop: (content, filename, metadata) => {
      const on_file_drop = inputs.on_file_drop()
      if (on_file_drop) return on_file_drop(content, filename, metadata)
      load_text(content, filename, metadata)
    },
    on_error: (message) => report_error(message),
    set_loading: (value) => {
      inputs.set_loading(value)
      if (value) inputs.set_error(undefined)
    },
    on_dragover: inputs.set_dragover,
  })

  return { drop_zone, load_text }
}
