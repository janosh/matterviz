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
  | `bands_and_dos`
  | `brillouin_zone`
  | `xrd`
  | `table`

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
  bands_and_dos: `Bands + DOS`,
  brillouin_zone: `Brillouin Zone`,
  xrd: `XRD`,
  table: `Table`,
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
  bands_and_dos: `#5c6bc0`,
  brillouin_zone: `#8d6e63`,
  xrd: `#ec407a`,
  table: `#78909c`,
}

// === Type Guards ===

// Narrows unknown to a non-array object record; used by every type guard below
function as_record(obj: unknown): Record<string, unknown> | null {
  return (obj && typeof obj === `object` && !Array.isArray(obj))
    ? obj as Record<string, unknown>
    : null
}

// Check that `key` on `data` is an Array with exactly `len` elements (or any length if omitted)
function has_array(data: Record<string, unknown>, key: string, len?: number): boolean {
  const val = data[key]
  return Array.isArray(val) && (len === undefined || val.length === len)
}

// Structure: must have non-empty `sites` array where first site has `species` + coordinates
function is_structure(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data || !has_array(data, `sites`)) return false
  const sites = data.sites as unknown[]
  if (sites.length === 0) return false
  const first_site = as_record(sites[0])
  if (!first_site) return false
  const has_species = Array.isArray(first_site.species) && first_site.species.length > 0
  return has_species && (Array.isArray(first_site.abc) || Array.isArray(first_site.xyz))
}

// FermiSurfaceData: pre-computed isosurfaces with reciprocal lattice info
function is_fermi_surface(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data) return false
  return has_array(data, `isosurfaces`) &&
    has_array(data, `k_lattice`, 3) &&
    typeof data.fermi_energy === `number` &&
    (data.reciprocal_cell === `wigner_seitz` ||
      data.reciprocal_cell === `parallelepiped`) &&
    !!as_record(data.metadata)
}

// BandGridData: raw band energies on a k-grid (needs marching cubes extraction)
function is_band_grid(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data) return false
  return has_array(data, `energies`) &&
    has_array(data, `k_grid`, 3) &&
    has_array(data, `k_lattice`, 3) &&
    typeof data.fermi_energy === `number` &&
    typeof data.n_bands === `number` &&
    typeof data.n_spins === `number`
}

// ConvexHull entries: array of objects with `composition` (object) + energy field
// Accepts `energy`, `e_form_per_atom`, or `energy_per_atom` as the energy key
function is_convex_hull_entries(obj: unknown): boolean {
  if (!Array.isArray(obj) || obj.length < 2) return false
  // Check first few entries to avoid false positives on random arrays
  return obj.slice(0, 3).every((item) => {
    const entry = as_record(item)
    return entry && as_record(entry.composition) && (
      typeof entry.energy === `number` ||
      typeof entry.e_form_per_atom === `number` ||
      typeof entry.energy_per_atom === `number`
    )
  })
}

// VolumetricData: 3D scalar grid with lattice info
function is_volumetric(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data || !has_array(data, `grid`)) return false
  // grid must be a 3D array (array of arrays of arrays)
  const grid = data.grid as unknown[]
  if (grid.length === 0) return false
  const first_slice = grid[0]
  if (
    !Array.isArray(first_slice) || !first_slice.length || !Array.isArray(first_slice[0])
  ) return false
  return has_array(data, `grid_dims`, 3) &&
    has_array(data, `lattice`, 3) &&
    has_array(data, `origin`, 3) &&
    !!as_record(data.data_range) &&
    typeof data.periodic === `boolean`
}

// PhaseDiagramData: binary phase diagram with components, regions, boundaries
function is_phase_diagram(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data) return false
  if (!has_array(data, `components`, 2)) return false
  const [comp_a, comp_b] = data.components as unknown[]
  if (typeof comp_a !== `string` || typeof comp_b !== `string`) return false
  return has_array(data, `regions`) &&
    has_array(data, `boundaries`) &&
    has_array(data, `temperature_range`, 2)
}

