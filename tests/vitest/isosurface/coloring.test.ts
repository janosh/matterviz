// Tests for colormap LUTs and scalar-to-vertex-color mapping
import {
  auto_color_config,
  compute_scalar_range,
  is_signed_range,
  scalars_to_vertex_colors,
} from '$lib/isosurface/coloring'
import { describe, expect, test } from 'vitest'

const viridis_opts = {
  colormap: `interpolateViridis` as const,
  color_range: [0, 10] as [number, number],
  fallback_color: `#ff0000`,
}

const rgb_at = (colors: Float32Array, idx: number): number[] => [
  colors[idx * 3],
  colors[idx * 3 + 1],
  colors[idx * 3 + 2],
]

describe(`scalars_to_vertex_colors`, () => {
  test.each([`interpolateViridis`, `interpolateRdBu`] as const)(
    `produces valid RGB triplets for %s`,
    (cmap) => {
      const colors = scalars_to_vertex_colors(new Float32Array([0, 5, 10]), {
        ...viridis_opts,
        colormap: cmap,
      })
      expect(colors).toHaveLength(9)
      for (const channel of colors) {
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(1)
      }
    },
  )

  test(`outputs linear-space RGB (sRGB values from d3 are converted)`, () => {
    // Viridis start is #440154 in sRGB; Three.js vertex colors must be linear.
    // Linear conversion of (0x44, 0x01, 0x54)/255 ≈ (0.0578, 0.0003, 0.0888).
    const colors = scalars_to_vertex_colors(new Float32Array([0]), viridis_opts)
    expect(colors[0]).toBeCloseTo(0.0578, 3)
    expect(colors[1]).toBeCloseTo(0.0003, 3)
    expect(colors[2]).toBeCloseTo(0.0888, 3)
  })

  test(`maps range endpoints to LUT ends and clamps outside values`, () => {
    const colors = scalars_to_vertex_colors(new Float32Array([0, 10, -5, 25]), viridis_opts)
    // Below-range clamps to the same color as the range start
    expect(rgb_at(colors, 2)).toEqual(rgb_at(colors, 0))
    // Above-range clamps to the same color as the range end
    expect(rgb_at(colors, 3)).toEqual(rgb_at(colors, 1))
    // Start and end colors differ
    expect(rgb_at(colors, 0)).not.toEqual(rgb_at(colors, 1))
  })

  test(`inverted color range flips the colormap`, () => {
    const forward = scalars_to_vertex_colors(new Float32Array([0, 10]), {
      ...viridis_opts,
      color_range: [0, 10],
    })
    const flipped = scalars_to_vertex_colors(new Float32Array([0, 10]), {
      ...viridis_opts,
      color_range: [10, 0],
    })
    expect(rgb_at(flipped, 0)).toEqual(rgb_at(forward, 1))
    expect(rgb_at(flipped, 1)).toEqual(rgb_at(forward, 0))
  })

  test.each([
    { value: NaN, label: `NaN` },
    { value: Infinity, label: `Infinity` },
    { value: -Infinity, label: `-Infinity` },
  ])(`$label scalars get the fallback color in linear space`, ({ value }) => {
    // #808080 is 0.502 in sRGB → ≈0.2158 linear (discriminates the two spaces)
    const colors = scalars_to_vertex_colors(new Float32Array([value]), {
      ...viridis_opts,
      fallback_color: `#808080`,
    })
    expect(colors[0]).toBeCloseTo(0.2158, 3)
    expect(colors[1]).toBeCloseTo(0.2158, 3)
    expect(colors[2]).toBeCloseTo(0.2158, 3)
  })

  test(`zero-span range maps everything to one mid color`, () => {
    const colors = scalars_to_vertex_colors(new Float32Array([5, 7]), {
      ...viridis_opts,
      color_range: [5, 5],
    })
    expect(rgb_at(colors, 0)).toEqual(rgb_at(colors, 1))
  })

  test(`fills a caller-provided output array in place when sizes match`, () => {
    const out = new Float32Array(6)
    const colors = scalars_to_vertex_colors(new Float32Array([0, 10]), viridis_opts, out)
    expect(colors).toBe(out)
    // Mismatched size allocates a fresh array instead
    const fresh = scalars_to_vertex_colors(new Float32Array([0, 5, 10]), viridis_opts, out)
    expect(fresh).not.toBe(out)
    expect(fresh).toHaveLength(9)
  })
})

describe(`compute_scalar_range`, () => {
  test.each([
    {
      arrays: [[1, 2, 3]],
      options: {},
      expected: [1, 3],
      label: `positive values keep [min, max]`,
    },
    {
      arrays: [[-2, 5]],
      options: {},
      expected: [-5, 5],
      label: `mixed-sign values get symmetric range`,
    },
    {
      arrays: [[2, 5]],
      options: { symmetric: true },
      expected: [-5, 5],
      label: `symmetric option forces zero-centered range for one-signed samples`,
    },
    {
      arrays: [[-4, -1]],
      options: { symmetric: true },
      expected: [-4, 4],
      label: `symmetric option covers negative-only samples`,
    },
    {
      arrays: [
        [1, NaN, 4],
        [2, Infinity, 8],
      ],
      options: {},
      expected: [1, 8],
      label: `multiple arrays merge, non-finite values ignored`,
    },
    {
      arrays: [[NaN, Infinity]],
      options: {},
      expected: [0, 1],
      label: `all-non-finite falls back to [0, 1]`,
    },
    { arrays: [], options: {}, expected: [0, 1], label: `empty input falls back to [0, 1]` },
  ])(`$label`, ({ arrays, options, expected }) => {
    const scalar_arrays = arrays.map((values) => new Float32Array(values))
    expect(compute_scalar_range(scalar_arrays, options)).toEqual(expected)
  })
})

describe(`is_signed_range`, () => {
  test.each([
    { range: { min: -3, max: 5, abs_max: 5, mean: 0 }, signed: true },
    { range: { min: 0, max: 8, abs_max: 8, mean: 2 }, signed: false },
    // Tiny negative noise below 1% of abs_max doesn't count as signed
    { range: { min: -0.001, max: 8, abs_max: 8, mean: 2 }, signed: false },
    { range: { min: -8, max: 0.001, abs_max: 8, mean: -2 }, signed: false },
  ])(`min=$range.min max=$range.max → $signed`, ({ range, signed }) => {
    expect(is_signed_range(range)).toBe(signed)
  })
})

describe(`auto_color_config`, () => {
  test(`signed data gets diverging RdBu with symmetric range`, () => {
    const config = auto_color_config({ min: -3, max: 5, abs_max: 5, mean: 0.2 })
    expect(config.colormap).toBe(`interpolateRdBu`)
    expect(config.color_range).toEqual([-5, 5])
  })

  test.each([
    { range: { min: 0, max: 8, abs_max: 8, mean: 2 }, label: `non-negative` },
    { range: { min: 0.01, max: 8, abs_max: 8, mean: 2 }, label: `positive` },
  ])(`$label data gets Viridis over [min, max]`, ({ range }) => {
    const config = auto_color_config(range)
    expect(config.colormap).toBe(`interpolateViridis`)
    expect(config.color_range).toEqual([range.min, range.max])
  })
})
