import type { Vec3 } from '$lib'
import type { Matrix3x3 } from '$lib/math'
import {
  angle_between_vectors,
  displacement_pbc,
  distance_pbc,
  smart_displacement_vectors,
} from '$lib/structure/measure'
import { parse_poscar } from '$lib/structure/parse'
import { get_pbc_image_sites } from '$lib/structure/pbc'
import { describe, expect, test } from 'vitest'

const cubic = (a: number): Matrix3x3 => [[a, 0, 0], [0, a, 0], [0, 0, a]]

describe(`measure: distances`, () => {
  test(`pbc distance and displacement`, () => {
    const lat = cubic(10)

    // Test basic PBC distance
    const a: Vec3 = [0.5, 0.5, 0.5]
    const b: Vec3 = [9.8, 9.6, 9.5]
    const disp = displacement_pbc(a, b, lat)
    expect(disp[0]).toBeCloseTo(-0.7, 10)
    expect(disp[1]).toBeCloseTo(-0.9, 10)
    expect(disp[2]).toBeCloseTo(-1.0, 10)
    expect(distance_pbc(a, b, lat)).toBeCloseTo(Math.hypot(0.7, 0.9, 1.0), 10)

    // Test edge cases
    const pos: Vec3 = [5.0, 5.0, 5.0]
    expect(displacement_pbc(pos, pos, lat)).toEqual([0, 0, 0])

    // Test boundary wrapping
    expect(displacement_pbc([0, 0, 0], [10, 0, 0], lat)).toEqual([0, 0, 0])

    const disp2 = displacement_pbc([0, 0, 0], [9.5, 8.5, 7.5], lat)
    expect(disp2[0]).toBeCloseTo(-0.5, 10)
    expect(disp2[1]).toBeCloseTo(-1.5, 10)
    expect(disp2[2]).toBeCloseTo(-2.5, 10)
  })
})

