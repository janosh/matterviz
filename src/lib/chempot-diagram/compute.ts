// Chemical potential diagrams: TypeScript port of pymatgen's ChemicalPotentialDiagram
// (pymatgen/analysis/chempot_diagram.py)

import { count_atoms_in_composition, get_reduced_formula } from '#lib/composition/reduce.js'
import {
  absolute_energy_per_atom,
  compute_e_form_per_atom,
  compute_quickhull_nd,
  find_lowest_energy_unary_refs,
  get_energy_per_atom,
  has_absolute_energy,
} from '#lib/convex-hull/thermodynamics.js'
import type { PhaseData } from '#lib/convex-hull/types.js'
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
} from '#lib/math.js'
import type { Vec2, Vec3 } from '#lib/math.js'
import type {
  ChemPotBound,
  ChemPotDiagramConfig,
  ChemPotDiagramData,
  ChemPotSliceValues,
  ChemPotSystem,
} from './types'
import { CHEMPOT_DEFAULTS } from './types'

// === Entry Helpers ===

// Energy per atom (MP `correction` applied, see convex-hull/thermodynamics) or NaN when the
// entry has no atoms or a non-finite energy, so callers can skip it without throwing.
export function safe_energy_per_atom(entry: PhaseData): number {
  if (count_atoms_in_composition(entry.composition) <= 0) return Number.NaN
  const epa = get_energy_per_atom(entry)
  return Number.isFinite(epa) ? epa : Number.NaN
}

// E_form-only entries (no energy, or a 0 eV placeholder next to E_form) placed on their
// references' absolute scale (E_form + Σ x_e E_e), so they share the absolute entries' axes
function with_absolute_energies(entries: PhaseData[]): PhaseData[] {
  if (entries.every(has_absolute_energy)) return entries
  const unary_refs = find_lowest_energy_unary_refs(entries)
  return entries.map((entry) => {
    if (has_absolute_energy(entry)) return entry
    const energy_per_atom = absolute_energy_per_atom(entry, unary_refs)
    const energy = energy_per_atom * count_atoms_in_composition(entry.composition)
    // E_form already includes any MP correction, so drop it or get_energy_per_atom re-applies
    return { ...entry, energy, energy_per_atom, correction: undefined }
  })
}

