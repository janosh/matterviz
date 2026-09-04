// Worker-safe composition and density helpers. Kept outside the component barrel so
// trajectory parsing can extract density without loading Svelte components in a Web Worker.
import { element_by_symbol } from '$lib/element/data'
import * as math from '$lib/math'
import type { Vec3 } from '$lib/math'
import type { ElementSymbol } from '$lib/element/types'
import type { AnyStructure, Crystal } from './index'
import { is_image_site } from './site'

export const get_element_counts = (
  structure: AnyStructure,
): Partial<Record<ElementSymbol, number>> => {
  const elements: Partial<Record<ElementSymbol, number>> = {}
  for (const site of structure.sites) {
    if (is_image_site(site)) continue
    for (const { element, occu } of site.species) {
      elements[element] = (elements[element] ?? 0) + occu
    }
  }
  return elements
}

// unified atomic mass units (u) per cubic angstrom (Å^3) to g/cm^3
const AMU_PER_A3_TO_G_PER_CM3 = 1.66053907

// One pass over the sites (no intermediate composition object): runs per frame of a trajectory
export const get_density = (structure: Crystal): number => {
  let mass = 0
  for (const site of structure.sites) {
    if (is_image_site(site)) continue
    for (const { element, occu } of site.species) {
      const weight = element_by_symbol.get(element)?.atomic_mass
      if (weight !== undefined) mass += occu * weight
    }
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
  const { sites } = structure
  if (!sites?.length) return MIN_OCCUPIED_EXTENT

  // Exclude PBC images from both occupancy and atom count.
  let n_real = 0
  if (!(`lattice` in structure)) {
    // No cell to subtract vacuum from: the atoms' own bounding box is all there is
    const mins = [Infinity, Infinity, Infinity]
    const maxs = [-Infinity, -Infinity, -Infinity]
    for (const site of sites) {
      if (is_image_site(site)) continue
      n_real += 1
      for (let axis = 0; axis < 3; axis++) {
        const coord = site.xyz[axis]
        if (coord < mins[axis]) mins[axis] = coord
        if (coord > maxs[axis]) maxs[axis] = coord
      }
    }
    if (n_real === 0) return MIN_OCCUPIED_EXTENT
    const box = [0, 1, 2].reduce(
      (product, axis) => product * Math.max(maxs[axis] - mins[axis], MIN_OCCUPIED_EXTENT),
      1,
    )
    return Math.cbrt(box / n_real)
  }

  const { volume, matrix, pbc } = structure.lattice
  if (!(volume > 0)) return MIN_OCCUPIED_EXTENT // singular cell: nothing to divide up

  // Hand-built sites may lack valid abc; derive it lazily from rendered xyz.
  let to_frac: ((cart: Vec3) => Vec3) | undefined
  const mins = [Infinity, Infinity, Infinity]
  const maxs = [-Infinity, -Infinity, -Infinity]
  for (const bins of occupancy) bins.fill(0)
  for (const site of sites) {
    if (is_image_site(site)) continue
    n_real += 1
    const abc = site.abc?.every((coord) => Number.isFinite(coord))
      ? site.abc
      : (to_frac ??= math.create_cart_to_frac(matrix))(site.xyz)
    for (let axis = 0; axis < 3; axis++) {
      if (!pbc[axis]) {
        mins[axis] = Math.min(mins[axis], abc[axis])
        maxs[axis] = Math.max(maxs[axis], abc[axis])
        continue
      }
      // MD frames and unwrapped inputs carry coordinates outside [0, 1)
      const wrapped = abc[axis] - Math.floor(abc[axis])
      occupancy[axis][Math.min(OCCUPANCY_BINS - 1, Math.floor(wrapped * OCCUPANCY_BINS))] = 1
    }
  }
  if (n_real === 0) return MIN_OCCUPIED_EXTENT

  const heights = math.cell_heights(matrix)
  let occupied_volume = volume
  for (let axis = 0; axis < 3; axis++) {
    // Open boundaries cannot wrap distant atoms together, even outside the cell.
    if (!pbc[axis]) {
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
