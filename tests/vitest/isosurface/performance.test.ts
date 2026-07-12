import { scalars_to_vertex_colors } from '$lib/isosurface/coloring'
import { parse_volumetric_file } from '$lib/isosurface/parse'
import { extract_volume_range, sample_volume_at_positions } from '$lib/isosurface/sampling'
import { marching_cubes_buffers } from '$lib/marching-cubes'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'

const MC_OPTIONS = { periodic: false, centered: false, normals: false } as const

interface Benchmark<Result> {
  result: Result
  stats: { median_ms: number; p95_ms: number }
}

const benchmark = <Result>(operation: () => Result, iterations = 5): Benchmark<Result> => {
  let result = operation()
  result = operation()
  const samples = Array.from({ length: iterations }, () => {
    const start_time = performance.now()
    result = operation()
    return performance.now() - start_time
  }).sort((left, right) => left - right)
  const percentile = (fraction: number): number =>
    samples[Math.min(samples.length - 1, Math.ceil(samples.length * fraction) - 1)] ?? 0
  return { result, stats: { median_ms: percentile(0.5), p95_ms: percentile(0.95) } }
}

describe.runIf(process.env.MATTERVIZ_PERF === `1`)(`isosurface detailed performance`, () => {
  test(`reports parse, extraction, marching-cubes, sampling, and recolor baselines`, () => {
    const compressed = readFileSync(
      resolve(import.meta.dirname, `../../../src/site/isosurfaces/large-grid-CHGCAR.gz`),
    )
    const decompression = benchmark(() => gunzipSync(compressed), 3)
    const source_text = decompression.result.toString(`utf8`)
    const parsing = benchmark(
      () => parse_volumetric_file(source_text, `large-grid-CHGCAR.gz`),
      3,
    )
    const parsed_volume = parsing.result?.volumes[0]
    if (!parsed_volume) throw new Error(`performance fixture produced no volume`)

    const extraction = benchmark(
      () =>
        extract_volume_range(parsed_volume, [
          [-0.15, 1.15],
          [-0.1, 1.1],
          [0, 1],
        ]),
      3,
    )
    const extracted = extraction.result
    const isovalue = parsed_volume.data_range.abs_max * 0.2
    const marching_buffers = benchmark(() =>
      marching_cubes_buffers(extracted.grid, isovalue, extracted.lattice, MC_OPTIONS),
    )
    const positions = marching_buffers.result.positions
    const sampling = benchmark(() => sample_volume_at_positions(parsed_volume, positions))
    const recolor = benchmark(
      () =>
        scalars_to_vertex_colors(sampling.result, {
          colormap: `interpolateViridis`,
          color_range: [parsed_volume.data_range.min, parsed_volume.data_range.max],
        }),
      7,
    )

    const timings = {
      decompress: decompression.stats,
      parse: parsing.stats,
      extract_range: extraction.stats,
      marching_cubes_buffers: marching_buffers.stats,
      sample_scalars: sampling.stats,
      recolor: recolor.stats,
    }
    console.info(
      `MATTERVIZ_ISOSURFACE_PROFILE`,
      JSON.stringify({
        grid_dims: parsed_volume.grid_dims,
        extracted_dims: extracted.grid_dims,
        vertices: positions.length / 3,
        triangles: marching_buffers.result.indices.length / 3,
        timings,
      }),
    )

    expect(sampling.result).toHaveLength(positions.length / 3)
    expect(recolor.result).toHaveLength(positions.length)
  }, 120_000)
})
