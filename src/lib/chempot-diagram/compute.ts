// Core computational logic for chemical potential diagrams.
// Ports pymatgen's ChemicalPotentialDiagram algorithm to TypeScript.
// Reference: pymatgen/analysis/chempot_diagram.py

import { count_atoms_in_composition, get_reduced_formula } from '$lib/composition/reduce'
import {
  compute_e_form_per_atom,
  compute_quickhull_nd,
  get_energy_per_atom,
} from '$lib/convex-hull/thermodynamics'
import type { PhaseData } from '$lib/convex-hull/types'
import {
  array_extent,
  array_max,
  array_min,
  combinations,
  compute_in_plane_basis,
  convex_hull_2d,
  cross_3d,
  dot,
  EPS,
  euclidean_dist,
  merge_coplanar_triangles,
  normalize_vec,
  point_in_polygon,
  polygon_centroid,
  subtract,
} from '$lib/math'
import type { Vec2, Vec3 } from '$lib/math'
import { CHEMPOT_DEFAULTS, type ChemPotDiagramConfig, type ChemPotDiagramData } from './types'

// === Entry Helpers ===

// Energy per atom (MP `correction` applied, see convex-hull/thermodynamics) or NaN when the
// entry has no atoms or a non-finite energy, so callers can skip it without throwing.
export function safe_energy_per_atom(entry: PhaseData): number {
  if (count_atoms_in_composition(entry.composition) <= 0) return Number.NaN
  const epa = get_energy_per_atom(entry)
  return Number.isFinite(epa) ? epa : Number.NaN
}

// Same-formula EPA total order: lower energy, then hull-eligible, then stable, then lower
// e_above_hull, then a deterministic fingerprint so ties never depend on input order.
function prefer_min_entry(
  candidate: PhaseData,
  candidate_epa: number,
  existing: PhaseData,
  existing_epa: number,
): boolean {
  if (candidate_epa !== existing_epa) return candidate_epa < existing_epa
  if (Boolean(candidate.exclude_from_hull) !== Boolean(existing.exclude_from_hull)) {
    return !candidate.exclude_from_hull
  }
  if ((candidate.is_stable === true) !== (existing.is_stable === true)) {
    return candidate.is_stable === true
  }
  const candidate_hull_dist = candidate.e_above_hull ?? Infinity
  const existing_hull_dist = existing.e_above_hull ?? Infinity
  if (candidate_hull_dist !== existing_hull_dist)
    return candidate_hull_dist < existing_hull_dist
  return entry_fingerprint(candidate) < entry_fingerprint(existing)
}

// Get a stable reduced formula string from composition dict
export function formula_key_from_composition(composition: Record<string, number>): string {
  const reduced = get_reduced_formula(composition)
  return Object.entries(reduced)
    .filter(([, amt]) => amt > 0)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([el, amt]) => (amt === 1 ? el : `${el}${amt}`))
    .join(``)
}

// Sorted elements present (positive amount) in any entry: the chemical system of a dataset
export function entry_elements(entries: PhaseData[]): string[] {
  const elements = new Set<string>()
  for (const entry of entries) {
    for (const [element, amount] of Object.entries(entry.composition)) {
      if (amount > 0) elements.add(element)
    }
  }
  return [...elements].toSorted()
}

// === Core Algorithm ===

// Group entries by reduced formula, keep only the minimum-energy entry per composition.
// Also extract elemental reference entries.
export function get_min_entries_and_el_refs(entries: PhaseData[]): {
  min_entries: PhaseData[]
  el_refs: Record<string, PhaseData>
} {
  const by_formula = new Map<string, { entry: PhaseData; epa: number }>()

  for (const entry of entries) {
    const key = formula_key_from_composition(entry.composition)
    const epa = safe_energy_per_atom(entry)
    if (!Number.isFinite(epa)) continue
    const existing = by_formula.get(key)
    if (!existing || prefer_min_entry(entry, epa, existing.entry, existing.epa)) {
      by_formula.set(key, { entry, epa })
    }
  }

  const min_entries = Array.from(by_formula.values(), ({ entry }) => entry)
  const el_refs: Record<string, PhaseData> = {}

  for (const entry of min_entries) {
    const positive = Object.entries(entry.composition).filter(([, amt]) => amt > 0)
    if (positive.length === 1) el_refs[positive[0][0]] = entry
  }

  return { min_entries, el_refs }
}

// Find minimum formation energy per atom across entries of one formula.
export function best_form_energy_for_formula(
  entries: PhaseData[],
  formula: string,
  el_refs: Record<string, PhaseData>,
): number | undefined {
  let best_value: number | undefined
  for (const entry of entries) {
    if (formula_key_from_composition(entry.composition) !== formula) continue
    // best-effort: a formula with no elemental reference is left uncolored, not fatal
    const e_form = entry.e_form_per_atom ?? compute_e_form_per_atom(entry, el_refs)
    if (e_form === null || !Number.isFinite(e_form)) continue
    if (best_value === undefined || e_form < best_value) best_value = e_form
  }
  return best_value
}

export interface FormulaEnergyStats {
  matching_entry_count: number
  min_energy_per_atom: number | null
  max_energy_per_atom: number | null
}

