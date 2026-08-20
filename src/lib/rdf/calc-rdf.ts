// Radial distribution function g(r) of a periodic structure: pair distances (periodic images
// included) binned over [0, cutoff) and normalised by the ideal-gas expectation
// N_a · N_b · 4π r² Δr / V, so g(r) → 1 for an uncorrelated system.
import { calc_lattice_params } from '$lib/math'
import type { Crystal, Site } from '$lib/structure'
import { neighbor_query } from '$lib/structure/bonding'
import type { RdfOptions, RdfPattern } from './index'

// Occupancy of `element` on every site (0 where absent); every site with weight 1 when no
// element is named. Partial RDFs weight each pair by the product of these.
const species_weights = (sites: Site[], element: string | undefined): Float64Array =>
  Float64Array.from(sites, (site) =>
    element ? (site.species.find((spec) => spec.element === element)?.occu ?? 0) : 1,
  )

// The neighbour list and bin assignment depend only on geometry and binning, never on the
// species pair, so all-pair callers build them once and histogram many times.
function prepare_rdf(structure: Crystal, options: RdfOptions) {
  const { cutoff = 15, n_bins = 75 } = options
  if (!(cutoff > 0) || !(n_bins > 0)) {
    throw new Error(
      `cutoff and n_bins must be positive, got cutoff=${cutoff} n_bins=${n_bins}`,
    )
  }
  if (!structure.lattice?.matrix) {
    throw new Error(`Crystal must have a lattice for RDF calculation`)
  }
  const { volume } = calc_lattice_params(structure.lattice.matrix)
  const list = neighbor_query(structure, { cutoff, pbc: options.pbc })
  const bin_size = cutoff / n_bins
  // Bin per neighbour slot, or -1 for the slots g(r) never counts: the true self term and
  // coincident duplicate sites (distance 0), and distances at exactly the cutoff, which the
  // half-open range [0, cutoff) excludes. Periodic images of the center itself are real
  // neighbours and stay in (they are the whole signal of a 1-atom cell).
  // Crystal shells often sit exactly on a bin edge (rocksalt a/2 = 2.8 Å on 0.2 Å bins), and
  // the image positions carry ±1 ulp of noise, so without the nudge one shell splits across
  // two bins. 1e-9 is ~4 orders above that noise (≤ n_bins · eps) and 1e-9 bin widths below
  // any physical separation, so it only decides edge cases, and decides them as [lo, hi).
  const { distances } = list
  const bins = new Int32Array(distances.length)
  for (let slot = 0; slot < distances.length; slot++) {
    const dist = distances[slot]
    const bin = Math.floor(dist / bin_size + 1e-9)
    bins[slot] = dist > 0 && bin < n_bins ? bin : -1
  }
  return {
    n_bins,
    bin_size,
    volume,
    list,
    bins,
    r: Array.from({ length: n_bins }, (_unused, idx) => (idx + 0.5) * bin_size),
  }
}

type PreparedRdf = ReturnType<typeof prepare_rdf>

function histogram_pairs(
  { n_bins, bin_size, volume, list, bins, r }: PreparedRdf,
  center_weights: Float64Array,
  neighbor_weights: Float64Array,
  element_pair: [string, string] | undefined,
): RdfPattern {
  const g_r = Array<number>(n_bins).fill(0)
  const { offsets, neighbors } = list
  for (let center = 0; center < list.n_centers; center++) {
    const center_weight = center_weights[center]
    if (center_weight === 0) continue
    for (let slot = offsets[center]; slot < offsets[center + 1]; slot++) {
      const bin = bins[slot]
      if (bin >= 0) g_r[bin] += center_weight * neighbor_weights[neighbors[slot]]
    }
  }
  // Ideal-gas normalisation with the original cell's density and occupancy-weighted counts.
  // Self-pairs are not subtracted: the unshifted self was never counted, and a site's own
  // periodic images are valid neighbours.
  const pair_weight =
    center_weights.reduce((sum, occu) => sum + occu, 0) *
    neighbor_weights.reduce((sum, occu) => sum + occu, 0)
  if (pair_weight > 0) {
    for (let idx = 0; idx < n_bins; idx++) {
      g_r[idx] /= (pair_weight * 4 * Math.PI * r[idx] ** 2 * bin_size) / volume
    }
  }
  return { r, g_r, ...(element_pair ? { element_pair } : {}) }
}

// g(r) of one structure: the full RDF, or the partial g_ab(r) with center_species a and
// neighbor_species b (either may be omitted to leave that end unfiltered).
export function calculate_rdf(structure: Crystal, options: RdfOptions = {}): RdfPattern {
  const { center_species, neighbor_species } = options
  return histogram_pairs(
    prepare_rdf(structure, options),
    species_weights(structure.sites, center_species),
    species_weights(structure.sites, neighbor_species),
    center_species && neighbor_species ? [center_species, neighbor_species] : undefined,
  )
}

// Partial g_ab(r) for every unordered element pair, elements sorted alphabetically. Mixed
// occupancy sites contribute to every element they carry. Each pattern shares one `r` array.
export function calculate_all_pair_rdfs(
  structure: Crystal,
  options: Omit<RdfOptions, `center_species` | `neighbor_species`> = {},
): RdfPattern[] {
  const prepared = prepare_rdf(structure, options)
  const elements = [
    ...new Set(structure.sites.flatMap((site) => site.species.map((spec) => spec.element))),
  ].toSorted()
  const weights = elements.map((element) => species_weights(structure.sites, element))
  return elements.flatMap((el_a, idx_a) =>
    elements
      .slice(idx_a)
      .map((el_b, offset) =>
        histogram_pairs(prepared, weights[idx_a], weights[idx_a + offset], [el_a, el_b]),
      ),
  )
}
