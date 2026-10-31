// Bond-angle distribution function (ADF): for every atom, take each pair of its bonded
// neighbours and record the angle subtended at that atom, then bin over 0-180 degrees.
// Third member of the local-structure family alongside #lib/rdf and #lib/coordination.

import type { Vec3 } from '#lib/math.js'
import { is_valid_index, sorted_numbers } from '#lib/math.js'
import type { AnyStructure } from '#lib/structure/index.js'
import type { BondingStrategy } from '#lib/structure/bonding.js'
import {
  compute_bonds,
  intern_site_elements,
  lattice_pbc_or_throw,
} from '#lib/structure/bonding.js'
import { angle_between_vectors } from '#lib/structure/measure.js'
import { split_site_partners } from '#lib/structure/partial-occupancy.js'
import type { Pbc } from '#lib/structure/pbc.js'

// Angles are undirected, so the whole distribution lives in [0, 180]
export const MAX_BOND_ANGLE = 180
// Cap on the histogram length: bounding the bin WIDTH to (0, 180] bounds nothing, since
// bin_width 1e-5 asks for 18 million bins (~290 MB across bin centers and the per-triplet
// count arrays). 1e5 bins is 0.0018 degrees, finer than any angle distribution resolves.
const MAX_ANGLE_BINS = 100_000
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

// Every angle of a structure as parallel columns, since plots keep them for re-binning and
// one object per angle cost ~150 B (108 MiB for 724k angles of an 11k-atom fcc metal). Angle
// `idx` is subtended at site center_idxs[idx] by two of its bonded neighbours.
export interface BondAngles {
  // Degrees
  angles: Float64Array
  center_idxs: Int32Array
  // Site indices of the two outer atoms at [2 * idx] and [2 * idx + 1] (the base site for a
  // neighbour reached through a cell boundary), so a histogram bar can be traced back to the
  // atoms it counts
  neighbor_idxs: Int32Array
  // Index into `labels` of each angle's triplet
  label_ids: Int32Array
  // `outer-center-outer` with the outer elements sorted alphabetically, so `H-Si-O` and
  // `O-Si-H` collapse to one label
  labels: string[]
}

interface BondAngleSeries {
  triplet: string
  counts: number[]
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
    if (!Number.isInteger(n_bins) || n_bins <= 0 || n_bins > MAX_ANGLE_BINS) {
      throw new Error(`n_bins must be a positive integer <= ${MAX_ANGLE_BINS}, got ${n_bins}`)
    }
    return { n_bins, bin_width: MAX_BOND_ANGLE / n_bins }
  }
  const width = bin_width ?? BOND_ANGLE_DEFAULT_BIN_WIDTH
  if (!Number.isFinite(width) || width <= 0 || width > MAX_BOND_ANGLE) {
    throw new Error(`bin_width must be a number in (0, ${MAX_BOND_ANGLE}], got ${bin_width}`)
  }
  // A bin_width that does not divide 180 leaves the last bin overhanging 180 degrees
  const resolved_bins = Math.ceil(MAX_BOND_ANGLE / width)
  if (resolved_bins > MAX_ANGLE_BINS) {
    throw new Error(
      `bin_width ${width} degrees spans ${resolved_bins} bins over 0-${MAX_BOND_ANGLE} degrees, past the ${MAX_ANGLE_BINS} limit; widen it to at least ${MAX_BOND_ANGLE / MAX_ANGLE_BINS} degrees`,
    )
  }
  return { n_bins: resolved_bins, bin_width: width }
}

export const angle_bin_centers = (n_bins: number, bin_width: number): number[] =>
  Array.from({ length: n_bins }, (_unused, bin_idx) => (bin_idx + 0.5) * bin_width)

// Bins are half-open on the lower edge, [lo, hi). Exact crystal angles (60, 90, 120 deg) sit
// on bin edges but come out of acos a few ulp low, so the 1e-9 nudge (as in calc-rdf.ts)
// keeps one shell from splitting across two bins; it is far below any physical separation.
// Exactly 180 degrees is clamped into the last bin so perfectly linear triplets are counted
// rather than dropped. No lower clamp: angle_between_vectors clamps its cosine to [-1, 1], so
// `angle` is never negative.
export const angle_bin_index = (angle: number, n_bins: number, bin_width: number): number =>
  Math.min(n_bins - 1, Math.floor(angle / bin_width + 1e-9))

