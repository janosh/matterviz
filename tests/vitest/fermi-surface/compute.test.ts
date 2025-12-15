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

describe(`extract_fermi_surface`, () => {
  const identity_lattice: Matrix3x3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]

  // Create a simple band data with spherical-like isosurface
  function create_spherical_band_data(
    grid_size: number,
    fermi_energy: number,
  ): BandGridData {
    const energies: number[][][][][] = [[]]
    const center = (grid_size - 1) / 2
    const band: number[][][] = []

    for (let x_idx = 0; x_idx < grid_size; x_idx++) {
      band[x_idx] = []
      for (let y_idx = 0; y_idx < grid_size; y_idx++) {
        band[x_idx][y_idx] = []
        for (let z_idx = 0; z_idx < grid_size; z_idx++) {
          const dx = x_idx - center
          const dy = y_idx - center
          const dz = z_idx - center
          // Energy increases with distance from center
          band[x_idx][y_idx][z_idx] = dx * dx + dy * dy + dz * dz
        }
      }
    }
    energies[0].push(band)

    return {
      energies,
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

    expect(result.isosurfaces.length).toBe(1)
    expect(result.fermi_energy).toBe(9)
    expect(result.reciprocal_cell).toBe(`wigner_seitz`)
  })

  test(`respects mu offset`, () => {
    const band_data = create_spherical_band_data(10, 9)

    // With mu=0, surface at E_F=9
    const result_0 = extract_fermi_surface(band_data, { mu: 0 })

    // With mu=7, surface at E_F=9+7=16 (larger radius)
    const result_7 = extract_fermi_surface(band_data, { mu: 7 })

    // Different mu should give different surface areas
    expect(result_0.metadata.total_area).not.toBe(result_7.metadata.total_area)
  })

  test(`returns empty isosurfaces when no intersection`, () => {
    const band_data = create_spherical_band_data(10, 100) // Fermi level too high
    const result = extract_fermi_surface(band_data)

    expect(result.isosurfaces.length).toBe(0)
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
  test(`computes area of simple triangle`, () => {
    // Single triangle with known area = 0.5 * base * height
    const surface: Isosurface = {
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      faces: [[0, 1, 2]],
      normals: [[0, 0, 1]],
      band_index: 0,
      spin: null,
    }

    const area = compute_surface_area(surface)
    expect(area).toBeCloseTo(0.5, 5)
  })

  test(`computes area of unit square (2 triangles)`, () => {
    const surface: Isosurface = {
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ],
      faces: [
        [0, 1, 2],
        [0, 2, 3],
      ],
      normals: [
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
      ],
      band_index: 0,
      spin: null,
    }

    const area = compute_surface_area(surface)
    expect(area).toBeCloseTo(1.0, 5)
  })

  test(`returns 0 for empty surface`, () => {
    const surface: Isosurface = {
      vertices: [],
      faces: [],
      normals: [],
      band_index: 0,
      spin: null,
    }

    expect(compute_surface_area(surface)).toBe(0)
  })
})

