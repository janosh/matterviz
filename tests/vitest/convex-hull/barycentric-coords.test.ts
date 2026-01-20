import type { CompositionType, ElementSymbol } from '$lib'
import {
  barycentric_to_ternary_xy,
  barycentric_to_ternary_xyz,
  barycentric_to_tetrahedral,
  calculate_face_centroid,
  calculate_face_normal,
  composition_to_barycentric_3d,
  composition_to_barycentric_4d,
  composition_to_barycentric_nd,
  compute_4d_coords,
  get_ternary_3d_coordinates,
  get_triangle_centroid,
  get_triangle_edges,
  get_triangle_vertical_edges,
  TETRAHEDRON_VERTICES,
  TRIANGLE_VERTICES,
} from '$lib/convex-hull/barycentric-coords'
import type { PhaseData } from '$lib/convex-hull/types'
import { describe, expect, test } from 'vitest'

describe(`ternary: constants and projections`, () => {
  test(`triangle vertices are equilateral base`, () => {
    expect(TRIANGLE_VERTICES.length).toBe(3)
    // side lengths: (0)-(1) and (1)-(2) should match
    const d01 = Math.hypot(
      TRIANGLE_VERTICES[0][0] - TRIANGLE_VERTICES[1][0],
      TRIANGLE_VERTICES[0][1] - TRIANGLE_VERTICES[1][1],
    )
    const d12 = Math.hypot(
      TRIANGLE_VERTICES[1][0] - TRIANGLE_VERTICES[2][0],
      TRIANGLE_VERTICES[1][1] - TRIANGLE_VERTICES[2][1],
    )
    const d20 = Math.hypot(
      TRIANGLE_VERTICES[2][0] - TRIANGLE_VERTICES[0][0],
      TRIANGLE_VERTICES[2][1] - TRIANGLE_VERTICES[0][1],
    )
    expect(d01).toBeCloseTo(d12, 6)
    expect(d12).toBeCloseTo(d20, 6)
  })

  test(`barycentric to triangular maps vertices correctly`, () => {
    expect(barycentric_to_ternary_xy([1, 0, 0])).toEqual([1, 0])
    const v1 = barycentric_to_ternary_xy([0, 1, 0])
    expect(v1[0]).toBeCloseTo(0.5, 6)
    expect(v1[1]).toBeCloseTo(Math.sqrt(3) / 2, 6)
    expect(barycentric_to_ternary_xy([0, 0, 1])).toEqual([0, 0])
  })

  test(`barycentric to ternary 3d uses energy as z`, () => {
    const p = barycentric_to_ternary_xyz([1, 0, 0], -0.5)
    expect(p).toEqual({ x: 1, y: 0, z: -0.5 })
  })

  test(`triangle centroid is arithmetic mean of vertices`, () => {
    const c = get_triangle_centroid()
    const avg_x =
      (TRIANGLE_VERTICES[0][0] + TRIANGLE_VERTICES[1][0] + TRIANGLE_VERTICES[2][0]) / 3
    const avg_y =
      (TRIANGLE_VERTICES[0][1] + TRIANGLE_VERTICES[1][1] + TRIANGLE_VERTICES[2][1]) / 3
    expect(c.x).toBeCloseTo(avg_x, 6)
    expect(c.y).toBeCloseTo(avg_y, 6)
    expect(c.z).toBe(0)
  })
})

describe(`ternary: composition and plotting`, () => {
  test(`composition to barycentric validates element count and normalization`, () => {
    const elements = [`A`, `B`, `C`] as unknown as ElementSymbol[]
    const bc = composition_to_barycentric_3d({ A: 2, B: 2, C: 4 }, elements)
    expect(bc[0]).toBeCloseTo(0.25, 6)
    expect(bc[1]).toBeCloseTo(0.25, 6)
    expect(bc[2]).toBeCloseTo(0.5, 6)
  })

  test(`composition to barycentric throws on invalid inputs`, () => {
    expect(() =>
      composition_to_barycentric_3d({ Li: 1 }, [`Li`, `O`] as unknown as ElementSymbol[])
    ).toThrow()
    expect(() => composition_to_barycentric_3d({ Li: 0, O: 0, Na: 0 }, [`Li`, `O`, `Na`]))
      .toThrow()
  })

  test(`get_ternary_3d_coordinates filters entries and projects coords`, () => {
    const elements = [`A`, `B`, `C`] as unknown as ElementSymbol[]
    const entries: PhaseData[] = [
      {
        composition: { A: 1 } as unknown as CompositionType,
        energy: 0,
        e_form_per_atom: 0,
      },
      {
        composition: { A: 1, B: 1 } as unknown as CompositionType,
        energy: 0,
        e_form_per_atom: -1,
      },
      {
        composition: { A: 1, D: 1 } as unknown as CompositionType,
        energy: 0,
        e_form_per_atom: -1,
      }, // out-of-system
    ]
    const out = get_ternary_3d_coordinates(entries, elements)
    expect(out.length).toBe(2)
    expect(out[0]).toHaveProperty(`x`)
    expect(out[0]).toHaveProperty(`y`)
    expect(out[0]).toHaveProperty(`z`)
    expect(out[0]).toHaveProperty(`is_element`)
  })

  test(`edges and vertical edges are generated with correct counts`, () => {
    const edges = get_triangle_edges()
    expect(edges.length).toBe(3)
    const v_edges = get_triangle_vertical_edges(-2, 1)
    expect(v_edges.length).toBe(3)
    for (const [lo, hi] of v_edges) {
      expect(lo.z).toBe(-2)
      expect(hi.z).toBe(1)
      expect(lo.x).toBe(hi.x)
      expect(lo.y).toBe(hi.y)
    }
  })
})