// Aggregate per-formula entry count and min/max energy per atom (used for
// region coloring and hover tooltips in the 2D/3D diagram components).
export function get_energy_stats_by_formula(
  entries: PhaseData[],
): Map<string, FormulaEnergyStats> {
  const stats = new Map<string, FormulaEnergyStats>()
  for (const entry of entries) {
    const energy_per_atom = safe_energy_per_atom(entry)
    if (!Number.isFinite(energy_per_atom)) continue
    const formula_key = formula_key_from_composition(entry.composition)
    const existing = stats.get(formula_key)
    if (existing) {
      existing.matching_entry_count += 1
      existing.min_energy_per_atom = Math.min(
        existing.min_energy_per_atom ?? energy_per_atom,
        energy_per_atom,
      )
      existing.max_energy_per_atom = Math.max(
        existing.max_energy_per_atom ?? energy_per_atom,
        energy_per_atom,
      )
    } else {
      stats.set(formula_key, {
        matching_entry_count: 1,
        min_energy_per_atom: energy_per_atom,
        max_energy_per_atom: energy_per_atom,
      })
    }
  }
  return stats
}

// Renormalize entry energies relative to elemental references (formal chemical potentials): the
// renormalized energy per atom is the formation energy per atom. Entries without one pass through.
export const renormalize_entries = (
  entries: PhaseData[],
  el_refs: Record<string, PhaseData>,
): PhaseData[] =>
  entries.map((entry) => {
    const e_form = compute_e_form_per_atom(entry, el_refs)
    if (e_form === null || !Number.isFinite(e_form)) return entry
    const atoms = count_atoms_in_composition(entry.composition)
    // e_form already includes the MP correction, so drop it or get_energy_per_atom re-applies
    return {
      ...entry,
      energy: e_form * atoms,
      energy_per_atom: e_form,
      correction: undefined,
    }
  })

// Build hyperplane representation for minimum entries.
// Each row is [x_1, ..., x_n, -E_per_atom].
// Filters to entries with negative formation energy plus all elemental refs.
// When every entry carries `is_stable`/`e_above_hull`, those flags replace pymatgen's
// `E_form < -tol` rule. PRECONDITION: the flags must belong to THIS chemsys — stale ones from
// a larger chemsys silently delete a locally stable phase's whole domain.
export function build_hyperplanes(
  min_entries: PhaseData[],
  el_refs: Record<string, PhaseData>,
  elements: string[],
): { hyperplanes: number[][]; hyperplane_entries: PhaseData[] } {
  const n_elems = elements.length
  const always_include = new Set<PhaseData>(Object.values(el_refs))
  const tol = 1e-6 // PhaseDiagram.formation_energy_tol
  const use_precomputed_hull = min_entries.every(
    (entry) => typeof entry.is_stable === `boolean` || typeof entry.e_above_hull === `number`,
  )
  const hyperplanes: number[][] = []
  const hyperplane_entries: PhaseData[] = []

  for (const entry of min_entries) {
    const atom_count = count_atoms_in_composition(entry.composition)
    const composition = entry.composition as Record<string, number>
    const energy_per_atom = safe_energy_per_atom(entry)
    if (!(atom_count > 0) || !Number.isFinite(energy_per_atom)) continue
    const row = Array(n_elems + 1).fill(0)
    for (let elem_idx = 0; elem_idx < n_elems; elem_idx++) {
      row[elem_idx] = (composition[elements[elem_idx]] ?? 0) / atom_count
    }
    const on_precomputed_hull =
      use_precomputed_hull &&
      !entry.exclude_from_hull &&
      (entry.is_stable === true ||
        (typeof entry.e_above_hull === `number` && entry.e_above_hull <= tol))
    let include_entry = on_precomputed_hull || always_include.has(entry)
    if (!include_entry && !use_precomputed_hull) {
      // build_chempot_hyperplanes validated the reference set, so null here is bad input
      const e_form = compute_e_form_per_atom(entry, el_refs)
      if (e_form === null) throw new Error(`No E_form for ${JSON.stringify(composition)}`)
      include_entry = e_form < -tol
    }
    if (include_entry) {
      row[n_elems] = -energy_per_atom
      hyperplanes.push(row)
      hyperplane_entries.push(entry)
    }
  }

  return { hyperplanes, hyperplane_entries }
}

// Build border hyperplanes from per-element limits.
// For each axis with limits [lo, hi], creates two halfspace rows.
export function build_border_hyperplanes(lims: Vec2[]): number[][] {
  const dim = lims.length
  const borders: number[][] = []
  for (let idx = 0; idx < dim; idx++) {
    // Lower bound: -mu_i + lo <= 0 → [-1, 0, ..., lo]
    const lower = Array(dim + 1).fill(0)
    lower[idx] = -1
    lower[dim] = lims[idx][0]
    borders.push(lower)

    // Upper bound: mu_i - hi <= 0 → [1, 0, ..., -hi]
    const upper = Array(dim + 1).fill(0)
    upper[idx] = 1
    upper[dim] = -lims[idx][1]
    borders.push(upper)
  }
  return borders
}

// Value of halfspace row [a_1..a_dim, b] at a point: a·mu + b (feasible when <= 0)
function halfspace_value(halfspace: number[], point: number[], dim: number): number {
  let val = halfspace[dim]
  for (let idx = 0; idx < dim; idx++) val += halfspace[idx] * point[idx]
  return val
}

// Pivot tolerance of the Chebyshev-centre simplex (coefficients are composition fractions and
// unit border normals, right-hand sides eV-scale chemical potentials)
const LP_TOL = 1e-10

