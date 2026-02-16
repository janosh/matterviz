// Core computational logic for chemical potential diagrams.
// Ports pymatgen's ChemicalPotentialDiagram algorithm to TypeScript.
// Reference: pymatgen/analysis/chempot_diagram.py

import { count_atoms_in_composition, get_reduced_formula } from '$lib/composition'
import type { PhaseData } from '$lib/convex-hull/types'
import {
  convex_hull_2d,
  EPS,
  polygon_centroid,
  solve_linear_system,
  type Vec2,
} from '$lib/math'
import {
  CHEMPOT_DEFAULTS,
  type ChemPotDiagramConfig,
  type ChemPotDiagramData,
} from './types'

// === Entry Helpers ===

// Get energy per atom for a PhaseData entry
export function get_energy_per_atom(entry: PhaseData): number {
  if (typeof entry.energy_per_atom === `number`) return entry.energy_per_atom
  const atoms = count_atoms_in_composition(entry.composition)
  if (atoms <= 0) {
    throw new Error(
      `Invalid composition with non-positive atom count: ${
        JSON.stringify(entry.composition)
      }`,
    )
  }
  return entry.energy / atoms
}

// Cache for reduced formula strings -- avoids recomputing get_reduced_formula
// in hot loops. Key is object identity (WeakMap), value is the formula string.
const formula_cache = new WeakMap<Record<string, number>, string>()

// Get a stable reduced formula string from composition dict (cached)
export function formula_key_from_composition(
  composition: Record<string, number>,
): string {
  const cached = formula_cache.get(composition)
  if (cached) return cached
  const reduced = get_reduced_formula(composition)
  const key = Object.entries(reduced)
    .filter(([, amt]) => amt > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([el, amt]) => (amt === 1 ? el : `${el}${amt}`))
    .join(``)
  formula_cache.set(composition, key)
  return key
}

// === Core Algorithm ===

// Group entries by reduced formula, keep only the minimum-energy entry per composition.
// Also extract elemental reference entries.
export function get_min_entries_and_el_refs(
  entries: PhaseData[],
): { min_entries: PhaseData[]; el_refs: Record<string, PhaseData> } {
  const by_formula = new Map<string, PhaseData>()

  for (const entry of entries) {
    const key = formula_key_from_composition(entry.composition)
    const existing = by_formula.get(key)
    if (!existing || get_energy_per_atom(entry) < get_energy_per_atom(existing)) {
      by_formula.set(key, entry)
    }
  }

  const min_entries = Array.from(by_formula.values())
  const el_refs: Record<string, PhaseData> = {}

  for (const entry of min_entries) {
    const positive = Object.entries(entry.composition).filter(([, amt]) => amt > 0)
    if (positive.length === 1) el_refs[positive[0][0]] = entry
  }

  return { min_entries, el_refs }
}

// Renormalize entry energies to be relative to elemental references (formal chemical potentials).
// For each entry, subtracts sum(x_i * E_ref_i) from its energy per atom.
export function renormalize_entries(
  entries: PhaseData[],
  el_refs: Record<string, PhaseData>,
  elements: string[],
): PhaseData[] {
  return entries.map((entry) => {
    const atoms = count_atoms_in_composition(entry.composition)
    let renorm_energy = 0
    for (const el of elements) {
      const frac = atoms > 0
        ? ((entry.composition as Record<string, number>)[el] ?? 0) / atoms
        : 0
      const ref = el_refs[el]
      if (ref) renorm_energy += frac * get_energy_per_atom(ref)
    }
    const new_energy_per_atom = get_energy_per_atom(entry) - renorm_energy
    return {
      ...entry,
      energy: new_energy_per_atom * atoms,
      energy_per_atom: new_energy_per_atom,
    }
  })
}

