import type { ElementSymbol } from '$lib'
import type { PhaseEntry, PlotEntry3D, Point3D, TernaryPlotEntry } from './types.ts'
import { is_unary_entry } from './types.ts'

// ================= Ternary coordinates =================

export const TRIANGLE_VERTICES = [
  [1, 0],
  [0.5, Math.sqrt(3) / 2],
  [0, 0],
] as const

export function composition_to_barycentric_3d(
  composition: Record<string, number>,
  elements: ElementSymbol[],
): [number, number, number] {
  if (elements.length !== 3) {
    throw new Error(`Ternary system requires exactly 3 elements, got ${elements.length}`)
  }
  const amounts = elements.map((el) => composition[el] || 0)
  const total = amounts.reduce((sum, amt) => sum + amt, 0)
  if (total === 0) {
    throw new Error(
      `Composition has no elements from the ternary system: ${elements.join(`-`)}`,
    )
  }
  const normalized = amounts.map((amount) => amount / total)
  return [normalized[0], normalized[1], normalized[2]]
}

// map barycentric coordinates to triangular 2D coordinates
export function barycentric_to_ternary_xy(
  barycentric: [number, number, number],
): [number, number] {
  const [a, b, c] = barycentric
  const x = TRIANGLE_VERTICES[0][0] * a + TRIANGLE_VERTICES[1][0] * b +
    TRIANGLE_VERTICES[2][0] * c
  const y = TRIANGLE_VERTICES[0][1] * a + TRIANGLE_VERTICES[1][1] * b +
    TRIANGLE_VERTICES[2][1] * c
  return [x, y]
}

// map barycentric coordinates to ternary 3D coordinates
export function barycentric_to_ternary_xyz(
  barycentric: [number, number, number],
  formation_energy: number,
): Point3D {
  const [x, y] = barycentric_to_ternary_xy(barycentric)
  return { x, y, z: formation_energy }
}

export function get_triangle_centroid(): Point3D {
  const centroid_x =
    (TRIANGLE_VERTICES[0][0] + TRIANGLE_VERTICES[1][0] + TRIANGLE_VERTICES[2][0]) / 3
  const centroid_y =
    (TRIANGLE_VERTICES[0][1] + TRIANGLE_VERTICES[1][1] + TRIANGLE_VERTICES[2][1]) / 3
  return { x: centroid_x, y: centroid_y, z: 0 }
}

export function calculate_face_normal(p1: Point3D, p2: Point3D, p3: Point3D): Point3D {
  const edge1 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z }
  const edge2 = { x: p3.x - p1.x, y: p3.y - p1.y, z: p3.z - p1.z }
  const normal = {
    x: edge1.y * edge2.z - edge1.z * edge2.y,
    y: edge1.z * edge2.x - edge1.x * edge2.z,
    z: edge1.x * edge2.y - edge1.y * edge2.x,
  }
  const magnitude = Math.sqrt(normal.x ** 2 + normal.y ** 2 + normal.z ** 2)
  if (magnitude === 0) return { x: 0, y: 0, z: 1 }
  return { x: normal.x / magnitude, y: normal.y / magnitude, z: normal.z / magnitude }
}

export function calculate_face_centroid(p1: Point3D, p2: Point3D, p3: Point3D): Point3D {
  return {
    x: (p1.x + p2.x + p3.x) / 3,
    y: (p1.y + p2.y + p3.y) / 3,
    z: (p1.z + p2.z + p3.z) / 3,
  }
}

export function get_ternary_3d_coordinates(
  entries: PhaseEntry[],
  elements: ElementSymbol[],
): TernaryPlotEntry[] {
  if (elements.length !== 3) {
    throw new Error(
      `Ternary phase diagram requires exactly 3 elements, got ${elements.length}`,
    )
  }
  if (!(`e_form_per_atom` in entries[0])) {
    throw new Error(`Ternary phase diagram requires e_form_per_atom field`)
  }
  const within_system = entries.filter((entry) =>
    Object.keys(entry.composition).every((el) => elements.includes(el as ElementSymbol))
  )
  const result = within_system.map((entry) => {
    const barycentric = composition_to_barycentric_3d(entry.composition, elements)
    const { x, y, z } = barycentric_to_ternary_xyz(
      barycentric,
      entry.e_form_per_atom ?? NaN,
    )
    const is_element = is_unary_entry(entry)
    return {
      ...entry,
      x,
      y,
      z,
      barycentric,
      formation_energy: entry.e_form_per_atom ?? NaN,
      is_element,
      visible: true,
    }
  })
  return result
}

export function get_triangle_edges(): [Point3D, Point3D][] {
  const [v0, v1, v2] = TRIANGLE_VERTICES.map(([x, y]) => ({ x, y, z: 0 }))
  return [[v0, v1], [v1, v2], [v2, v0]]
}

export function get_triangle_vertical_edges(
  min_z: number,
  max_z: number,
): [Point3D, Point3D][] {
  const vertices = TRIANGLE_VERTICES.map(([x, y]) => ({ x, y, z: 0 }))
  return vertices.map((vertex) => [{ ...vertex, z: min_z }, { ...vertex, z: max_z }])
}

// ================= Quaternary coordinates =================

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
    throw new Error(`Quaternary barycentric coordinates require exactly ${4} elements`)
  }
  const amounts = elements.map((el) => composition[el] || 0)
  const total = amounts.reduce((sum, amount) => sum + amount, 0)
  if (total === 0) {
    throw new Error(
      `Composition has no elements from the quaternary system: ${elements.join(`-`)}`,
    )
  }
  return amounts.map((amount) => amount / total)
}

// map barycentric coordinates to tetrahedral 3D coordinates
export function barycentric_to_tetrahedral(barycentric: number[]): Point3D {
  if (barycentric.length !== 4) {
    throw new Error(`Tetrahedral coordinates need ${4}D barycentric input`)
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
  entries: PhaseEntry[],
  elements: ElementSymbol[],
): PlotEntry3D[] {
  if (elements.length !== 4) {
    throw new Error(`Quaternary phase diagram requires exactly ${4} elements`)
  }
  const within_system = entries.filter((entry) =>
    Object.keys(entry.composition).every((el) => (elements as string[]).includes(el))
  )
  return within_system.map((entry) => {
    const barycentric_4d = composition_to_barycentric_4d(
      entry.composition,
      elements,
    )
    const tetrahedral = barycentric_to_tetrahedral(barycentric_4d)
    const is_element = is_unary_entry(entry)
    return { ...entry, ...tetrahedral, is_element, visible: true }
  })
}