describe(`ternary: geometry helpers`, () => {
  test(`face normal points upward for counter-clockwise triangle`, () => {
    const n = calculate_face_normal({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, {
      x: 0,
      y: 1,
      z: 0,
    })
    expect(n.z).toBeCloseTo(1, 6)
  })

  test(`face centroid is arithmetic mean`, () => {
    const c = calculate_face_centroid({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }, {
      x: 0,
      y: 2,
      z: 4,
    })
    expect(c).toEqual({ x: 2 / 3, y: 2 / 3, z: 2 })
  })
})

describe(`quaternary: barycentric and projection`, () => {
  test(`tetrahedron vertex count and non-degenerate`, () => {
    expect(TETRAHEDRON_VERTICES.length).toBe(4)
    // distances from vertex 3 (origin) are non-zero
    for (let idx = 0; idx < 3; idx++) {
      const d = Math.hypot(
        TETRAHEDRON_VERTICES[idx][0] - TETRAHEDRON_VERTICES[3][0],
        TETRAHEDRON_VERTICES[idx][1] - TETRAHEDRON_VERTICES[3][1],
        TETRAHEDRON_VERTICES[idx][2] - TETRAHEDRON_VERTICES[3][2],
      )
      expect(d).toBeGreaterThan(0)
    }
  })

  test(`composition_to_barycentric_4d normalizes or defaults to uniform`, () => {
    const elems = [`A`, `B`, `C`, `D`] as unknown as ElementSymbol[]
    const bc = composition_to_barycentric_4d({ A: 2, B: 2, C: 4, D: 2 }, elems)
    expect(bc.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    expect(() => composition_to_barycentric_4d({ A: 0, B: 0, C: 0, D: 0 }, elems))
      .toThrow(`Composition has no elements from the quaternary system: A-B-C-D`)
  })

  test(`barycentric_to_tetrahedral maps basis to vertices`, () => {
    const p0 = barycentric_to_tetrahedral([1, 0, 0, 0])
    expect(p0.x).toBeCloseTo(1, 6)
    const p1 = barycentric_to_tetrahedral([0, 1, 0, 0])
    expect(p1.x).toBeCloseTo(0.5, 6)
    const p3 = barycentric_to_tetrahedral([0, 0, 0, 1])
    expect(p3).toEqual({ x: 0, y: 0, z: 0 })
    const p2 = barycentric_to_tetrahedral([0, 0, 1, 0])
    expect(p2.y).toBeCloseTo(Math.sqrt(3) / 6, 6)
    expect(p2.z).toBeCloseTo(Math.sqrt(6) / 3, 6)
  })
})

describe(`quaternary: compute_4d_coords`, () => {
  test(`filters entries outside chemical system and projects coords`, () => {
    const elems = [`A`, `B`, `C`, `D`] as unknown as ElementSymbol[]
    const entries: PhaseData[] = [
      { composition: { A: 1 } as unknown as CompositionType, energy: 0 },
      { composition: { A: 1, B: 1 } as unknown as CompositionType, energy: 0 },
      { composition: { A: 1, E: 1 } as unknown as CompositionType, energy: 0 },
    ]
    const out = compute_4d_coords(entries, elems)
    expect(out.length).toBe(2)
    expect(out[0]).toHaveProperty(`x`)
    expect(out[0]).toHaveProperty(`y`)
    expect(out[0]).toHaveProperty(`z`)
    expect(out[0]).toHaveProperty(`is_element`)
  })
})

describe(`composition_to_barycentric_nd`, () => {
  test(`normalizes composition to sum to 1`, () => {
    const elements = [`Li`, `Na`, `K`, `Rb`, `Cs`] as ElementSymbol[]
    const result = composition_to_barycentric_nd(
      { Li: 2, Na: 2, K: 2, Rb: 2, Cs: 2 },
      elements,
    )
    expect(result).toHaveLength(5)
    expect(result.reduce((sum, val) => sum + val, 0)).toBeCloseTo(1, 10)
    expect(result.every((val) => val === 0.2)).toBe(true)
  })

  test(`handles missing elements as zero`, () => {
    const elements = [`Li`, `Na`, `K`] as ElementSymbol[]
    const result = composition_to_barycentric_nd({ Li: 1 }, elements)
    expect(result).toEqual([1, 0, 0])
  })

  const elems = [`Li`, `Na`] as ElementSymbol[]

  test(`throws for <2 elements`, () => {
    expect(() => composition_to_barycentric_nd({ Li: 1 }, [`Li`] as ElementSymbol[]))
      .toThrow(/at least 2 elements/)
  })

  test(`throws for no matching elements`, () => {
    expect(() => composition_to_barycentric_nd({ Fe: 1 }, elems)).toThrow(/no elements/)
  })

  test(`throws for negative amounts`, () => {
    expect(() => composition_to_barycentric_nd({ Li: -1, Na: 2 }, elems)).toThrow(
      /negative/,
    )
  })

  test(`handles NaN as zero via || 0 fallback`, () => {
    const elements = [`Li`, `Na`] as ElementSymbol[]
    const result = composition_to_barycentric_nd({ Li: NaN, Na: 1 }, elements)
    expect(result).toEqual([0, 1])
  })
})