// Same-formula EPA total order: lower energy, then stable, then lower e_above_hull, then a
// deterministic fingerprint so ties never depend on input order.
function prefer_min_entry(
  candidate: PhaseData,
  candidate_epa: number,
  existing: PhaseData,
  existing_epa: number,
): boolean {
  if (candidate_epa !== existing_epa) return candidate_epa < existing_epa
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
    .toSorted(([left_value], [right_value]) => left_value.localeCompare(right_value))
    .map(([element, amt]) => (amt === 1 ? element : `${element}${amt}`))
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

// Minimum-energy entry per reduced formula, plus elemental references. As in the convex hull,
// exclude_from_hull entries are neither.
export function get_min_entries_and_el_refs(entries: PhaseData[]): {
  min_entries: PhaseData[]
  el_refs: Record<string, PhaseData>
} {
  const by_formula = new Map<string, { entry: PhaseData; epa: number }>()

  for (const entry of with_absolute_energies(entries)) {
    if (entry.exclude_from_hull) continue
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

// Per-formula entry count and min/max energy per atom (region coloring and tooltips)
export function get_energy_stats_by_formula(
  entries: PhaseData[],
): Map<string, FormulaEnergyStats> {
  const stats = new Map<string, FormulaEnergyStats>()
  for (const entry of with_absolute_energies(entries)) {
    const energy_per_atom = safe_energy_per_atom(entry)
    if (!Number.isFinite(energy_per_atom)) continue
    const formula_key = formula_key_from_composition(entry.composition)
    const prev = stats.get(formula_key)
    stats.set(formula_key, {
      matching_entry_count: (prev?.matching_entry_count ?? 0) + 1,
      min_energy_per_atom: Math.min(
        prev?.min_energy_per_atom ?? energy_per_atom,
        energy_per_atom,
      ),
      max_energy_per_atom: Math.max(
        prev?.max_energy_per_atom ?? energy_per_atom,
        energy_per_atom,
      ),
    })
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
    return { ...entry, energy: e_form * atoms, energy_per_atom: e_form, correction: undefined }
  })

// Hyperplane rows [x_1, ..., x_n, -E_per_atom] for elemental refs and entries with negative
// E_form. When every entry carries `is_stable`/`e_above_hull`, those replace pymatgen's
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

// Border hyperplanes from per-element limits: two halfspace rows per axis with limits [lo, hi],
// -mu_i + lo <= 0 → [-1, 0, ..., lo] and mu_i - hi <= 0 → [1, 0, ..., -hi]
export const build_border_hyperplanes = (lims: Vec2[]): number[][] =>
  lims.flatMap(([lower, upper], idx) => {
    const row = (coeff: number, offset: number): number[] =>
      Array(lims.length + 1)
        .fill(0)
        .with(idx, coeff)
        .with(lims.length, offset)
    return [row(-1, lower), row(1, -upper)]
  })

// Value of halfspace row [a_1..a_dim, b] at a point: a·mu + b (feasible when <= 0)
function halfspace_value(halfspace: number[], point: number[], dim: number): number {
  let val = halfspace[dim]
  for (let idx = 0; idx < dim; idx++) val += halfspace[idx] * point[idx]
  return val
}

// Pivot tolerance of the Chebyshev-centre simplex (coefficients are composition fractions and
// unit border normals, right-hand sides eV-scale chemical potentials)
const LP_TOL = 1e-10

// Chebyshev centre of the region {mu : a_i·mu + b_i <= 0} (entry rows plus `lims` borders):
// the (mu, r) maximising r subject to a_i·mu + |a_i|·r + b_i <= 0, correct for arbitrary
// per-element limit widths unlike a diagonal-shift heuristic. Solved by a dense simplex in
// y = mu - lo >= 0 (Bland's rule, cannot cycle). Entry normals are composition fractions
// (>= 0, screened by build_chempot_hyperplanes), so lo is feasible whenever the region is
// non-empty: the slack basis is feasible from the start (no phase 1), and a negative slack at
// lo proves the region empty (`radius` -Infinity). Exported for tests.
export function chebyshev_centre(
  entry_hs: number[][],
  lims: Vec2[],
): { centre: number[]; radius: number } {
  const dim = lims.length
  const lower = lims.map(([low]) => low)
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
      rhs -= halfspace[idx] * lower[idx]
    }
    line[r_col] = Math.sqrt(norm_sq)
    line[slack_col + row] = 1
    line[rhs_col] = rhs
    return line
  })
  if (tableau.some((line) => line[rhs_col] < -LP_TOL)) return { centre: [], radius: -Infinity }
  const basis = all_hs.map((_, row) => slack_col + row)
  // Reduced costs of the maximised objective r (-c_j): negative marks an improving column
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
  // minimum-ratio rows leaves (tie window measured from the true minimum)
  while (true) {
    const enter = objective.findIndex((val, col) => col < rhs_col && val < -LP_TOL)
    if (enter === -1) break
    const ratios = tableau.map((line) =>
      line[enter] > LP_TOL ? line[rhs_col] / line[enter] : Infinity,
    )
    const min_ratio = array_min(ratios)
    // Unreachable in practice: the upper borders bound r, so a positive pivot always exists
    if (min_ratio === Infinity) break
    let leave = -1
    for (let row = 0; row < n_rows; row++) {
      if (ratios[row] - min_ratio > LP_TOL) continue
      if (leave === -1 || basis[row] < basis[leave]) leave = row
    }
    pivot(leave, enter)
  }

  const centre = [...lower]
  let radius = 0
  for (let row = 0; row < n_rows; row++) {
    const variable = basis[row]
    if (variable < dim) centre[variable] += tableau[row][rhs_col]
    else if (variable === r_col) radius = tableau[row][rhs_col]
  }
  return { centre, radius }
}

// Chemical potential domains: vertices of the halfspace intersection {mu : a_i·mu + b_i <= 0},
// via the polar dual (replacing scipy's HalfspaceIntersection): about an interior point c each
// halfspace becomes the dual point a_i / -(a_i·c + b_i), and each dual hull facet is a primal
// vertex. Vertices go to every entry whose hyperplane is active there, handling degenerate
// vertices where more than `dim` planes meet (e.g. an element plane on the mu = 0 border).
// `formulas` names the domain of each hyperplane row.
function compute_domains(
  hyperplanes: number[][],
  lims: Vec2[],
  formulas: string[],
): Record<string, number[][]> {
  const dim = lims.length
  const n_entries = hyperplanes.length
  const all_hs = [...hyperplanes, ...build_border_hyperplanes(lims)]
  const tol = 1e-6

  const domains: Record<string, number[][]> = {}
  for (const formula of formulas) domains[formula] ??= []
  if (n_entries === 0) return domains

  // Strictly interior unless the region is empty (E_form below the lower limit, inverted lims)
  const { centre, radius } = chebyshev_centre(hyperplanes, lims)
  if (!(radius > LP_TOL)) {
    throw new Error(
      `Chemical potential region is empty: largest inscribed radius ${radius} eV for limits ${JSON.stringify(lims)}`,
    )
  }
  const slacks = all_hs.map((halfspace) => -halfspace_value(halfspace, centre, dim))
  // Nearest halfspace maps to unit distance so quickhull's absolute tolerance is scale-free
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
        domains[formulas[hs_idx]].push(vertex)
      }
    }
  }

  return Object.fromEntries(Object.entries(domains).filter(([, domain]) => domain.length > 0))
}