// Chebyshev centre of the chemical potential region {mu : a_i·mu + b_i <= 0} (entry rows and
// the box borders from `lims`): the centre of the largest inscribed ball, i.e. the (mu, r)
// maximising r subject to a_i·mu + |a_i|·r + b_i <= 0 for every row. Every entry row has
// |a_i| = 1 only for pure elements, so unlike a diagonal-shift heuristic this is correct for
// arbitrary per-element limit widths. Solved exactly by a small dense simplex in
// y = mu - lo >= 0 (dim + 1 structural variables, one slack per row; Bland's rule so it cannot
// cycle). Entry normals are composition fractions (>= 0), so a_i·mu is smallest at the box's
// lower corner: lo is feasible whenever the region is non-empty, which makes the slack basis
// feasible from the start (no phase 1) and a negative slack at lo a proof that the region is
// empty (`radius` -Infinity). Exported for tests.
//
// Invariant (not re-checked here): every entry row has non-negative normals. The only
// producer is build_hyperplanes over entries that build_chempot_hyperplanes has already
// screened for positive composition amounts, so a negative fraction cannot reach this point.
export function chebyshev_centre(
  entry_hs: number[][],
  lims: Vec2[],
): { centre: number[]; radius: number } {
  const dim = lims.length
  const lo = lims.map(([low]) => low)
  const all_hs = [...entry_hs, ...build_border_hyperplanes(lims)]
  const n_rows = all_hs.length
  const r_col = dim // columns: y_0..y_{dim-1}, r, one slack per row, RHS
  const slack_col = dim + 1
  const rhs_col = slack_col + n_rows

  const tableau = all_hs.map((halfspace, row) => {
    const line: number[] = Array(rhs_col + 1).fill(0)
    let norm_sq = 0
    let rhs = -halfspace[dim]
    for (let idx = 0; idx < dim; idx++) {
      line[idx] = halfspace[idx]
      norm_sq += halfspace[idx] ** 2
      rhs -= halfspace[idx] * lo[idx]
    }
    line[r_col] = Math.sqrt(norm_sq)
    line[slack_col + row] = 1
    line[rhs_col] = rhs
    return line
  })
  if (tableau.some((line) => line[rhs_col] < -LP_TOL)) return { centre: [], radius: -Infinity }
  const basis = all_hs.map((_, row) => slack_col + row)
  // Reduced costs of the maximised objective r (entries are -c_j): a negative entry marks an
  // improving column
  const objective: number[] = Array(rhs_col + 1).fill(0)
  objective[r_col] = -1

  const pivot = (pivot_row: number, pivot_col: number) => {
    const row = tableau[pivot_row]
    const inv = 1 / row[pivot_col]
    for (let col = 0; col <= rhs_col; col++) row[col] *= inv
    for (const other of [...tableau, objective]) {
      if (other === row) continue
      const factor = other[pivot_col]
      if (factor === 0) continue
      for (let col = 0; col <= rhs_col; col++) other[col] -= factor * row[col]
    }
    basis[pivot_row] = pivot_col
  }

  // Bland's rule: lowest-index improving column enters, lowest-index basic variable among the
  // minimum-ratio rows leaves. The minimum is found first so the tie window is measured from
  // the true minimum, not from whichever candidate happened to be scanned earlier.
  while (true) {
    const enter = objective.findIndex((val, col) => col < rhs_col && val < -LP_TOL)
    if (enter === -1) break
    const ratios = tableau.map((line) =>
      line[enter] > LP_TOL ? line[rhs_col] / line[enter] : Infinity,
    )
    const min_ratio = array_min(ratios)
    // Unreachable in practice: r is bounded by the upper borders (each axis contributes a row
    // with +1 in the r column), so every improving column has a positive pivot candidate
    if (min_ratio === Infinity) break
    let leave = -1
    for (let row = 0; row < n_rows; row++) {
      if (ratios[row] - min_ratio > LP_TOL) continue
      if (leave === -1 || basis[row] < basis[leave]) leave = row
    }
    pivot(leave, enter)
  }

  const centre = [...lo]
  let radius = 0
  for (let row = 0; row < n_rows; row++) {
    const variable = basis[row]
    if (variable < dim) centre[variable] += tableau[row][rhs_col]
    else if (variable === r_col) radius = tableau[row][rhs_col]
  }
  return { centre, radius }
}

// Compute chemical potential domains as the vertices of the halfspace intersection
// {mu : a_i·mu + b_i <= 0}, replacing scipy's HalfspaceIntersection via the polar dual:
// translating the origin to an interior point makes every offset negative, so each
// halfspace becomes the dual point a_i / -(a_i·c + b_i) and every facet of the dual convex
// hull is a vertex of the primal region (normal / -offset, translated back). Vertices are
// then assigned to every entry whose hyperplane is active there, which also handles
// degenerate vertices where more than `dim` planes meet (e.g. an element hyperplane
// coinciding with the mu = 0 border in formal mode).
function compute_domains(
  hyperplanes: number[][],
  lims: Vec2[],
  hyperplane_entries: PhaseData[],
): Record<string, number[][]> {
  const dim = lims.length
  const n_entries = hyperplanes.length
  const all_hs = [...hyperplanes, ...build_border_hyperplanes(lims)]
  const tol = 1e-6

  const entry_formulas = hyperplane_entries.map((entry) =>
    formula_key_from_composition(entry.composition),
  )
  const domains: Record<string, number[][]> = {}
  for (const formula of entry_formulas) domains[formula] ??= []
  if (n_entries === 0) return domains

  // The Chebyshev centre is strictly interior unless the region has no interior (an entry with
  // formation energy below the lower limit, or inverted limits)
  const { centre, radius } = chebyshev_centre(hyperplanes, lims)
  if (!(radius > LP_TOL)) {
    throw new Error(
      `Chemical potential region is empty: largest inscribed radius ${radius} eV for limits ${JSON.stringify(lims)}`,
    )
  }
  const slacks = all_hs.map((halfspace) => -halfspace_value(halfspace, centre, dim))
  // Scale dual points so the nearest halfspace maps to unit distance (keeps quickhull's
  // absolute tolerance meaningful regardless of the eV scale of the limits)
  const scale = array_min(slacks)
  const dual_points = all_hs.map((halfspace, idx) =>
    halfspace.slice(0, dim).map((coeff) => (coeff * scale) / slacks[idx]),
  )

  const seen_vertices = new Set<string>()
  for (const facet of compute_quickhull_nd(dual_points)) {
    // The origin is interior to the dual hull, so every facet offset is negative
    if (!(facet.offset < -EPS)) continue
    const vertex = facet.normal.map((val, idx) => centre[idx] - (scale * val) / facet.offset)
    const key = vertex.map((val) => Math.round(val / tol)).join(`,`)
    if (seen_vertices.has(key)) continue
    seen_vertices.add(key)
    for (let hs_idx = 0; hs_idx < n_entries; hs_idx++) {
      if (Math.abs(halfspace_value(all_hs[hs_idx], vertex, dim)) <= tol) {
        domains[entry_formulas[hs_idx]].push(vertex)
      }
    }
  }

  return Object.fromEntries(Object.entries(domains).filter(([, domain]) => domain.length > 0))
}

