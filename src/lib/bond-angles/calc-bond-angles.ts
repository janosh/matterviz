// Bond-angle distribution function (ADF): for every atom, take each pair of its bonded
// neighbours and record the angle subtended at that atom, then bin over 0-180 degrees.
// Third member of the local-structure family alongside $lib/rdf and $lib/coordination.

import type { Vec3 } from '$lib/math'
import type { AnyStructure } from '$lib/structure'
import type { BondingStrategy } from '$lib/structure/bonding'
import { compute_bonds, get_majority_element } from '$lib/structure/bonding'
import { angle_between_vectors } from '$lib/structure/measure'
import type { Pbc } from '$lib/structure/pbc'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'

// Angles are undirected, so the whole distribution lives in [0, 180]
export const MAX_BOND_ANGLE = 180
export const BOND_ANGLE_DEFAULT_BIN_WIDTH = 2 // degrees
// Element label for sites whose majority species cannot be resolved
const UNKNOWN_ELEMENT = `Unknown`
// Label used for the combined (all triplet types) series
export const TOTAL_TRIPLET_LABEL = `All angles`

export interface BondAngleOptions {
  strategy?: BondingStrategy
  // Bin width in degrees (default 2). Mutually exclusive with n_bins.
  bin_width?: number
  // Number of bins spanning 0-180 degrees. Mutually exclusive with bin_width.
  n_bins?: number
  // Accumulate per-triplet histograms in addition to the total (default true)
  split_by_triplet?: boolean
  // Only these elements may act as the central atom of an angle
  center_elements?: readonly string[]
  // Only these elements may act as the two outer atoms of an angle
  neighbor_elements?: readonly string[]
  // Periodic axes to bond across, defaults to the structure's own lattice.pbc. Switching
  // every axis off drops each angle that closes through a cell boundary.
  pbc?: Pbc
}

// A single angle: the two bond vectors from `center_idx` to a pair of its neighbours. A
// neighbour reached through a cell boundary reports the site index of its periodic image.
interface BondAngleTriplet {
  center_idx: number
  neighbor_idxs: [number, number]
  center_element: string
  // Outer elements sorted alphabetically, so `H-Si-O` and `O-Si-H` collapse to one label
  triplet: string
  angle: number
}

interface BondAngleSeries {
  triplet: string
  counts: number[]
  // Probability density over degrees, normalised by the STRUCTURE's grand total angle
  // count (not this series'), so the per-triplet densities add up to the total density
  density: number[]
  // Angles in this series only
  n_angles: number
}

export interface BondAngleData {
  bin_centers: number[]
  bin_width: number
  n_bins: number
  // Angles across all triplet types
  n_angles: number
  total: BondAngleSeries
  // Empty when split_by_triplet is false, else one entry per triplet, sorted by label
  by_triplet: BondAngleSeries[]
}

// Bin layout. bin_width and n_bins express the same thing, so supplying both is an error
// rather than a silent preference for one of them.
export function resolve_angle_bins({
  bin_width,
  n_bins,
}: Pick<BondAngleOptions, `bin_width` | `n_bins`>): { n_bins: number; bin_width: number } {
  if (bin_width !== undefined && n_bins !== undefined) {
    throw new Error(
      `Pass either bin_width or n_bins, not both (got bin_width=${bin_width}, n_bins=${n_bins})`,
    )
  }
  if (n_bins !== undefined) {
    if (!Number.isInteger(n_bins) || n_bins <= 0) {
      throw new Error(`n_bins must be a positive integer, got ${n_bins}`)
    }
    return { n_bins, bin_width: MAX_BOND_ANGLE / n_bins }
  }
  const width = bin_width ?? BOND_ANGLE_DEFAULT_BIN_WIDTH
  if (!Number.isFinite(width) || width <= 0 || width > MAX_BOND_ANGLE) {
    throw new Error(`bin_width must be a number in (0, ${MAX_BOND_ANGLE}], got ${bin_width}`)
  }
  // A bin_width that does not divide 180 leaves the last bin overhanging 180 degrees
  return { n_bins: Math.ceil(MAX_BOND_ANGLE / width), bin_width: width }
}

export const angle_bin_centers = (n_bins: number, bin_width: number): number[] =>
  Array.from({ length: n_bins }, (_unused, bin_idx) => (bin_idx + 0.5) * bin_width)

// Bins are half-open on the lower edge, [lo, hi). An angle sitting exactly on a boundary
// lands in the upper bin whenever `bin_width` is representable in binary (all widths the UI
// can produce are); for other widths `angle / bin_width` may round just below the integer
// and put such an angle one bin low. Only exactly-on-boundary angles are affected, they move
// by a single bin, and the set of them has measure zero. Exactly 180 degrees is clamped into
// the last bin so perfectly linear triplets are counted rather than dropped. No lower clamp:
// angle_between_vectors clamps its cosine to [-1, 1], so `angle` is never negative.
export const angle_bin_index = (angle: number, n_bins: number, bin_width: number): number =>
  Math.min(n_bins - 1, Math.floor(angle / bin_width))

// Counts -> probability density over degrees: sum(density) * bin_width === 1 when
// `n_angles` is the total the counts were drawn from. This is the normalisation that makes
// structures of different sizes comparable; raw counts scale with the number of atoms.
export const to_angle_density = (
  counts: readonly number[],
  n_angles: number,
  bin_width: number,
): number[] => {
  if (n_angles <= 0) return counts.map(() => 0)
  const scale = 1 / (n_angles * bin_width)
  return counts.map((count) => count * scale)
}

