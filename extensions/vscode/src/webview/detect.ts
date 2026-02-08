// Data type detection for JSON values -- determines which visualization component to use.
// Used by JsonBrowser to detect renderable items in JSON trees and by main.ts
// to decide whether to show the browser or render directly.

import { is_optimade_raw } from '$lib/structure/parse'

// Visualization types that can be rendered in the extension
export type RenderableType =
  | `structure`
  | `fermi_surface`
  | `band_grid`
  | `convex_hull`
  | `volumetric`
  | `phase_diagram`
  | `band_structure`
  | `dos`

// Human-readable labels for badge display
export const TYPE_LABELS: Record<RenderableType, string> = {
  structure: `Structure`,
  fermi_surface: `Fermi Surface`,
  band_grid: `Band Grid`,
  convex_hull: `Convex Hull`,
  volumetric: `Volumetric`,
  phase_diagram: `Phase Diagram`,
  band_structure: `Band Structure`,
  dos: `DOS`,
}

// Badge colors per type (CSS color values)
export const TYPE_COLORS: Record<RenderableType, string> = {
  structure: `#4fc3f7`,
  fermi_surface: `#ab47bc`,
  band_grid: `#7e57c2`,
  convex_hull: `#66bb6a`,
  volumetric: `#ffa726`,
  phase_diagram: `#ef5350`,
  band_structure: `#29b6f6`,
  dos: `#26a69a`,
}

// === Type Guards ===

// Structure: must have non-empty `sites` array where first site has `species` + coordinates
function is_structure(obj: unknown): boolean {
  if (!obj || typeof obj !== `object` || Array.isArray(obj)) return false
  const record = obj as Record<string, unknown>
  if (!Array.isArray(record.sites) || record.sites.length === 0) return false
  const first_site = record.sites[0] as Record<string, unknown> | undefined
  if (!first_site || typeof first_site !== `object`) return false
  const has_species = Array.isArray(first_site.species) && first_site.species.length > 0
  const has_coords = Array.isArray(first_site.abc) || Array.isArray(first_site.xyz)
  return has_species && has_coords
}

// FermiSurfaceData: pre-computed isosurfaces with reciprocal lattice info
function is_fermi_surface(obj: unknown): boolean {
  if (!obj || typeof obj !== `object` || Array.isArray(obj)) return false
  const data = obj as Record<string, unknown>
  if (!Array.isArray(data.isosurfaces)) return false
  if (!Array.isArray(data.k_lattice) || data.k_lattice.length !== 3) return false
  if (typeof data.fermi_energy !== `number`) return false
  if (
    data.reciprocal_cell !== `wigner_seitz` && data.reciprocal_cell !== `parallelepiped`
  ) return false
  if (!data.metadata || typeof data.metadata !== `object`) return false
  return true
}

// BandGridData: raw band energies on a k-grid (needs marching cubes extraction)
function is_band_grid(obj: unknown): boolean {
  if (!obj || typeof obj !== `object` || Array.isArray(obj)) return false
  const data = obj as Record<string, unknown>
  if (!Array.isArray(data.energies)) return false
  if (!Array.isArray(data.k_grid) || data.k_grid.length !== 3) return false
  if (!Array.isArray(data.k_lattice) || data.k_lattice.length !== 3) return false
  if (typeof data.fermi_energy !== `number`) return false
  if (typeof data.n_bands !== `number`) return false
  if (typeof data.n_spins !== `number`) return false
  return true
}

// ConvexHull entries: array of objects with `composition` (object) + energy field
// Accepts `energy`, `e_form_per_atom`, or `energy_per_atom` as the energy key
function is_convex_hull_entries(obj: unknown): boolean {
  if (!Array.isArray(obj) || obj.length === 0) return false
  // Check first few entries to avoid false positives on random arrays
  const check_count = Math.min(obj.length, 3)
  for (let idx = 0; idx < check_count; idx++) {
    const entry = obj[idx] as Record<string, unknown> | undefined
    if (!entry || typeof entry !== `object`) return false
    if (!entry.composition || typeof entry.composition !== `object`) return false
    const has_energy = typeof entry.energy === `number` ||
      typeof entry.e_form_per_atom === `number` ||
      typeof entry.energy_per_atom === `number`
    if (!has_energy) return false
  }
  return true
}

// VolumetricData: 3D scalar grid with lattice info
function is_volumetric(obj: unknown): boolean {
  if (!obj || typeof obj !== `object` || Array.isArray(obj)) return false
  const data = obj as Record<string, unknown>
  // grid must be a 3D array (array of arrays of arrays)
  if (!Array.isArray(data.grid) || data.grid.length === 0) return false
  const first_slice = data.grid[0]
  if (!Array.isArray(first_slice) || first_slice.length === 0) return false
  if (!Array.isArray(first_slice[0])) return false
  // grid_dims, lattice, origin are required
  if (!Array.isArray(data.grid_dims) || data.grid_dims.length !== 3) return false
  if (!Array.isArray(data.lattice) || data.lattice.length !== 3) return false
  if (!Array.isArray(data.origin) || data.origin.length !== 3) return false
  if (!data.data_range || typeof data.data_range !== `object`) return false
  if (typeof data.periodic !== `boolean`) return false
  return true
}

