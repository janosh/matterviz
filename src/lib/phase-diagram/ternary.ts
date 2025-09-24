import type { ElementSymbol } from '$lib'
import type { PhaseEntry, Point3D, TernaryPlotEntry } from './types'
import { is_elemental_entry } from './utils'

// Vertices of equilateral triangle in 2D (base of ternary diagram)
export const TRIANGLE_VERTICES = [
  [1, 0], // Vertex for element[0] at (1,0)
  [0.5, Math.sqrt(3) / 2], // Vertex for element[1]
  [0, 0], // Vertex for element[2] at origin
] as const

// Convert composition to normalized barycentric coordinates for 3 elements
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

// Convert barycentric coordinates to triangular 2D coordinates (base of ternary diagram)
export function barycentric_to_triangular(
  barycentric: [number, number, number],
): [number, number] {
  const [a, b, c] = barycentric

  // Convert to Cartesian coordinates on equilateral triangle
  const x = TRIANGLE_VERTICES[0][0] * a + TRIANGLE_VERTICES[1][0] * b +
    TRIANGLE_VERTICES[2][0] * c
  const y = TRIANGLE_VERTICES[0][1] * a + TRIANGLE_VERTICES[1][1] * b +
    TRIANGLE_VERTICES[2][1] * c

  return [x, y]
}

// Convert barycentric coordinates and formation energy to 3D coordinates
export function barycentric_to_ternary_3d(
  barycentric: [number, number, number],
  formation_energy: number,
): Point3D {
  const [x, y] = barycentric_to_triangular(barycentric)

  // Use formation energy directly as z-coordinate
  // Pure elements have formation_energy = 0 (by definition)
  // Stable compounds have negative formation energy (funnel shape)
  return { x, y, z: formation_energy }
}

// Calculate triangle centroid for camera centering
export function get_triangle_centroid(): Point3D {
  const centroid_x =
    (TRIANGLE_VERTICES[0][0] + TRIANGLE_VERTICES[1][0] + TRIANGLE_VERTICES[2][0]) / 3
  const centroid_y =
    (TRIANGLE_VERTICES[0][1] + TRIANGLE_VERTICES[1][1] + TRIANGLE_VERTICES[2][1]) / 3
  return { x: centroid_x, y: centroid_y, z: 0 }
}

// Calculate face normal vector for lighting effects
export function calculate_face_normal(p1: Point3D, p2: Point3D, p3: Point3D): Point3D {
  // Calculate two edge vectors
  const edge1 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z }
  const edge2 = { x: p3.x - p1.x, y: p3.y - p1.y, z: p3.z - p1.z }

  // Calculate cross product for normal
  const normal = {
    x: edge1.y * edge2.z - edge1.z * edge2.y,
    y: edge1.z * edge2.x - edge1.x * edge2.z,
    z: edge1.x * edge2.y - edge1.y * edge2.x,
  }

  // Normalize the vector
  const magnitude = Math.sqrt(normal.x ** 2 + normal.y ** 2 + normal.z ** 2)
  if (magnitude === 0) return { x: 0, y: 0, z: 1 } // Default upward normal

  return {
    x: normal.x / magnitude,
    y: normal.y / magnitude,
    z: normal.z / magnitude,
  }
}

// Calculate face centroid
export function calculate_face_centroid(p1: Point3D, p2: Point3D, p3: Point3D): Point3D {
  return {
    x: (p1.x + p2.x + p3.x) / 3,
    y: (p1.y + p2.y + p3.y) / 3,
    z: (p1.z + p2.z + p3.z) / 3,
  }
}

// Main function to compute ternary 3D coordinates
export function compute_ternary_3d_coordinates(
  entries: PhaseEntry[],
  elements: ElementSymbol[],
): TernaryPlotEntry[] {
  if (elements.length !== 3) {
    throw new Error(
      `Ternary phase diagram requires exactly 3 elements, got ${elements.length}`,
    )
  }

  // Filter entries that contain only elements from our ternary system
  const within_system = entries.filter((entry) =>
    Object.keys(entry.composition).every((el) => (elements as string[]).includes(el))
  )

  const result = within_system.map((entry) => {
    const barycentric = composition_to_barycentric_3d(entry.composition, elements)

    // Use formation energy from entry (should be pre-calculated)
    const formation_energy_per_atom = entry.e_form_per_atom ?? 0

    const { x, y, z } = barycentric_to_ternary_3d(barycentric, formation_energy_per_atom)
    const is_element = is_elemental_entry(entry)

    return {
      ...entry,
      x,
      y,
      z,
      barycentric,
      formation_energy: formation_energy_per_atom,
      is_element,
      visible: true,
    }
  })

  return result
}

// Get triangle edge lines for rendering the base triangle
export function get_triangle_edges(): Array<[Point3D, Point3D]> {
  const vertices = TRIANGLE_VERTICES.map(([x, y]) => ({ x, y, z: 0 }))

  return [
    [vertices[0], vertices[1]], // Edge 0-1
    [vertices[1], vertices[2]], // Edge 1-2
    [vertices[2], vertices[0]], // Edge 2-0
  ]
}

// Project triangle vertices to 3D for vertical edge rendering
export function get_triangle_vertical_edges(
  min_z: number,
  max_z: number,
): Array<[Point3D, Point3D]> {
  const vertices = TRIANGLE_VERTICES.map(([x, y]) => ({ x, y, z: 0 }))

  return vertices.map((vertex) => [
    { ...vertex, z: min_z },
    { ...vertex, z: max_z },
  ])
}