// BandStructure: normalized format (qpoints, branches, bands, nb_bands)
// or pymatgen format (kpoints, branches, bands with spin keys, labels_dict)
function is_band_structure(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data) return false
  if (!has_array(data, `branches`) || (data.branches as unknown[]).length === 0) {
    return false
  }
  if (!as_record(data.labels_dict)) return false
  // Normalized format
  if (
    has_array(data, `qpoints`) && has_array(data, `bands`) &&
    typeof data.nb_bands === `number`
  ) return true
  // Pymatgen format: kpoints + bands object (not array) + efermi
  if (has_array(data, `kpoints`) && as_record(data.bands)) {
    return typeof data.efermi === `number`
  }
  return false
}

// DOS: pymatgen CompleteDos format or normalized DosData
// CompleteDos: has energies, densities, efermi, and @class containing "Dos"
// DosData: has type ("phonon"|"electronic"), frequencies/energies, densities
function is_dos(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data) return false
  const has_spectra = has_array(data, `energies`) || has_array(data, `frequencies`)
  // pymatgen CompleteDos format
  if (
    typeof data[`@class`] === `string` && (data[`@class`] as string).includes(`Dos`) &&
    has_spectra && data.densities !== undefined
  ) return true
  // Normalized DosData format
  if (
    (data.type === `phonon` || data.type === `electronic`) &&
    has_spectra && has_array(data, `densities`)
  ) return true
  return false
}

// BandsAndDos: object containing both band_structure and dos data at the same level.
// Must be a focused wrapper (few keys), not a large object that happens to have both.
function is_bands_and_dos(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data) return false
  const keys = Object.keys(data).filter((key) =>
    !key.startsWith(`@`) && !key.startsWith(`_`)
  )
  // Wrapper format: { band_structure: {...}, dos: {...} } with few extra keys
  const has_bands = as_record(data.band_structure) &&
    is_band_structure(data.band_structure)
  const has_dos_key = as_record(data.dos) && is_dos(data.dos)
  if (has_bands && has_dos_key && keys.length <= 5) return true
  // Combined-fields format: single object with both band structure and DOS fields mixed in
  const has_bands_fields = has_array(data, `branches`) && as_record(data.labels_dict)
  const has_dos_fields =
    (has_array(data, `energies`) || has_array(data, `frequencies`)) &&
    data.densities !== undefined &&
    (data.atom_dos !== undefined || data.spd_dos !== undefined)
  return !!(has_bands_fields && has_dos_fields)
}

// BrillouinZone: reciprocal lattice data with optional k-path info
// Matches objects with a lattice that has reciprocal vectors (k_lattice or reciprocal_lattice)
// and optionally k-path points/labels for overlaying on the zone
function is_brillouin_zone(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data) return false
  // Must have reciprocal lattice vectors (3x3 matrix)
  const has_k_lattice = has_array(data, `k_lattice`, 3) ||
    has_array(data, `reciprocal_lattice`, 3)
  if (!has_k_lattice) return false
  // Must have k-path or explicit BZ data to distinguish from Fermi surface data
  // (Fermi surface also has k_lattice but additionally has isosurfaces)
  if (has_array(data, `isosurfaces`)) return false // that's a Fermi surface, not a plain BZ
  // Accept if it has k_path labels/points, or a structure with lattice
  return has_array(data, `k_path`) || has_array(data, `k_points`) ||
    !!as_record(data.k_labels) || !!as_record(data.labels_dict) ||
    data.bz_order !== undefined
}

