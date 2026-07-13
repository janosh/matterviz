// Tests for Fermi surface computation and analysis functions
import {
  compute_fermi_slice,
  compute_surface_area,
  detect_irreducible_bz,
  extract_fermi_surface,
} from '$lib/fermi-surface/compute'
import type { BandGridData, FermiSurfaceData, Isosurface } from '$lib/fermi-surface/types'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { describe, expect, test } from 'vitest'
import { make_grid } from '../setup'

const identity_lattice: Matrix3x3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

describe(`extract_fermi_surface`, () => {
  // Band data with a spherical isosurface: energy = distance² from grid center
  function create_spherical_band_data(grid_size: number, fermi_energy: number): BandGridData {
    const center = (grid_size - 1) / 2
    const band = make_grid(
      grid_size,
      grid_size,
      grid_size,
      (ix, iy, iz) => (ix - center) ** 2 + (iy - center) ** 2 + (iz - center) ** 2,
    )
    return {
      energies: [[band]],
      k_grid: [grid_size, grid_size, grid_size],
      k_lattice: identity_lattice,
      fermi_energy,
      n_bands: 1,
      n_spins: 1,
    }
  }

  test(`extracts Fermi surface from band data`, () => {
    const band_data = create_spherical_band_data(10, 9) // Fermi level at radius^2 = 9
    const result = extract_fermi_surface(band_data)

    expect(result.isosurfaces).toHaveLength(1)
    expect(result.fermi_energy).toBe(9)
    expect(result.reciprocal_cell).toBe(`wigner_seitz`)
  })

  test(`respects mu offset`, () => {
    const band_data = create_spherical_band_data(10, 9)
    // mu=0 gives surface at E_F=9; mu=7 at E_F=16 (larger radius, different area)
    const result_0 = extract_fermi_surface(band_data, { mu: 0 })
    const result_7 = extract_fermi_surface(band_data, { mu: 7 })
    expect(result_0.metadata.total_area).not.toBe(result_7.metadata.total_area)
  })

  test(`returns empty isosurfaces when no intersection`, () => {
    const band_data = create_spherical_band_data(10, 100) // Fermi level too high
    const result = extract_fermi_surface(band_data)

    expect(result.isosurfaces).toHaveLength(0)
    expect(result.metadata.total_area).toBe(0)
  })

  test(`filters by selected_bands`, () => {
    // Create data with 2 bands
    const band_data = create_spherical_band_data(10, 9)
    band_data.energies[0].push([...band_data.energies[0][0]]) // duplicate band
    band_data.n_bands = 2

    const result = extract_fermi_surface(band_data, { selected_bands: [0] })

    // Should only have isosurface from band 0
    expect(result.isosurfaces.every((iso) => iso.band_index === 0)).toBe(true)
  })

  test(`handles multiple spin channels`, () => {
    const band_data = create_spherical_band_data(8, 4)
    // Add second spin channel
    band_data.energies.push([...band_data.energies[0]])
    band_data.n_spins = 2

    const result = extract_fermi_surface(band_data)

    // Should have isosurfaces from both spins
    const spins = new Set(result.isosurfaces.map((iso) => iso.spin))
    expect(spins.has(`up`)).toBe(true)
    expect(spins.has(`down`)).toBe(true)
  })
})

describe(`compute_surface_area`, () => {
  test.each([
    {
      label: `single triangle`,
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ] as Vec3[],
      faces: [[0, 1, 2]],
      area: 0.5, // 0.5 * base * height
    },
    {
      label: `unit square (2 triangles)`,
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ] as Vec3[],
      faces: [
        [0, 1, 2],
        [0, 2, 3],
      ],
      area: 1.0,
    },
    { label: `empty surface`, vertices: [] as Vec3[], faces: [] as number[][], area: 0 },
  ])(`computes area of $label`, ({ vertices, faces, area }) => {
    const surface: Isosurface = { vertices, faces, normals: [], band_index: 0, spin: null }
    expect(compute_surface_area(surface)).toBeCloseTo(area, 5)
  })
})