// Every bond angle in the structure, one entry per unordered neighbour pair per centre.
export function compute_bond_angles(
  structure: AnyStructure,
  options: BondAngleOptions = {},
): BondAngleTriplet[] {
  const { strategy = `electroneg_ratio` } = options
  const { sites } = structure
  const n_sites = sites.length
  if (n_sites === 0) return []

  // Periodic structures are bonded across their cell boundaries, so every angle that closes
  // through a cell face is found and a partner's periodic images count as distinct
  // neighbours. explicit_only reads bonds (cell_shift included) straight off
  // structure.properties.bonds and ignores the periodicity option.
  const lattice_pbc = `lattice` in structure ? structure.lattice.pbc : undefined
  const bonds = compute_bonds(structure, strategy, { pbc: options.pbc ?? lattice_pbc })
  const element_of = sites.map((site) => get_majority_element(site) ?? UNKNOWN_ELEMENT)

  // Both bonding strategies emit each unordered pair once, so a naive pass leaves every
  // centre's neighbour list half full. Register each bond from BOTH ends, storing the
  // DISPLACEMENT rather than the neighbour index: BondPair.pos_2 already sits at the
  // (possibly periodic) partner position, and the reverse direction is just its negation.
  //
  // Displacements are raw pos_2 - pos_1, deliberately NOT minimum-imaged. Periodic partners
  // already sit at their true Cartesian positions, so folding would collapse distinct
  // neighbours: in a 2-atom chain with a = 4 and bond length a/2, the centre's partners at
  // +2 and -2 both fold to -2, turning the correct {180: 2} into {0: 1, 180: 1}.
  type Neighbor = { site_idx: number; vec: Vec3 }
  const adjacency: Neighbor[][] = Array.from({ length: n_sites }, () => [])
  for (const { site_idx_1, site_idx_2, pos_1, pos_2 } of bonds) {
    const delta: Vec3 = [pos_2[0] - pos_1[0], pos_2[1] - pos_1[1], pos_2[2] - pos_1[2]]
    adjacency[site_idx_1].push({ site_idx: site_idx_2, vec: delta })
    adjacency[site_idx_2].push({
      site_idx: site_idx_1,
      vec: [-delta[0], -delta[1], -delta[2]],
    })
  }

  const center_filter = options.center_elements ? new SvelteSet(options.center_elements) : null
  const neighbor_filter = options.neighbor_elements
    ? new SvelteSet(options.neighbor_elements)
    : null

  const triplets: BondAngleTriplet[] = []
  for (let center_idx = 0; center_idx < n_sites; center_idx++) {
    const center_element = element_of[center_idx]
    if (center_filter && !center_filter.has(center_element)) continue
    const all_neighbors = adjacency[center_idx]
    const neighbors = neighbor_filter
      ? all_neighbors.filter((neighbor) => neighbor_filter.has(element_of[neighbor.site_idx]))
      : all_neighbors
    if (neighbors.length < 2) continue

    for (let first = 0; first < neighbors.length - 1; first++) {
      const near_1 = neighbors[first]
      const elem_1 = element_of[near_1.site_idx]
      for (let second = first + 1; second < neighbors.length; second++) {
        const near_2 = neighbors[second]
        const elem_2 = element_of[near_2.site_idx]
        const [outer_1, outer_2] = elem_1 <= elem_2 ? [elem_1, elem_2] : [elem_2, elem_1]
        triplets.push({
          center_idx,
          neighbor_idxs: [near_1.site_idx, near_2.site_idx],
          center_element,
          triplet: `${outer_1}-${center_element}-${outer_2}`,
          angle: angle_between_vectors(near_1.vec, near_2.vec, `degrees`),
        })
      }
    }
  }
  return triplets
}

// Histogram a triplet list that has already been computed. Kept separate from
// compute_bond_angles so re-binning (e.g. a bin-width slider) never re-runs the image
// expansion and bond search.
export function bin_bond_angles(
  triplets: readonly BondAngleTriplet[],
  options: Pick<BondAngleOptions, `bin_width` | `n_bins` | `split_by_triplet`> = {},
): BondAngleData {
  const { n_bins, bin_width } = resolve_angle_bins(options)
  const { split_by_triplet = true } = options

  const total_counts = Array.from({ length: n_bins }, () => 0)
  const counts_by_triplet = new SvelteMap<string, number[]>()
  for (const { angle, triplet } of triplets) {
    const bin_idx = angle_bin_index(angle, n_bins, bin_width)
    total_counts[bin_idx] += 1
    if (!split_by_triplet) continue
    let counts = counts_by_triplet.get(triplet)
    if (!counts)
      counts_by_triplet.set(triplet, (counts = Array.from({ length: n_bins }, () => 0)))
    counts[bin_idx] += 1
  }

  const n_angles = triplets.length
  const make_series = (triplet: string, counts: number[]): BondAngleSeries => ({
    triplet,
    counts,
    density: to_angle_density(counts, n_angles, bin_width),
    n_angles: counts.reduce((sum, count) => sum + count, 0),
  })

  return {
    bin_centers: angle_bin_centers(n_bins, bin_width),
    bin_width,
    n_bins,
    n_angles,
    total: make_series(TOTAL_TRIPLET_LABEL, total_counts),
    by_triplet: Array.from(counts_by_triplet.entries())
      .toSorted(([label_a], [label_b]) => label_a.localeCompare(label_b))
      .map(([triplet, counts]) => make_series(triplet, counts)),
  }
}

// Bond-angle distribution: histogram of every bond angle over 0-180 degrees, plus one
// histogram per triplet type. Series carry raw `counts` and a `density` normalised by the
// structure's grand total angle count (see BondAngleSeries).
export const calc_bond_angle_distribution = (
  structure: AnyStructure,
  options: BondAngleOptions = {},
): BondAngleData => bin_bond_angles(compute_bond_angles(structure, options), options)