// Build hyperplane representation for minimum entries.
// Each row is [x_1, ..., x_n, -E_per_atom].
// Filters to entries with negative formation energy plus all elemental refs.
export function build_hyperplanes(
  min_entries: PhaseData[],
  el_refs: Record<string, PhaseData>,
  elements: string[],
): { hyperplanes: number[][]; hyperplane_entries: PhaseData[] } {
  const n_elems = elements.length
  // Build data matrix: [atomic_fracs..., energy_per_atom]
  const data = min_entries.map((entry) => {
    const atoms = count_atoms_in_composition(entry.composition)
    const comp = entry.composition as Record<string, number>
    const row = elements.map((el) => atoms > 0 ? (comp[el] ?? 0) / atoms : 0)
    row.push(get_energy_per_atom(entry))
    return row
  })

  // Formation energy vector: ref_energies per atom for each element, then -1
  const vec = elements.map((el) => {
    const ref = el_refs[el]
    return ref ? get_energy_per_atom(ref) : 0
  })
  vec.push(-1)

  // form_e = -dot(data_row, vec) for each entry
  const form_energies = data.map((row) => {
    let val = 0
    for (let idx = 0; idx < row.length; idx++) val += row[idx] * vec[idx]
    return -val
  })

  // Keep entries with negative formation energy or elemental refs (use Set for O(1) lookup)
  const tol = 1e-6 // PhaseDiagram.formation_energy_tol
  const index_set = new Set<number>()

  for (let idx = 0; idx < form_energies.length; idx++) {
    if (form_energies[idx] < -tol) index_set.add(idx)
  }
  // Always include elemental references
  for (const ref of Object.values(el_refs)) {
    const ref_idx = min_entries.indexOf(ref)
    if (ref_idx >= 0) index_set.add(ref_idx)
  }

  const indices = Array.from(index_set)
  const hyperplanes = indices.map((idx) => {
    const row = [...data[idx]]
    row[n_elems] *= -1 // negate energy column
    return row
  })

  return {
    hyperplanes,
    hyperplane_entries: indices.map((idx) => min_entries[idx]),
  }
}

// Build border hyperplanes from per-element limits.
// For each axis with limits [lo, hi], creates two halfspace rows.
export function build_border_hyperplanes(lims: [number, number][]): number[][] {
  const dim = lims.length
  const borders: number[][] = []
  for (let idx = 0; idx < dim; idx++) {
    // Lower bound: -mu_i + lo <= 0 → [-1, 0, ..., lo]
    const lower = new Array(dim + 1).fill(0)
    lower[idx] = -1
    lower[dim] = lims[idx][0]
    borders.push(lower)

    // Upper bound: mu_i - hi <= 0 → [1, 0, ..., -hi]
    const upper = new Array(dim + 1).fill(0)
    upper[idx] = 1
    upper[dim] = -lims[idx][1]
    borders.push(upper)
  }
  return borders
}

// Inline 2x2 linear solve (Cramer's rule). Returns false if singular.
// Writes solution into out[0], out[1].
function solve_2x2(
  a00: number,
  a01: number,
  b0: number,
  a10: number,
  a11: number,
  b1: number,
  out: number[],
): boolean {
  const det = a00 * a11 - a01 * a10
  if (Math.abs(det) < EPS) return false
  out[0] = (b0 * a11 - b1 * a01) / det
  out[1] = (a00 * b1 - a10 * b0) / det
  return true
}

// Inline 3x3 linear solve via Cramer's rule. Returns false if singular.
// Takes three halfspace rows directly to avoid array allocation in the hot loop.
function solve_3x3(
  a: number[],
  b: number[],
  c: number[],
  offsets: number[],
  out: number[],
): boolean {
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  if (Math.abs(det) < EPS) return false
  const inv = 1 / det
  out[0] = (offsets[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (offsets[1] * c[2] - b[2] * offsets[2]) +
    a[2] * (offsets[1] * c[1] - b[1] * offsets[2])) * inv
  out[1] = (a[0] * (offsets[1] * c[2] - b[2] * offsets[2]) -
    offsets[0] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * offsets[2] - offsets[1] * c[0])) * inv
  out[2] = (a[0] * (b[1] * offsets[2] - offsets[1] * c[1]) -
    a[1] * (b[0] * offsets[2] - offsets[1] * c[0]) +
    offsets[0] * (b[0] * c[1] - b[1] * c[0])) * inv
  return true
}

