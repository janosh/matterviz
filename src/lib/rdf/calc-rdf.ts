import type { Matrix3x3, Vec3 } from '$lib/math'
import {
  calc_lattice_params,
  create_lattice_converters,
  euclidean_dist,
  pbc_dist,
} from '$lib/math'
import type { Crystal, Site } from '$lib/structure'
import type { Pbc } from '$lib/structure/pbc'
import type { RdfOptions, RdfPattern } from './index'

const get_occu = (site: Crystal[`sites`][number], elem: string | undefined) =>
  elem ? (site.species.find((spec) => spec.element === elem)?.occu ?? 0) : 1
const has_species = (site: Crystal[`sites`][number], elem: string | undefined) =>
  !elem || site.species.some((spec) => spec.element === elem)
const sum_occu = (sites: Crystal[`sites`], elem: string | undefined) =>
  sites.reduce((sum, site) => sum + get_occu(site, elem), 0)

// Symmetric ± lattice images on expanded PBC axes (positive-only supercell + min-image
// can collapse distinct shells). Expanded axes disable PBC; short axes still min-image.
function build_rdf_neighbor_sites(
  structure: Crystal,
  pbc: Pbc,
  cutoff: number,
  auto_expand: boolean,
  expansion_factor: number,
): { sites: Site[]; dist_pbc: Pbc; dist_lattice: Matrix3x3 } {
  const dist_lattice = structure.lattice.matrix
  if (!auto_expand) return { sites: structure.sites, dist_pbc: pbc, dist_lattice }

  const { a, b, c } = calc_lattice_params(dist_lattice)
  const extents = ([a, b, c] as const).map((len, axis) =>
    pbc[axis] ? Math.max(0, Math.ceil((cutoff * expansion_factor) / len) - 1) : 0,
  ) as Vec3

  if (extents.every((extent) => extent === 0)) {
    return { sites: structure.sites, dist_pbc: pbc, dist_lattice }
  }

  const [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = dist_lattice
  const sites: Site[] = []
  for (let ia = -extents[0]; ia <= extents[0]; ia++) {
    for (let ib = -extents[1]; ib <= extents[1]; ib++) {
      for (let ic = -extents[2]; ic <= extents[2]; ic++) {
        const tx = ia * ax + ib * bx + ic * cx
        const ty = ia * ay + ib * by + ic * cy
        const tz = ia * az + ib * bz + ic * cz
        for (const site of structure.sites) {
          sites.push({ ...site, xyz: [site.xyz[0] + tx, site.xyz[1] + ty, site.xyz[2] + tz] })
        }
      }
    }
  }

  const dist_pbc: Pbc = [
    pbc[0] && extents[0] === 0,
    pbc[1] && extents[1] === 0,
    pbc[2] && extents[2] === 0,
  ]
  return { sites, dist_pbc, dist_lattice }
}

// Calculate radial distribution function
export function calculate_rdf(structure: Crystal, options: RdfOptions = {}): RdfPattern {
  const {
    center_species,
    neighbor_species,
    cutoff = 15,
    n_bins = 75,
    auto_expand = true,
    expansion_factor = 2.0,
  } = options
  const { pbc = [true, true, true] } = options
  if (cutoff <= 0 || n_bins <= 0) {
    throw new Error(`cutoff and n_bins must be positive`)
  }

  // Validate structure has lattice
  if (!structure.lattice?.matrix) {
    throw new Error(`Crystal must have a lattice for RDF calculation`)
  }

  const {
    sites: neighbor_sites,
    dist_pbc,
    dist_lattice,
  } = build_rdf_neighbor_sites(structure, pbc, cutoff, auto_expand, expansion_factor)

  const bin_size = cutoff / n_bins
  const r = Array.from({ length: n_bins }, (_, idx) => (idx + 0.5) * bin_size)
  const g_r = Array(n_bins).fill(0)

  // Centers stay in the original cell; neighbor_sites may include periodic images
  const centers = structure.sites.filter((site) => has_species(site, center_species))
  const neighbors = neighbor_sites.filter((site) => has_species(site, neighbor_species))
  // Normalization density uses the original cell (not the image cloud)
  const norm_neighbors = structure.sites.filter((site) => has_species(site, neighbor_species))

  const element_pair =
    center_species && neighbor_species
      ? ([center_species, neighbor_species] as [string, string])
      : undefined
  if (centers.length === 0 || neighbors.length === 0) return { r, g_r, element_pair }

  const use_pbc = dist_pbc.some(Boolean)
  const converters = use_pbc ? create_lattice_converters(dist_lattice) : undefined

  for (const center of centers) {
    for (const neighbor of neighbors) {
      const dist = use_pbc
        ? pbc_dist(center.xyz, neighbor.xyz, dist_lattice, converters, dist_pbc)
        : euclidean_dist(center.xyz, neighbor.xyz)

      if (dist > 0 && dist < cutoff) {
        // Weight by product of occupancies for the species pair
        const weight = get_occu(center, center_species) * get_occu(neighbor, neighbor_species)
        g_r[Math.min(Math.floor(dist / bin_size), n_bins - 1)] += weight
      }
    }
  }

  // Ideal-gas normalization with original-cell density. Do not subtract self-pairs:
  // dist > 0 already drops the true self term, while periodic images of the same atom
  // are valid neighbors (critical for 1-atom cells).
  const center_weight = sum_occu(centers, center_species)
  const neighbor_weight = sum_occu(norm_neighbors, neighbor_species)
  const volume = calc_lattice_params(structure.lattice.matrix).volume
  if (center_weight > 0 && neighbor_weight > 0 && volume > 0) {
    for (let idx = 0; idx < n_bins; idx++) {
      g_r[idx] /=
        center_weight * neighbor_weight * ((4 * Math.PI * r[idx] ** 2 * bin_size) / volume)
    }
  }

  return { r, g_r, element_pair }
}

// Calculate RDF for all element pairs
export function calculate_all_pair_rdfs(
  structure: Crystal,
  options: Omit<RdfOptions, `center_species` | `neighbor_species`> = {},
): RdfPattern[] {
  // Collect all unique elements across all species (supports mixed occupancy)
  const elems = [
    ...new Set(structure.sites.flatMap((site) => site.species.map((spec) => spec.element))),
  ].sort()

  // Forward options unchanged (preserves caller's pbc); each calculate_rdf expands itself
  return elems.flatMap((el1, idx1) =>
    elems.slice(idx1).map((el2) =>
      calculate_rdf(structure, {
        ...options,
        center_species: el1,
        neighbor_species: el2,
      }),
    ),
  )
}