// PhaseDiagramData: binary phase diagram with components, regions, boundaries
function is_phase_diagram(obj: unknown): boolean {
  if (!obj || typeof obj !== `object` || Array.isArray(obj)) return false
  const data = obj as Record<string, unknown>
  // components must be a 2-element array of strings
  if (!Array.isArray(data.components) || data.components.length !== 2) return false
  if (typeof data.components[0] !== `string` || typeof data.components[1] !== `string`) {
    return false
  }
  // regions and boundaries are required arrays
  if (!Array.isArray(data.regions)) return false
  if (!Array.isArray(data.boundaries)) return false
  // temperature_range is required
  if (!Array.isArray(data.temperature_range) || data.temperature_range.length !== 2) {
    return false
  }
  return true
}

// BandStructure: normalized format (qpoints, branches, bands, nb_bands)
// or pymatgen format (kpoints, branches, bands with spin keys, labels_dict)
function is_band_structure(obj: unknown): boolean {
  if (!obj || typeof obj !== `object` || Array.isArray(obj)) return false
  const data = obj as Record<string, unknown>
  // Both formats require branches and labels_dict
  if (!Array.isArray(data.branches) || data.branches.length === 0) return false
  if (!data.labels_dict || typeof data.labels_dict !== `object`) return false
  // Normalized format: qpoints + bands array + nb_bands + distance
  if (
    Array.isArray(data.qpoints) && Array.isArray(data.bands) &&
    typeof data.nb_bands === `number`
  ) {
    return true
  }
  // Pymatgen format: kpoints + bands object with spin keys ("1"/"-1") + efermi
  if (
    Array.isArray(data.kpoints) && data.bands && typeof data.bands === `object` &&
    !Array.isArray(data.bands)
  ) {
    return typeof data.efermi === `number`
  }
  return false
}

// DOS: pymatgen CompleteDos format or normalized DosData
// CompleteDos: has energies, densities, efermi, and @class containing "Dos"
// DosData: has type ("phonon"|"electronic"), frequencies/energies, densities
function is_dos(obj: unknown): boolean {
  if (!obj || typeof obj !== `object` || Array.isArray(obj)) return false
  const data = obj as Record<string, unknown>
  // pymatgen CompleteDos format
  if (
    typeof data[`@class`] === `string` &&
    (data[`@class`] as string).includes(`Dos`) &&
    (Array.isArray(data.energies) || Array.isArray(data.frequencies)) &&
    data.densities !== undefined
  ) {
    return true
  }
  // Normalized DosData format
  if (
    (data.type === `phonon` || data.type === `electronic`) &&
    (Array.isArray(data.frequencies) || Array.isArray(data.energies)) &&
    Array.isArray(data.densities)
  ) {
    return true
  }
  return false
}

// === Main Detection Function ===

// Detect the visualization type for a given JSON value.
// Returns the type if the value matches a known format, or null if not renderable.
// Checks are ordered from most specific to least specific to minimize false positives.
export function detect_view_type(value: unknown): RenderableType | null {
  if (value === null || value === undefined) return null

  // OPTIMADE format (special structure variant) -- check before generic structure
  if (typeof value === `object` && !Array.isArray(value) && is_optimade_raw(value)) {
    return `structure`
  }

  // Fermi surface (pre-computed isosurfaces) -- very specific shape
  if (is_fermi_surface(value)) return `fermi_surface`

  // Band grid data (raw k-grid energies) -- very specific shape
  if (is_band_grid(value)) return `band_grid`

  // Phase diagram -- specific shape with components + regions + boundaries
  if (is_phase_diagram(value)) return `phase_diagram`

  // Band structure -- qpoints + branches + bands
  if (is_band_structure(value)) return `band_structure`

  // DOS -- energies/frequencies + densities
  if (is_dos(value)) return `dos`

  // Volumetric data -- 3D grid with lattice
  if (is_volumetric(value)) return `volumetric`

  // Structure (pymatgen-style) -- check after more specific types since
  // structures are common building blocks inside other data types
  if (is_structure(value)) return `structure`

  // Convex hull entries -- array check last (most generic)
  if (is_convex_hull_entries(value)) return `convex_hull`

  return null
}

// === Renderable Path Scanner ===

interface RenderablePath {
  type: RenderableType
  label: string
}

// Recursively scan a JSON object to find all paths that contain renderable data.
// Returns a Map of JSON path strings to their detected type.
// Used to show badges on JsonTree nodes indicating which subtrees contain visualizable data.
export function scan_renderable_paths(
  obj: unknown,
  prefix: string = ``,
  max_depth: number = 10,
): Map<string, RenderablePath> {
  const results = new Map<string, RenderablePath>()
  const visited = new WeakSet<object>()

  function walk(value: unknown, path: string, depth: number): void {
    if (depth > max_depth) return
    if (value === null || value === undefined) return
    if (typeof value !== `object`) return

    // Circular reference protection
    const obj_ref = value as object
    if (visited.has(obj_ref)) return
    visited.add(obj_ref)

    // Check if this value itself is renderable
    const detected_type = detect_view_type(value)
    if (detected_type) {
      results.set(path, { type: detected_type, label: TYPE_LABELS[detected_type] })
      // Don't recurse into renderable objects -- their children are part of the data
      return
    }

    // Recurse into children
    if (Array.isArray(value)) {
      // For arrays, only scan first few elements to avoid huge arrays
      const scan_count = Math.min(value.length, 20)
      for (let idx = 0; idx < scan_count; idx++) {
        const child_path = path ? `${path}[${idx}]` : `[${idx}]`
        walk(value[idx], child_path, depth + 1)
      }
    } else {
      for (const [key, child_value] of Object.entries(value as Record<string, unknown>)) {
        const child_path = path ? `${path}.${key}` : key
        walk(child_value, child_path, depth + 1)
      }
    }
  }

  walk(obj, prefix, 0)
  return results
}
