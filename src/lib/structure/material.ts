// Applies an open_material result to Structure's document state. Parsing stays in the shared
// runtime; this only preserves the viewer's multi-volume merge behavior.
import type { OpenedMaterial } from '$lib/file-viewer/open'
import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface'
import {
  auto_isosurface_settings,
  label_file_volumes,
  merge_imported_volumes,
  normalize_active_volume_id,
} from '$lib/isosurface'
import { plural } from '$lib/labels'
import type { AnyStructure } from './index'

// Absolute Cartesian tolerance (A): retain fields across coordinate conversions and
// high-precision text serialization; reject differences >= 1e-8 A regardless of cell size.
const same_coordinate = (left: number, right: number): boolean =>
  Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 1e-8

export type StructureDocument = {
  structure: AnyStructure | undefined
  volumetric_data: VolumetricData[] | undefined
  isosurface_settings: IsosurfaceSettings
  active_volume_id: string | undefined
}

export function apply_structure_material(
  current: StructureDocument,
  opened: OpenedMaterial,
): { document: StructureDocument; notice?: string } {
  if (opened.type !== `isosurface` && opened.type !== `structure`) {
    throw new Error(`${opened.filename} is ${opened.type}, not a structure`)
  }
  const structure = opened.type === `isosurface` ? opened.data.structure : opened.data
  const current_lattice =
    current.structure && `lattice` in current.structure
      ? current.structure.lattice.matrix
      : undefined

  const incoming_lattice = `lattice` in structure ? structure.lattice.matrix : undefined
  // Only combine fields with matching ordered atoms and a common Cartesian frame.
  // Empty structures have no anchor; reordered sites or changed species replace.
  const same_structure =
    current.structure !== undefined &&
    current.structure.sites.length > 0 &&
    current.structure.sites.length === structure.sites.length &&
    (current_lattice && incoming_lattice
      ? current_lattice.every((row, row_idx) =>
          row.every((value, col_idx) =>
            same_coordinate(value, incoming_lattice[row_idx][col_idx]),
          ),
        )
      : current_lattice === incoming_lattice) &&
    current.structure.sites.every((site, site_idx) => {
      const other = structure.sites[site_idx]
      return (
        site.xyz.every((value, axis) => same_coordinate(value, other.xyz[axis])) &&
        site.species.length === other.species.length &&
        site.species.every(
          (species, species_idx) =>
            species.element === other.species[species_idx].element &&
            species.occu === other.species[species_idx].occu,
        )
      )
    })

  if (opened.type === `isosurface`) {
    const volumetric = opened.data
    const { filename, source_filename } = opened.provenance
    const incoming = label_file_volumes(volumetric.volumes, filename, source_filename)
    if (same_structure && current.volumetric_data?.length) {
      const merged = merge_imported_volumes(
        current.volumetric_data,
        current.isosurface_settings.layers,
        incoming,
      )
      return {
        document: {
          structure: current.structure,
          volumetric_data: merged.volumes,
          isosurface_settings: { ...current.isosurface_settings, layers: merged.layers },
          active_volume_id: normalize_active_volume_id(
            current.active_volume_id,
            merged.volumes,
          ),
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
        structure: same_structure ? current.structure : structure,
        volumetric_data: incoming,
        isosurface_settings: caller_layers
          ? current.isosurface_settings
          : auto_isosurface_settings(first_volume),
        active_volume_id: first_volume.id,
      },
      notice: same_structure
        ? `Added ${plural(incoming.length, `volume`)} from ${filename}`
        : undefined,
    }
  }

  const keeps_volumes = same_structure || !current.volumetric_data?.length
  return {
    document: {
      structure,
      volumetric_data: same_structure ? current.volumetric_data : [],
      isosurface_settings: keeps_volumes
        ? current.isosurface_settings
        : { ...current.isosurface_settings, layers: [] },
      active_volume_id: same_structure ? current.active_volume_id : undefined,
    },
  }
}