// Every bond angle in the structure, one entry per unordered neighbour pair per centre.
export function calc_bond_angles(
  structure: AnyStructure,
  options: BondAngleOptions = {},
): BondAngles {
  const { strategy = `electroneg_ratio` } = options
  const { sites } = structure
  const n_sites = sites.length

  // Periodic structures are bonded across their cell boundaries, so every angle that closes
  // through a cell face is found and a partner's periodic images count as distinct
  // neighbours. explicit_only reads bonds (cell_shift included) straight off
  // structure.properties.bonds and ignores the periodicity option.
  const bonds = compute_bonds(structure, strategy, {
    pbc: lattice_pbc_or_throw(structure, options.pbc),
  })
  // Elements as small integers so the inner loop indexes a label table instead of
  // building one `A-B-C` string per angle
  const { symbols: elements, site_elem_ids: elem_of_site } = intern_site_elements(
    sites,
    UNKNOWN_ELEMENT,
  )
  const n_elems = elements.length
  // Label ids filled on first use, keyed by the packed (center, low, high) index so (center,
  // outer_1, outer_2) and (center, outer_2, outer_1) share an entry without reserving
  // n_elems^3 slots
  const labels: string[] = []
  const label_id_of_slot = new Map<number, number>()
  const label_of = (center: number, outer_1: number, outer_2: number): number => {
    const low = Math.min(outer_1, outer_2)
    const slot = (center * n_elems + low) * n_elems + Math.max(outer_1, outer_2)
    let label_id = label_id_of_slot.get(slot)
    if (label_id === undefined) {
      // Alphabetical by element symbol, not by first-seen id
      const [outer_a, outer_b] = [elements[outer_1], elements[outer_2]].toSorted()
      label_id = labels.push(`${outer_a}-${elements[center]}-${outer_b}`) - 1
      label_id_of_slot.set(slot, label_id)
    }
    return label_id
  }

  // Both bonding strategies emit each unordered pair once, so a naive pass leaves every
  // centre's neighbour list half full. Register each bond from BOTH ends, storing the
  // DISPLACEMENT rather than the neighbour index: BondPair.pos_2 already sits at the
  // (possibly periodic) partner position, and the reverse direction is just its negation.
  //
  // Displacements are raw pos_2 - pos_1, deliberately NOT minimum-imaged. Periodic partners
  // already sit at their true Cartesian positions, so folding would collapse distinct
  // neighbours: in a 2-atom chain with a = 4 and bond length a/2, the centre's partners at
  // +2 and -2 both fold to -2, turning the correct {180: 2} into {0: 1, 180: 1}.
  //
  // Split partial sites at one position are one neighbor, as the viewer draws them as one
  // atom, so they add no 0-degree angle between themselves. It is named by its majority
  // element (ties alphabetical, so site order doesn't matter) and passes a neighbor filter
  // through any of its elements.
  type Neighbor = { site_idx: number; elem_id: number; vec: Vec3 }
  const adjacency: Neighbor[][] = Array.from({ length: n_sites }, () => [])
  const { groups, partner_of } = split_site_partners(sites)
  const group_elem = new Map<number, number>()
  for (const [render_idx, members] of groups) {
    const occupancy = new Map<number, number>()
    for (const member of members) {
      const occu = sites[member].species.reduce((sum, species) => sum + species.occu, 0)
      const elem_id = elem_of_site[member]
      occupancy.set(elem_id, (occupancy.get(elem_id) ?? 0) + occu)
    }
    const [[majority]] = [...occupancy].toSorted(
      ([elem_a, occu_a], [elem_b, occu_b]) =>
        occu_b - occu_a || elements[elem_a].localeCompare(elements[elem_b]),
    )
    group_elem.set(render_idx, majority)
  }
  const elem_of_partner = (partner: number): number =>
    group_elem.get(partner) ?? elem_of_site[partner]
  for (const { site_idx_1, site_idx_2, pos_1, pos_2, cell_shift } of bonds) {
    const delta: Vec3 = [pos_2[0] - pos_1[0], pos_2[1] - pos_1[1], pos_2[2] - pos_1[2]]
    const partner_2 = partner_of(site_idx_1, site_idx_2, false, cell_shift)
    if (partner_2 !== -1) {
      adjacency[site_idx_1].push({
        site_idx: partner_2,
        elem_id: elem_of_partner(partner_2),
        vec: delta,
      })
    }
    const partner_1 = partner_of(site_idx_2, site_idx_1, true, cell_shift)
    if (partner_1 !== -1) {
      adjacency[site_idx_2].push({
        site_idx: partner_1,
        elem_id: elem_of_partner(partner_1),
        vec: [-delta[0], -delta[1], -delta[2]],
      })
    }
  }

  const center_filter = options.center_elements ? new Set(options.center_elements) : null
  const neighbor_filter = options.neighbor_elements ? new Set(options.neighbor_elements) : null

  // Filter first so the columns are allocated at their exact length
  for (let center_idx = 0; center_idx < n_sites; center_idx++) {
    const center_elem = elements[elem_of_site[center_idx]]
    if (center_filter && !center_filter.has(center_elem)) adjacency[center_idx] = []
    else if (neighbor_filter) {
      adjacency[center_idx] = adjacency[center_idx].filter(({ site_idx, elem_id }) =>
        (groups.get(site_idx)?.map((member) => elem_of_site[member]) ?? [elem_id]).some(
          (member_elem) => neighbor_filter.has(elements[member_elem]),
        ),
      )
    }
  }
  const n_angles = adjacency.reduce(
    (sum, neighbors) => sum + (neighbors.length * (neighbors.length - 1)) / 2,
    0,
  )
  const angles = new Float64Array(n_angles)
  const center_idxs = new Int32Array(n_angles)
  const neighbor_idxs = new Int32Array(2 * n_angles)
  const label_ids = new Int32Array(n_angles)
  let angle_idx = 0
  for (const [center_idx, neighbors] of adjacency.entries()) {
    const center = elem_of_site[center_idx]
    for (let first = 0; first < neighbors.length - 1; first++) {
      const near_1 = neighbors[first]
      for (let second = first + 1; second < neighbors.length; second++) {
        const near_2 = neighbors[second]
        angles[angle_idx] = angle_between_vectors(near_1.vec, near_2.vec)
        center_idxs[angle_idx] = center_idx
        neighbor_idxs[2 * angle_idx] = near_1.site_idx
        neighbor_idxs[2 * angle_idx + 1] = near_2.site_idx
        label_ids[angle_idx] = label_of(center, near_1.elem_id, near_2.elem_id)
        angle_idx++
      }
    }
  }
  return { angles, center_idxs, neighbor_idxs, label_ids, labels }
}

