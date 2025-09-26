import type { ElementSymbol } from '$lib'
import {
  barycentric_to_tetrahedral,
  composition_to_barycentric_4d,
  compute_4d_coordinates,
  TETRAHEDRON_VERTICES,
} from '$lib/phase-diagram/quaternary'
import type { PhaseEntry } from '$lib/phase-diagram/types'
import { describe, expect, test } from 'vitest'

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
    expect(Number(bc.reduce((a, b) => a + b, 0).toFixed(9))).toBe(1)
    const zero = composition_to_barycentric_4d({ A: 0, B: 0, C: 0, D: 0 }, elems)
    expect(zero).toEqual([0.25, 0.25, 0.25, 0.25])
  })

  test(`barycentric_to_tetrahedral maps basis to vertices`, () => {
    const p0 = barycentric_to_tetrahedral([1, 0, 0, 0])
    expect(Number(p0.x.toFixed(6))).toBe(1)
    const p1 = barycentric_to_tetrahedral([0, 1, 0, 0])
    expect(Number(p1.x.toFixed(6))).toBe(Number((0.5).toFixed(6)))
    const p3 = barycentric_to_tetrahedral([0, 0, 0, 1])
    expect(p3).toEqual({ x: 0, y: 0, z: 0 })
    const p2 = barycentric_to_tetrahedral([0, 0, 1, 0])
    expect(Number(p2.y.toFixed(6))).toBe(Number((Math.sqrt(3) / 6).toFixed(6)))
    expect(Number(p2.z.toFixed(6))).toBe(Number((Math.sqrt(6) / 3).toFixed(6)))
  })
})

describe(`quaternary: compute_4d_coordinates`, () => {
  test(`filters entries outside chemical system and projects coords`, () => {
    const elems = [`A`, `B`, `C`, `D`] as unknown as ElementSymbol[]
    const entries: PhaseEntry[] = [
      { composition: { A: 1 }, energy: 0 },
      { composition: { A: 1, B: 1 }, energy: 0 },
      { composition: { A: 1, E: 1 }, energy: 0 },
    ]
    const out = compute_4d_coordinates(entries, elems)
    expect(out.length).toBe(2)
    expect(out[0]).toHaveProperty(`x`)
    expect(out[0]).toHaveProperty(`y`)
    expect(out[0]).toHaveProperty(`z`)
    expect(out[0]).toHaveProperty(`is_element`)
  })
})
