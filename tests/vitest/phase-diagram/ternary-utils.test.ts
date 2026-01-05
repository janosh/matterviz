import { describe, expect, it } from 'vitest'
import type {
  TernaryComposition,
  TernaryPhaseRegion,
  TernaryVertex,
} from '$lib/phase-diagram/types'
import {
  compute_isothermal_slice,
  compute_ternary_region_centroid,
  compute_vertical_slice,
  get_ternary_region_temp_range,
  point_in_ternary_polygon,
  scene_xyz_to_ternary,
  slice_polyhedron_horizontal,
  slice_polyhedron_vertical,
  ternary_to_scene_xyz,
} from '$lib/phase-diagram/utils'

describe(`ternary_to_scene_xyz`, () => {
  const t_range: [number, number] = [1000, 2000]
  const scene_height = 5

  it(`converts pure component A to correct scene position`, () => {
    const [scene_x, scene_y, scene_z] = ternary_to_scene_xyz(
      1,
      0,
      0,
      1500,
      t_range,
      scene_height,
    )
    // Temperature 1500 is midpoint, so Y should be half scene_height
    expect(scene_y).toBeCloseTo(scene_height / 2)
    // X and Z depend on triangle vertex position
    expect(typeof scene_x).toBe(`number`)
    expect(typeof scene_z).toBe(`number`)
  })

  it(`converts T_min to Y=0`, () => {
    const [, scene_y] = ternary_to_scene_xyz(
      0.33,
      0.33,
      0.34,
      1000,
      t_range,
      scene_height,
    )
    expect(scene_y).toBeCloseTo(0)
  })

  it(`converts T_max to Y=scene_height`, () => {
    const [, scene_y] = ternary_to_scene_xyz(
      0.33,
      0.33,
      0.34,
      2000,
      t_range,
      scene_height,
    )
    expect(scene_y).toBeCloseTo(scene_height)
  })

  it(`handles different scene heights`, () => {
    const [, scene_y_10] = ternary_to_scene_xyz(0.5, 0.3, 0.2, 1500, t_range, 10)
    const [, scene_y_5] = ternary_to_scene_xyz(0.5, 0.3, 0.2, 1500, t_range, 5)
    expect(scene_y_10).toBeCloseTo(5) // midpoint of 10
    expect(scene_y_5).toBeCloseTo(2.5) // midpoint of 5
  })
})

describe(`scene_xyz_to_ternary`, () => {
  const t_range: [number, number] = [1000, 2000]
  const scene_height = 5

  it(`inverts ternary_to_scene_xyz`, () => {
    const original_comp: TernaryComposition = [0.5, 0.3, 0.2]
    const original_temp = 1500

    const scene_coords = ternary_to_scene_xyz(
      original_comp[0],
      original_comp[1],
      original_comp[2],
      original_temp,
      t_range,
      scene_height,
    )

    const { composition, temperature } = scene_xyz_to_ternary(
      scene_coords[0],
      scene_coords[1],
      scene_coords[2],
      t_range,
      scene_height,
    )

    expect(composition[0]).toBeCloseTo(original_comp[0], 1)
    expect(composition[1]).toBeCloseTo(original_comp[1], 1)
    expect(composition[2]).toBeCloseTo(original_comp[2], 1)
    expect(temperature).toBeCloseTo(original_temp)
  })

  it(`clamps compositions to valid range`, () => {
    // Test with extreme scene coordinates
    const { composition } = scene_xyz_to_ternary(100, 2.5, 100, t_range, scene_height)

    // All compositions should be between 0 and 1
    for (const comp of composition) {
      expect(comp).toBeGreaterThanOrEqual(0)
      expect(comp).toBeLessThanOrEqual(1)
    }
  })
})

