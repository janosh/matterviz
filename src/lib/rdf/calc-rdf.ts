// Radial distribution function g(r) of a periodic structure: pair distances (periodic images
// included) binned over [0, cutoff) and normalised by the ideal-gas expectation
// N_a · N_b · 4π r² Δr / V, so g(r) → 1 for an uncorrelated system.
import { calc_lattice_params } from '$lib/math'
import type { AnyStructure, Crystal, Site } from '$lib/structure'
import { visit_neighbor_distances } from '$lib/structure/bonding'
import { has_usable_lattice, lattice_unavailable_reason } from '$lib/structure/validation'
import type { RdfOptions, RdfPattern } from './index'

// Occupancy of `element` on every site (all species when unnamed). RDFs weight each pair
// by the product of these, including vacancies in the full RDF.
const species_weights = (sites: Site[], element: string | undefined): Float64Array =>
  Float64Array.from(sites, (site) =>
    site.species.reduce(
      (sum, spec) => sum + (!element || spec.element === element ? spec.occu : 0),
      0,
    ),
  )

// Bound allocations: one radius grid and one n_bins-long histogram per element pair.
const MAX_RDF_BINS = 1_000_000

// Only the histogram grid is retained. Neighbours stream into it so wide cutoffs on large
// frames never allocate pair lists, displacement vectors or per-contact bin indices.
function prepare_rdf(structure: Crystal, options: RdfOptions) {
  const { cutoff = 15, n_bins = 75 } = options
  // finite too: Infinity passes `> 0` and resurfaces as a neighbor_query error naming no caller
  if (!(cutoff > 0) || !Number.isFinite(cutoff)) {
    throw new Error(`cutoff must be a positive finite number, got cutoff=${cutoff}`)
  }
  if (!Number.isInteger(n_bins) || n_bins <= 0 || n_bins > MAX_RDF_BINS) {
    throw new Error(
      `n_bins must be a positive integer <= ${MAX_RDF_BINS}, got n_bins=${n_bins}`,
    )
  }
  if (!has_usable_lattice(structure)) {
    throw new Error(`RDF calculation: ${lattice_unavailable_reason(structure, true)}`)
  }
  const { volume } = calc_lattice_params(structure.lattice.matrix)
  const bin_size = cutoff / n_bins
  // Exclude zero distances and the exact cutoff. Periodic self images remain included
  // (they are the whole signal of a 1-atom cell).
  // Crystal shells often sit exactly on a bin edge (rocksalt a/2 = 2.8 Å on 0.2 Å bins), and
  // the image positions carry ±1 ulp of noise, so without the nudge one shell splits across
  // two bins. 1e-9 is ~4 orders above that noise (≤ n_bins · eps) and 1e-9 bin widths below
  // any physical separation, so it only decides edge cases, and decides them as [lo, hi).
  const bin_of = (distance: number): number => {
    const bin = Math.floor(distance / bin_size + 1e-9)
    return distance > 0 && bin < n_bins ? bin : -1
  }
  return {
    cutoff,
    pbc: options.pbc,
    n_bins,
    bin_size,
    volume,
    bin_of,
    r: Array.from({ length: n_bins }, (_unused, idx) => (idx + 0.5) * bin_size),
  }
}

function normalize_histogram(
  { n_bins, bin_size, volume, r: radius }: ReturnType<typeof prepare_rdf>,
  g_r: number[],
  pair_weight: number,
  element_pair: [string, string] | undefined,
): RdfPattern {
  if (pair_weight > 0) {
    for (let idx = 0; idx < n_bins; idx++) {
      g_r[idx] /= (pair_weight * 4 * Math.PI * radius[idx] ** 2 * bin_size) / volume
    }
  }
  return { r: radius, g_r, element_pair }
}

// g(r) of one structure: the full RDF, or the partial g_ab(r) with center_species a and
// neighbor_species b (either may be omitted to leave that end unfiltered).
export function calculate_rdf(structure: Crystal, options: RdfOptions = {}): RdfPattern {
  const { center_species, neighbor_species } = options
  const prepared = prepare_rdf(structure, options)
  const center_weights = species_weights(structure.sites, center_species)
  const neighbor_weights = species_weights(structure.sites, neighbor_species)
  const g_r = Array<number>(prepared.n_bins).fill(0)
  visit_neighbor_distances(structure, prepared, (center, neighbor, distance) => {
    const center_weight = center_weights[center]
    if (center_weight === 0) return
    const bin = prepared.bin_of(distance)
    if (bin >= 0) g_r[bin] += center_weight * neighbor_weights[neighbor]
  })
  // The original cell's occupancy-weighted density includes self images. Only the
  // unshifted self and coincident sites were excluded when binning above.
  const pair_weight =
    center_weights.reduce((sum, occu) => sum + occu, 0) *
    neighbor_weights.reduce((sum, occu) => sum + occu, 0)
  return normalize_histogram(
    prepared,
    g_r,
    pair_weight,
    center_species && neighbor_species ? [center_species, neighbor_species] : undefined,
  )
}