describe(`compute_fermi_slice`, () => {
  // Create a simple FermiSurfaceData for testing
  function create_test_fermi_data(): FermiSurfaceData {
    // A square isosurface in the xy plane
    const vertices: Vec3[] = [
      [-0.5, -0.5, 0],
      [0.5, -0.5, 0],
      [0.5, 0.5, 0],
      [-0.5, 0.5, 0],
      [-0.5, -0.5, 0.1],
      [0.5, -0.5, 0.1],
      [0.5, 0.5, 0.1],
      [-0.5, 0.5, 0.1],
    ]

    // Make a box
    const faces: number[][] = [
      [0, 1, 2],
      [0, 2, 3], // bottom
      [4, 6, 5],
      [4, 7, 6], // top
      [0, 4, 5],
      [0, 5, 1], // front
      [2, 6, 7],
      [2, 7, 3], // back
      [0, 3, 7],
      [0, 7, 4], // left
      [1, 5, 6],
      [1, 6, 2], // right
    ]

    const normals: Vec3[] = vertices.map(() => [0, 0, 1])

    return {
      isosurfaces: [
        {
          vertices,
          faces,
          normals,
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
      metadata: {
        n_bands: 1,
        n_surfaces: 1,
        total_area: 1,
      },
    }
  }

  test(`computes slice through Fermi surface`, () => {
    const fermi_data = create_test_fermi_data()
    const slice = compute_fermi_slice(fermi_data, {
      miller_indices: [0, 0, 1],
      distance: 0.05,
    })

    expect(slice.plane_normal).toBeDefined()
    expect(slice.plane_distance).toBe(0.05)
  })

  test(`returns metadata about isolines`, () => {
    const fermi_data = create_test_fermi_data()
    const slice = compute_fermi_slice(fermi_data)

    expect(slice.metadata.n_lines).toBeDefined()
    expect(typeof slice.metadata.has_properties).toBe(`boolean`)
  })

  test(`throws error for zero miller indices [0, 0, 0]`, () => {
    const fermi_data = create_test_fermi_data()

    expect(() => compute_fermi_slice(fermi_data, { miller_indices: [0, 0, 0] })).toThrow(
      /Invalid miller indices.*at least one index must be non-zero/,
    )
  })

  test(`throws error for degenerate k_lattice producing zero plane normal`, () => {
    const fermi_data = create_test_fermi_data()
    // Set k_lattice to degenerate vectors (all zeros)
    fermi_data.k_lattice = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]

    expect(() => compute_fermi_slice(fermi_data, { miller_indices: [1, 0, 0] })).toThrow(
      /Degenerate plane normal.*zero-length normal/,
    )
  })

  test(`produces ordered contour points (not random scribbles)`, () => {
    const fermi_data = create_test_fermi_data()
    const slice = compute_fermi_slice(fermi_data, {
      miller_indices: [0, 0, 1],
      distance: 0.05,
    })

    // Each isoline should have ordered points where consecutive points are close
    for (const isoline of slice.isolines) {
      if (isoline.points_2d.length < 2) continue

      for (let idx = 0; idx < isoline.points_2d.length - 1; idx++) {
        const [x1, y1] = isoline.points_2d[idx]
        const [x2, y2] = isoline.points_2d[idx + 1]
        const dist = Math.hypot(x2 - x1, y2 - y1)
        // Consecutive points should be close (within a reasonable mesh edge length)
        // This ensures contours are traced, not random scribbles
        expect(dist).toBeLessThan(1.0)
      }
    }
  })

  test(`correctly handles quad faces (4 vertices per face)`, () => {
    // Create a simple box with quad faces instead of triangles
    // This tests the fix for the bug where only the first 3 edges were checked
    const vertices: Vec3[] = [
      [-0.5, -0.5, 0],
      [0.5, -0.5, 0],
      [0.5, 0.5, 0],
      [-0.5, 0.5, 0],
      [-0.5, -0.5, 0.1],
      [0.5, -0.5, 0.1],
      [0.5, 0.5, 0.1],
      [-0.5, 0.5, 0.1],
    ]

    // Use quad faces (4 vertices each) instead of triangles
    const faces: number[][] = [
      [0, 1, 2, 3], // bottom quad
      [4, 7, 6, 5], // top quad
      [0, 4, 5, 1], // front quad
      [2, 6, 7, 3], // back quad
      [0, 3, 7, 4], // left quad
      [1, 5, 6, 2], // right quad
    ]

    const normals: Vec3[] = vertices.map(() => [0, 0, 1])

    const fermi_data: FermiSurfaceData = {
      isosurfaces: [
        {
          vertices,
          faces,
          normals,
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
      metadata: {
        n_bands: 1,
        n_surfaces: 1,
        total_area: 1,
      },
    }

    // Slice at z=0.05 should intersect the side faces
    const slice = compute_fermi_slice(fermi_data, {
      miller_indices: [0, 0, 1],
      distance: 0.05,
    })

    // Should produce isolines since the plane intersects the box
    expect(slice.isolines.length).toBeGreaterThan(0)

    // The isoline should form a closed rectangular contour
    // With quad faces, edges 3->0 (the 4th edge) must be checked for intersections
    const total_points = slice.isolines.reduce(
      (sum, line) => sum + line.points_2d.length,
      0,
    )
    expect(total_points).toBeGreaterThan(0)
  })
})

describe(`detect_irreducible_bz`, () => {
  const identity_lattice: Matrix3x3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]

  test(`returns true for vertices in positive octant only`, () => {
    const fermi_data: FermiSurfaceData = {
      isosurfaces: [
        {
          vertices: [
            [0.1, 0.2, 0.3],
            [0.5, 0.5, 0.5],
            [0.8, 0.4, 0.2],
            [0.3, 0.6, 0.1],
            [0.2, 0.2, 0.2],
            [0.4, 0.3, 0.5],
            [0.1, 0.1, 0.1],
            [0.7, 0.7, 0.7],
            [0.6, 0.4, 0.3],
            [0.5, 0.5, 0.4],
            [0.3, 0.3, 0.3],
          ],
          faces: [[0, 1, 2]],
          normals: [],
          band_index: 0,
          spin: null,
        },
      ],
      k_lattice: identity_lattice,
      fermi_energy: 0,
      reciprocal_cell: `wigner_seitz`,
      metadata: { n_bands: 1, n_surfaces: 1, total_area: 1 },
    }

    expect(detect_irreducible_bz(fermi_data)).toBe(true)
  })

  test(`returns false for vertices spanning full BZ`, () => {
    const fermi_data: FermiSurfaceData = {
      isosurfaces: [
        {
          vertices: [
            [0.5, 0.5, 0.5],
            [-0.5, 0.5, 0.5],
            [0.5, -0.5, 0.5],
            [0.5, 0.5, -0.5],
            [-0.5, -0.5, 0.5],
            [0.5, -0.5, -0.5],
            [-0.5, 0.5, -0.5],
            [-0.5, -0.5, -0.5],
            [0, 0, 0],
            [0.3, -0.2, 0.1],
            [-0.1, 0.4, -0.3],
          ],
          faces: [[0, 1, 2]],
          normals: [],
          band_index: 0,
          spin: null,
        },
      ],
      k_lattice: identity_lattice,
      fermi_energy: 0,
      reciprocal_cell: `wigner_seitz`,
      metadata: { n_bands: 1, n_surfaces: 1, total_area: 1 },
    }

    expect(detect_irreducible_bz(fermi_data)).toBe(false)
  })

  test(`returns false for empty isosurfaces`, () => {
    const fermi_data: FermiSurfaceData = {
      isosurfaces: [],
      k_lattice: identity_lattice,
      fermi_energy: 0,
      reciprocal_cell: `wigner_seitz`,
      metadata: { n_bands: 0, n_surfaces: 0, total_area: 0 },
    }

    expect(detect_irreducible_bz(fermi_data)).toBe(false)
  })

  test(`returns false for too few vertices`, () => {
    const fermi_data: FermiSurfaceData = {
      isosurfaces: [
        {
          vertices: [
            [0.1, 0.2, 0.3],
            [0.5, 0.5, 0.5],
          ],
          faces: [],
          normals: [],
          band_index: 0,
          spin: null,
        },
      ],
      k_lattice: identity_lattice,
      fermi_energy: 0,
      reciprocal_cell: `wigner_seitz`,
      metadata: { n_bands: 1, n_surfaces: 1, total_area: 0 },
    }

    // Only 2 vertices, needs > 10 to be considered valid irreducible data
    expect(detect_irreducible_bz(fermi_data)).toBe(false)
  })
})