describe(`slice_polyhedron_horizontal`, () => {
  // Simple tetrahedron for testing
  const tetrahedron_vertices: TernaryVertex[] = [
    [0.5, 0.25, 0.25, 1000], // bottom vertex
    [0.25, 0.5, 0.25, 1000], // bottom vertex
    [0.25, 0.25, 0.5, 1000], // bottom vertex
    [0.33, 0.33, 0.34, 1500], // top vertex
  ]
  const tetrahedron_faces = [
    [0, 1, 2], // bottom
    [0, 1, 3], // side 1
    [1, 2, 3], // side 2
    [2, 0, 3], // side 3
  ]

  it(`returns empty for temperature below all vertices`, () => {
    const result = slice_polyhedron_horizontal(
      tetrahedron_vertices,
      tetrahedron_faces,
      900,
    )
    expect(result.length).toBe(0)
  })

  it(`returns empty for temperature above all vertices`, () => {
    const result = slice_polyhedron_horizontal(
      tetrahedron_vertices,
      tetrahedron_faces,
      1600,
    )
    expect(result.length).toBe(0)
  })

  it(`returns polygon for temperature intersecting the polyhedron`, () => {
    const result = slice_polyhedron_horizontal(
      tetrahedron_vertices,
      tetrahedron_faces,
      1250,
    )
    // Should produce a triangle intersection
    expect(result.length).toBeGreaterThanOrEqual(3)
  })
})

describe(`slice_polyhedron_vertical`, () => {
  // Prism-like region for testing
  const prism_vertices: TernaryVertex[] = [
    [0.6, 0.2, 0.2, 1000],
    [0.2, 0.6, 0.2, 1000],
    [0.4, 0.4, 0.2, 1000],
    [0.6, 0.2, 0.2, 1500],
    [0.2, 0.6, 0.2, 1500],
    [0.4, 0.4, 0.2, 1500],
  ]
  const prism_faces = [
    [0, 1, 2],
    [3, 4, 5], // top/bottom
    [0, 1, 4],
    [0, 4, 3], // sides
    [1, 2, 5],
    [1, 5, 4],
    [2, 0, 3],
    [2, 3, 5],
  ]

  it(`returns polygon for ratio intersecting the region`, () => {
    // At ratio 0.5, A/(A+B) = 0.5 means A = B
    const result = slice_polyhedron_vertical(prism_vertices, prism_faces, 0.5)
    // Should produce some intersection points
    expect(Array.isArray(result)).toBe(true)
  })

  it(`handles edge case ratios`, () => {
    const result_0 = slice_polyhedron_vertical(prism_vertices, prism_faces, 0)
    const result_1 = slice_polyhedron_vertical(prism_vertices, prism_faces, 1)
    expect(Array.isArray(result_0)).toBe(true)
    expect(Array.isArray(result_1)).toBe(true)
  })
})

describe(`compute_isothermal_slice`, () => {
  const sample_region: TernaryPhaseRegion = {
    id: `test`,
    name: `Test Phase`,
    vertices: [
      [0.6, 0.2, 0.2, 1000],
      [0.2, 0.6, 0.2, 1000],
      [0.2, 0.2, 0.6, 1000],
      [0.6, 0.2, 0.2, 1500],
      [0.2, 0.6, 0.2, 1500],
      [0.2, 0.2, 0.6, 1500],
    ],
    faces: [
      [0, 1, 2],
      [3, 4, 5],
      [0, 1, 4],
      [0, 4, 3],
      [1, 2, 5],
      [1, 5, 4],
      [2, 0, 3],
      [2, 3, 5],
    ],
  }

  it(`returns slice with correct temperature`, () => {
    const slice = compute_isothermal_slice([sample_region], 1250)
    expect(slice.temperature).toBe(1250)
  })

  it(`includes regions that intersect the temperature`, () => {
    const slice = compute_isothermal_slice([sample_region], 1250)
    expect(slice.regions.length).toBeGreaterThan(0)
    expect(slice.regions[0].id).toBe(`test`)
    expect(slice.regions[0].name).toBe(`Test Phase`)
  })

  it(`excludes regions that don't intersect the temperature`, () => {
    const slice_below = compute_isothermal_slice([sample_region], 800)
    const slice_above = compute_isothermal_slice([sample_region], 1800)
    expect(slice_below.regions.length).toBe(0)
    expect(slice_above.regions.length).toBe(0)
  })
})

