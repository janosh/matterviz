import type { Matrix3x3, Vec3 } from '$lib/math'
import { calc_lattice_params, create_lattice_converters, pbc_dist } from '$lib/math'
import type { Crystal, Site } from '$lib/structure'
import type { Pbc } from '$lib/structure/pbc'
import type { RdfOptions, RdfPattern } from './index'

const get_occu = (site: Crystal[`sites`][number], elem: string | undefined) =>
  elem ? (site.species.find((spec) => spec.element === elem)?.occu ?? 0) : 1
const has_species = (site: Crystal[`sites`][number], elem: string | undefined) =>
  !elem || site.species.some((spec) => spec.element === elem)

// Symmetric ± lattice images on expanded PBC axes. Extents use reciprocal-axis norms
// with search radius cutoff + cell diagonal (length-based ceil undercounts skewed cells).
function build_rdf_neighbor_sites(
  structure: Crystal,
  pbc: Pbc,
  cutoff: number,
  auto_expand: boolean,
): { sites: Site[]; dist_pbc: Pbc; dist_lattice: Matrix3x3 } {
  const dist_lattice = structure.lattice.matrix
  if (!auto_expand) return { sites: structure.sites, dist_pbc: pbc, dist_lattice }

  const [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = dist_lattice
  let cell_diag = 0
  for (let bits = 0; bits < 8; bits++) {
    const [ua, ub, uc] = [bits & 1, (bits >> 1) & 1, (bits >> 2) & 1]
    cell_diag = Math.max(
      cell_diag,
      Math.hypot(
        ua * ax + ub * bx + uc * cx,
        ua * ay + ub * by + uc * cy,
        ua * az + ub * bz + uc * cz,
      ),
    )
  }
  const { reciprocal_axis_norms } = create_lattice_converters(dist_lattice)
  const search_radius = cutoff + cell_diag
  const extents = ([0, 1, 2] as const).map((axis) =>
    pbc[axis]
      ? Math.max(0, Math.ceil(search_radius * reciprocal_axis_norms[axis] - 1e-12))
      : 0,
  ) as Vec3

  if (extents.every((extent) => extent === 0)) {
    return { sites: structure.sites, dist_pbc: pbc, dist_lattice }
  }

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

type NeighborCloud = ReturnType<typeof build_rdf_neighbor_sites>

// The image cloud depends only on structure, pbc, cutoff and auto_expand — never on the
// species pair — so all-pair callers build it once.
function prepare_rdf(structure: Crystal, options: RdfOptions) {
  const { cutoff = 15, n_bins = 75, auto_expand = true } = options
  const pbc = options.pbc ?? structure.lattice?.pbc ?? [true, true, true]
  if (cutoff <= 0 || n_bins <= 0) throw new Error(`cutoff and n_bins must be positive`)
  if (!structure.lattice?.matrix) {
    throw new Error(`Crystal must have a lattice for RDF calculation`)
  }
  return {
    cutoff,
    n_bins,
    cloud: build_rdf_neighbor_sites(structure, pbc, cutoff, auto_expand),
  }
}

// Bin pair distances into `g_r`, weighted by the product of the pair's occupancies. The image
// cloud spans cutoff + cell diagonal, so most images sit beyond the cutoff: bucketing
// neighbors into cutoff-sized cells lets each center scan the 27 cells around it instead of
// every image. Euclidean only — the PBC path needs minimum-image distances, but it only runs
// when no cloud was built, so it stays small.
function accumulate_pairs(
  centers: Site[],
  center_occu: Float64Array,
  neighbors: Site[],
  neighbor_occu: Float64Array,
  cutoff: number,
  bin_size: number,
  n_bins: number,
  g_r: number[],
): void {
  let [min_x, min_y, min_z] = [Infinity, Infinity, Infinity]
  let [max_x, max_y, max_z] = [-Infinity, -Infinity, -Infinity]
  for (const { xyz } of neighbors) {
    min_x = Math.min(min_x, xyz[0])
    min_y = Math.min(min_y, xyz[1])
    min_z = Math.min(min_z, xyz[2])
    max_x = Math.max(max_x, xyz[0])
    max_y = Math.max(max_y, xyz[1])
    max_z = Math.max(max_z, xyz[2])
  }
  const dim_x = Math.floor((max_x - min_x) / cutoff) + 1
  const dim_y = Math.floor((max_y - min_y) / cutoff) + 1
  const dim_z = Math.floor((max_z - min_z) / cutoff) + 1

  const axis_bin = (value: number, min: number, dim: number): number =>
    Math.min(dim - 1, Math.max(0, Math.floor((value - min) / cutoff)))

  // Flat positions: the inner loop reads these millions of times, where a site object plus
  // its xyz array costs measurably more than an indexed read (48 ms vs 83 ms on 444 sites).
  const pos = new Float64Array(neighbors.length * 3)
  const grid = new Map<number, number[]>()
  for (let idx = 0; idx < neighbors.length; idx++) {
    const [nx, ny, nz] = neighbors[idx].xyz
    pos[idx * 3] = nx
    pos[idx * 3 + 1] = ny
    pos[idx * 3 + 2] = nz
    const key =
      (axis_bin(nz, min_z, dim_z) * dim_y + axis_bin(ny, min_y, dim_y)) * dim_x +
      axis_bin(nx, min_x, dim_x)
    const cell = grid.get(key)
    if (cell) cell.push(idx)
    else grid.set(key, [idx])
  }

  const cutoff_sq = cutoff * cutoff
  for (let ci = 0; ci < centers.length; ci++) {
    const [cx, cy, cz] = centers[ci].xyz
    const bin_x = axis_bin(cx, min_x, dim_x)
    const bin_y = axis_bin(cy, min_y, dim_y)
    const bin_z = axis_bin(cz, min_z, dim_z)
    for (let iz = Math.max(0, bin_z - 1); iz <= Math.min(dim_z - 1, bin_z + 1); iz++) {
      for (let iy = Math.max(0, bin_y - 1); iy <= Math.min(dim_y - 1, bin_y + 1); iy++) {
        for (let ix = Math.max(0, bin_x - 1); ix <= Math.min(dim_x - 1, bin_x + 1); ix++) {
          const cell = grid.get((iz * dim_y + iy) * dim_x + ix)
          if (!cell) continue
          for (const ni of cell) {
            const dist_sq =
              (cx - pos[ni * 3]) ** 2 +
              (cy - pos[ni * 3 + 1]) ** 2 +
              (cz - pos[ni * 3 + 2]) ** 2
            if (dist_sq <= 0 || dist_sq >= cutoff_sq) continue
            const bin = Math.min(Math.floor(Math.sqrt(dist_sq) / bin_size), n_bins - 1)
            g_r[bin] += center_occu[ci] * neighbor_occu[ni]
          }
        }
      }
    }
  }
}

// Sites carrying a species, with that species' occupancy per site resolved up front.
type SpeciesSubset = { sites: Site[]; occu: Float64Array }
type SubsetCache = Map<string, SpeciesSubset>

// Walks every site and its species list, which costs more than the distance scan itself, so
// all-pair runs (E(E+1)/2 calls over E species) memoize this for the duration of the run.
function species_subset(
  sites: Site[],
  species: string | undefined,
  cache: SubsetCache | undefined,
): SpeciesSubset {
  const cached = cache?.get(species ?? ``)
  if (cached) return cached
  const filtered = sites.filter((site) => has_species(site, species))
  const subset = {
    sites: filtered,
    occu: Float64Array.from(filtered, (site) => get_occu(site, species)),
  }
  cache?.set(species ?? ``, subset)
  return subset
}

function rdf_from_cloud(
  structure: Crystal,
  cloud: NeighborCloud,
  cutoff: number,
  n_bins: number,
  center_species: string | undefined,
  neighbor_species: string | undefined,
  // Per-run caches keyed by species: one over the original cell, one over the image cloud.
  cell_cache?: SubsetCache,
  cloud_cache?: SubsetCache,
): RdfPattern {
  const { sites: neighbor_sites, dist_pbc, dist_lattice } = cloud
  const bin_size = cutoff / n_bins
  const r = Array.from({ length: n_bins }, (_, idx) => (idx + 0.5) * bin_size)
  const g_r = Array(n_bins).fill(0)

  // Centers stay in the original cell; neighbor_sites may include periodic images
  const { sites: centers, occu: center_occu } = species_subset(
    structure.sites,
    center_species,
    cell_cache,
  )
  const { sites: neighbors, occu: neighbor_occu } = species_subset(
    neighbor_sites,
    neighbor_species,
    cloud_cache,
  )
  // Normalization density uses the original cell (not the image cloud)
  const norm_neighbors = species_subset(structure.sites, neighbor_species, cell_cache)

  const element_pair =
    center_species && neighbor_species
      ? ([center_species, neighbor_species] as [string, string])
      : undefined
  if (centers.length === 0 || neighbors.length === 0) return { r, g_r, element_pair }

  if (dist_pbc.some(Boolean)) {
    const converters = create_lattice_converters(dist_lattice)
    for (let ci = 0; ci < centers.length; ci++) {
      for (let ni = 0; ni < neighbors.length; ni++) {
        const dist = pbc_dist(
          centers[ci].xyz,
          neighbors[ni].xyz,
          dist_lattice,
          converters,
          dist_pbc,
        )
        if (dist > 0 && dist < cutoff) {
          g_r[Math.min(Math.floor(dist / bin_size), n_bins - 1)] +=
            center_occu[ci] * neighbor_occu[ni]
        }
      }
    }
  } else {
    accumulate_pairs(
      centers,
      center_occu,
      neighbors,
      neighbor_occu,
      cutoff,
      bin_size,
      n_bins,
      g_r,
    )
  }

  // Ideal-gas normalization with original-cell density. Do not subtract self-pairs:
  // dist > 0 already drops the true self term, while periodic images of the same atom
  // are valid neighbors (critical for 1-atom cells).
  const center_weight = center_occu.reduce((sum, occu) => sum + occu, 0)
  const neighbor_weight = norm_neighbors.occu.reduce((sum, occu) => sum + occu, 0)
  const volume = calc_lattice_params(structure.lattice.matrix).volume
  if (center_weight > 0 && neighbor_weight > 0 && volume > 0) {
    for (let idx = 0; idx < n_bins; idx++) {
      g_r[idx] /=
        center_weight * neighbor_weight * ((4 * Math.PI * r[idx] ** 2 * bin_size) / volume)
    }
  }

  return { r, g_r, element_pair }
}

// Calculate radial distribution function
export function calculate_rdf(structure: Crystal, options: RdfOptions = {}): RdfPattern {
  const { cutoff, n_bins, cloud } = prepare_rdf(structure, options)
  return rdf_from_cloud(
    structure,
    cloud,
    cutoff,
    n_bins,
    options.center_species,
    options.neighbor_species,
  )
}

// Calculate RDF for all element pairs
export function calculate_all_pair_rdfs(
  structure: Crystal,
  options: Omit<RdfOptions, `center_species` | `neighbor_species`> = {},
): RdfPattern[] {
  // Collect all unique elements across all species (supports mixed occupancy)
  const elems = [
    ...new Set(structure.sites.flatMap((site) => site.species.map((spec) => spec.element))),
  ].toSorted()

  // Expand once and reuse: the cloud and the per-species subsets are the same for every pair
  const { cutoff, n_bins, cloud } = prepare_rdf(structure, options)
  const cell_cache: SubsetCache = new Map()
  const cloud_cache: SubsetCache = new Map()

  return elems.flatMap((el1, idx1) =>
    elems
      .slice(idx1)
      .map((el2) =>
        rdf_from_cloud(structure, cloud, cutoff, n_bins, el1, el2, cell_cache, cloud_cache),
      ),
  )
}