describe(`compute_fermi_slice`, () => {
  // Thin box: a square sheet at z=0 extruded to z=0.1
  const box_vertices: Vec3[] = [
    [-0.5, -0.5, 0],
    [0.5, -0.5, 0],
    [0.5, 0.5, 0],
    [-0.5, 0.5, 0],
    [-0.5, -0.5, 0.1],
    [0.5, -0.5, 0.1],
    [0.5, 0.5, 0.1],
    [-0.5, 0.5, 0.1],
  ]
  // oxfmt-ignore
  const tri_faces = [
    [0, 1, 2], [0, 2, 3], // bottom
    [4, 6, 5], [4, 7, 6], // top
    [0, 4, 5], [0, 5, 1], // front
    [2, 6, 7], [2, 7, 3], // back
    [0, 3, 7], [0, 7, 4], // left
    [1, 5, 6], [1, 6, 2], // right
  ]
  // oxfmt-ignore
  const quad_faces = [
    [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [2, 6, 7, 3], [0, 3, 7, 4], [1, 5, 6, 2],
  ]

  const make_box_fermi_data = (faces: number[][] = tri_faces): FermiSurfaceData => ({
    isosurfaces: [
      {
        vertices: box_vertices,
        faces,
        normals: box_vertices.map(() => [0, 0, 1]),
        band_index: 0,
        spin: null,
      },
    ],
    k_lattice: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    fermi_energy: 0,
    reciprocal_cell: `wigner_seitz`,
    metadata: { n_bands: 1, n_surfaces: 1, total_area: 1 },
  })

  test(`computes slice with metadata and ordered contour points`, () => {
    const slice = compute_fermi_slice(make_box_fermi_data(), {
      miller_indices: [0, 0, 1],
      distance: 0.05,
    })

    expect(slice.plane_normal).toBeDefined()
    expect(slice.plane_distance).toBe(0.05)
    expect(slice.metadata.n_lines).toBe(slice.isolines.length)
    expect(slice.metadata.has_properties).toBe(false)

    // Consecutive points must be close: contours are traced, not random scribbles
    for (const isoline of slice.isolines) {
      for (let idx = 0; idx < isoline.points_2d.length - 1; idx++) {
        const [x1, y1] = isoline.points_2d[idx]
        const [x2, y2] = isoline.points_2d[idx + 1]
        expect(Math.hypot(x2 - x1, y2 - y1)).toBeLessThan(1.0)
      }
    }
  })

  test(`throws error for zero miller indices [0, 0, 0]`, () => {
    expect(() =>
      compute_fermi_slice(make_box_fermi_data(), { miller_indices: [0, 0, 0] }),
    ).toThrow(/Invalid miller indices.*at least one index must be non-zero/)
  })

  test(`throws error for degenerate k_lattice producing zero plane normal`, () => {
    const fermi_data = make_box_fermi_data()
    fermi_data.k_lattice = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]

    expect(() => compute_fermi_slice(fermi_data, { miller_indices: [1, 0, 0] })).toThrow(
      /Degenerate plane normal.*zero-length normal/,
    )
  })

  test(`correctly handles quad faces (4 vertices per face)`, () => {
    // Regression: only the first 3 edges of each face used to be checked, so the
    // 4th edge of a quad never produced intersections
    const slice = compute_fermi_slice(make_box_fermi_data(quad_faces), {
      miller_indices: [0, 0, 1],
      distance: 0.05,
    })

    expect(slice.isolines.length).toBeGreaterThan(0)
    const total_points = slice.isolines.reduce((sum, line) => sum + line.points_2d.length, 0)
    expect(total_points).toBeGreaterThan(0)
  })
})

describe(`detect_irreducible_bz`, () => {
  const make_data = (...vertex_lists: Vec3[][]): FermiSurfaceData => ({
    isosurfaces: vertex_lists.map((vertices) => ({
      vertices,
      faces: [],
      normals: [],
      band_index: 0,
      spin: null,
    })),
    k_lattice: identity_lattice,
    fermi_energy: 0,
    reciprocal_cell: `wigner_seitz`,
    metadata: { n_bands: 1, n_surfaces: vertex_lists.length, total_area: 0 },
  })

  // 11 vertices (> IRREDUCIBLE_BZ_MIN_VERTICES), all in the positive octant
  const positive_verts: Vec3[] = Array.from({ length: 11 }, (_, idx) => [
    0.1 + idx * 0.05,
    0.2,
    0.3,
  ])
  // 11 vertices spanning positive and negative octants
  const spanning_verts: Vec3[] = positive_verts.map((vert, idx) =>
    idx % 2 ? vert : [-vert[0], vert[1], vert[2]],
  )

  test.each([
    {
      label: `vertices in positive octant only`,
      data: make_data(positive_verts),
      expected: true,
    },
    { label: `vertices spanning full BZ`, data: make_data(spanning_verts), expected: false },
    { label: `empty isosurfaces`, data: make_data(), expected: false },
    {
      // needs > 10 vertices to be considered valid irreducible data
      label: `too few vertices`,
      data: make_data(positive_verts.slice(0, 2)),
      expected: false,
    },
  ])(`returns $expected for $label`, ({ data, expected }) => {
    expect(detect_irreducible_bz(data)).toBe(expected)
  })
})