// Apply element padding: replace coordinates close to default_min_limit with
// actual_min - padding for cleaner visual bounds. Single pass over all points.
export function apply_element_padding(
  domains: Record<string, number[][]>,
  elem_indices: number[],
  padding: number,
  default_min_limit: number,
): number[] {
  const replace_threshold = Math.max(Math.abs(padding), EPS)
  // Single-pass: track min per axis, skipping default_min_limit values
  const mins = elem_indices.map(() => Infinity)
  for (const pts of Object.values(domains)) {
    for (const pt of pts) {
      for (let idx = 0; idx < elem_indices.length; idx++) {
        const val = pt[elem_indices[idx]]
        if (Math.abs(val - default_min_limit) > replace_threshold && val < mins[idx]) {
          mins[idx] = val
        }
      }
    }
  }
  return mins.map(
    (min_val) => (Number.isFinite(min_val) ? min_val : default_min_limit) - padding,
  )
}

// Replace default_min_limit coordinates with padded limits for display
export function pad_domain_points(
  pts: number[][],
  elem_indices: number[],
  new_lims: number[],
  default_min_limit: number,
  padding: number,
): number[][] {
  const replace_threshold = Math.max(Math.abs(padding), EPS)
  return pts.map((pt) => {
    const padded = [...pt]
    for (let idx = 0; idx < elem_indices.length; idx++) {
      const col = elem_indices[idx]
      if (Math.abs(padded[col] - default_min_limit) < replace_threshold) {
        padded[col] = new_lims[idx]
      }
    }
    return padded
  })
}

// Build per-axis min/max ranges for a set of points
export function build_axis_ranges(
  points: number[][],
  elements: string[],
): { element: string; min_val: number; max_val: number }[] {
  return elements.map((element, axis_idx) => {
    const [min_val, max_val] = array_extent(points.map((point) => point[axis_idx]))
    return { element, min_val, max_val }
  })
}

// Which axis bounds a domain is clipped against, as human-readable labels. Tolerance is a
// fraction of each axis' own window, not an absolute eV: on a window a few meV wide an
// absolute tolerance reports every domain as clipped on every bound.
export function get_touches_limits(
  points: number[][],
  lims: Vec2[],
  elements: string[],
): string[] {
  const touches_limits: string[] = []
  for (let axis_idx = 0; axis_idx < Math.min(elements.length, lims.length); axis_idx++) {
    const [axis_min, axis_max] = lims[axis_idx]
    const tol = 1e-4 * (axis_max - axis_min) || EPS
    const axis_name = elements[axis_idx] ?? `axis_${axis_idx}`
    const touches = (bound: number) =>
      points.some((point) => Math.abs(point[axis_idx] - bound) < tol)
    if (touches(axis_min)) touches_limits.push(`${axis_name} lower bound`)
    if (touches(axis_max)) touches_limits.push(`${axis_name} upper bound`)
  }
  return touches_limits
}

// === Label Placement Helpers ===

// Simple PCA: center data, compute covariance, eigendecompose, project to top-k.
// Used in 3D for finding domain polygon orientation for label placement.
// Strip from `vec` (in place) its components along each vector of the orthonormal `basis`
const project_out = (vec: number[], basis: number[][]): void => {
  for (const basis_vec of basis) {
    const proj = dot(vec, basis_vec)
    for (let idx = 0; idx < vec.length; idx++) vec[idx] -= proj * basis_vec[idx]
  }
}

// Unit vector orthogonal to every vector in `basis`: the standard-basis direction with the
// largest residual after projecting the others out. Null when the basis already spans the space.
const orthogonal_unit_vec = (basis: number[][], n_cols: number): number[] | null => {
  let best: number[] | null = null
  let best_norm = EPS
  for (let axis = 0; axis < n_cols; axis++) {
    const candidate = Array(n_cols).fill(0).with(axis, 1)
    project_out(candidate, basis)
    const norm = Math.hypot(...candidate)
    if (norm > best_norm) [best_norm, best] = [norm, candidate.map((val) => val / norm)]
  }
  return best
}

