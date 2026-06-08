import type { ElementSymbol } from '$lib/element'
import type { Point3D, Vec2, Vec3 } from '$lib/math'
import { compute_e_form_per_atom, find_lowest_energy_unary_refs } from './thermodynamics'
import type { ConvexHullEntry, PhaseData } from './types'
import { is_unary_entry } from './helpers'

// --- Ternary coordinates ---

export const TRIANGLE_VERTICES = [
  [1, 0],
  [0.5, Math.sqrt(3) / 2],
  [0, 0],
] as const

export function composition_to_barycentric_3d(
  composition: Record<string, number>,
  elements: ElementSymbol[],
): Vec3 {
  if (elements.length !== 3) {
    throw new Error(`Ternary system requires exactly 3 elements, got ${elements.length}`)
  }
  return composition_to_barycentric_nd(composition, elements) as Vec3
}

// map barycentric coordinates to triangular 2D coordinates
export function barycentric_to_ternary_xy(barycentric: Vec3): Vec2 {
  const [v0, v1, v2] = TRIANGLE_VERTICES
  const [a, b, c] = barycentric
  const x = v0[0] * a + v1[0] * b + v2[0] * c
  const y = v0[1] * a + v1[1] * b + v2[1] * c
  return [x, y]
}

// map barycentric coordinates to ternary 3D coordinates
export function barycentric_to_ternary_xyz(
  barycentric: Vec3,
  formation_energy: number,
): Point3D {
  const [x, y] = barycentric_to_ternary_xy(barycentric)
  return { x, y, z: formation_energy }
}

export function get_triangle_centroid(): Point3D {
  const [v0, v1, v2] = TRIANGLE_VERTICES
  const centroid_x = (v0[0] + v1[0] + v2[0]) / 3
  const centroid_y = (v0[1] + v1[1] + v2[1]) / 3
  return { x: centroid_x, y: centroid_y, z: 0 }
}

export function get_ternary_3d_coordinates(
  entries: PhaseData[],
  elements: ElementSymbol[],
  el_refs?: Record<string, PhaseData>, // Optional: pass precomputed refs to avoid recomputing
): ConvexHullEntry[] {
  if (elements.length !== 3) {
    throw new Error(`Ternary convex hull requires exactly 3 elements, got ${elements.length}`)
  }

  // Filter to entries within the ternary system first (use Set for O(1) lookups)
  const element_set = new Set(elements)
  const within_system = entries.filter((entry) =>
    Object.keys(entry.composition).every((el) => element_set.has(el as ElementSymbol)),
  )

  if (within_system.length === 0) {
    throw new Error(`No entries found within the ternary system: ${elements.join(`-`)}`)
  }

  // Check if we have formation energies - provide detailed diagnostics if missing
  const entries_with_e_form = within_system.filter(
    (entry) =>
      typeof entry.e_form_per_atom === `number` && Number.isFinite(entry.e_form_per_atom),
  )

  // If none have e_form_per_atom, try to derive them using refs; only error if we can't
  const refs = el_refs ?? find_lowest_energy_unary_refs(entries)
  if (entries_with_e_form.length === 0) {
    const missing_refs = elements.filter((el) => !refs[el])
    if (missing_refs.length > 0) {
      throw new Error(
        [
          `Ternary convex hull requires formation energies (e_form_per_atom) for z-axis positioning, but none of the ${within_system.length} entries in the ${elements.join(
            `-`,
          )} system have this field.`,
          `\nCannot compute formation energies because elemental references are missing for: ${missing_refs.join(
            `, `,
          )}.`,
          `To fix: Ensure your dataset includes stable unary (single-element) entries for each element.`,
        ].join(`\n`),
      )
    }
    // proceed; values will be computed during mapping below
  }

  // Map entries to ternary plot coordinates
  const result = within_system.map((entry) => {
    const barycentric = composition_to_barycentric_3d(entry.composition, elements)
    const e_form_per_atom =
      typeof entry.e_form_per_atom === `number` && Number.isFinite(entry.e_form_per_atom)
        ? entry.e_form_per_atom
        : (compute_e_form_per_atom(entry, refs) ?? NaN)
    const xyz = barycentric_to_ternary_xyz(barycentric, e_form_per_atom)
    const is_element = is_unary_entry(entry)
    return { ...entry, ...xyz, is_element }
  })
  return result
}

