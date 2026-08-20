// Common Neighbor Analysis (CNA): per-atom classification into FCC / HCP / BCC / ICO / Other.
//
// Every bonded neighbor of the central atom yields a triplet (n_common, n_bonds, n_longest_chain):
//   n_common        atoms that are neighbors of BOTH the central atom and that neighbor
//   n_bonds         bonds among those common neighbors
//   n_longest_chain bonds in the largest connected component of that bond graph
// Counting the triplets over all neighbors gives the signature (Honeycutt & Andersen,
// J. Phys. Chem. 91, 4950 (1987); table reproduced as Table 1 of Stukowski, Modelling Simul.
// Mater. Sci. Eng. 20, 045021 (2012)):
//   fcc (N=12)  12 x (4,2,1)
//   hcp (N=12)   6 x (4,2,1) + 6 x (4,2,2)
//   bcc (N=14)   8 x (6,6,6) + 6 x (4,4,4)   <- needs BOTH the 8 nearest and 6 next-nearest
//   ico (N=12)  12 x (5,5,5)
// Anything else is Other. Cubic diamond (12 x (5,4,3) + 4 x (6,6,3)) is deliberately not
// identified here: it needs the second-neighbor trick OVITO's IdentifyDiamond modifier applies.
//
// The `n_longest_chain` index is the number of bonds in the LARGEST CONNECTED COMPONENT of the
// common-neighbor bond graph, not the longest simple path. That is what makes a 6-bond ring
// score 6 and two disjoint bonds score 1, and it matches OVITO's calcMaxChainLength().
import type { NeighborList } from '$lib/structure/bonding'

// `adaptive` derives a per-atom cutoff from that atom's own neighbor distances (Stukowski 2012)
// and needs no lattice constant. `fixed` uses one global cutoff for the whole structure and
// requires `cutoff` to be set to 0.854 * a_fcc or 1.207 * a_bcc for the phase under study.
export type CnaMode = `adaptive` | `fixed`

// Numeric CNA codes. These are the values written to `site.properties.cna_type`, chosen over
// strings so an atom color mode keyed on numeric site properties renders them with no mapping
// step. Order matches OVITO's StructureType enum, so a code read from either tool means the same.
export const CNA_TYPES = { other: 0, fcc: 1, hcp: 2, bcc: 3, ico: 4 } as const
export type CnaTypeName = keyof typeof CNA_TYPES
export type CnaTypeCode = (typeof CNA_TYPES)[CnaTypeName]

export const CNA_TYPE_NAMES = Object.keys(CNA_TYPES) as CnaTypeName[]

export const CNA_TYPE_LABELS: Record<CnaTypeName, string> = {
  other: `Other`,
  fcc: `FCC`,
  hcp: `HCP`,
  bcc: `BCC`,
  ico: `Icosahedral`,
}

// OVITO's default structure-type colors, so a MatterViz plot and an OVITO screenshot of the
// same trajectory read the same way
export const CNA_TYPE_COLORS: Record<CnaTypeName, string> = {
  other: `#bfbfbf`,
  fcc: `#40c840`,
  hcp: `#f04040`,
  bcc: `#4040f0`,
  ico: `#f5c73a`,
}

// Halfway between the 1st and 2nd fcc shells, and between the 2nd and 3rd bcc shells:
// (1 + sqrt(2)) / 2. OVITO hard-codes the truncated literal 1.207 in its bcc branch; the exact
// value differs by 8.8e-5 relative, far below the ~40% gap between the shells being separated.
const SHELL_MIDPOINT = (1 + Math.SQRT2) / 2
// First-shell bcc neighbors sit at sqrt(3)/2 * a, so 2/sqrt(3) rescales them onto the same
// length scale as the second shell before the two are averaged (Stukowski 2012, eq. 7).
const BCC_FIRST_SHELL_SCALE = 2 / Math.sqrt(3)

const N_CLOSE_PACKED = 12 // fcc / hcp / ico coordination
const N_BCC = 14 // bcc 1st (8) + 2nd (6) shell

const popcount = (mask: number): number => {
  let count = 0
  for (let bits = mask; bits !== 0; bits &= bits - 1) count++
  return count
}

