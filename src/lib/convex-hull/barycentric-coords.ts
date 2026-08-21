import type { ElementSymbol } from '$lib/element'

// Corners of the composition simplex each diagram plots into: a unit segment for binaries,
// an equilateral triangle for ternaries, a regular tetrahedron for quaternaries.
export const TRIANGLE_VERTICES = [
  [1, 0],
  [0.5, Math.sqrt(3) / 2],
  [0, 0],
] as const

export const TETRAHEDRON_VERTICES = [
  [1, 0, 0],
  [0.5, Math.sqrt(3) / 2, 0],
  [0.5, Math.sqrt(3) / 6, Math.sqrt(6) / 3],
  [0, 0, 0],
] as const

const SIMPLEX_VERTICES: Record<2 | 3 | 4, readonly (readonly number[])[]> = {
  2: [[0], [1]],
  3: TRIANGLE_VERTICES,
  4: TETRAHEDRON_VERTICES,
}

// Composition → barycentric coordinates over `elements` (length N, summing to 1). Missing
// and NaN amounts count as 0; negative amounts and all-zero compositions throw.
export function composition_to_barycentric_nd(
  composition: Record<string, number>,
  elements: ElementSymbol[],
): number[] {
  const n_elems = elements.length
  if (n_elems < 2) {
    throw new Error(`Barycentric coordinates require at least 2 elements, got ${n_elems}`)
  }
  const amounts = elements.map((el) => {
    const val = composition[el]
    return val == null || Number.isNaN(val) ? 0 : val
  })
  const negative = elements.filter((_, idx) => amounts[idx] < 0)
  if (negative.length > 0) {
    throw new Error(`Composition contains negative amounts for: ${negative.join(`, `)}`)
  }
  const total = amounts.reduce((sum, amt) => sum + amt, 0)
  if (total === 0) {
    throw new Error(`Composition has no elements from the system: ${elements.join(`-`)}`)
  }
  return amounts.map((amount) => amount / total)
}

// Position of a composition inside the plotted simplex of a 2-, 3- or 4-element system:
// [x] (fraction of the second element), [x, y] on the triangle, or [x, y, z] in the tetrahedron
export function composition_to_simplex_coords(
  composition: Record<string, number>,
  elements: ElementSymbol[],
): number[] {
  const dim = elements.length
  if (dim !== 2 && dim !== 3 && dim !== 4) {
    throw new Error(`Simplex coordinates need 2, 3 or 4 elements, got ${dim}`)
  }
  const vertices = SIMPLEX_VERTICES[dim]
  const barycentric = composition_to_barycentric_nd(composition, elements)
  return vertices[0].map((_, axis) =>
    barycentric.reduce((sum, weight, idx) => sum + weight * vertices[idx][axis], 0),
  )
}