export function simple_pca(
  data: number[][],
  k: number = 2,
): { scores: number[][]; eigenvectors: number[][]; means: number[] } {
  const n_rows = data.length
  const n_cols = data[0]?.length ?? 0
  if (n_rows === 0 || n_cols === 0) return { scores: [], eigenvectors: [], means: [] }

  // Center the data
  const means = Array(n_cols).fill(0)
  for (const row of data) {
    for (let col = 0; col < n_cols; col++) means[col] += row[col]
  }
  for (let col = 0; col < n_cols; col++) means[col] /= n_rows

  const centered = data.map((row) => row.map((val, col) => val - means[col]))

  // Covariance matrix
  const cov: number[][] = Array.from({ length: n_cols }, () => Array(n_cols).fill(0))
  for (const row of centered) {
    for (let idx = 0; idx < n_cols; idx++) {
      for (let jdx = idx; jdx < n_cols; jdx++) {
        cov[idx][jdx] += row[idx] * row[jdx]
      }
    }
  }
  for (let idx = 0; idx < n_cols; idx++) {
    cov[idx][idx] /= n_rows
    for (let jdx = idx + 1; jdx < n_cols; jdx++) {
      cov[idx][jdx] /= n_rows
      cov[jdx][idx] = cov[idx][jdx]
    }
  }

  // Power iteration for top-k eigenvectors (sufficient for k=2 on small matrices). Rank
  // thresholds are relative to the total variance: covariance entries are lengths squared, so an
  // absolute epsilon calls a good axis rank-deficient once coordinates shrink (a domain 1e-6
  // wide has a second eigenvalue near 1e-13).
  const eigenvectors: number[][] = []
  const work_cov = cov.map((row) => [...row])
  const mat_vec = (vec: number[]): number[] => dot(work_cov, vec)
  const cov_scale = cov.reduce((sum, row, idx) => sum + row[idx], 0) // trace = total variance
  const rank_eps = EPS * (cov_scale || 1)

  for (let comp = 0; comp < k; comp++) {
    // Initial guess: the (deflated) covariance row with the largest norm. A fixed basis
    // vector can sit in the null space (elemental domains have zero variance along their
    // own axis), where power iteration stalls on the first step and returns a spurious
    // zero-eigenvalue direction ahead of the real principal axes.
    const row_norms = work_cov.map((row) => Math.hypot(...row))
    const seed_idx = row_norms.indexOf(array_max(row_norms))
    let vec: number[] =
      row_norms[seed_idx] > rank_eps
        ? work_cov[seed_idx].map((val) => val / row_norms[seed_idx])
        : Array(n_cols).fill(0).with(seed_idx, 1)

    for (let iter = 0; iter < 100; iter++) {
      const new_vec = mat_vec(vec)
      // Re-orthogonalize against components already found: with close eigenvalues (near-square
      // domains) 100 iterations don't converge, deflation is inexact and the next component
      // drifts out of orthogonality (v1·v2 up to 1e-3), breaking the is_planar check.
      project_out(new_vec, eigenvectors)

      // Normalize
      const norm = Math.hypot(...new_vec)
      if (norm < rank_eps) {
        // Rank-deficient input (collinear/coincident points): `vec` is still the raw seed and
        // not orthogonal to what was already found, which would give a non-orthonormal basis
        // and wrongly fail the `is_planar` reconstruction check. Any orthogonal unit vec does.
        vec = orthogonal_unit_vec(eigenvectors, n_cols) ?? vec
        break
      }
      const prev = vec
      vec = new_vec.map((val) => val / norm)
      // Early exit when eigenvector has converged
      if (prev.every((val, idx) => Math.abs(val - vec[idx]) < EPS)) break
    }

    // Rayleigh quotient for deflation
    const eigenvalue = dot(vec, mat_vec(vec))

    eigenvectors.push(vec)

    // Deflate: remove this component from the covariance matrix
    for (let idx = 0; idx < n_cols; idx++) {
      for (let jdx = 0; jdx < n_cols; jdx++) {
        work_cov[idx][jdx] -= eigenvalue * vec[idx] * vec[jdx]
      }
    }
  }

  // Project data onto eigenvectors
  const scores = centered.map((row) =>
    eigenvectors.map((ev) => row.reduce((sum, val, idx) => sum + val * ev[idx], 0)),
  )

  return { scores, eigenvectors, means }
}

// Compute orthonormal vector to a 2D line segment (for label offset in 2D diagrams)
export function orthonormal_2d(line_pts: number[][]): Vec2 {
  const [dx, dy] = subtract(line_pts[1], line_pts[0])
  return normalize_vec<Vec2>([-dy, dx], [0, 1])
}

// Deduplicate points within an L-inf ball of radius `tol`, returning unique points and index
// mapping. Greedy (first point of a cluster wins).
export function dedup_points(
  pts: number[][],
  tol: number = 1e-4,
): {
  unique: number[][]
  orig_indices: number[] // for each unique point, the index in the original array
} {
  const unique: number[][] = []
  const orig_indices: number[] = []
  for (let idx = 0; idx < pts.length; idx++) {
    const pt = pts[idx]
    const is_dup = unique.some((existing) =>
      existing.every((val, dim) => Math.abs(val - pt[dim]) < tol),
    )
    if (!is_dup) {
      unique.push(pt)
      orig_indices.push(idx)
    }
  }
  return { unique, orig_indices }
}

// Two-component PCA fit, with the reconstruction from a score pair and the largest
// out-of-plane residual (0 when exactly coplanar).
function pca_plane(points: number[][]) {
  const { scores, eigenvectors, means } = simple_pca(points, 2)
  const unproject = (score_x: number, score_y: number): number[] =>
    means.map(
      (mean, dim) => mean + score_x * eigenvectors[0][dim] + score_y * eigenvectors[1][dim],
    )
  const max_residual = Math.max(
    ...points.map((pt, idx) => euclidean_dist(pt, unproject(scores[idx][0], scores[idx][1]))),
  )
  return { scores, eigenvectors, means, unproject, max_residual }
}