// Compute chemical potential domains via vertex enumeration.
// This replaces scipy's HalfspaceIntersection.
// For each combination of dim halfspaces, solves the linear system to find a
// candidate vertex, checks feasibility against all halfspaces, then assigns
// vertices to the phases whose hyperplanes are active at that vertex.
export function compute_domains(
  hyperplanes: number[][],
  border_hyperplanes: number[][],
  hyperplane_entries: PhaseData[],
  dim: number,
): Record<string, number[][]> {
  const n_entries = hyperplanes.length
  const all_hs = [...hyperplanes, ...border_hyperplanes]
  const n_total = all_hs.length
  const tol = 1e-6

  // Pre-compute formula keys for entry hyperplanes (avoid repeated work in hot loop)
  const entry_formulas = hyperplane_entries.map((entry) =>
    formula_key_from_composition(entry.composition)
  )

  const domains: Record<string, number[][]> = {}
  for (const formula of entry_formulas) {
    if (!domains[formula]) domains[formula] = []
  }

  // Pre-allocate reusable buffers to avoid GC pressure in the combo loop
  const mu = new Array(dim).fill(0)
  const offsets = new Array(dim).fill(0)
  // For dim <= 3, use inline solvers; for larger dims, build A on the fly
  const A_rows: number[][] = dim > 3
    ? Array.from({ length: dim }, () => new Array(dim).fill(0))
    : []

  // Generate all combinations of dim indices from n_total halfspaces
  const combo = new Array(dim).fill(0)
  for (let idx = 0; idx < dim; idx++) combo[idx] = idx

  while (true) {
    // Compute offsets (negated last column of selected halfspaces)
    for (let row = 0; row < dim; row++) offsets[row] = -all_hs[combo[row]][dim]

    // Solve for vertex using dimension-specialized solvers
    let solved = false
    if (dim === 2) {
      const h0 = all_hs[combo[0]]
      const h1 = all_hs[combo[1]]
      solved = solve_2x2(h0[0], h0[1], offsets[0], h1[0], h1[1], offsets[1], mu)
    } else if (dim === 3) {
      solved = solve_3x3(
        all_hs[combo[0]],
        all_hs[combo[1]],
        all_hs[combo[2]],
        offsets,
        mu,
      )
    } else {
      // General case: build A matrix and use LU solver
      for (let row = 0; row < dim; row++) {
        const hs = all_hs[combo[row]]
        for (let col = 0; col < dim; col++) A_rows[row][col] = hs[col]
      }
      const result = solve_linear_system(A_rows, offsets)
      if (result) {
        for (let idx = 0; idx < dim; idx++) mu[idx] = result[idx]
        solved = true
      }
    }

    if (solved) {
      // Feasibility check: all halfspaces must be satisfied (a·mu + b <= tol)
      for (let idx = 0; idx < n_total; idx++) {
        const hs = all_hs[idx]
        let val = hs[dim]
        for (let jdx = 0; jdx < dim; jdx++) val += hs[jdx] * mu[jdx]
        if (val > tol) {
          solved = false
          break
        }
      }

      if (solved) {
        // Assign vertex to entries whose hyperplanes are active
        for (let idx = 0; idx < dim; idx++) {
          const hs_idx = combo[idx]
          if (hs_idx < n_entries) {
            domains[entry_formulas[hs_idx]].push([...mu])
          }
        }
      }
    }

    // Advance to next combination (lexicographic order)
    let pos = dim - 1
    while (pos >= 0 && combo[pos] >= n_total - dim + pos) pos--
    if (pos < 0) break
    combo[pos]++
    for (let idx = pos + 1; idx < dim; idx++) combo[idx] = combo[idx - 1] + 1
  }

  // Remove empty domains
  for (const key of Object.keys(domains)) {
    if (domains[key].length === 0) delete domains[key]
  }

  return domains
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
  return mins.map((min_val) =>
    (Number.isFinite(min_val) ? min_val : default_min_limit) - padding
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
    const axis_vals = points.map((point) => point[axis_idx])
    return {
      element: element ?? `\u03BC${axis_idx}`,
      min_val: Math.min(...axis_vals),
      max_val: Math.max(...axis_vals),
    }
  })
}

// === Label Placement Helpers ===

