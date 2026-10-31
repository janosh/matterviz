// Radial distribution function g(r) of a periodic structure: pair distances (periodic images
// included) binned over [0, cutoff) and normalised by the ideal-gas expectation
// N_a · N_b · V_shell / V (exact shell volume), so g(r) → 1 for an uncorrelated system.
import { calc_lattice_params, is_valid_index, sorted_numbers } from '#lib/math.js'
import type { AnyStructure, Site } from '#lib/structure/index.js'
import { visit_neighbor_distances } from '#lib/structure/bonding.js'
import { has_usable_lattice, lattice_unavailable_reason } from '#lib/structure/validation.js'
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
// frames never allocate pair lists, displacement vectors or per-contact bin indices. Takes any
// structure (an MD frame off the worker payload too) and rejects one without a usable cell,
// since the ideal-gas normalisation needs its volume.
function prepare_rdf(structure: AnyStructure, options: RdfOptions) {
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

// Exact volume of the shell [r - Δ/2, r + Δ/2): 4π/3·((r + Δ/2)³ − (r − Δ/2)³). The midpoint
// rule 4π·r²·Δ undercounts it by Δ²/12, which inflates g(r) by 1/(12·(k + ½)²) in bin k, e.g.
// 33% in the first bin of an ideal gas.
export const shell_volume = (radius: number, bin_size: number): number =>
  4 * Math.PI * bin_size * (radius ** 2 + bin_size ** 2 / 12)

function normalize_histogram(
  { n_bins, bin_size, volume, r: radius }: ReturnType<typeof prepare_rdf>,
  g_r: number[],
  pair_weight: number,
  element_pair: [string, string] | undefined,
): RdfPattern {
  if (pair_weight > 0) {
    for (let idx = 0; idx < n_bins; idx++) {
      g_r[idx] /= (pair_weight * shell_volume(radius[idx], bin_size)) / volume
    }
  }
  return { r: radius, g_r, element_pair }
}

// g(r) of one structure: the full RDF, or the partial g_ab(r) with center_species a and
// neighbor_species b (either may be omitted to leave that end unfiltered).
export function calculate_rdf(structure: AnyStructure, options: RdfOptions = {}): RdfPattern {
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

// Atoms behind one RDF bin (centres and their partners, images mapped to base sites, sorted)
// for highlighting a hovered bin. The kernels keep only the histogram, so this re-runs the
// neighbour search for the one bin with the histogram's own bin_of and weights, so it finds
// exactly the pairs counted there. `n_pairs` counts contacts, not weighted by occupancy.
export function rdf_bin_sites(
  structure: AnyStructure,
  options: Omit<RdfOptions, `center_species` | `neighbor_species`> & {
    bin_idx: number
    element_pair?: readonly [string, string]
  },
): { site_indices: number[]; neighbor_indices: number[]; n_pairs: number } {
  const { bin_idx, element_pair } = options
  const prepared = prepare_rdf(structure, options)
  if (!is_valid_index(bin_idx, prepared.n_bins)) {
    throw new Error(`bin_idx must be an integer in [0, ${prepared.n_bins}), got ${bin_idx}`)
  }
  const center_weights = species_weights(structure.sites, element_pair?.[0])
  const neighbor_weights = species_weights(structure.sites, element_pair?.[1])
  const centers = new Set<number>()
  const neighbors = new Set<number>()
  let n_pairs = 0
  // bin_of floors, so the search never needs to reach past the bin's upper edge
  const cutoff = Math.min(prepared.cutoff, (bin_idx + 1) * prepared.bin_size)
  visit_neighbor_distances(structure, { ...prepared, cutoff }, (center, neighbor, dist) => {
    if (!center_weights[center] || !neighbor_weights[neighbor]) return
    if (prepared.bin_of(dist) !== bin_idx) return
    n_pairs++
    centers.add(center)
    neighbors.add(neighbor)
  })
  return {
    site_indices: sorted_numbers(centers),
    neighbor_indices: sorted_numbers(neighbors),
    n_pairs,
  }
}

// Past this the bitsets would outweigh the search they save (10k sites on 100k bins: 250 MB),
// so each bin is answered by its own search instead
const MAX_RDF_BIN_INDEX_BYTES = 32 * 1024 ** 2

// rdf_bin_sites for every bin from one full-cutoff neighbour search, for hovering bin after
// bin: each bin's centres and partners are kept as bitsets (n_bins · n_sites / 4 bytes, 38 KB
// for 2048 sites on 75 bins) with its contact count, and a bin reads back in O(n_sites / 32).
export function rdf_bin_site_index(
  structure: AnyStructure,
  options: Omit<RdfOptions, `center_species` | `neighbor_species`> & {
    element_pair?: readonly [string, string]
  },
): (bin_idx: number) => ReturnType<typeof rdf_bin_sites> {
  const { element_pair } = options
  const prepared = prepare_rdf(structure, options)
  const { n_bins } = prepared
  const n_words = Math.ceil(structure.sites.length / 32)
  if (2 * Int32Array.BYTES_PER_ELEMENT * n_bins * n_words > MAX_RDF_BIN_INDEX_BYTES)
    return (bin_idx) => rdf_bin_sites(structure, { ...options, bin_idx })
  const [centers, neighbors] = [0, 1].map(() => new Int32Array(n_bins * n_words))
  const n_pairs = new Float64Array(n_bins)
  const center_weights = species_weights(structure.sites, element_pair?.[0])
  const neighbor_weights = species_weights(structure.sites, element_pair?.[1])
  visit_neighbor_distances(structure, prepared, (center, neighbor, dist) => {
    if (!center_weights[center] || !neighbor_weights[neighbor]) return
    const bin = prepared.bin_of(dist)
    if (bin < 0) return
    n_pairs[bin]++
    centers[bin * n_words + (center >>> 5)] |= 1 << (center & 31)
    neighbors[bin * n_words + (neighbor >>> 5)] |= 1 << (neighbor & 31)
  })
  // set bits of one bin's words in ascending site order
  const sites_of = (bits: Int32Array, bin_idx: number): number[] => {
    const sites: number[] = []
    for (let word_idx = 0; word_idx < n_words; word_idx++) {
      let word = bits[bin_idx * n_words + word_idx]
      while (word !== 0) {
        const low_bit = word & -word
        sites.push(word_idx * 32 + 31 - Math.clz32(low_bit))
        word ^= low_bit
      }
    }
    return sites
  }
  return (bin_idx) => {
    if (!is_valid_index(bin_idx, n_bins)) {
      throw new Error(`bin_idx must be an integer in [0, ${n_bins}), got ${bin_idx}`)
    }
    return {
      site_indices: sites_of(centers, bin_idx),
      neighbor_indices: sites_of(neighbors, bin_idx),
      n_pairs: n_pairs[bin_idx],
    }
  }
}

// What the trajectory RDF worker computes per MD frame (calculate_all_pair_rdfs)
export type FrameRdfOptions = Pick<RdfOptions, `cutoff` | `n_bins`>

// Partial g_ab(r) for every unordered element pair, elements sorted alphabetically. Mixed
// occupancy sites contribute to every element they carry. Each pattern shares one `r` array.
export function calculate_all_pair_rdfs(
  structure: AnyStructure,
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
