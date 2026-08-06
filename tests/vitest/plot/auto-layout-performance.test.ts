import {
  clear_tick_metrics_cache,
  resolve_tick_layout,
  type MeasuredAxis,
} from '$lib/plot/core/layout'
import { analyze_tick_label_geometry, type TickLabelItem } from '$lib/plot/core/tick-geometry'
import { SvelteMap } from 'svelte/reactivity'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

const CI_MULTIPLIER = [`true`, `1`].includes(process.env.CI ?? ``) ? 5 : 1
const AXIS_SIZE = 1200
const operation_measurements: {
  workload: string
  measure_text_calls?: number
  elapsed_ms?: number
}[] = []
const measure_text = vi.fn((text: string) => ({ width: Array.from(text).length * 6 }))

const generated_labels = (tick_count: number): string[] =>
  Array.from(
    { length: tick_count },
    (_unused, tick_idx) =>
      `Phase ${String(tick_idx).padStart(3, `0`)} formation-energy average temperature`,
  )

const generated_positions = (tick_count: number, axis_size = AXIS_SIZE): number[] =>
  Array.from({ length: tick_count }, (_unused, tick_idx) =>
    tick_count === 1 ? axis_size / 2 : (tick_idx * axis_size) / (tick_count - 1),
  )

const generated_axis = (tick_count: number, axis_size = AXIS_SIZE): MeasuredAxis => ({
  tick_values: generated_labels(tick_count),
  tick_positions: generated_positions(tick_count, axis_size),
  axis_extent: { start: 0, end: axis_size },
  tick: {
    label: {
      max_lines: 3,
      // Exercise the real default strategy set, including bounded thin+rotate composition.
      auto_layout: { endpoint_policy: `preserve` },
    },
  },
})

const generated_geometry_items = (tick_count: number, axis_size: number): TickLabelItem[] => {
  const labels = generated_labels(tick_count)
  const positions = generated_positions(tick_count, axis_size)
  return labels.map((label, tick_idx) => {
    const multiline = tick_idx % 4 === 0
    const lines = multiline ? [label, `secondary ${tick_idx}`] : [label]
    const base_position = positions[tick_idx]
    const jitter =
      tick_idx === 0 || tick_idx === tick_count - 1 ? 0 : (((tick_idx * 37) % 11) - 5) * 0.08
    return {
      id: tick_idx,
      lines,
      position: { axis: base_position + jitter, cross_axis: (tick_idx % 2) * 18 },
      rotation: [0, -30, 45][tick_idx % 3],
      stagger_row: tick_idx % 2,
      dimensions: {
        line_widths: lines.map((_line, line_idx) => 24 + ((tick_idx + line_idx) % 9) * 3),
        line_height: 14,
      },
    }
  })
}

const best_batch_ms = (repetitions: number, run: () => void): number => {
  let best_ms = Number.POSITIVE_INFINITY
  for (let batch_idx = 0; batch_idx < 3; batch_idx++) {
    const started = performance.now()
    for (let repetition_idx = 0; repetition_idx < repetitions; repetition_idx++) run()
    best_ms = Math.min(best_ms, performance.now() - started)
  }
  return best_ms
}