// Simple PCA: center data, compute covariance, eigendecompose, project to top-k.
// Used in 3D for finding domain polygon orientation for label placement.
export function simple_pca(
  data: number[][],
  k: number = 2,
): { scores: number[][]; eigenvectors: number[][] } {
  const n_rows = data.length
  const n_cols = data[0]?.length ?? 0
  if (n_rows === 0 || n_cols === 0) {
    return { scores: [], eigenvectors: [] }
  }

  // Center the data
  const means = new Array(n_cols).fill(0)
  for (const row of data) {
    for (let col = 0; col < n_cols; col++) means[col] += row[col]
  }
  for (let col = 0; col < n_cols; col++) means[col] /= n_rows

  const centered = data.map((row) => row.map((val, col) => val - means[col]))

  // Covariance matrix
  const cov: number[][] = Array.from({ length: n_cols }, () => new Array(n_cols).fill(0))
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

  // Power iteration for top-k eigenvectors (sufficient for k=2 on small matrices)
  const eigenvectors: number[][] = []
  const work_cov = cov.map((row) => [...row])

  for (let comp = 0; comp < k; comp++) {
    let vec = new Array(n_cols).fill(0)
    vec[comp % n_cols] = 1 // initial guess

    for (let iter = 0; iter < 100; iter++) {
      // Matrix-vector multiply
      const new_vec = new Array(n_cols).fill(0)
      for (let idx = 0; idx < n_cols; idx++) {
        for (let jdx = 0; jdx < n_cols; jdx++) {
          new_vec[idx] += work_cov[idx][jdx] * vec[jdx]
        }
      }

      // Normalize
      const norm = Math.hypot(...new_vec)
      if (norm < EPS) break
      vec = new_vec.map((val) => val / norm)
    }

    // Rayleigh quotient for deflation
    const eigenvalue = vec.reduce((sum, val, idx) => {
      let mv = 0
      for (let jdx = 0; jdx < n_cols; jdx++) mv += work_cov[idx][jdx] * vec[jdx]
      return sum + val * mv
    }, 0)

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
    eigenvectors.map((ev) => row.reduce((sum, val, idx) => sum + val * ev[idx], 0))
  )

  return { scores, eigenvectors }
}

// Compute orthonormal vector to a 2D line segment (for label offset in 2D diagrams)
export function orthonormal_2d(line_pts: number[][]): [number, number] {
  const x_diff = Math.abs(line_pts[1][0] - line_pts[0][0])
  const y_diff = Math.abs(line_pts[1][1] - line_pts[0][1])
  const theta = x_diff < EPS ? Math.PI / 2 : Math.atan(y_diff / x_diff)
  return [Math.sin(theta), Math.cos(theta)]
}

// Deduplicate points within tolerance, returning unique points and index mapping
function dedup_points(pts: number[][], tol: number = 1e-4): {
  unique: number[][]
  orig_indices: number[] // for each unique point, the index in the original array
} {
  const unique: number[][] = []
  const orig_indices: number[] = []
  for (let idx = 0; idx < pts.length; idx++) {
    const pt = pts[idx]
    const is_dup = unique.some((u) =>
      u.every((val, dim) => Math.abs(val - pt[dim]) < tol)
    )
    if (!is_dup) {
      unique.push(pt)
      orig_indices.push(idx)
    }
  }
  return { unique, orig_indices }
}

// For a 3D domain, compute convex hull boundary edges and annotation location.
// Deduplicates vertices first, then uses PCA to project to 2D for the convex
// hull computation. Returns only the outer boundary edges, not interior lines.
export function get_3d_domain_simplexes_and_ann_loc(
  points_3d: number[][],
): { simplex_indices: number[][]; ann_loc: number[] } {
  // Deduplicate vertices to avoid cluttered interior edges
  const { unique, orig_indices } = dedup_points(points_3d)

  if (unique.length < 3) {
    const center = unique[0] ?? points_3d[0] ?? [0, 0, 0]
    if (unique.length === 2) {
      return { simplex_indices: [[orig_indices[0], orig_indices[1]]], ann_loc: center }
    }
    return { simplex_indices: [], ann_loc: center }
  }

  const { scores, eigenvectors } = simple_pca(unique, 2)

  // 2D convex hull of PCA-projected unique points → only boundary edges
  const pts_2d: Vec2[] = scores.map((row) => [row[0], row[1]])
  const hull = convex_hull_2d(pts_2d)
  const centroid = polygon_centroid(hull)

  // Map centroid back to 3D
  const n_dims = unique[0].length
  const mean_3d = Array.from(
    { length: n_dims },
    (_, dim) => unique.reduce((sum, pt) => sum + pt[dim], 0) / unique.length,
  )
  const centroid_x = centroid[0] ?? 0
  const centroid_y = centroid[1] ?? 0
  const first_eigenvector = eigenvectors[0] ?? new Array(n_dims).fill(0)
  const second_eigenvector = eigenvectors[1] ?? new Array(n_dims).fill(0)
  const ann_loc = mean_3d.map((m, dim) =>
    m + centroid_x * first_eigenvector[dim] + centroid_y * second_eigenvector[dim]
  )

  // Map hull vertices back to original point indices using nearest projected
  // vertex instead of stringified coordinates to avoid precision aliasing.
  function nearest_projected_idx(target: Vec2): number {
    let nearest_idx = 0
    let min_sq_dist = Infinity
    for (let idx = 0; idx < pts_2d.length; idx++) {
      const dx = pts_2d[idx][0] - target[0]
      const dy = pts_2d[idx][1] - target[1]
      const sq_dist = dx * dx + dy * dy
      if (sq_dist < min_sq_dist) {
        min_sq_dist = sq_dist
        nearest_idx = idx
      }
    }
    return nearest_idx
  }

  const simplex_indices: number[][] = []
  for (let hull_idx = 0; hull_idx < hull.length; hull_idx++) {
    const pt_a = hull[hull_idx]
    const pt_b = hull[(hull_idx + 1) % hull.length]
    const ui_a = nearest_projected_idx(pt_a)
    const ui_b = nearest_projected_idx(pt_b)
    // Map back to original array indices
    simplex_indices.push([orig_indices[ui_a], orig_indices[ui_b]])
  }

  return { simplex_indices, ann_loc }
}