// Whether a coordinate is the artificial default_min_limit bound, not a real vertex near it
// (pymatgen's np.isclose(col, default_min_limit) with default tolerances)
const at_min_limit = (val: number, default_min_limit: number): boolean =>
  Math.abs(val - default_min_limit) <= 1e-8 + 1e-5 * Math.abs(default_min_limit)

// Per given axis, its lowest real coordinate (not at the artificial default_min_limit floor)
// minus `padding`: where pad_domains moves the floor
export function padded_floors(
  domains: Record<string, number[][]>,
  elem_indices: number[],
  padding: number,
  default_min_limit: number,
): number[] {
  const mins = elem_indices.map(() => Infinity)
  for (const pts of Object.values(domains)) {
    for (const point of pts) {
      for (const [idx, col] of elem_indices.entries()) {
        const val = point[col]
        if (!at_min_limit(val, default_min_limit) && val < mins[idx]) mins[idx] = val
      }
    }
  }
  return mins.map(
    (min_val) => (Number.isFinite(min_val) ? min_val : default_min_limit) - padding,
  )
}

// Move coordinates at default_min_limit (the artificial floor) on the given axes to `floors`
// (default: padded_floors of these domains), for cleaner visual bounds. Sections pass the
// floors of the unsliced projection, so their floor faces hold still during a sweep.
export function pad_domains(
  domains: Record<string, number[][]>,
  elem_indices: number[],
  padding: number,
  default_min_limit: number,
  floors: number[] | null = null,
): Record<string, number[][]> {
  if (!(padding > 0)) return domains
  const new_lims = floors ?? padded_floors(domains, elem_indices, padding, default_min_limit)
  return Object.fromEntries(
    Object.entries(domains).map(([formula, pts]) => [
      formula,
      pts.map((point) => {
        const padded = [...point]
        for (const [idx, col] of elem_indices.entries()) {
          if (at_min_limit(padded[col], default_min_limit)) padded[col] = new_lims[idx]
        }
        return padded
      }),
    ]),
  )
}

// Build per-axis min/max ranges for a set of points
export const build_axis_ranges = (
  points: number[][],
  elements: string[],
): { element: string; min_val: number; max_val: number }[] =>
  elements.map((element, axis_idx) => {
    const [min_val, max_val] = array_extent(points.map((point) => point[axis_idx]))
    return { element, min_val, max_val }
  })

// Axis bounds a domain is clipped against, as labels. Tolerance is relative to each axis'
// window: on a window a few meV wide an absolute eV tolerance flags every bound.
export function get_touches_limits(
  points: number[][],
  lims: Vec2[],
  elements: string[],
): ChemPotBound[] {
  const touches_limits: ChemPotBound[] = []
  for (let axis_idx = 0; axis_idx < Math.min(elements.length, lims.length); axis_idx++) {
    const [axis_min, axis_max] = lims[axis_idx]
    const tol = 1e-4 * (axis_max - axis_min) || EPS
    const axis_name = elements[axis_idx]
    const touches = (bound: number) =>
      points.some((point) => Math.abs(point[axis_idx] - bound) < tol)
    if (touches(axis_min)) touches_limits.push({ element: axis_name, side: `lower` })
    if (touches(axis_max)) touches_limits.push({ element: axis_name, side: `upper` })
  }
  return touches_limits
}

// === Label Placement Helpers ===

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

