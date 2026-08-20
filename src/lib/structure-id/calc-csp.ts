// Centrosymmetry parameter (CSP), Kelchner, Plimpton & Hamilton, Phys. Rev. B 58, 11085 (1998):
//
//   CSP = sum over the N/2 pairs of opposite neighbors of |r_i + r_j|²
//
// where r_i are vectors from the central atom to its N nearest neighbors. A perfectly
// centrosymmetric site pairs every bond with its exact opposite, so every term vanishes; a
// vacancy, surface or dislocation core leaves bonds unpaired and CSP rises. N is a property of
// the lattice: 12 for fcc, 8 for bcc. Units are Å², so CSP scales with the square of the lattice
// parameter — compare values only within one material.
//
// The pairing is the one LAMMPS `compute centro/atom` and OVITO's CentroSymmetryModifier use,
// and the one Stukowski 2012 §2.3 documents: form all N(N-1)/2 values |r_i + r_j|² and add up
// the N/2 smallest. It does NOT force each neighbor into exactly one pair, so a strongly
// non-centrosymmetric site can reuse one neighbor in several of the summed terms. That is a
// known quirk of the reference implementations, reproduced here so the numbers are comparable.
import type { NeighborList } from '$lib/structure/bonding'

// Reused across atoms; N is capped so the pair buffer can be allocated once
const MAX_CSP_NEIGHBORS = 32
const pair_sums = new Float64Array((MAX_CSP_NEIGHBORS * (MAX_CSP_NEIGHBORS - 1)) / 2)

// |r_i + r_j|² for every pair among the first `n_neighbors` neighbors, into the scratch buffer.
// Returns the pair count.
function fill_pair_sums(deltas: Float64Array, base: number, n_neighbors: number): number {
  let n_pairs = 0
  for (let left = 0; left < n_neighbors; left++) {
    const off_left = base + left * 3
    for (let right = left + 1; right < n_neighbors; right++) {
      const off_right = base + right * 3
      const sum_x = deltas[off_left] + deltas[off_right]
      const sum_y = deltas[off_left + 1] + deltas[off_right + 1]
      const sum_z = deltas[off_left + 2] + deltas[off_right + 2]
      pair_sums[n_pairs++] = sum_x * sum_x + sum_y * sum_y + sum_z * sum_z
    }
  }
  return n_pairs
}

// Sum of the `n_terms` smallest entries of `pair_sums[0..n_pairs)`, which is the CSP of one atom.
// Sorting the indices would need an allocation per atom; a partial selection sort over n_terms
// (6 for fcc) passes is cheaper than sorting all 66 pairs.
function sum_smallest_pairs(n_pairs: number, n_terms: number): number {
  let total = 0
  for (let term = 0; term < n_terms; term++) {
    let best_idx = term
    for (let idx = term + 1; idx < n_pairs; idx++) {
      if (pair_sums[idx] < pair_sums[best_idx]) best_idx = idx
    }
    const best = pair_sums[best_idx]
    pair_sums[best_idx] = pair_sums[term]
    pair_sums[term] = best
    total += best
  }
  return total
}

// Fail fast on invalid N so callers (calc_structure_id) can reject before an expensive
// neighbor search sized to a k that can never be satisfied.
export function validate_csp_neighbors(n_csp_neighbors: number): void {
  if (!Number.isInteger(n_csp_neighbors) || n_csp_neighbors < 2) {
    throw new Error(
      `validate_csp_neighbors: n_csp_neighbors must be an integer >= 2, got ${n_csp_neighbors}`,
    )
  }
  if (n_csp_neighbors % 2 !== 0) {
    throw new Error(
      `validate_csp_neighbors: n_csp_neighbors must be even so every bond can be paired with ` +
        `an opposite, got ${n_csp_neighbors}`,
    )
  }
  if (n_csp_neighbors > MAX_CSP_NEIGHBORS) {
    throw new Error(
      `validate_csp_neighbors: n_csp_neighbors ${n_csp_neighbors} exceeds the ` +
        `${MAX_CSP_NEIGHBORS} built-in limit`,
    )
  }
}

// Per-atom centrosymmetry in Å². Atoms with fewer than `n_csp_neighbors` neighbors in `list`
// (cluster surfaces, isolated fragments) get NaN rather than a value computed from a different
// neighbor count, which would not be comparable to the rest of the array.
export function calc_centrosymmetry(
  list: NeighborList,
  n_csp_neighbors: number,
): Float64Array {
  validate_csp_neighbors(n_csp_neighbors)

  const csp = new Float64Array(list.n_centers)
  for (let center_idx = 0; center_idx < list.n_centers; center_idx++) {
    if (list.offsets[center_idx + 1] - list.offsets[center_idx] < n_csp_neighbors) {
      csp[center_idx] = NaN
      continue
    }
    const base = list.offsets[center_idx] * 3
    const n_pairs = fill_pair_sums(list.deltas, base, n_csp_neighbors)
    csp[center_idx] = sum_smallest_pairs(n_pairs, n_csp_neighbors >> 1)
  }
  return csp
}