interface DomainPlane {
  normal: Vec3
  offset: number
  // Is `point`, already known to lie on this plane, inside the outline the points trace on it?
  in_outline: (point: Vec3) => boolean
}

// Plane a set of 3D points lies on, as unit `normal` and `offset` with normal . p = offset.
// Null when they span a volume (projected quaternary+ domains are polyhedra), are collinear,
// or number fewer than 3. `rel_tol` is relative to the bounding-box diagonal.
export function fit_plane(points: number[][], rel_tol: number = 1e-6): DomainPlane | null {
  const diag = bbox_diagonal(points)
  // dedup far below rel_tol — coarser merging is the collinearity check's job, and an absolute
  // tolerance merges a whole domain once coordinates shrink
  const { unique } = dedup_points(points, 1e-9 * diag || EPS)
  if (unique.length < 3 || unique[0].length !== 3) return null
  const { scores, eigenvectors, means, max_residual } = pca_plane(unique)
  const tol = rel_tol * diag
  // collinear points have a degenerate second component: any plane through the line fits
  const [second_lo, second_hi] = array_extent(scores.map((row) => row[1]))
  if (second_hi - second_lo <= tol || max_residual > tol) return null
  const normal = normalize_vec<Vec3>(cross_3d(eigenvectors[0], eigenvectors[1]), [0, 0, 0])
  if (normal.every((component) => component === 0)) return null
  const [u_vec, v_vec] = compute_in_plane_basis(normal)
  const outline = convex_hull_2d(unique.map((pt) => [dot(u_vec, pt), dot(v_vec, pt)] as Vec2))
  return {
    normal,
    offset: dot(normal, means),
    in_outline: (point) => point_in_polygon(dot(u_vec, point), dot(v_vec, point), outline),
  }
}

// Mean of a set of points, per axis
export const vertex_mean = (points: number[][]): Vec3 =>
  [0, 1, 2].map(
    (axis) => points.reduce((sum, pt) => sum + pt[axis], 0) / points.length,
  ) as Vec3

// Triangles of a non-indexed position buffer, as corner triples (9 numbers per face)
const buffer_faces = (positions: ArrayLike<number>): Vec3[][] =>
  Array.from({ length: Math.floor(positions.length / 9) }, (_, face) =>
    [0, 3, 6].map(
      (corner) => [0, 1, 2].map((axis) => positions[face * 9 + corner + axis]) as Vec3,
    ),
  )

// Drop the artificial faces that close a chemical potential diagram at the lower axis limits: a
// closing face's outward normal points entirely into the negative octant, a real domain boundary
// always has one component toward 0 eV. Survivors come back as a flat non-indexed position array
// re-merged into clean fans, or null when nothing survives.
export function strip_closing_faces(positions: ArrayLike<number>): Float32Array | null {
  const faces = buffer_faces(positions)
  const hull_centroid = vertex_mean(faces.flat())
  const kept = faces
    .filter((corners) => {
      const [va, vb, vc] = corners
      const normal = cross_3d(subtract(vb, va), subtract(vc, va))
      // oriented away from the hull centroid, so the buffer's own winding does not matter
      const sign = dot(normal, subtract(vertex_mean(corners), hull_centroid)) < 0 ? -1 : 1
      return normal.some((component) => component * sign > 0)
    })
    .flat(2)
  if (kept.length === 0) return null
  // removing closing faces can expose new coplanar adjacencies
  return merge_coplanar_triangles(Float32Array.from(kept))
}

// Assign each triangle of a non-indexed face buffer (9 numbers per face) to the domain owning it.
// Every hull face lies on exactly one entry's hyperplane, so the face centroid's distance to each
// domain's plane decides it (nearest-centroid, replaced here, is a Voronoi partition mislabelling
// elongated and adjacent domains: 73/120 faces correct against 120/120). Coplanar domains are
// told apart by their outlines; nearest centroid is the last resort for domains with no plane.
export function assign_faces_to_domains(
  face_positions: ArrayLike<number>,
  domains: { formula: string; points: number[][] }[],
): string[] {
  // plane membership tolerance, relative to the scene so it survives any axis stretch
  const tol = 1e-4 * bbox_diagonal(domains.flatMap(({ points }) => points)) || 1e-6
  const prepared = domains.map(({ formula, points }) => ({
    formula,
    plane: fit_plane(points),
    centroid: vertex_mean(points),
  }))

  return buffer_faces(face_positions).map((corners) => {
    const centroid = vertex_mean(corners)
    let claimants = prepared.filter(
      ({ plane }) => plane && Math.abs(dot(plane.normal, centroid) - plane.offset) <= tol,
    )
    if (claimants.length > 1) {
      const inside = claimants.filter(({ plane }) => plane?.in_outline(centroid))
      if (inside.length > 0) claimants = inside
    }
    if (claimants.length === 0) claimants = prepared
    return claimants.reduce((best, cand) =>
      euclidean_dist(centroid, cand.centroid) < euclidean_dist(centroid, best.centroid)
        ? cand
        : best,
    ).formula
  })
}