export type FrameRdfOptions = Pick<RdfOptions, `cutoff` | `n_bins`>

// Partial g_ab(r) of every element pair in one MD frame: the trajectory RDF worker's compute.
// Same as calculate_all_pair_rdfs, but rejects a lattice-less frame with a message that says
// why (an ideal-gas normalisation needs a cell volume).
export const calc_frame_rdfs = (
  structure: AnyStructure,
  options: FrameRdfOptions = {},
): RdfPattern[] => {
  if (!has_usable_lattice(structure)) {
    throw new Error(`calc_frame_rdfs: ${lattice_unavailable_reason(structure, true)}`)
  }
  return calculate_all_pair_rdfs(structure, options)
}

// Partial g_ab(r) for every unordered element pair, elements sorted alphabetically. Mixed
// occupancy sites contribute to every element they carry. Each pattern shares one `r` array.
export function calculate_all_pair_rdfs(
  structure: Crystal,
  options: Omit<RdfOptions, `center_species` | `neighbor_species`> = {},
): RdfPattern[] {
  const prepared = prepare_rdf(structure, options)
  const element_set = new Set<string>()
  for (const { species } of structure.sites) {
    for (const { element } of species) element_set.add(element)
  }
  const elements = [...element_set].toSorted()
  const element_ids = new Map(elements.map((element, idx) => [element, idx]))
  const counts = new Float64Array(elements.length)
  const site_offsets = new Int32Array(structure.sites.length + 1)
  const species_ids: number[] = []
  const site_weights: number[] = []
  const occupied_weights = new Float64Array(elements.length)
  let ordered = true
  for (let site_idx = 0; site_idx < structure.sites.length; site_idx++) {
    occupied_weights.fill(0)
    // Aggregate repeated species before multiplying, as the single-pair kernel does.
    for (const { element, occu } of structure.sites[site_idx].species) {
      const element_idx = element_ids.get(element)
      if (element_idx !== undefined) occupied_weights[element_idx] += occu
    }
    for (let element_idx = 0; element_idx < elements.length; element_idx++) {
      const weight = occupied_weights[element_idx]
      counts[element_idx] += weight
      if (weight === 0) continue
      species_ids.push(element_idx)
      site_weights.push(weight)
    }
    site_offsets[site_idx + 1] = species_ids.length
    if (site_offsets[site_idx + 1] - site_offsets[site_idx] > 1) ordered = false
  }
  const histograms = elements.map((_element, idx_a) =>
    elements.map((_neighbor_element, idx_b) =>
      idx_a <= idx_b ? Array<number>(prepared.n_bins).fill(0) : [],
    ),
  )
  visit_neighbor_distances(
    structure,
    prepared,
    ordered
      ? (center, neighbor, distance) => {
          const center_slot = site_offsets[center]
          const neighbor_slot = site_offsets[neighbor]
          if (
            center_slot === site_offsets[center + 1] ||
            neighbor_slot === site_offsets[neighbor + 1]
          )
            return
          const center_species = species_ids[center_slot]
          const neighbor_species = species_ids[neighbor_slot]
          if (center_species > neighbor_species) return
          const bin = prepared.bin_of(distance)
          if (bin >= 0) {
            histograms[center_species][neighbor_species][bin] +=
              site_weights[center_slot] * site_weights[neighbor_slot]
          }
        }
      : (center, neighbor, distance) => {
          const bin = prepared.bin_of(distance)
          if (bin < 0) return
          for (
            let center_slot = site_offsets[center];
            center_slot < site_offsets[center + 1];
            center_slot++
          ) {
            const center_species = species_ids[center_slot]
            const row = histograms[center_species]
            const center_weight = site_weights[center_slot]
            for (
              let neighbor_slot = site_offsets[neighbor];
              neighbor_slot < site_offsets[neighbor + 1];
              neighbor_slot++
            ) {
              const neighbor_species = species_ids[neighbor_slot]
              if (center_species <= neighbor_species) {
                row[neighbor_species][bin] += center_weight * site_weights[neighbor_slot]
              }
            }
          }
        },
  )
  return elements.flatMap((el_a, idx_a) =>
    elements.slice(idx_a).map((el_b, offset) => {
      const idx_b = idx_a + offset
      return normalize_histogram(
        prepared,
        histograms[idx_a][idx_b],
        counts[idx_a] * counts[idx_b],
        [el_a, el_b],
      )
    }),
  )
}