// === Main Pipeline ===

// Compute the full chemical potential diagram from entries and config.
// Returns domains, elements, refs, and all intermediate data.
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

  // Detect all unique elements across all input entries
  const all_data_elements = Array.from(
    new Set(
      entries.flatMap((entry) =>
        Object.entries(entry.composition).filter(([, amt]) => amt > 0).map(([el]) => el)
      ),
    ),
  ).sort()

  // Display elements: user-specified order (controls axis mapping), or auto-detect
  const display_elements = config.elements?.length
    ? [...config.elements]
    : all_data_elements

  // Projection mode: display fewer axes than the data has elements
  // In this mode, compute in full N-D and project afterward
  const is_projection = display_elements.length < all_data_elements.length &&
    display_elements.every((el) => all_data_elements.includes(el))

  // Computation elements: full element set for projection, display set for subsystem
  const compute_elements = is_projection ? all_data_elements : display_elements

  // In subsystem mode, filter entries to only those within the element set
  let working_entries = entries
  if (!is_projection && config.elements?.length) {
    const target_set = new Set(config.elements)
    working_entries = entries.filter((entry) =>
      Object.entries(entry.composition)
        .filter(([, amt]) => amt > 0)
        .every(([el]) => target_set.has(el))
    )
  }

  // Sort entries by composition (Schwartzian transform to avoid recomputing keys)
  const sorted_entries = working_entries
    .map((entry) => ({ entry, key: formula_key_from_composition(entry.composition) }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ entry }) => entry)

  // Get min entries and elemental references
  let { min_entries, el_refs } = get_min_entries_and_el_refs(sorted_entries)

  const dim = compute_elements.length
  if (dim < 2) {
    throw new Error(`ChemicalPotentialDiagram requires 2+ elements, got ${dim}`)
  }

  // Check all elemental refs exist for the computation elements
  const missing_refs = compute_elements.filter((el) => !el_refs[el])
  if (missing_refs.length > 0) {
    throw new Error(`Missing elemental reference entries for: ${missing_refs.join(`, `)}`)
  }

  // Renormalize if using formal chemical potentials
  if (formal_chempots) {
    min_entries = renormalize_entries(min_entries, el_refs, compute_elements)
    const renorm_result = get_min_entries_and_el_refs(min_entries)
    el_refs = renorm_result.el_refs
  }

  // Build limits array for computation elements
  const compute_lims: [number, number][] = compute_elements.map((el) => {
    if (limits?.[el]) return limits[el]
    return [default_min_limit, 0]
  })

  // Build hyperplanes and compute domains in full dimensionality
  const { hyperplanes, hyperplane_entries } = build_hyperplanes(
    min_entries,
    el_refs,
    compute_elements,
  )

  const border_hyperplanes = build_border_hyperplanes(compute_lims)

  let domains = compute_domains(
    hyperplanes,
    border_hyperplanes,
    hyperplane_entries,
    dim,
  )

  // Project domain vertices from N-D to display axes (column extraction)
  let output_lims = compute_lims
  if (is_projection) {
    const col_indices = display_elements.map((el) => compute_elements.indexOf(el))
    const projected: Record<string, number[][]> = {}
    for (const [formula, pts] of Object.entries(domains)) {
      projected[formula] = pts.map((pt) => col_indices.map((idx) => pt[idx]))
    }
    domains = projected
    output_lims = col_indices.map((idx) => compute_lims[idx])
  }

  return {
    domains,
    elements: display_elements,
    el_refs,
    min_entries,
    hyperplanes,
    hyperplane_entries,
    lims: output_lims,
  }
}