export function get_triangle_edges(): [Point3D, Point3D][] {
  const [v0, v1, v2] = TRIANGLE_VERTICES.map(([x, y]) => ({ x, y, z: 0 }))
  return [
    [v0, v1],
    [v1, v2],
    [v2, v0],
  ]
}

export function get_triangle_vertical_edges(
  min_z: number,
  max_z: number,
): [Point3D, Point3D][] {
  const vertices = TRIANGLE_VERTICES.map(([x, y]) => ({ x, y, z: 0 }))
  return vertices.map((vertex) => [
    { ...vertex, z: min_z },
    { ...vertex, z: max_z },
  ])
}

// --- N-dimensional barycentric coordinates (the 3D/4D converters wrap this) ---

// Convert composition to N-dimensional barycentric coordinates
// Returns array of length N where coords sum to 1 (all N coords are explicit)
// The last coordinate represents formation energy when used in hull calculations
export function composition_to_barycentric_nd(
  composition: Record<string, number>,
  elements: ElementSymbol[],
): number[] {
  const n_elems = elements.length
  if (n_elems < 2) {
    throw new Error(`Barycentric coordinates require at least 2 elements, got ${n_elems}`)
  }
  // NaN and undefined/missing elements are treated as 0
  const amounts = elements.map((el) => {
    const val = composition[el]
    return val == null || Number.isNaN(val) ? 0 : val
  })
  let total = 0
  const negative: string[] = []
  for (let idx = 0; idx < amounts.length; idx++) {
    if (amounts[idx] < 0) negative.push(elements[idx])
    else total += amounts[idx]
  }
  if (negative.length > 0) {
    throw new Error(`Composition contains negative amounts for: ${negative.join(`, `)}`)
  }
  if (total === 0) {
    throw new Error(`Composition has no elements from the system: ${elements.join(`-`)}`)
  }
  return amounts.map((amount) => amount / total)
}

// --- Quaternary coordinates ---
export const TETRAHEDRON_VERTICES = [
  [1, 0, 0],
  [0.5, Math.sqrt(3) / 2, 0],
  [0.5, Math.sqrt(3) / 6, Math.sqrt(6) / 3],
  [0, 0, 0],
] as const

export function composition_to_barycentric_4d(
  composition: Record<string, number>,
  elements: ElementSymbol[],
): number[] {
  if (elements.length !== 4) {
    throw new Error(`Quaternary barycentric coordinates require exactly 4 elements`)
  }
  return composition_to_barycentric_nd(composition, elements)
}

// map barycentric coordinates to tetrahedral 3D coordinates
export function barycentric_to_tetrahedral(barycentric: number[]): Point3D {
  if (barycentric.length !== 4) {
    throw new Error(
      `Tetrahedral coordinates require exactly 4D barycentric input, got ${barycentric.length}`,
    )
  }
  let [x, y, z] = [0, 0, 0]
  for (let idx = 0; idx < 4; idx++) {
    x += barycentric[idx] * TETRAHEDRON_VERTICES[idx][0]
    y += barycentric[idx] * TETRAHEDRON_VERTICES[idx][1]
    z += barycentric[idx] * TETRAHEDRON_VERTICES[idx][2]
  }
  return { x, y, z }
}

export function compute_4d_coords(
  entries: PhaseData[],
  elements: ElementSymbol[],
): ConvexHullEntry[] {
  if (elements.length !== 4) {
    throw new Error(`Quaternary convex hull requires exactly 4 elements`)
  }
  // Use Set for O(1) lookups instead of O(n) includes
  const element_set = new Set(elements)
  const within_system = entries.filter((entry) =>
    Object.keys(entry.composition).every((el) => element_set.has(el as ElementSymbol)),
  )
  return within_system.map((entry) => {
    const barycentric_4d = composition_to_barycentric_4d(entry.composition, elements)
    const tetrahedral = barycentric_to_tetrahedral(barycentric_4d)
    const is_element = is_unary_entry(entry)
    return { ...entry, ...tetrahedral, is_element }
  })
}