// Outline of a 3D domain: boundary edges (as index pairs into points_3d) and the label
// anchor. Vertices are deduplicated, projected onto their two principal axes and hulled in
// 2D, so only the outer polygon comes back, never interior diagonals. `is_planar` reports
// whether that projection was lossless (max out-of-plane residual below 1e-6 of the bounding
// box diagonal): every domain of a true ternary lies on its entry's hyperplane, but
// projections of quaternary+ systems produce polyhedra whose edges need a 3D hull instead.
export function get_3d_domain_simplexes_and_ann_loc(points_3d: number[][]): {
  simplex_indices: number[][]
  ann_loc: number[]
  is_planar: boolean
} {
  // Deduplicate vertices to avoid cluttered interior edges
  const { unique, orig_indices } = dedup_points(points_3d)

  if (unique.length < 3) {
    // a single vertex (or none) has no edges; a segment is its own outline
    const is_segment = unique.length === 2
    return {
      simplex_indices: is_segment ? [[orig_indices[0], orig_indices[1]]] : [],
      ann_loc: is_segment
        ? unique[0].map((val, dim) => (val + unique[1][dim]) / 2)
        : (unique[0] ?? [0, 0, 0]),
      is_planar: true,
    }
  }

  const { scores, unproject, max_residual } = pca_plane(unique)
  // Out-of-plane residual of the 2-component reconstruction, relative to the domain size
  const is_planar = max_residual <= 1e-6 * bbox_diagonal(unique)

  // 2D convex hull of PCA-projected unique points → only boundary edges
  const pts_2d: Vec2[] = scores.map((row) => [row[0], row[1]])
  const hull = convex_hull_2d(pts_2d)
  const [centroid_x, centroid_y] = polygon_centroid(hull)
  const ann_loc = unproject(centroid_x, centroid_y)

  // Map hull vertices back to original point indices using nearest projected
  // vertex instead of stringified coordinates to avoid precision aliasing.
  const nearest_orig_idx = (target: Vec2): number => {
    let [nearest_idx, min_sq_dist] = [0, Infinity]
    for (const [idx, [pt_x, pt_y]] of pts_2d.entries()) {
      const [delta_x, delta_y] = [pt_x - target[0], pt_y - target[1]]
      const sq_dist = delta_x * delta_x + delta_y * delta_y
      if (sq_dist < min_sq_dist) [nearest_idx, min_sq_dist] = [idx, sq_dist]
    }
    return orig_indices[nearest_idx]
  }

  const simplex_indices = hull.map((pt_a, hull_idx) => [
    nearest_orig_idx(pt_a),
    nearest_orig_idx(hull[(hull_idx + 1) % hull.length]),
  ])

  return { simplex_indices, ann_loc, is_planar }
}

// === Label Sizing ===

// Bounding box diagonal of a set of N-D points (Euclidean distance between
// the min and max corners). Returns 0 for fewer than 2 points.
export function bbox_diagonal(points: number[][]): number {
  if (points.length < 2) return 0
  const sq_spans = points[0].map((_, col) => {
    const [lo, hi] = array_extent(points.map((pt) => pt[col]))
    return (hi - lo) ** 2
  })
  return Math.sqrt(sq_spans.reduce((sum, sq_span) => sum + sq_span, 0))
}

// Map an array of raw size values to font sizes via linear interpolation.
// Returns a new array of font sizes in [min_font, max_font].
// If all sizes are equal, returns the midpoint for all.
export function scale_to_font_range(
  sizes: number[],
  min_font: number,
  max_font: number,
): number[] {
  const [min_size, max_size] = array_extent(sizes)
  const range = max_size - min_size
  const mid = (min_font + max_font) / 2
  return sizes.map((size) =>
    range > 0 ? min_font + ((max_font - min_font) * (size - min_size)) / range : mid,
  )
}

// Map Plotly/pymatgen's Z-up data axes to Three.js's Y-up render axes.
export const swizzle_to_render =
  (scale: Vec3) =>
  (d0: number, d1: number, d2: number): Vec3 => [d1 * scale[0], d2 * scale[1], d0 * scale[2]]

export interface VisibleDomainLabel {
  formula: string
  position: [number, number, number]
  label_font_size: number
}

export function get_visible_domain_labels(
  face_positions: ArrayLike<number>,
  face_domain_map: string[],
  label_font_size_by_formula: ReadonlyMap<string, number>,
  pinned_labels: VisibleDomainLabel[] = [],
): VisibleDomainLabel[] {
  const accum = new Map<string, { area: number; x: number; y: number; z: number }>()

  // faces past the end of face_domain_map get an undefined formula and are skipped
  for (const [face_idx, corners] of buffer_faces(face_positions).entries()) {
    const formula = face_domain_map[face_idx]
    if (!formula || !label_font_size_by_formula.has(formula)) continue

    const [vert_a, vert_b, vert_c] = corners
    const area =
      Math.hypot(...cross_3d(subtract(vert_b, vert_a), subtract(vert_c, vert_a))) / 2
    if (area <= EPS) continue

    const centroid = vertex_mean(corners)
    const entry = accum.get(formula) ?? { area: 0, x: 0, y: 0, z: 0 }
    entry.area += area
    entry.x += centroid[0] * area
    entry.y += centroid[1] * area
    entry.z += centroid[2] * area
    accum.set(formula, entry)
  }

  const visible_labels = [...accum.entries()]
    .filter(([, entry]) => entry.area > EPS)
    .map(([formula, entry]) => ({
      formula,
      position: [entry.x / entry.area, entry.y / entry.area, entry.z / entry.area] as [
        number,
        number,
        number,
      ],
      label_font_size: label_font_size_by_formula.get(formula) ?? 12,
    }))

  for (const label of pinned_labels) {
    if (!visible_labels.some((visible_label) => visible_label.formula === label.formula)) {
      visible_labels.push(label)
    }
  }

  return visible_labels.toSorted((label_a, label_b) =>
    label_a.formula.localeCompare(label_b.formula),
  )
}

// === Ternary Combinations ===

// Generate all C(n,3) ternary element combinations from a sorted element list.
// Each triplet is sorted alphabetically. Returns empty array for fewer than 3 elements.
export const get_ternary_combinations = (elements: string[]): string[][] =>
  combinations([...elements].toSorted(), 3)

