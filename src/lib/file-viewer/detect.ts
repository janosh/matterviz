// Data type detection for JSON values -- determines which visualization component to use.
// Used by JsonBrowser and the file renderer to select visualization components.

import { type VolumetricFileData, volume_from_json } from '$lib/isosurface/types'
import { build_path } from '$lib/json-path'
import { is_structure_like, optimade_structure_from_raw } from '$lib/structure/parse'
import { make_lattice } from '$lib/structure/parsers/shared'
import type { Pbc } from '$lib/structure/pbc'
import { is_plain_object } from '$lib/utils'

// Visualization types supported by the file viewer and their badge labels.
export const TYPE_LABELS = {
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
  plot: `Plot`,
}
export type RenderableType = keyof typeof TYPE_LABELS

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
  plot: `#7c3aed`,
}

// === Type Guards ===

// Nullable form of is_plain_object so the guards below can bind-and-bail in one line
const as_record = (obj: unknown): Record<string, unknown> | null =>
  is_plain_object(obj) ? obj : null

// Check that `key` on `data` is an Array with exactly `len` elements (or any length if omitted)
const has_array = (data: Record<string, unknown>, key: string, len?: number): boolean => {
  const val = data[key]
  return Array.isArray(val) && (len === undefined || val.length === len)
}

// FermiSurfaceData: pre-computed Matterviz meshes or IFermi's band-keyed mesh object
function is_fermi_surface(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data) return false
  if (data[`@class`] === `FermiSurface`) return Boolean(as_record(data.isosurfaces))
  return (
    has_array(data, `isosurfaces`) &&
    has_array(data, `k_lattice`, 3) &&
    typeof data.fermi_energy === `number` &&
    (data.reciprocal_cell === `wigner_seitz` || data.reciprocal_cell === `parallelepiped`) &&
    Boolean(as_record(data.metadata))
  )
}

// BandGridData: raw band energies on a k-grid (needs marching cubes extraction)
function is_band_grid(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data) return false
  return (
    has_array(data, `energies`) &&
    has_array(data, `k_grid`, 3) &&
    has_array(data, `k_lattice`, 3) &&
    typeof data.fermi_energy === `number` &&
    typeof data.n_bands === `number` &&
    typeof data.n_spins === `number`
  )
}

// ConvexHull entries: array of objects with `composition` (object) + energy field
// Accepts `energy`, `e_form_per_atom`, or `energy_per_atom` as the energy key
function is_convex_hull_entries(obj: unknown): boolean {
  if (!Array.isArray(obj) || obj.length < 2) return false
  // Check first few entries to avoid false positives on random arrays
  return obj.slice(0, 3).every((item) => {
    const entry = as_record(item)
    return (
      entry &&
      as_record(entry.composition) &&
      (typeof entry.energy === `number` ||
        typeof entry.e_form_per_atom === `number` ||
        typeof entry.energy_per_atom === `number`)
    )
  })
}

// VolumetricData JSON: a 3D scalar grid (nested `grid` [x][y][z] or flat `values` + `dims`)
// with lattice info. volume_from_json turns either encoding into typed-array storage.
function is_volumetric(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data) return false
  let has_grid = false
  if (has_array(data, `grid`)) {
    const first_slice = (data.grid as unknown[])[0]
    has_grid =
      Array.isArray(first_slice) && first_slice.length > 0 && Array.isArray(first_slice[0])
  } else if (has_array(data, `values`) && has_array(data, `dims`, 3)) {
    has_grid = (data.values as unknown[]).length > 0
  }
  return (
    has_grid &&
    has_array(data, `lattice`, 3) &&
    has_array(data, `origin`, 3) &&
    typeof data.periodic === `boolean`
  )
}

// PhaseDiagramData: binary phase diagram with components, regions, boundaries
function is_phase_diagram(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data) return false
  if (!has_array(data, `components`, 2)) return false
  const [comp_a, comp_b] = data.components as unknown[]
  if (typeof comp_a !== `string` || typeof comp_b !== `string`) return false
  return (
    has_array(data, `regions`) &&
    has_array(data, `boundaries`) &&
    has_array(data, `temperature_range`, 2)
  )
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
    has_array(data, `qpoints`) &&
    has_array(data, `bands`) &&
    typeof data.nb_bands === `number`
  )
    return true
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
    typeof data[`@class`] === `string` &&
    data[`@class`].includes(`Dos`) &&
    has_spectra &&
    data.densities !== undefined
  )
    return true
  // Normalized DosData format
  if (
    (data.type === `phonon` || data.type === `electronic`) &&
    has_spectra &&
    has_array(data, `densities`)
  )
    return true
  return false
}

// BandsAndDos: object containing both band_structure and dos data at the same level.
// Must be a focused wrapper (few keys), not a large object that happens to have both.
function is_bands_and_dos(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data) return false
  const keys = Object.keys(data).filter((key) => !key.startsWith(`@`) && !key.startsWith(`_`))
  // Wrapper format: { band_structure: {...}, dos: {...} } with few extra keys
  const has_bands = as_record(data.band_structure) && is_band_structure(data.band_structure)
  const has_dos_key = as_record(data.dos) && is_dos(data.dos)
  if (has_bands && has_dos_key && keys.length <= 5) return true
  // Combined-fields format: single object with both band structure and DOS fields mixed in
  const has_bands_fields = has_array(data, `branches`) && as_record(data.labels_dict)
  const has_dos_fields =
    (has_array(data, `energies`) || has_array(data, `frequencies`)) &&
    data.densities !== undefined &&
    (data.atom_dos !== undefined || data.spd_dos !== undefined)
  return Boolean(has_bands_fields && has_dos_fields)
}