// Simple PCA onto the top 2 components, used to orient 3D domain polygons for labels
export function simple_pca(data: number[][]): {
  scores: number[][]
  eigenvectors: number[][]
  means: number[]
} {
  const n_rows = data.length
  const n_cols = data[0]?.length ?? 0
  if (n_rows === 0 || n_cols === 0) return { scores: [], eigenvectors: [], means: [] }

  const means = Array(n_cols).fill(0)
  for (const row of data) {
    for (let col = 0; col < n_cols; col++) means[col] += row[col]
  }
  for (let col = 0; col < n_cols; col++) means[col] /= n_rows

  const centered = data.map((row) => row.map((val, col) => val - means[col]))

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

  // Power iteration for the top 2 eigenvectors. Rank thresholds are relative to the total
  // variance: an absolute epsilon calls a good axis rank-deficient once coordinates shrink (a
  // domain 1e-6 wide has a second eigenvalue near 1e-13).
  const eigenvectors: number[][] = []
  const work_cov = cov.map((row) => [...row])
  const mat_vec = (vec: number[]): number[] => dot(work_cov, vec)
  const cov_scale = cov.reduce((sum, row, idx) => sum + row[idx], 0) // trace = total variance
  const rank_eps = EPS * (cov_scale || 1)

  for (let comp = 0; comp < 2; comp++) {
    // Seed with the largest (deflated) covariance row: a fixed basis vector may be in the null
    // space (elemental domains have zero variance on their own axis) and stall on step one.
    const row_norms = work_cov.map((row) => Math.hypot(...row))
    const seed_idx = row_norms.indexOf(array_max(row_norms))
    let vec: number[] =
      row_norms[seed_idx] > rank_eps
        ? work_cov[seed_idx].map((val) => val / row_norms[seed_idx])
        : Array(n_cols).fill(0).with(seed_idx, 1)

    for (let iter = 0; iter < 100; iter++) {
      const new_vec = mat_vec(vec)
      // Re-orthogonalize: with close eigenvalues (near-square domains) deflation is inexact,
      // so v1·v2 drifts up to 1e-3, breaking the is_planar check.
      project_out(new_vec, eigenvectors)

      const norm = Math.hypot(...new_vec)
      if (norm < rank_eps) {
        // Rank-deficient (collinear/coincident points): the raw seed isn't orthogonal to the
        // found components, so take any orthogonal unit vector to keep the basis orthonormal
        vec = orthogonal_unit_vec(eigenvectors, n_cols) ?? vec
        break
      }
      const prev = vec
      vec = new_vec.map((val) => val / norm)
      if (prev.every((val, idx) => Math.abs(val - vec[idx]) < EPS)) break
    }

    const eigenvalue = dot(vec, mat_vec(vec)) // Rayleigh quotient
    eigenvectors.push(vec)
    // Deflate: remove this component from the covariance matrix
    for (let idx = 0; idx < n_cols; idx++) {
      for (let jdx = 0; jdx < n_cols; jdx++) {
        work_cov[idx][jdx] -= eigenvalue * vec[idx] * vec[jdx]
      }
    }
  }

  const scores = centered.map((row) =>
    eigenvectors.map((eigenvector) =>
      row.reduce((sum, val, idx) => sum + val * eigenvector[idx], 0),
    ),
  )

  return { scores, eigenvectors, means }
}

// Compute orthonormal vector to a 2D line segment (for label offset in 2D diagrams)
export function orthonormal_2d(line_pts: number[][]): Vec2 {
  const [delta_x, delta_y] = subtract(line_pts[1], line_pts[0])
  return normalize_vec<Vec2>([-delta_y, delta_x], [0, 1])
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
    const point = pts[idx]
    const is_dup = unique.some((existing) =>
      existing.every((val, dim) => Math.abs(val - point[dim]) < tol),
    )
    if (!is_dup) {
      unique.push(point)
      orig_indices.push(idx)
    }
  }
  return { unique, orig_indices }
}