describe(`adaptive layout performance`, { timeout: 10_000 * CI_MULTIPLIER }, () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue({
      font: ``,
      measureText: measure_text,
    } as unknown as CanvasRenderingContext2D)
  })

  afterAll(() => {
    console.info(
      `adaptive layout operation measurements: ${JSON.stringify(operation_measurements)}`,
    )
    clear_tick_metrics_cache()
    vi.restoreAllMocks()
  })

  test(`default strategies keep text measurement work near-linear`, () => {
    const calls_by_count = new SvelteMap<number, number>()
    const layouts = new SvelteMap<number, ReturnType<typeof resolve_tick_layout>>()

    for (const tick_count of [100, 500]) {
      clear_tick_metrics_cache()
      measure_text.mockClear()
      const layout = resolve_tick_layout(generated_axis(tick_count), AXIS_SIZE, `x`)
      const measure_text_calls = measure_text.mock.calls.length
      calls_by_count.set(tick_count, measure_text_calls)
      layouts.set(tick_count, layout)
      operation_measurements.push({
        workload: `default-layout-${tick_count}`,
        measure_text_calls,
      })

      expect(layout.labels).toHaveLength(tick_count)
      expect(layout.visible_tick_indices.length).toBeGreaterThanOrEqual(2)
      expect(
        layout.labels.every(
          ({ visible, display_text }) => !visible || !/^…*$/u.test(display_text.trim()),
        ),
      ).toBe(true)
    }

    const calls_100 = calls_by_count.get(100)
    const calls_500 = calls_by_count.get(500)
    if (calls_100 == null || calls_500 == null) {
      throw new Error(`Missing text-operation measurements`)
    }
    expect(calls_100).toBeGreaterThan(0)
    expect(calls_500).toBeGreaterThan(calls_100)
    expect(calls_500 / calls_100).toBeLessThan(6 * CI_MULTIPLIER)
    expect(layouts.get(500)?.visible_tick_indices.length).toBeGreaterThan(2)
  })

  test(`sweep geometry scales sub-quadratically on bounded-overlap labels`, () => {
    const geometry_by_count = new SvelteMap<
      number,
      ReturnType<typeof analyze_tick_label_geometry>
    >()
    const elapsed_by_count = new SvelteMap<number, number>()
    const repetitions = 20 * CI_MULTIPLIER

    for (const tick_count of [100, 500]) {
      const axis_size = tick_count * 12
      const items = generated_geometry_items(tick_count, axis_size)
      const analyze = () =>
        analyze_tick_label_geometry({
          items,
          side: `x`,
          axis_extent: { start: 0, end: axis_size },
          gap: 4,
          edge_gap: 2,
          collision_method: `sweep`,
        })
      const geometry = analyze()
      const elapsed_ms = best_batch_ms(repetitions, analyze)
      geometry_by_count.set(tick_count, geometry)
      elapsed_by_count.set(tick_count, elapsed_ms)
      operation_measurements.push({
        workload: `geometry-${repetitions}x-${tick_count}`,
        elapsed_ms,
      })

      expect(geometry.labels).toHaveLength(tick_count)
      expect(geometry.collisions.count).toBe(geometry.collisions.pairs.length)
      expect(
        geometry.labels.every(({ aabb }) =>
          [aabb.min_x, aabb.min_y, aabb.max_x, aabb.max_y, aabb.width, aabb.height].every(
            Number.isFinite,
          ),
        ),
      ).toBe(true)
    }

    const elapsed_100 = elapsed_by_count.get(100)
    const elapsed_500 = elapsed_by_count.get(500)
    if (elapsed_100 == null || elapsed_500 == null) {
      throw new Error(`Missing geometry scaling measurements`)
    }
    expect(elapsed_500 / elapsed_100).toBeLessThan(10 * CI_MULTIPLIER)
    expect(geometry_by_count.get(500)?.collisions.pairs.length).toBeGreaterThan(0)
  })

  test(`cache hits and translated resize layouts add no text measurements`, () => {
    const axis = generated_axis(500)
    clear_tick_metrics_cache()
    measure_text.mockClear()
    const cold_result = resolve_tick_layout(axis, AXIS_SIZE, `x`)
    const cold_measurements = measure_text.mock.calls.length
    expect(cold_measurements).toBeGreaterThan(0)

    measure_text.mockClear()
    for (let repetition_idx = 0; repetition_idx < 50; repetition_idx++) {
      expect(resolve_tick_layout(axis, AXIS_SIZE, `x`)).toBe(cold_result)
    }
    expect(measure_text).not.toHaveBeenCalled()

    const resized_axis = generated_axis(500, AXIS_SIZE / 2)
    const resized_result = resolve_tick_layout(resized_axis, AXIS_SIZE / 2, `x`)
    expect(resized_result).not.toBe(cold_result)
    expect(resized_result.labels).toHaveLength(500)
    expect(resolve_tick_layout(axis, AXIS_SIZE, `x`)).toBe(cold_result)
    expect(measure_text).not.toHaveBeenCalled()
    operation_measurements.push({
      workload: `cache-and-resize-500`,
      measure_text_calls: cold_measurements,
    })
  })
})