// XRD pattern: x + y arrays of equal length (2-theta angles vs intensities)
// with optional hkls (Miller indices) and d_hkls (d-spacings)
function is_xrd_pattern(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data) return false
  if (!has_array(data, `x`) || !has_array(data, `y`)) return false
  const x_arr = data.x as unknown[]
  const y_arr = data.y as unknown[]
  if (x_arr.length !== y_arr.length || x_arr.length === 0) return false
  // Must have numeric x/y values
  if (typeof x_arr[0] !== `number` || typeof y_arr[0] !== `number`) return false
  // Distinguish from generic scatter data: XRD patterns typically have hkls or d_hkls,
  // or have @class containing "Xrd"
  return has_array(data, `hkls`) || has_array(data, `d_hkls`) ||
    (typeof data[`@class`] === `string` && (data[`@class`] as string).includes(`Xrd`)) ||
    typeof data.wavelength === `number`
}

// Tabular data: array of objects with consistent keys (row-based table format)
// or object with parallel arrays (column-based format)
function is_tabular_data(obj: unknown): boolean {
  // Row-based: array of objects with string keys and numeric/string values
  if (Array.isArray(obj) && obj.length >= 3) {
    const first = as_record(obj[0])
    const second = as_record(obj[1])
    if (!first || !second) return false
    const first_keys = Object.keys(first)
    if (first_keys.length < 2) return false
    // Check that rows have consistent keys and mostly numeric/string values
    const second_keys = Object.keys(second)
    const overlap = first_keys.filter((key) => second_keys.includes(key))
    if (overlap.length < first_keys.length * 0.5) return false
    // At least some values should be numbers (not just metadata objects)
    const num_count = first_keys.filter((key) => typeof first[key] === `number`).length
    return num_count >= 1
  }
  // Column-based: object where multiple values are equal-length arrays
  const data = as_record(obj)
  if (!data) return false
  const entries = Object.entries(data)
  if (entries.length < 2) return false
  const array_entries = entries.filter(([, val]) => Array.isArray(val) && val.length > 0)
  if (array_entries.length < 2) return false
  // Check that arrays have consistent lengths
  const lengths = array_entries.map(([, val]) => (val as unknown[]).length)
  const first_len = lengths[0]
  if (!lengths.every((len) => len === first_len)) return false
  // At least one column must contain numbers
  return array_entries.some(([, val]) => typeof (val as unknown[])[0] === `number`)
}

// === Main Detection Function ===

// Detect the visualization type for a given JSON value.
// Returns the type if the value matches a known format, or null if not renderable.
// Checks are ordered from most specific to least specific to minimize false positives.
export function detect_view_type(value: unknown): RenderableType | null {
  if (value === null || value === undefined) return null

  // OPTIMADE format (special structure variant) -- check before generic structure
  if (as_record(value) && is_optimade_raw(value)) return `structure`

  // Fermi surface (pre-computed isosurfaces) -- very specific shape
  if (is_fermi_surface(value)) return `fermi_surface`

  // Band grid data (raw k-grid energies) -- very specific shape
  if (is_band_grid(value)) return `band_grid`

  // Phase diagram -- specific shape with components + regions + boundaries
  if (is_phase_diagram(value)) return `phase_diagram`

  // Combined bands + DOS -- check before individual band/dos checks
  if (is_bands_and_dos(value)) return `bands_and_dos`

  // Band structure -- qpoints + branches + bands
  if (is_band_structure(value)) return `band_structure`

  // DOS -- energies/frequencies + densities
  if (is_dos(value)) return `dos`

  // Brillouin zone -- reciprocal lattice with k-path info
  if (is_brillouin_zone(value)) return `brillouin_zone`

  // XRD pattern -- x/y arrays with hkls or d_hkls
  if (is_xrd_pattern(value)) return `xrd`

  // Volumetric data -- 3D grid with lattice
  if (is_volumetric(value)) return `volumetric`

  // Structure (pymatgen-style) -- check after more specific types since
  // structures are common building blocks inside other data types
  if (is_structure(value)) return `structure`

  // Convex hull entries -- array check last (most generic)
  if (is_convex_hull_entries(value)) return `convex_hull`

  // Tabular data -- most generic, check last
  if (is_tabular_data(value)) return `table`

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
