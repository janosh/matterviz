import type { ElementSymbol } from '$lib'
import type { PhaseEntry, PlotEntry3D, Point3D } from './types'
import { is_elemental_entry } from './utils'

// Corners of tetrahedral coordinate system
export const TETRAHEDRON_VERTICES = [
  [1, 0, 0], // Vertex for element[0] at (1,0,0)
  [0.5, Math.sqrt(3) / 2, 0], // Vertex for element[1]
  [0.5, Math.sqrt(3) / 6, Math.sqrt(6) / 3], // Vertex for element[2]
  [0, 0, 0], // Vertex for element[3] at origin
] as const

// Convert composition to normalized barycentric coordinates for 4 elements
export function composition_to_barycentric_4d(
  composition: Record<string, number>,
  elements: ElementSymbol[],
): number[] {
  if (elements.length !== 4) {
    throw new Error(
      `Quaternary barycentric coordinates require exactly ${4} elements`,
    )
  }

  const amounts = elements.map((el) => composition[el] || 0)
  const total = amounts.reduce((sum, amount) => sum + amount, 0)

  if (total === 0) return Array(4).fill(0.25)
  return amounts.map((amount) => amount / total)
}

// Convert barycentric coordinates to tetrahedral 3D coordinates
export function barycentric_to_tetrahedral(barycentric: number[]): Point3D {
  if (barycentric.length !== 4) {
    throw new Error(
      `Tetrahedral coordinates need ${4}D barycentric input`,
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

// Main function to compute 4D coordinates for quaternary phase diagrams
export function compute_4d_coordinates(
  entries: PhaseEntry[],
  elements: ElementSymbol[],
): PlotEntry3D[] {
  if (elements.length !== 4) {
    throw new Error(
      `Quaternary phase diagram requires exactly ${4} elements`,
    )
  }

  const within_system = entries.filter((entry) =>
    Object.keys(entry.composition).every((el) => (elements as string[]).includes(el))
  )

  return within_system.map((entry) => {
    const barycentric_4d = composition_to_barycentric_4d(entry.composition, elements)
    const tetrahedral = barycentric_to_tetrahedral(barycentric_4d)
    const is_element = is_elemental_entry(entry)

    return { ...entry, ...tetrahedral, is_element, visible: true }
  })
}
