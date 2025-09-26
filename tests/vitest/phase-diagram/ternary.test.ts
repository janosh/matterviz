import type { ElementSymbol } from '$lib'
import {
  barycentric_to_ternary_3d,
  barycentric_to_triangular,
  calculate_face_centroid,
  calculate_face_normal,
  composition_to_barycentric_3d,
  compute_ternary_3d_coordinates,
  get_triangle_centroid,
  get_triangle_edges,
  get_triangle_vertical_edges,
  TRIANGLE_VERTICES,
} from '$lib/phase-diagram/ternary'
import type { PhaseEntry } from '$lib/phase-diagram/types'
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
    expect(Number(d01.toFixed(6))).toBe(Number(d12.toFixed(6)))
    expect(Number(d12.toFixed(6))).toBe(Number(d20.toFixed(6)))
  })

  test(`barycentric to triangular maps vertices correctly`, () => {
    expect(barycentric_to_triangular([1, 0, 0])).toEqual([1, 0])
    const v1 = barycentric_to_triangular([0, 1, 0])
    expect(Number(v1[0].toFixed(6))).toBe(Number((0.5).toFixed(6)))
    expect(Number(v1[1].toFixed(6))).toBe(Number((Math.sqrt(3) / 2).toFixed(6)))
    expect(barycentric_to_triangular([0, 0, 1])).toEqual([0, 0])
  })

  test(`barycentric to ternary 3d uses energy as z`, () => {
    const p = barycentric_to_ternary_3d([1, 0, 0], -0.5)
    expect(p).toEqual({ x: 1, y: 0, z: -0.5 })
  })

  test(`triangle centroid is arithmetic mean of vertices`, () => {
    const c = get_triangle_centroid()
    const avg_x =
      (TRIANGLE_VERTICES[0][0] + TRIANGLE_VERTICES[1][0] + TRIANGLE_VERTICES[2][0]) / 3
    const avg_y =
      (TRIANGLE_VERTICES[0][1] + TRIANGLE_VERTICES[1][1] + TRIANGLE_VERTICES[2][1]) / 3
    expect(Number(c.x.toFixed(6))).toBe(Number(avg_x.toFixed(6)))
    expect(Number(c.y.toFixed(6))).toBe(Number(avg_y.toFixed(6)))
    expect(c.z).toBe(0)
  })
})

describe(`ternary: composition and plotting`, () => {
  test(`composition to barycentric validates element count and normalization`, () => {
    const elements = [`A`, `B`, `C`] as unknown as ElementSymbol[]
    const bc = composition_to_barycentric_3d({ A: 2, B: 2, C: 4 }, elements)
    expect(Number(bc[0].toFixed(6))).toBe(0.25)
    expect(Number(bc[1].toFixed(6))).toBe(0.25)
    expect(Number(bc[2].toFixed(6))).toBe(0.5)
  })

  test(`composition to barycentric throws on invalid inputs`, () => {
    expect(() =>
      composition_to_barycentric_3d({ Li: 1 }, [`Li`, `O`] as unknown as ElementSymbol[])
    ).toThrow()
    expect(() => composition_to_barycentric_3d({ Li: 0, O: 0, Na: 0 }, [`Li`, `O`, `Na`]))
      .toThrow()
  })

  test(`compute_ternary_3d_coordinates filters entries and projects coords`, () => {
    const elements = [`A`, `B`, `C`] as unknown as ElementSymbol[]
    const entries: PhaseEntry[] = [
      { composition: { A: 1 }, energy: 0, e_form_per_atom: 0 },
      { composition: { A: 1, B: 1 }, energy: 0, e_form_per_atom: -1 },
      { composition: { A: 1, D: 1 }, energy: 0, e_form_per_atom: -1 }, // out-of-system
    ]
    const out = compute_ternary_3d_coordinates(entries, elements)
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
    expect(Number(n.z.toFixed(6))).toBe(1)
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