// Two-component PCA fit, with the reconstruction from a score pair and the largest
// out-of-plane residual (0 when exactly coplanar).
function pca_plane(points: number[][]) {
  const { scores, eigenvectors, means } = simple_pca(points)
  const unproject = (score_x: number, score_y: number): number[] =>
    means.map(
      (mean, dim) => mean + score_x * eigenvectors[0][dim] + score_y * eigenvectors[1][dim],
    )
  const max_residual = Math.max(
    ...points.map((point, idx) =>
      euclidean_dist(point, unproject(scores[idx][0], scores[idx][1])),
    ),
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
  // dedup far below rel_tol (coarser merging is the collinearity check's job)
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
  const outline = convex_hull_2d(
    unique.map((point) => [dot(u_vec, point), dot(v_vec, point)] as Vec2),
  )
  return {
    normal,
    offset: dot(normal, means),
    in_outline: (point) => point_in_polygon(dot(u_vec, point), dot(v_vec, point), outline),
  }
}

// Mean of a set of points, per axis
export const vertex_mean = (points: number[][]): Vec3 =>
  [0, 1, 2].map(
    (axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length,
  ) as Vec3

// Triangles of a non-indexed position buffer, as corner triples (9 numbers per face)
const buffer_faces = (positions: ArrayLike<number>): Vec3[][] =>
  Array.from({ length: Math.floor(positions.length / 9) }, (_, face) =>
    [0, 3, 6].map(
      (corner) => [0, 1, 2].map((axis) => positions[face * 9 + corner + axis]) as Vec3,
    ),
  )

// Drop the artificial faces closing the diagram at the lower axis limits (outward normal fully
// in the negative octant; real boundaries point toward 0 eV on some axis). Survivors come back
// re-merged as a flat non-indexed position array, or null when nothing survives.
export function strip_closing_faces(positions: ArrayLike<number>): Float32Array | null {
  const faces = buffer_faces(positions)
  const hull_centroid = vertex_mean(faces.flat())
  const kept = faces
    .filter((corners) => {
      const [vertex_a, vertex_b, vertex_c] = corners
      const normal = cross_3d(subtract(vertex_b, vertex_a), subtract(vertex_c, vertex_a))
      // oriented away from the hull centroid, so the buffer's own winding does not matter
      const sign = dot(normal, subtract(vertex_mean(corners), hull_centroid)) < 0 ? -1 : 1
      return normal.some((component) => component * sign > 0)
    })
    .flat(2)
  if (kept.length === 0) return null
  // removing closing faces can expose new coplanar adjacencies
  return merge_coplanar_triangles(Float32Array.from(kept))
}

// Assign each triangle of a non-indexed face buffer to its domain by the face centroid's
// distance to each domain's plane (nearest-centroid alone mislabels elongated domains: 73/120
// vs 120/120). Outlines split coplanar domains; nearest centroid is the last resort.
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

// Outline of a 3D domain (boundary edges as index pairs into points_3d) and its label anchor,
// from a 2D hull of the PCA-projected unique vertices. `is_planar` reports whether that was
// lossless: quaternary+ projections are polyhedra whose edges need a 3D hull instead.
export function get_3d_domain_simplexes_and_ann_loc(points_3d: number[][]): {
  simplex_indices: number[][]
  ann_loc: number[]
  is_planar: boolean
} {
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
  const is_planar = max_residual <= 1e-6 * bbox_diagonal(unique)

  const pts_2d: Vec2[] = scores.map((row) => [row[0], row[1]])
  const hull = convex_hull_2d(pts_2d)
  const [centroid_x, centroid_y] = polygon_centroid(hull)
  const ann_loc = unproject(centroid_x, centroid_y)

  // Map hull vertices back by nearest projected point (string keys alias under round-off)
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

// Bounding box diagonal of N-D points (0 for fewer than 2)
export function bbox_diagonal(points: number[][]): number {
  if (points.length < 2) return 0
  const sq_spans = points[0].map((_, col) => {
    const [lower, upper] = array_extent(points.map((point) => point[col]))
    return (upper - lower) ** 2
  })
  return Math.sqrt(sq_spans.reduce((sum, sq_span) => sum + sq_span, 0))
}

// Linearly map sizes to fonts in [min_font, max_font] (all midpoint when sizes are equal)
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
  (distance_0: number, distance_1: number, distance_2: number): Vec3 => [
    distance_1 * scale[0],
    distance_2 * scale[1],
    distance_0 * scale[2],
  ]

export interface VisibleDomainLabel {
  formula: string
  position: Vec3
  label_font_size: number
}

export function get_visible_domain_labels(
  face_positions: ArrayLike<number>,
  face_domain_map: string[],
  label_font_size_by_formula: ReadonlyMap<string, number>,
  pinned_labels: VisibleDomainLabel[],
): VisibleDomainLabel[] {
  const accum = new Map<
    string,
    { area: number; x: number; y: number; z: number; label_font_size: number }
  >()

  // faces past the end of face_domain_map get an undefined formula and are skipped
  for (const [face_idx, corners] of buffer_faces(face_positions).entries()) {
    const formula = face_domain_map[face_idx]
    const label_font_size = formula ? label_font_size_by_formula.get(formula) : undefined
    if (label_font_size === undefined) continue

    const [vert_a, vert_b, vert_c] = corners
    const area =
      Math.hypot(...cross_3d(subtract(vert_b, vert_a), subtract(vert_c, vert_a))) / 2
    if (area <= EPS) continue

    const centroid = vertex_mean(corners)
    const entry = accum.get(formula) ?? { area: 0, x: 0, y: 0, z: 0, label_font_size }
    entry.area += area
    entry.x += centroid[0] * area
    entry.y += centroid[1] * area
    entry.z += centroid[2] * area
    accum.set(formula, entry)
  }

  const visible_labels = [...accum.entries()]
    .filter(([, entry]) => entry.area > EPS)
    .map(([formula, entry]): VisibleDomainLabel => ({
      formula,
      position: [entry.x / entry.area, entry.y / entry.area, entry.z / entry.area],
      label_font_size: entry.label_font_size,
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

// All C(n,3) alphabetically sorted ternary element combinations
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
    is_stable: entry.is_stable === true,
    e_above_hull: Number.isFinite(entry.e_above_hull) ? entry.e_above_hull : null,
  })
}

// === Main Pipeline ===

// Entries restricted to `elements`, reduced to the min-energy entry per formula, optionally
// renormalized to formal chemical potentials, and turned into hyperplane rows
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
  // Zero amounts mean "absent". Negative/NaN amounts would give negative hyperplane normals,
  // breaking chebyshev_centre's lower-corner feasibility, so reject them here by name.
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
  const missing_refs = elements.filter((element) => !el_refs[element])
  if (missing_refs.length > 0) {
    throw new Error(`Missing elemental reference entries for: ${missing_refs.join(`, `)}`)
  }
  if (formal_chempots) {
    min_entries = renormalize_entries(min_entries, el_refs)
    el_refs = get_min_entries_and_el_refs(min_entries).el_refs
  }
  return { min_entries, el_refs, ...build_hyperplanes(min_entries, el_refs, elements) }
}

// Display axes (config.elements, else the data's chemical system) and the axes the domains are
// computed on: every data element when the display axes are a subset of them (any extra axes
// are then sliced or shadow-projected by section_chempot_system), else the display axes
// themselves (a subsystem, possibly naming elements absent from the data).
export function chempot_axes(
  data_elements: string[],
  config_elements: string[] | undefined,
): { display: string[]; compute: string[] } {
  const display = config_elements?.length ? [...config_elements] : data_elements
  const is_subset = display.every((element) => data_elements.includes(element))
  return { display, compute: is_subset ? data_elements : display }
}

// The full halfspace system and its domains on the compute axes: the expensive part of a
// diagram, run once (in the worker) and then sliced/projected per view on the main thread
export function compute_chempot_system(
  entries: PhaseData[],
  config: ChemPotDiagramConfig = {},
): ChemPotSystem {
  const {
    formal_chempots = CHEMPOT_DEFAULTS.formal_chempots,
    default_min_limit = CHEMPOT_DEFAULTS.default_min_limit,
    limits,
  } = config
  const { compute: elements } = chempot_axes(entry_elements(entries), config.elements)
  if (elements.length < 2) {
    throw new Error(`ChemicalPotentialDiagram requires 2+ elements, got ${elements.length}`)
  }
  const { hyperplanes, hyperplane_entries } = build_chempot_hyperplanes(
    entries,
    elements,
    formal_chempots,
  )
  const formulas = hyperplane_entries.map((entry) =>
    formula_key_from_composition(entry.composition),
  )
  const lims = elements.map((element): Vec2 => limits?.[element] ?? [default_min_limit, 0])
  const domains = compute_domains(hyperplanes, lims, formulas)
  return { elements, lims, hyperplanes, formulas, domains }
}

// Chemical potential diagram (stability domains per formula) on the display axes. Data
// elements beyond config.elements are fixed at config.slice_chempots where given (exact
// cross-sections) and shadow-projected otherwise (pymatgen's multinary behavior).
export const compute_chempot_diagram = (
  entries: PhaseData[],
  config: ChemPotDiagramConfig = {},
): ChemPotDiagramData =>
  section_chempot_system(
    compute_chempot_system(entries, config),
    chempot_axes(entry_elements(entries), config.elements).display,
    config.slice_chempots,
  )

// === Sections ===

// Domains of `system` with the axes in `slices` fixed at their (defined) values: each fixed
// mu_k = c is substituted into every hyperplane and the vertices re-enumerated on the remaining
// axes, so the result holds exact cross-section vertices for any number of slices. A
// hyperplane left with no free coefficient (the sliced element's own reference) is a constant
// constraint: dropped when satisfied, an empty region otherwise.
function slice_system(
  system: ChemPotSystem,
  slices: ChemPotSliceValues,
): { elements: string[]; lims: Vec2[]; domains: Record<string, number[][]> } {
  const fixed = new Map<number, number>()
  for (const [element, value] of Object.entries(slices)) {
    if (value === undefined) continue
    const axis = system.elements.indexOf(element)
    if (axis === -1) {
      throw new Error(`Cannot slice ${element}: not an axis of ${system.elements.join(`-`)}`)
    }
    const [lower, upper] = system.lims[axis]
    if (!(value >= lower && value <= upper)) {
      throw new Error(
        `Slice mu_${element} = ${value} eV lies outside its limits [${lower}, ${upper}]`,
      )
    }
    fixed.set(axis, value)
  }
  if (fixed.size === 0) return system
  const free_axes = system.elements.flatMap((_, axis) => (fixed.has(axis) ? [] : [axis]))
  const n_axes = system.elements.length
  const hyperplanes: number[][] = []
  const formulas: string[] = []
  for (const [row_idx, row] of system.hyperplanes.entries()) {
    let offset = row[n_axes]
    for (const [axis, value] of fixed) offset += row[axis] * value
    const normal = free_axes.map((axis) => row[axis])
    if (normal.some((coeff) => Math.abs(coeff) > EPS)) {
      hyperplanes.push([...normal, offset])
      formulas.push(system.formulas[row_idx])
    } else if (offset > 1e-9) {
      throw new Error(
        `Slice ${JSON.stringify(slices)} puts ${system.formulas[row_idx]} ` +
          `${offset} eV above its reference: empty region`,
      )
    }
  }
  const lims = free_axes.map((axis) => system.lims[axis])
  return {
    elements: free_axes.map((axis) => system.elements[axis]),
    lims,
    domains: compute_domains(hyperplanes, lims, formulas),
  }
}

// Diagram on the `display` axes: slice the axes named in `slices`, then shadow-project any
// remaining non-display axis by dropping its column
export function section_chempot_system(
  system: ChemPotSystem,
  display: string[],
  slices: ChemPotSliceValues = {},
): ChemPotDiagramData {
  const missing = display.filter((element) => !system.elements.includes(element))
  if (missing.length > 0) {
    throw new Error(`Display axes ${missing.join(`, `)} not in ${system.elements.join(`-`)}`)
  }
  const displayed_slice = display.find((element) => slices[element] !== undefined)
  if (displayed_slice) throw new Error(`Cannot slice display axis ${displayed_slice}`)
  const sliced = slice_system(system, slices)
  const columns = display.map((element) => sliced.elements.indexOf(element))
  const project = (point: number[]) => columns.map((col) => point[col])
  return {
    domains: Object.fromEntries(
      Object.entries(sliced.domains).map(([formula, points]) => [
        formula,
        points.map(project),
      ]),
    ),
    elements: display,
    lims: columns.map((col) => sliced.lims[col]),
    shadow_elements: sliced.elements.filter((element) => !display.includes(element)),
  }
}

// `system` sliced at every slice except `element`'s, with `element`'s axis index in it
function slice_others(
  system: ChemPotSystem,
  slices: ChemPotSliceValues,
  element: string,
): { sliced: ReturnType<typeof slice_system>; axis: number } {
  const sliced = slice_system(system, { ...slices, [element]: undefined })
  const axis = sliced.elements.indexOf(element)
  if (axis === -1) throw new Error(`${element} is not an axis of ${sliced.elements.join(`-`)}`)
  return { sliced, axis }
}

// mu range of `element` worth slicing at, given the other `slices`: its extent over the domain
// vertices of the region they leave (convex, so exactly the feasible interval), ignoring the
// artificial default_min_limit floor and padding the low end like the plotted axes
export function slice_range(
  system: ChemPotSystem,
  element: string,
  padding: number,
  default_min_limit: number,
  slices: ChemPotSliceValues = {},
): Vec2 {
  const { sliced, axis } = slice_others(system, slices, element)
  const values = Object.values(sliced.domains).flatMap((points) =>
    points.map((point) => point[axis]),
  )
  const [lower, upper] = sliced.lims[axis]
  const real = values.filter((val) => !at_min_limit(val, default_min_limit))
  if (real.length === 0) return [lower, upper]
  return [Math.max(lower, array_min(real) - padding), Math.min(upper, array_max(values))]
}

// Points where segments between `points` cross mu_axis = value, with the axis dropped: a
// superset of the section's vertices whose convex hull is the section. Only called between
// vertex heights, so no point lies on the plane.
function section_points(points: number[][], axis: number, value: number): number[][] {
  const below = points.filter((point) => point[axis] < value)
  const above = points.filter((point) => point[axis] > value)
  const cuts: number[][] = []
  for (const low of below) {
    for (const high of above) {
      const frac = (value - low[axis]) / (high[axis] - low[axis])
      const cut = low.map((val, idx) => val + frac * (high[idx] - val))
      cut.splice(axis, 1)
      cuts.push(cut)
    }
  }
  return cuts
}

// Length (2 coords) or area (3 coords, coplanar) of the convex hull of `points`
export function section_measure(points: number[][]): number {
  if (points.length < 2) return 0
  const origin = points[0]
  const farthest = (from: number[]) =>
    points.reduce((best, point) =>
      euclidean_dist(point, from) > euclidean_dist(best, from) ? point : best,
    )
  if (origin.length === 2) {
    // the farthest point from any point is a diameter endpoint on a line
    const end = farthest(origin)
    return euclidean_dist(end, farthest(end))
  }
  const axis_u = subtract(farthest(origin), origin) as Vec3
  // the plane normal from the point farthest off the line through origin along axis_u; zero
  // for collinear points, whose projection onto the fallback basis then has zero area
  let [normal, normal_len]: [Vec3, number] = [[0, 0, 0], 0]
  for (const point of points) {
    const cross = cross_3d(axis_u, subtract(point, origin))
    const len = Math.hypot(...cross)
    if (len > normal_len) [normal, normal_len] = [cross, len]
  }
  const [basis_u, basis_v] = compute_in_plane_basis(normalize_vec(normal))
  const hull = convex_hull_2d(
    points.map((point): Vec2 => [dot(basis_u, point), dot(basis_v, point)]),
  )
  let twice_area = 0
  for (const [idx, [x_1, y_1]] of hull.entries()) {
    const [x_2, y_2] = hull[(idx + 1) % hull.length]
    twice_area += x_1 * y_2 - x_2 * y_1
  }
  return Math.abs(twice_area) / 2
}

// Each domain's cross-section measure (length on 2 display axes, area on 3) as mu_element
// sweeps `range`, every other slice held fixed, as plot-ready [mu, measure] polylines with
// `per_interval` segments between consecutive vertex heights. Exact: between those heights a
// convex polytope's section measure is a polynomial of degree <= 2, pinned down by three
// interior samples; its values at the interval ends are one-sided limits, so the jumps where
// a face lies in a mu_element = const plane show as vertical steps (two points at one mu).
// Null when any axis besides `element` is neither displayed nor sliced: sections are then
// undefined (shadow projection).
export function section_measure_curves(
  system: ChemPotSystem,
  display: string[],
  slices: ChemPotSliceValues,
  element: string,
  range: Vec2,
  per_interval: number = 8,
): Map<string, Vec2[]> | null {
  if (display.includes(element)) throw new Error(`Cannot sweep display axis ${element}`)
  const { sliced, axis } = slice_others(system, slices, element)
  if (sliced.elements.some((other) => other !== element && !display.includes(other)))
    return null
  const [lower, upper] = range
  const merge_tol = 1e-9 * (1 + upper - lower)
  const curves = new Map<string, Vec2[]>()
  for (const [formula, points] of Object.entries(sliced.domains)) {
    const heights = [lower, upper, ...points.map((point) => point[axis])]
      .filter((val) => val >= lower && val <= upper)
      .toSorted((left, right) => left - right)
      .filter((val, idx, sorted) => idx === 0 || val - sorted[idx - 1] > merge_tol)
    const curve: Vec2[] = []
    for (let idx = 1; idx < heights.length; idx++) {
      const [start, span] = [heights[idx - 1], heights[idx] - heights[idx - 1]]
      const [quarter, half, three_quarter] = [0.25, 0.5, 0.75].map((frac) =>
        section_measure(section_points(points, axis, start + frac * span)),
      )
      for (let step = 0; step <= per_interval; step++) {
        const frac = step / per_interval
        // Lagrange basis on nodes 1/4, 1/2, 3/4; clamped since round-off can dip below 0
        const measure =
          8 * (frac - 0.5) * (frac - 0.75) * quarter -
          16 * (frac - 0.25) * (frac - 0.75) * half +
          8 * (frac - 0.25) * (frac - 0.5) * three_quarter
        curve.push([start + frac * span, Math.max(0, measure)])
      }
    }
    if (curve.some(([, measure]) => measure > 0)) curves.set(formula, curve)
  }
  return curves
}