// BrillouinZone: reciprocal lattice data with optional k-path info
// Matches objects with a lattice that has reciprocal vectors (k_lattice or reciprocal_lattice)
// and optionally k-path points/labels for overlaying on the zone
function is_brillouin_zone(obj: unknown): boolean {
  const data = as_record(obj)
  if (!data) return false
  // Must have reciprocal lattice vectors (3x3 matrix)
  const has_k_lattice =
    has_array(data, `k_lattice`, 3) || has_array(data, `reciprocal_lattice`, 3)
  if (!has_k_lattice) return false
  // Must have k-path or explicit BZ data to distinguish from Fermi surface data
  // (Fermi surface also has k_lattice but additionally has isosurfaces)
  if (has_array(data, `isosurfaces`)) return false // that's a Fermi surface, not a plain BZ
  // Accept if it has k_path labels/points, or a structure with lattice
  return (
    has_array(data, `k_path`) ||
    has_array(data, `k_points`) ||
    Boolean(as_record(data.k_labels)) ||
    Boolean(as_record(data.labels_dict)) ||
    data.bz_order !== undefined
  )
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
  return (
    has_array(data, `hkls`) ||
    has_array(data, `d_hkls`) ||
    (typeof data[`@class`] === `string` && data[`@class`].includes(`Xrd`)) ||
    typeof data.wavelength === `number`
  )
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

// Plottable data: tabular data with at least 2 numeric columns (enough for a scatter plot).
// Samples multiple rows/elements to handle leading nulls.
export function is_plottable_data(obj: unknown): boolean {
  if (!is_tabular_data(obj)) return false
  if (Array.isArray(obj)) {
    const sample = obj.slice(0, 10).map(as_record).filter(Boolean) as Record<string, unknown>[]
    if (sample.length === 0) return false
    const all_keys = new Set(sample.flatMap(Object.keys))
    const num_cols = [...all_keys].filter((key) =>
      sample.some((row) => typeof row[key] === `number`),
    ).length
    return num_cols >= 2
  }
  const data = as_record(obj)
  if (!data) return false
  const array_entries = Object.entries(data).filter(
    ([, val]) => Array.isArray(val) && (val as unknown[]).length > 0,
  )
  const num_cols = array_entries.filter(([, val]) =>
    (val as unknown[]).some((elem) => typeof elem === `number`),
  ).length
  return num_cols >= 2
}

// === Main Detection Function ===

// Checks are ordered from most specific to least specific to minimize false positives:
// OPTIMADE before generic structure, combined bands+DOS before individual band/dos,
// structure late (structures are common building blocks inside other data types),
// and generic tabular data last.
export function detect_view_type(value: unknown): RenderableType | null {
  if (value == null) return null
  if (as_record(value) && optimade_structure_from_raw(value)) return `structure`
  if (is_fermi_surface(value)) return `fermi_surface`
  if (is_band_grid(value)) return `band_grid`
  if (is_phase_diagram(value)) return `phase_diagram`
  if (is_bands_and_dos(value)) return `bands_and_dos`
  if (is_band_structure(value)) return `band_structure`
  if (is_dos(value)) return `dos`
  if (is_brillouin_zone(value)) return `brillouin_zone`
  if (is_xrd_pattern(value)) return `xrd`
  if (is_volumetric(value)) return `volumetric`
  if (is_structure_like(value)) return `structure`
  if (is_convex_hull_entries(value)) return `convex_hull`
  if (is_tabular_data(value)) return `table`
  return null
}

// === Volumetric JSON ===

// Volumetric JSON (nested grid or flat values) becomes a typed-array volume rendered by the
// Structure viewer, which needs a site-less Crystal whose lattice is a full LatticeType (a
// bare 3x3 matrix crashes the scene on lattice.matrix)
export const volume_json_to_isosurface_input = (raw: unknown): VolumetricFileData => {
  const volume = volume_from_json(raw)
  const pbc: Pbc = [volume.periodic, volume.periodic, volume.periodic]
  return {
    structure: { sites: [], lattice: make_lattice(volume.lattice, pbc) },
    volumes: [volume],
  }
}

// === Renderable Path Scanner ===

// Map of JSON path -> detected type for every renderable subtree, for the badges JsonTree nodes
// show. A renderable value is not walked further: its children are part of the data.
export function scan_renderable_paths(
  obj: unknown,
  max_depth: number = 10,
): Map<string, RenderableType> {
  const results = new Map<string, RenderableType>()
  const visited = new WeakSet<object>()

  function walk(value: unknown, path: string, depth: number): void {
    if (depth > max_depth || value == null || typeof value !== `object`) return

    if (visited.has(value)) return // cycle
    visited.add(value)

    const detected_type = detect_view_type(value)
    if (detected_type) {
      results.set(path, detected_type)
      // If tabular data is also plottable, register a plot badge too
      if (detected_type === `table` && is_plottable_data(value)) {
        const plot_path = path ? `${path}\u0000plot` : `\u0000plot`
        results.set(plot_path, `plot`)
      }
      return
    }
    // Only the first few elements of an array: renderable items repeat their shape
    if (Array.isArray(value)) {
      for (const [idx, item] of value.slice(0, 20).entries()) {
        walk(item, build_path(path, idx), depth + 1)
      }
    } else {
      for (const [key, child_value] of Object.entries(value as Record<string, unknown>)) {
        walk(child_value, build_path(path, key), depth + 1)
      }
    }
  }

  walk(obj, ``, 0)
  return results
}