// Deterministic fingerprint for equal-energy tie-breaking in prefer_min_entry. Only the
// fields that affect the geometry take part (no structures or calculation metadata).
function entry_fingerprint(entry: PhaseData): string {
  const effective_energy = safe_energy_per_atom(entry)
  const composition = Object.entries(entry.composition).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )
  return JSON.stringify({
    entry_id: entry.entry_id ?? null,
    name: entry.name ?? null,
    reduced_formula: entry.reduced_formula ?? null,
    composition,
    energy_per_atom: Number.isFinite(effective_energy) ? effective_energy : null,
    exclude_from_hull: entry.exclude_from_hull === true,
    is_stable: entry.is_stable === true,
    e_above_hull: Number.isFinite(entry.e_above_hull) ? entry.e_above_hull : null,
  })
}

// === Main Pipeline ===

// Entries restricted to `elements` (every positive-amount element must be in the set),
// reduced to the minimum-energy entry per formula, optionally renormalized to formal
// chemical potentials, and turned into hyperplane rows. Shared by compute_chempot_diagram
// and tests that inspect the intermediate hull input.
export function build_chempot_hyperplanes(
  entries: PhaseData[],
  elements: string[],
  formal_chempots: boolean,
): {
  min_entries: PhaseData[]
  el_refs: Record<string, PhaseData>
  hyperplanes: number[][]
  hyperplane_entries: PhaseData[]
} {
  const element_set = new Set(elements)
  // Zero amounts mean "absent" throughout this module (formula keys, references, the element
  // scan). A negative or NaN amount would turn into a negative hyperplane normal and break the
  // lower-corner feasibility argument of chebyshev_centre, so reject it here where the entry
  // is still known by name.
  const in_subsystem = (entry: PhaseData): boolean =>
    Object.entries(entry.composition).every(([element, amount]) => {
      if (!(amount >= 0)) {
        const label = entry.entry_id ?? entry.reduced_formula ?? entry.name
        throw new Error(
          `Invalid composition amount ${element}: ${amount} in entry ${label ?? JSON.stringify(entry.composition)}`,
        )
      }
      return amount === 0 || element_set.has(element)
    })
  // Sort by formula key so same-energy ties resolve deterministically
  const sorted_entries = entries
    .filter(in_subsystem)
    .map((entry) => ({ entry, key: formula_key_from_composition(entry.composition) }))
    .toSorted((left, right) => left.key.localeCompare(right.key))
    .map(({ entry }) => entry)

  let { min_entries, el_refs } = get_min_entries_and_el_refs(sorted_entries)
  const missing_refs = elements.filter((el) => !el_refs[el])
  if (missing_refs.length > 0) {
    throw new Error(`Missing elemental reference entries for: ${missing_refs.join(`, `)}`)
  }
  if (formal_chempots) {
    min_entries = renormalize_entries(min_entries, el_refs)
    el_refs = get_min_entries_and_el_refs(min_entries).el_refs
  }
  return { min_entries, el_refs, ...build_hyperplanes(min_entries, el_refs, elements) }
}

// Compute the chemical potential diagram (stability domains per formula) from entries.
//
// Supports two modes based on config.elements vs data dimensionality:
// - **Subsystem mode**: config.elements matches data element count → filter entries
//   to subsystem, compute in reduced dimensionality (fast for ternary from ternary data)
// - **Projection mode**: config.elements has fewer elements than data → compute in
//   full N-D, then project domain vertices to selected display axes (column extraction).
//   This matches pymatgen's ChemicalPotentialDiagram behavior for multinary systems.
export function compute_chempot_diagram(
  entries: PhaseData[],
  config: ChemPotDiagramConfig = {},
): ChemPotDiagramData {
  const {
    formal_chempots = CHEMPOT_DEFAULTS.formal_chempots,
    default_min_limit = CHEMPOT_DEFAULTS.default_min_limit,
    limits,
  } = config

  const all_data_elements = entry_elements(entries)

  // Display elements: user-specified order (controls axis mapping), or auto-detect
  const display_elements = config.elements?.length ? [...config.elements] : all_data_elements

  // Projection mode: display fewer axes than the data has elements
  // In this mode, compute in full N-D and project afterward
  const is_projection =
    display_elements.length < all_data_elements.length &&
    display_elements.every((el) => all_data_elements.includes(el))

  // Computation elements: full element set for projection, display set for subsystem
  const compute_elements = is_projection ? all_data_elements : display_elements
  const dim = compute_elements.length
  if (dim < 2) throw new Error(`ChemicalPotentialDiagram requires 2+ elements, got ${dim}`)

  const { hyperplanes, hyperplane_entries } = build_chempot_hyperplanes(
    entries,
    compute_elements,
    formal_chempots,
  )
  const compute_lims: Vec2[] = compute_elements.map(
    (el) => limits?.[el] ?? [default_min_limit, 0],
  )
  const nd_domains = compute_domains(hyperplanes, compute_lims, hyperplane_entries)

  // Project domain vertices from N-D to display axes (column extraction; the identity in
  // subsystem mode, where compute_elements is display_elements)
  const col_indices = display_elements.map((element) => compute_elements.indexOf(element))
  const domains = Object.fromEntries(
    Object.entries(nd_domains).map(([formula, pts]) => [
      formula,
      pts.map((pt) => col_indices.map((idx) => pt[idx])),
    ]),
  )
  return {
    domains,
    elements: display_elements,
    lims: col_indices.map((col_idx) => compute_lims[col_idx]),
  }
}
