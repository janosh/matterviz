// Parsing for the structure viewer's loader (`create_viewer_loader` in Structure.svelte): one
// text payload becomes the next document, including volumetric files (CHGCAR, cube) whose
// volumes merge into the loaded set when they describe the cell already on screen.
import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface/types'
import {
  auto_isosurface_settings,
  label_file_volumes,
  lattices_match,
  merge_imported_volumes,
} from '$lib/isosurface/types'
import { parse_volumetric_file } from '$lib/isosurface/parse'
import { plural } from '$lib/labels'
import type { AnyStructure } from './index'
import { parse_structure_file } from './parse'

export type StructureDocument = {
  structure: AnyStructure | undefined
  volumetric_data: VolumetricData[] | undefined
  isosurface_settings: IsosurfaceSettings
  active_volume_idx: number
}

// Parse one text payload into the next document. Volumetric files whose cell matches the
// current structure append their volumes (or replace a re-imported source in place) so
// several fields can coexist; anything else replaces structure and volumes. Plain structure
// files keep loaded volumes only when they describe the same cell (mixed CHGCAR + POSCAR
// drops in either order). Throws when nothing could parse the content.
export function open_structure_text(
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
    // lattices_match is false for an undefined lattice, so same_cell implies a current structure
    const same_cell = lattices_match(current_lattice, volumetric.structure.lattice?.matrix)
    if (same_cell && current.volumetric_data?.length) {
      const merged = merge_imported_volumes(
        current.volumetric_data,
        current.isosurface_settings.layers,
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
    // Layers set before any volume existed (a host passing isosurface_settings next to
    // data_url, e.g. pymatviz) describe the incoming volume and are kept; otherwise the
    // first volume gets the automatic layer
    const caller_layers =
      !current.volumetric_data?.length && current.isosurface_settings.layers.length > 0
    // Parsers set pbc so the header lattice conforms to Crystal's lattice type
    return {
      document: {
        structure: same_cell ? current.structure : volumetric.structure,
        volumetric_data: incoming,
        isosurface_settings: caller_layers
          ? current.isosurface_settings
          : auto_isosurface_settings(incoming[0]),
        active_volume_idx: 0,
      },
      notice: same_cell
        ? `Added ${plural(incoming.length, `volume`)} from ${filename}`
        : undefined,
    }
  }
  const parsed = parse_structure_file(text, filename)
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
