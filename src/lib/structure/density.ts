// Worker-safe composition and density helpers. Kept outside the component barrel so
// trajectory parsing can extract density without loading Svelte components in a Web Worker.
import { element_by_symbol } from '$lib/element/data'
import * as math from '$lib/math'
import type { Vec3 } from '$lib/math'
import type { ElementSymbol } from '$lib/element/types'
import type { AnyStructure, Crystal } from './index'
import { is_image_site, numeric_sites, site_count, snapshot_topologies } from './site'
import { element_from_atomic_number } from '$lib/element/helpers'

const topology_counts = new WeakMap<object, Partial<Record<ElementSymbol, number>>>()

const count_elements = (structure: AnyStructure): Partial<Record<ElementSymbol, number>> => {
  const columns = numeric_sites.get(structure)
  // Image provenance belongs to the frame, not its shared atom identities.
  const topology = columns?.scalar_columns?.orig_site_idx
    ? undefined
    : snapshot_topologies.get(structure)
  const cached = topology && topology_counts.get(topology)
  if (cached) return cached
  const elements: Partial<Record<ElementSymbol, number>> = {}
  if (columns) {
    for (let idx = 0; idx < columns.length; idx++) {
      const element = element_from_atomic_number(columns.numbers[idx])
      if (!element)
        throw new Error(`Invalid atomic number ${columns.numbers[idx]} at site ${idx}`)
      if (!columns.is_image(idx)) elements[element] = (elements[element] ?? 0) + 1
    }
    if (topology) topology_counts.set(topology, elements)
    return elements
  }
  for (const site of structure.sites) {
    if (is_image_site(site)) continue
    for (const { element, occu } of site.species) {
      elements[element] = (elements[element] ?? 0) + occu
    }
  }
  return elements
}

// Callers may edit composition counts; density can read the internal cache directly.
export const get_element_counts = (structure: AnyStructure) => ({
  ...count_elements(structure),
})

// unified atomic mass units (u) per cubic angstrom (Å^3) to g/cm^3
const AMU_PER_A3_TO_G_PER_CM3 = 1.66053907

// Reuse cached numeric topology counts without materializing trajectory sites.
export const get_density = (structure: Crystal): number => {
  let mass = 0
  for (const [element, count] of Object.entries(count_elements(structure))) {
    const weight = element_by_symbol.get(element as ElementSymbol)?.atomic_mass
    if (weight !== undefined) mass += count * weight
  }
  return (AMU_PER_A3_TO_G_PER_CM3 * mass) / structure.lattice.volume
}

// Vacuum is scanned in 64 fractional bins (~1.5% cell-edge resolution).
const OCCUPANCY_BINS = 64
const VACUUM_GAP = 6 // Å; preserve ordinary interlayer gaps
const MIN_OCCUPIED_EXTENT = 1 // Å; floor for planar/linear arrangements
// Reused safely: this per-frame calculation never yields.
const occupancy = [0, 1, 2].map(() => new Uint8Array(OCCUPANCY_BINS))

// Sum circular empty runs above the threshold, anchored at an occupied bin.
const vacuum_fraction = (bins: Uint8Array, min_run: number): number => {
  const first_used = bins.findIndex(Boolean)
  if (first_used === -1) return 0
  let run = 0
  let empty_bins = 0
  for (let offset = 1; offset <= bins.length; offset++) {
    if (!bins[(first_used + offset) % bins.length]) run += 1
    else {
      if (run > min_run) empty_bins += run
      run = 0
    }
  }
  return empty_bins / bins.length
}

// Estimate decoration scale from occupied volume per real atom. Remove axis-aligned vacuum
// before taking the cube root; diagonal rods can still overestimate occupancy. A direct
// nearest-neighbor query costs substantially more per trajectory frame and tracks short bonds.
export function characteristic_atom_spacing(structure: AnyStructure): number {
  const columns = numeric_sites.get(structure)
  if (columns?.display_metrics) return columns.display_metrics.characteristic_atom_spacing
  const count = site_count(structure)
  if (!count) return MIN_OCCUPIED_EXTENT
  const lattice = `lattice` in structure ? structure.lattice : null
  if (lattice && !(lattice.volume > 0)) return MIN_OCCUPIED_EXTENT // singular cell

  // Exclude PBC images from both occupancy and atom count.
  let n_real = 0
  // Hand-built sites may lack valid abc; derive it lazily from rendered xyz.
  let to_frac: ((cart: Vec3) => Vec3) | undefined
  const mins = [Infinity, Infinity, Infinity]
  const maxs = [-Infinity, -Infinity, -Infinity]
  if (lattice) for (const bins of occupancy) bins.fill(0)
  const numeric_coords: Vec3 = [0, 0, 0]
  for (let idx = 0; idx < count; idx++) {
    const site = columns ? undefined : structure.sites[idx]
    if (columns ? columns.is_image(idx) : is_image_site(site)) continue
    n_real += 1
    if (columns) {
      const offset = idx * columns.stride + (lattice ? 3 : 0)
      for (let axis = 0; axis < 3; axis++)
        numeric_coords[axis] = columns.coordinates[offset + axis]
    }
    let coords = site ? (lattice ? site.abc : site.xyz) : numeric_coords
    if (lattice && !coords?.every(Number.isFinite)) {
      if (columns)
        for (let axis = 0; axis < 3; axis++)
          numeric_coords[axis] = columns.coordinates[idx * columns.stride + axis]
      coords = (to_frac ??= math.create_cart_to_frac(lattice.matrix))(
        site ? site.xyz : numeric_coords,
      )
    }
    for (let axis = 0; axis < 3; axis++) {
      const coord = coords[axis]
      if (!lattice?.pbc[axis]) {
        // Molecule bounds ignore NaN coordinates, as coordinate comparisons do.
        if (!lattice && Number.isNaN(coord)) continue
        mins[axis] = Math.min(mins[axis], coord)
        maxs[axis] = Math.max(maxs[axis], coord)
        continue
      }
      // MD frames and unwrapped inputs carry coordinates outside [0, 1)
      const wrapped = coord - Math.floor(coord)
      occupancy[axis][Math.min(OCCUPANCY_BINS - 1, Math.floor(wrapped * OCCUPANCY_BINS))] = 1
    }
  }
  if (n_real === 0) return MIN_OCCUPIED_EXTENT

  // Molecules use Cartesian bounds directly; crystal bounds are fractional.
  const heights = lattice ? math.cell_heights(lattice.matrix) : [1, 1, 1]
  let occupied_volume = lattice?.volume ?? 1
  for (let axis = 0; axis < 3; axis++) {
    // Open boundaries cannot wrap distant atoms together, even outside the cell.
    if (!lattice?.pbc[axis]) {
      occupied_volume *= Math.max(maxs[axis] - mins[axis], MIN_OCCUPIED_EXTENT / heights[axis])
      continue
    }
    // Gaps below the threshold are the material's own interlayer spacing, part of the volume
    // each atom occupies, and must stay in
    const min_run = (VACUUM_GAP / heights[axis]) * OCCUPANCY_BINS
    const empty = vacuum_fraction(occupancy[axis], min_run)
    if (empty === 0) continue
    const filled = Math.max(1 - empty, MIN_OCCUPIED_EXTENT / heights[axis])
    occupied_volume *= Math.min(1, filled)
  }
  return Math.cbrt(occupied_volume / n_real)
}
