// Applies an open_material result to Structure's document state. Parsing stays in the shared
// runtime; this only preserves the viewer's multi-volume merge behavior.
import type { OpenedMaterial } from '$lib/file-viewer/open'
import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface'
import {
  auto_isosurface_settings,
  label_file_volumes,
  lattices_match,
  merge_imported_volumes,
} from '$lib/isosurface'
import { plural } from '$lib/labels'
import type { AnyStructure } from './index'

export type StructureDocument = {
  structure: AnyStructure | undefined
  volumetric_data: VolumetricData[] | undefined
  isosurface_settings: IsosurfaceSettings
  active_volume_idx: number
}

export function apply_structure_material(
  current: StructureDocument,
  opened: OpenedMaterial,
): { document: StructureDocument; notice?: string } {
  const current_lattice =
    current.structure && `lattice` in current.structure
      ? current.structure.lattice.matrix
      : undefined

  if (opened.type === `isosurface`) {
    const volumetric = opened.data
    const { filename, source_filename } = opened.provenance
    const incoming = label_file_volumes(volumetric.volumes, filename, source_filename)
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
    const first_volume = incoming[0]
    if (!first_volume) throw new Error(`${filename} contains no volumes`)
    const caller_layers =
      !current.volumetric_data?.length && current.isosurface_settings.layers.length > 0
    return {
      document: {
        structure: same_cell ? current.structure : volumetric.structure,
        volumetric_data: incoming,
        isosurface_settings: caller_layers
          ? current.isosurface_settings
          : auto_isosurface_settings(first_volume),
        active_volume_idx: 0,
      },
      notice: same_cell
        ? `Added ${plural(incoming.length, `volume`)} from ${filename}`
        : undefined,
    }
  }

  if (opened.type !== `structure`) {
    throw new Error(`${opened.filename} is ${opened.type}, not a structure`)
  }
  const structure = opened.data
  const same_cell = lattices_match(
    current_lattice,
    `lattice` in structure ? structure.lattice?.matrix : undefined,
  )
  const keeps_volumes = same_cell || !current.volumetric_data?.length
  return {
    document: {
      structure,
      volumetric_data: same_cell ? current.volumetric_data : [],
      isosurface_settings: keeps_volumes
        ? current.isosurface_settings
        : { ...current.isosurface_settings, layers: [] },
      active_volume_idx: same_cell ? current.active_volume_idx : 0,
    },
  }
}