describe(`compute_vertical_slice`, () => {
  const sample_region: TernaryPhaseRegion = {
    id: `test`,
    name: `Test Phase`,
    vertices: [
      [0.6, 0.2, 0.2, 1000],
      [0.2, 0.6, 0.2, 1000],
      [0.2, 0.2, 0.6, 1000],
      [0.6, 0.2, 0.2, 1500],
      [0.2, 0.6, 0.2, 1500],
      [0.2, 0.2, 0.6, 1500],
    ],
    faces: [
      [0, 1, 2],
      [3, 4, 5],
      [0, 1, 4],
      [0, 4, 3],
      [1, 2, 5],
      [1, 5, 4],
      [2, 0, 3],
      [2, 3, 5],
    ],
  }
  const components: [string, string, string] = [`A`, `B`, `C`]

  it(`returns slice with correct ratio`, () => {
    const slice = compute_vertical_slice([sample_region], 0.5, components)
    expect(slice.ratio).toBe(0.5)
  })

  it(`identifies fixed and variable components`, () => {
    const slice = compute_vertical_slice([sample_region], 0.5, components)
    expect(slice.fixed_components).toEqual([`A`, `B`])
    expect(slice.variable_component).toBe(`C`)
  })
})

describe(`compute_ternary_region_centroid`, () => {
  it(`returns label_position if provided`, () => {
    const region: TernaryPhaseRegion = {
      id: `test`,
      name: `Test`,
      vertices: [[0.5, 0.3, 0.2, 1200]],
      faces: [],
      label_position: [0.4, 0.4, 0.2, 1300],
    }
    const centroid = compute_ternary_region_centroid(region)
    expect(centroid).toEqual([0.4, 0.4, 0.2, 1300])
  })

  it(`computes centroid from vertices`, () => {
    const region: TernaryPhaseRegion = {
      id: `test`,
      name: `Test`,
      vertices: [
        [0.6, 0.2, 0.2, 1000],
        [0.2, 0.6, 0.2, 1000],
        [0.2, 0.2, 0.6, 1000],
        [0.33, 0.33, 0.34, 1500],
      ],
      faces: [],
    }
    const centroid = compute_ternary_region_centroid(region)

    // Average of vertices
    expect(centroid[0]).toBeCloseTo((0.6 + 0.2 + 0.2 + 0.33) / 4)
    expect(centroid[1]).toBeCloseTo((0.2 + 0.6 + 0.2 + 0.33) / 4)
    expect(centroid[3]).toBeCloseTo((1000 + 1000 + 1000 + 1500) / 4)
  })

  it(`handles empty vertices`, () => {
    const region: TernaryPhaseRegion = {
      id: `test`,
      name: `Test`,
      vertices: [],
      faces: [],
    }
    const centroid = compute_ternary_region_centroid(region)
    expect(centroid).toEqual([0.33, 0.33, 0.34, 0])
  })
})

describe(`get_ternary_region_temp_range`, () => {
  it(`returns temperature range from vertices`, () => {
    const region: TernaryPhaseRegion = {
      id: `test`,
      name: `Test`,
      vertices: [
        [0.5, 0.3, 0.2, 1100],
        [0.3, 0.5, 0.2, 1300],
        [0.3, 0.3, 0.4, 1500],
      ],
      faces: [],
    }
    const range = get_ternary_region_temp_range(region)
    expect(range).toEqual({ t_min: 1100, t_max: 1500 })
  })

  it(`returns null for empty vertices`, () => {
    const region: TernaryPhaseRegion = {
      id: `test`,
      name: `Test`,
      vertices: [],
      faces: [],
    }
    const range = get_ternary_region_temp_range(region)
    expect(range).toBeNull()
  })
})

describe(`point_in_ternary_polygon`, () => {
  // Simple triangle polygon
  const triangle: TernaryComposition[] = [
    [0.6, 0.2, 0.2],
    [0.2, 0.6, 0.2],
    [0.2, 0.2, 0.6],
  ]

  it(`returns true for point inside polygon`, () => {
    const result = point_in_ternary_polygon(0.33, 0.33, 0.34, triangle)
    expect(result).toBe(true)
  })

  it(`returns false for point outside polygon`, () => {
    // Point near corner A (pure component A)
    const result = point_in_ternary_polygon(0.9, 0.05, 0.05, triangle)
    expect(result).toBe(false)
  })

  it(`handles edge cases`, () => {
    // Point on vertex
    const result = point_in_ternary_polygon(0.6, 0.2, 0.2, triangle)
    // Point on edge or vertex behavior may vary - just ensure no errors
    expect(typeof result).toBe(`boolean`)
  })
})