// Scratch buffers reused across every atom: analyze_signature runs once per site and per
// candidate structure, so per-call allocation would dominate the run time on large supercells.
const bond_masks = new Uint16Array(N_BCC)
// At most N_BCC * (N_BCC - 1) / 2 = 91 bonds can exist among common neighbors
const common_bonds = new Uint16Array((N_BCC * (N_BCC - 1)) / 2)

// Bond graph among the `n_neighbors` nearest neighbors: bit `nj` of bond_masks[ni] is set when
// neighbors ni and nj are within `cutoff` of each other. Neighbor deltas are read from
// `deltas` starting at `base` (3 numbers per neighbor).
function fill_bond_masks(
  deltas: Float64Array,
  base: number,
  n_neighbors: number,
  cutoff: number,
): void {
  const cutoff_sq = cutoff * cutoff
  bond_masks.fill(0, 0, n_neighbors)
  for (let ni = 0; ni < n_neighbors; ni++) {
    const off_i = base + ni * 3
    for (let nj = ni + 1; nj < n_neighbors; nj++) {
      const off_j = base + nj * 3
      const diff_x = deltas[off_i] - deltas[off_j]
      const diff_y = deltas[off_i + 1] - deltas[off_j + 1]
      const diff_z = deltas[off_i + 2] - deltas[off_j + 2]
      if (diff_x * diff_x + diff_y * diff_y + diff_z * diff_z > cutoff_sq) continue
      bond_masks[ni] |= 1 << nj
      bond_masks[nj] |= 1 << ni
    }
  }
}

// Bonds among the neighbors flagged in `common`, written into the shared `common_bonds` scratch
// as two-bit masks. Returns the bond count.
function collect_common_bonds(common: number, n_neighbors: number): number {
  let n_bonds = 0
  for (let ni = 0; ni < n_neighbors; ni++) {
    const ni_bit = 1 << ni
    if ((common & ni_bit) === 0) continue
    // Only partners with a lower index, so each bond is emitted exactly once
    const partners = common & bond_masks[ni] & (ni_bit - 1)
    for (let bits = partners; bits !== 0; bits &= bits - 1) {
      common_bonds[n_bonds++] = ni_bit | (bits & -bits)
    }
  }
  return n_bonds
}

// Bonds in the largest connected component of the graph held in `common_bonds[0..n_bonds)`.
// Consumes the scratch buffer (entries are swapped out as they are absorbed into a component).
function max_bond_cluster_size(n_bonds: number): number {
  let remaining = n_bonds
  let max_size = 0
  while (remaining > 0) {
    remaining--
    let atoms_to_process = common_bonds[remaining]
    let atoms_processed = 0
    let cluster_size = 1
    while (atoms_to_process !== 0) {
      const next_atom = atoms_to_process & -atoms_to_process
      atoms_processed |= next_atom
      atoms_to_process &= ~next_atom
      // Absorb every remaining bond touching this atom. Scanning downwards lets an absorbed
      // slot be back-filled from the tail without re-visiting an entry.
      for (let idx = remaining - 1; idx >= 0; idx--) {
        if ((common_bonds[idx] & next_atom) === 0) continue
        cluster_size++
        atoms_to_process |= common_bonds[idx] & ~atoms_processed
        remaining--
        common_bonds[idx] = common_bonds[remaining]
      }
    }
    if (cluster_size > max_size) max_size = cluster_size
  }
  return max_size
}

// fcc / hcp / ico test over 12 neighbors whose bond graph is already in `bond_masks`
function analyze_close_packed_signature(): CnaTypeCode {
  let n421 = 0
  let n422 = 0
  let n555 = 0
  for (let ni = 0; ni < N_CLOSE_PACKED; ni++) {
    const common = bond_masks[ni]
    const n_common = popcount(common)
    if (n_common !== 4 && n_common !== 5) return CNA_TYPES.other
    const n_bonds = collect_common_bonds(common, N_CLOSE_PACKED)
    if (n_bonds !== 2 && n_bonds !== 5) return CNA_TYPES.other
    const chain = max_bond_cluster_size(n_bonds)
    if (n_common === 4 && n_bonds === 2) {
      if (chain === 1) n421++
      else if (chain === 2) n422++
      else return CNA_TYPES.other
    } else if (n_common === 5 && n_bonds === 5 && chain === 5) n555++
    else return CNA_TYPES.other
  }
  if (n421 === 12) return CNA_TYPES.fcc
  if (n421 === 6 && n422 === 6) return CNA_TYPES.hcp
  if (n555 === 12) return CNA_TYPES.ico
  return CNA_TYPES.other
}

