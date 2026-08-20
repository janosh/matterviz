import {
  composition_to_barycentric_nd,
  composition_to_simplex_coords,
  TETRAHEDRON_VERTICES,
  TRIANGLE_VERTICES,
} from '$lib/convex-hull/barycentric-coords'
import type { ElementSymbol } from '$lib/element'
import { describe, expect, test } from 'vitest'

// Rounded copies so toEqual compares tuples of nearby floats exactly
const rounded = (values: readonly number[]): number[] =>
  values.map((val) => Math.round(val * 1e12) / 1e12)

describe(`composition_to_barycentric_nd`, () => {
  test.each([
    [{ Li: 1, Fe: 1, O: 2 }, [`Li`, `Fe`, `O`], [0.25, 0.25, 0.5]],
    [{ Fe: 3 }, [`Li`, `Fe`, `O`], [0, 1, 0]],
    [{ Li: 1, Na: NaN, K: 1, Rb: 2 }, [`Li`, `Na`, `K`, `Rb`, `Cs`], [0.25, 0, 0.25, 0.5, 0]],
    [{ Li: 1, O: 3 }, [`Li`, `O`], [0.25, 0.75]],
  ] as [Record<string, number>, ElementSymbol[], number[]][])(
    `%o over %j → %j (missing/NaN amounts count as 0)`,
    (composition, elements, expected) => {
      expect(rounded(composition_to_barycentric_nd(composition, elements))).toEqual(expected)
    },
  )

  test.each([
    [{ Li: 1 }, [`Li`], /at least 2 elements/],
    [{ Li: -1, O: 2 }, [`Li`, `O`], /negative amounts for: Li/],
    [{ Na: 1 }, [`Li`, `O`], /no elements from the system: Li-O/],
  ] as [Record<string, number>, ElementSymbol[], RegExp][])(
    `throws for %o over %j`,
    (composition, elements, error) => {
      expect(() => composition_to_barycentric_nd(composition, elements)).toThrow(error)
    },
  )
})

describe(`composition_to_simplex_coords`, () => {
  const elements = [`Li`, `Fe`, `P`, `O`] as ElementSymbol[]
  const coords = (composition: Record<string, number>, n_elements: number) =>
    rounded(composition_to_simplex_coords(composition, elements.slice(0, n_elements)))

  test(`pure elements land on the simplex corners for 2, 3 and 4 components`, () => {
    expect(coords({ Li: 1 }, 2)).toEqual([0])
    expect(coords({ Fe: 1 }, 2)).toEqual([1])
    for (const [idx, vertex] of TRIANGLE_VERTICES.entries()) {
      expect(coords({ [elements[idx]]: 2 }, 3)).toEqual(rounded(vertex))
    }
    for (const [idx, vertex] of TETRAHEDRON_VERTICES.entries()) {
      expect(coords({ [elements[idx]]: 1 }, 4)).toEqual(rounded(vertex))
    }
  })

  test(`equimolar compositions land on the centroid; binary x is the second element's fraction`, () => {
    expect(coords({ Li: 1, Fe: 3 }, 2)).toEqual([0.75])
    expect(coords({ Li: 1, Fe: 1, P: 1 }, 3)).toEqual(rounded([0.5, Math.sqrt(3) / 6]))
    expect(coords({ Li: 1, Fe: 1, P: 1, O: 1 }, 4)).toEqual(
      rounded([0.5, Math.sqrt(3) / 6, Math.sqrt(6) / 12]),
    )
  })

  test(`rejects systems outside 2–4 elements`, () => {
    expect(() => composition_to_simplex_coords({ Li: 1 }, elements.slice(0, 1))).toThrow(
      /2, 3 or 4/,
    )
    expect(() =>
      composition_to_simplex_coords({ Li: 1 }, [...elements, `Na`] as ElementSymbol[]),
    ).toThrow(/2, 3 or 4/)
  })

  test(`the plotted triangle and tetrahedron are regular (unit edges)`, () => {
    const edge = (pt_a: readonly number[], pt_b: readonly number[]) =>
      Math.hypot(...pt_a.map((val, idx) => val - pt_b[idx]))
    for (const vertices of [TRIANGLE_VERTICES, TETRAHEDRON_VERTICES]) {
      for (const [idx, pt_a] of vertices.entries()) {
        for (const pt_b of vertices.slice(idx + 1)) expect(edge(pt_a, pt_b)).toBeCloseTo(1, 12)
      }
    }
  })
})