describe(`measure: angles`, () => {
  test.each([
    { v1: [1, 0, 0] as Vec3, v2: [0, 1, 0] as Vec3, deg: 90 },
    { v1: [1, 0, 0] as Vec3, v2: [0.5, Math.sqrt(3) / 2, 0] as Vec3, deg: 60 },
    { v1: [1, 0, 0] as Vec3, v2: [-1, 0, 0] as Vec3, deg: 180 },
    { v1: [1, 0, 0] as Vec3, v2: [2, 0, 0] as Vec3, deg: 0 },
  ] as Array<{ v1: Vec3; v2: Vec3; deg: number }>)(
    `basic angles: %#`,
    ({ v1, v2, deg }) => {
      expect(angle_between_vectors(v1, v2, `degrees`)).toBeCloseTo(deg, 10)
    },
  )

  test(`angle edge cases`, () => {
    // Zero vectors
    expect(angle_between_vectors([0, 0, 0], [1, 0, 0])).toBe(0)

    // Radians mode
    expect(angle_between_vectors([1, 0, 0], [0, 1, 0], `radians`)).toBeCloseTo(
      Math.PI / 2,
      10,
    )

    // Collinear precision
    expect(angle_between_vectors([1, 2, 3], [2, 4, 6])).toBeCloseTo(0, 12)
    expect(angle_between_vectors([1, 2, 3], [-2, -4, -6])).toBeCloseTo(180, 12)

    // Nearly collinear
    const eps = 1e-10
    expect(angle_between_vectors([1, 0, 0], [1, eps, 0])).toBeCloseTo(0, 6)
    expect(angle_between_vectors([1, 0, 0], [-1, eps, 0])).toBeCloseTo(180, 6)
  })

  test(`smart displacement preserves collinearity`, () => {
    // Direct collinear case
    const [v1, v2] = smart_displacement_vectors([0, 0, 0], [1, 0, 0], [2, 0, 0])
    expect(angle_between_vectors(v1, v2)).toBeCloseTo(0, 5)

    // PBC wrapping case (atoms collinear only after PBC)
    const lat = cubic(10)
    const center: Vec3 = [0.1, 0.1, 0.1]
    const a: Vec3 = [9.9, 0.1, 0.1] // wraps to negative side
    const b: Vec3 = [0.3, 0.1, 0.1] // positive side

    // Test direct PBC calculation for this edge case
    const v1_pbc = displacement_pbc(center, a, lat)
    const v2_pbc = displacement_pbc(center, b, lat)
    expect(angle_between_vectors(v1_pbc, v2_pbc)).toBeCloseTo(180, 5)
  })

  test(`real structure angles: aviary-CuF3K-triolith.poscar`, async () => {
    const fs = await import(`fs`)
    const path = await import(`path`)
    const process = await import(`node:process`)

    const poscar_path = path.join(
      process.cwd(),
      `static/structures/aviary-CuF3K-triolith.poscar`,
    )
    const poscar_content = fs.readFileSync(poscar_path, `utf-8`)

    const structure = parse_poscar(poscar_content)
    if (!structure) {
      throw new Error(`Failed to parse POSCAR file`)
    }
    const with_images = get_pbc_image_sites(structure)

    // Test Zr collinear atoms: should give 0° for end atoms
    const zr_sites = with_images.sites.filter((s) => s.species[0].element === `Zr`)
    const zr_site_0 = zr_sites.find((s) =>
      s.xyz.every((c, i) => Math.abs(c - [0, 0, 0][i]) < 0.01)
    )
    const zr_site_1 = zr_sites.find((s) =>
      s.xyz.every((c, i) => Math.abs(c - [3.019349, 3.019349, 0][i]) < 0.01)
    )
    const zr_site_2 = zr_sites.find((s) =>
      s.xyz.every((c, i) => Math.abs(c - [6.038698, 6.038698, 0][i]) < 0.01)
    )

    if (!zr_site_0 || !zr_site_1 || !zr_site_2) {
      throw new Error(`Could not find expected Zr sites in structure`)
    }

    const zr_triplet = [zr_site_0, zr_site_1, zr_site_2]

    const [v1, v2] = smart_displacement_vectors(
      zr_triplet[0].xyz,
      zr_triplet[1].xyz,
      zr_triplet[2].xyz,
      structure.lattice?.matrix,
      zr_triplet[0].abc,
      zr_triplet[1].abc,
      zr_triplet[2].abc,
    )
    expect(angle_between_vectors(v1, v2)).toBeCloseTo(0, 1)

    // Test N square: should give 45°/90° angles
    const n_sites = with_images.sites.filter((s) => s.species[0].element === `N`).slice(
      0,
      4,
    )

    if (n_sites.length >= 4) {
      const [v3, v4] = smart_displacement_vectors(
        n_sites[0].xyz,
        n_sites[1].xyz,
        n_sites[2].xyz,
        structure.lattice?.matrix,
        n_sites[0].abc,
        n_sites[1].abc,
        n_sites[2].abc,
      )
      const square_angle = angle_between_vectors(v3, v4, `degrees`)
      expect([45, 90, 135].some((exp) => Math.abs(square_angle - exp) < 5)).toBe(true)
    }
  })

  test(`PBC distance regression: opposing corners of cubic cell`, () => {
    // Test the new bug: opposing corners should have PBC distance 0
    const cubic_lattice: Matrix3x3 = [
      [5, 0, 0],
      [0, 5, 0],
      [0, 0, 5],
    ]

    // Atoms at opposing corners of the unit cell
    const corner1: Vec3 = [0, 0, 0]
    const corner2: Vec3 = [5, 5, 5] // This is the same as [0,0,0] under PBC

    const pbc_dist = distance_pbc(corner1, corner2, cubic_lattice)
    const direct_dist = Math.hypot(5, 5, 5)

    // PBC distance should be 0 (same site), direct should be non-zero
    expect(pbc_dist).toBeCloseTo(0, 10)
    expect(direct_dist).toBeGreaterThan(8)

    // Additional test cases
    expect(distance_pbc([0, 0, 0], [5, 0, 0], cubic_lattice)).toBeCloseTo(0, 10)
    expect(distance_pbc([0, 0, 0], [0, 5, 0], cubic_lattice)).toBeCloseTo(0, 10)
    expect(distance_pbc([0, 0, 0], [0, 0, 5], cubic_lattice)).toBeCloseTo(0, 10)
  })

  test(`PBC distance invariant: PBC ≤ direct distance`, () => {
    // Test various lattice types to ensure PBC never violates minimum image
    const test_cases = [
      {
        name: `cubic`,
        lattice: [[3, 0, 0], [0, 3, 0], [0, 0, 3]] as Matrix3x3,
        pos1: [0, 0, 0] as Vec3,
        pos2: [1.5, 1.5, 1.5] as Vec3,
      },
      {
        name: `triclinic (original bug case)`,
        lattice: [[6.038698, 0, 0], [0, 6.038698, 0], [
          3.019349,
          3.019349,
          4.167943,
        ]] as Matrix3x3,
        pos1: [0, 0, 0] as Vec3,
        pos2: [3.019349, 3.019349, 0] as Vec3,
      },
    ]

    for (const { lattice, pos1, pos2 } of test_cases) {
      const direct_dist = Math.hypot(
        pos2[0] - pos1[0],
        pos2[1] - pos1[1],
        pos2[2] - pos1[2],
      )
      const pbc_dist = distance_pbc(pos1, pos2, lattice)

      // The fundamental PBC invariant: PBC distance ≤ direct distance
      expect(pbc_dist).toBeLessThanOrEqual(direct_dist + 1e-10)
    }
  })
})