// bcc test over 14 neighbors whose bond graph is already in `bond_masks`
function analyze_bcc_signature(): CnaTypeCode {
  let n444 = 0
  let n666 = 0
  for (let ni = 0; ni < N_BCC; ni++) {
    const common = bond_masks[ni]
    const n_common = popcount(common)
    if (n_common !== 4 && n_common !== 6) return CNA_TYPES.other
    const n_bonds = collect_common_bonds(common, N_BCC)
    if (n_bonds !== 4 && n_bonds !== 6) return CNA_TYPES.other
    const chain = max_bond_cluster_size(n_bonds)
    if (n_common === 4 && n_bonds === 4 && chain === 4) n444++
    else if (n_common === 6 && n_bonds === 6 && chain === 6) n666++
    else return CNA_TYPES.other
  }
  return n666 === 8 && n444 === 6 ? CNA_TYPES.bcc : CNA_TYPES.other
}

// Conventional fixed-cutoff CNA. The atom must have exactly 12 or exactly 14 neighbors inside
// the list's cutoff — an atom whose count lands anywhere else is Other by construction, which is
// why the cutoff has to be picked for the phase under study (0.854 * a_fcc, 1.207 * a_bcc).
function classify_fixed(list: NeighborList, center_idx: number): CnaTypeCode {
  const n_neighbors = list.offsets[center_idx + 1] - list.offsets[center_idx]
  if (n_neighbors !== N_CLOSE_PACKED && n_neighbors !== N_BCC) return CNA_TYPES.other
  const base = list.offsets[center_idx] * 3
  fill_bond_masks(list.deltas, base, n_neighbors, list.cutoff)
  return n_neighbors === N_CLOSE_PACKED
    ? analyze_close_packed_signature()
    : analyze_bcc_signature()
}

// Adaptive CNA (Stukowski 2012, eqs. 6 and 7): the cutoff is derived per atom from its own
// neighbor distances, so no lattice constant is needed and elastic strain does not shift the
// classification. Each candidate structure gets its own local cutoff and is tested in turn.
function classify_adaptive(list: NeighborList, center_idx: number): CnaTypeCode {
  const n_neighbors = list.offsets[center_idx + 1] - list.offsets[center_idx]
  const base = list.offsets[center_idx] * 3
  const dist_base = list.offsets[center_idx]
  const { distances, deltas } = list

  if (n_neighbors >= N_CLOSE_PACKED) {
    let scaling = 0
    for (let idx = 0; idx < N_CLOSE_PACKED; idx++) scaling += distances[dist_base + idx]
    const local_cutoff = (scaling / N_CLOSE_PACKED) * SHELL_MIDPOINT
    fill_bond_masks(deltas, base, N_CLOSE_PACKED, local_cutoff)
    const cna_type = analyze_close_packed_signature()
    if (cna_type !== CNA_TYPES.other) return cna_type
  }
  if (n_neighbors >= N_BCC) {
    let scaling = 0
    for (let idx = 0; idx < 8; idx++) {
      scaling += distances[dist_base + idx] * BCC_FIRST_SHELL_SCALE
    }
    for (let idx = 8; idx < N_BCC; idx++) scaling += distances[dist_base + idx]
    const local_cutoff = (scaling / N_BCC) * SHELL_MIDPOINT
    fill_bond_masks(deltas, base, N_BCC, local_cutoff)
    return analyze_bcc_signature()
  }
  return CNA_TYPES.other
}

// Per-atom CNA type codes. In `fixed` mode the bond cutoff is the radius `list` was built at:
// the 12-or-14 neighbor count that drives that branch is read off `list`, so counting neighbors
// at one cutoff and bonding them at another would classify against a structure nobody asked for.
export function calc_cna(list: NeighborList, mode: CnaMode): Int8Array {
  const classify = mode === `fixed` ? classify_fixed : classify_adaptive
  const types = new Int8Array(list.n_centers)
  for (let center_idx = 0; center_idx < list.n_centers; center_idx++) {
    types[center_idx] = classify(list, center_idx)
  }
  return types
}
