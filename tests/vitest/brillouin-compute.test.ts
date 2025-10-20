import type { Matrix3x3, Vec3 } from '$lib'
import { compute_brillouin_zone, reciprocal_lattice } from '$lib/brillouin/compute'
import { describe, expect, it } from 'vitest'
import reference_data from './bz_reference_data.json' with { type: 'json' }

// Helper to check if vertex exists in list
const has_vertex = (vertices: Vec3[], target: Vec3, tol = 1e-8) =>
  vertices.some(
    (v) =>
      Math.abs(v[0] - target[0]) < tol &&
      Math.abs(v[1] - target[1]) < tol &&
      Math.abs(v[2] - target[2]) < tol,
  )

// Helper to create edge key for deduplication
const edge_key = (v1: Vec3, v2: Vec3) =>
  [v1, v2]
    .map((v) => v.map((x) => x.toFixed(8)).join(`,`))
    .sort()
    .join(`|`)

describe(`Brillouin Zone Computation`, () => {
  describe(`reciprocal_lattice`, () => {
    it(`should compute correct reciprocal lattice for all crystal systems`, () => {
      for (const [_type, data] of Object.entries(reference_data)) {
        const computed = reciprocal_lattice(data.real_lattice as Matrix3x3)
        const expected = data.reciprocal_lattice as Matrix3x3

        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            expect(computed[i][j]).toBeCloseTo(expected[i][j], 10)
          }
        }
      }
    })
  })

  describe(`compute_brillouin_zone`, () => {
    it(`should generate valid BZ for all crystal systems`, () => {
      for (const [type, data] of Object.entries(reference_data)) {
        const bz = compute_brillouin_zone(data.reciprocal_lattice as Matrix3x3, 1)

        expect(bz.vertices.length).toBeGreaterThan(3)
        expect(bz.faces.length).toBeGreaterThan(3)
        expect(bz.edges.length).toBeGreaterThan(0)
        expect(bz.volume).toBeCloseTo(data.bz_volume_approximation, 6)

        console.log(
          `${type}: V=${bz.vertices.length}, F=${bz.faces.length}, E=${bz.edges.length}, vol=${
            bz.volume.toFixed(2)
          }`,
        )
      }
    })

    it(`should generate correct cubic BZ geometry`, () => {
      const bz = compute_brillouin_zone(
        reference_data.cubic.reciprocal_lattice as Matrix3x3,
        1,
      )

      expect(bz.vertices.length).toBe(8) // cube corners
      expect(bz.faces.length).toBe(12) // 6 faces triangulated
      expect(bz.edges.length).toBe(12) // cube edges only
    })
  })

  describe(`BZ symmetry`, () => {
    it(`should have inversion symmetry`, () => {
      for (const [_type, data] of Object.entries(reference_data)) {
        const bz = compute_brillouin_zone(data.reciprocal_lattice as Matrix3x3, 1)

        for (const v of bz.vertices) {
          expect(has_vertex(bz.vertices, v.map((x) => -x) as Vec3)).toBe(true)
        }
      }
    })
  })

  describe(`Edge filtering`, () => {
    it(`should have correct edge counts for each lattice type`, () => {
      const test_cases: [keyof typeof reference_data, number][] = [
        [`cubic`, 12],
        [`tetragonal`, 12],
        [`orthorhombic`, 12],
        [`hexagonal`, 18],
      ]

      for (const [name, count] of test_cases) {
        const bz = compute_brillouin_zone(
          reference_data[name].reciprocal_lattice as Matrix3x3,
          1,
        )
        expect(bz.edges.length).toBe(count)
      }
    })

    it(`should validate edge topology for all lattices`, () => {
      for (const [_type, data] of Object.entries(reference_data)) {
        const bz = compute_brillouin_zone(data.reciprocal_lattice as Matrix3x3, 1)
        const keys = new Set<string>()

        // Check: all edges connect existing vertices, no duplicates, shared by 2 faces
        const edge_to_faces = new Map<string, number>()
        for (const face of bz.faces) {
          for (let i = 0; i < face.length; i++) {
            const v1 = bz.vertices[face[i]]
            const v2 = bz.vertices[face[(i + 1) % face.length]]
            const key = edge_key(v1, v2)
            edge_to_faces.set(key, (edge_to_faces.get(key) || 0) + 1)
          }
        }

        for (const [v1, v2] of bz.edges) {
          // Vertices exist
          expect(has_vertex(bz.vertices, v1)).toBe(true)
          expect(has_vertex(bz.vertices, v2)).toBe(true)

          // No duplicates
          const key = edge_key(v1, v2)
          expect(keys.has(key)).toBe(false)
          keys.add(key)

          // Each edge shared by exactly 2 faces
          expect(edge_to_faces.get(key)).toBe(2)
        }

        // Fewer edges than naive extraction (3F/2)
        expect(bz.edges.length).toBeLessThan((3 * bz.faces.length) / 2)
      }
    })

    it(`should have reasonable edge lengths`, () => {
      for (const [_type, data] of Object.entries(reference_data)) {
        const bz = compute_brillouin_zone(data.reciprocal_lattice as Matrix3x3, 1)
        const max_len = Math.cbrt(bz.volume) * 10

        for (const [v1, v2] of bz.edges) {
          const len = Math.sqrt(
            (v2[0] - v1[0]) ** 2 + (v2[1] - v1[1]) ** 2 + (v2[2] - v1[2]) ** 2,
          )
          expect(len).toBeGreaterThan(0)
          expect(len).toBeLessThan(max_len)
        }
      }
    })

    it(`should have valid face indices`, () => {
      const bz = compute_brillouin_zone(
        reference_data.cubic.reciprocal_lattice as Matrix3x3,
        1,
      )

      for (const face of bz.faces) {
        expect(face.length).toBeGreaterThanOrEqual(3)
        for (const idx of face) {
          expect(idx).toBeGreaterThanOrEqual(0)
          expect(idx).toBeLessThan(bz.vertices.length)
        }
      }
    })
  })
})