// Histogram angles that have already been computed. Kept separate from
// calc_bond_angles so re-binning (e.g. a bin-width slider) never re-runs the image
// expansion and bond search.
export function bin_bond_angles(
  { angles, label_ids, labels }: BondAngles,
  options: Pick<BondAngleOptions, `bin_width` | `n_bins` | `split_by_triplet`> = {},
): BondAngleData {
  const { n_bins, bin_width } = resolve_angle_bins(options)
  const { split_by_triplet = true } = options

  const total_counts = Array.from({ length: n_bins }, () => 0)
  // Indexed by label id. calc_bond_angles only labels angles it emits, so none stays empty.
  const counts_by_label = split_by_triplet
    ? labels.map(() => Array.from({ length: n_bins }, () => 0))
    : []
  for (let angle_idx = 0; angle_idx < angles.length; angle_idx++) {
    const bin_idx = angle_bin_index(angles[angle_idx], n_bins, bin_width)
    total_counts[bin_idx] += 1
    if (split_by_triplet) counts_by_label[label_ids[angle_idx]][bin_idx] += 1
  }

  const make_series = (triplet: string, counts: number[]): BondAngleSeries => ({
    triplet,
    counts,
    n_angles: counts.reduce((sum, count) => sum + count, 0),
  })

  return {
    bin_centers: angle_bin_centers(n_bins, bin_width),
    bin_width,
    n_bins,
    n_angles: angles.length,
    total: make_series(TOTAL_TRIPLET_LABEL, total_counts),
    by_triplet: counts_by_label
      .map((counts, label_id) => make_series(labels[label_id], counts))
      .toSorted((series_a, series_b) => series_a.triplet.localeCompare(series_b.triplet)),
  }
}

// Bond-angle distribution: histogram of every bond angle over 0-180 degrees, plus one
// histogram per triplet type. Series carry raw counts; to_angle_bar_series in ./series.ts
// turns them into densities where structures of different sizes need comparing.
export const calc_bond_angle_distribution = (
  structure: AnyStructure,
  options: BondAngleOptions = {},
): BondAngleData => bin_bond_angles(calc_bond_angles(structure, options), options)

// Sites behind one histogram bar (bin `bin_idx`, optionally one triplet label): the sorted
// centre atoms and outer atoms (base sites for neighbours across a cell boundary) of its angles
export function bond_angle_bin_sites(
  { angles, center_idxs, neighbor_idxs, label_ids, labels }: BondAngles,
  options: Pick<BondAngleOptions, `bin_width` | `n_bins`> & {
    bin_idx: number
    triplet?: string
  },
): { site_indices: number[]; neighbor_indices: number[] } {
  const { bin_idx, triplet: triplet_filter, ...bins } = options
  const { n_bins, bin_width } = resolve_angle_bins(bins)
  if (!is_valid_index(bin_idx, n_bins)) {
    throw new Error(`bin_idx must be an integer in [0, ${n_bins}), got ${bin_idx}`)
  }
  // -1 (matching no angle) for a label this structure has none of
  const label_filter =
    triplet_filter === undefined ? undefined : labels.indexOf(triplet_filter)
  const centers = new Set<number>()
  const outers = new Set<number>()
  for (let angle_idx = 0; angle_idx < angles.length; angle_idx++) {
    if (label_filter !== undefined && label_ids[angle_idx] !== label_filter) continue
    if (angle_bin_index(angles[angle_idx], n_bins, bin_width) !== bin_idx) continue
    centers.add(center_idxs[angle_idx])
    outers.add(neighbor_idxs[2 * angle_idx])
    outers.add(neighbor_idxs[2 * angle_idx + 1])
  }
  return { site_indices: sorted_numbers(centers), neighbor_indices: sorted_numbers(outers) }
}
