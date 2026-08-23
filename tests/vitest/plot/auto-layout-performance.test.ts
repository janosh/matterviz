import {
  clear_tick_metrics_cache,
  resolve_tick_layout,
  type MeasuredAxis,
} from '$lib/plot/core/layout'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { mock_canvas_context } from '../setup'

const CI_MULTIPLIER = [`true`, `1`].includes(process.env.CI ?? ``) ? 5 : 1
const AXIS_SIZE = 1200
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

describe(`adaptive layout performance`, { timeout: 10_000 * CI_MULTIPLIER }, () => {
  beforeAll(() => {
    mock_canvas_context({ measureText: measure_text })
  })

  afterAll(() => {
    clear_tick_metrics_cache()
    vi.restoreAllMocks()
  })

  test(`default strategies keep text measurement work near-linear`, () => {
    const results = [100, 500].map((tick_count) => {
      clear_tick_metrics_cache()
      measure_text.mockClear()
      const layout = resolve_tick_layout(generated_axis(tick_count), AXIS_SIZE, `x`)
      const measure_text_calls = measure_text.mock.calls.length
      expect(layout.labels).toHaveLength(tick_count)
      expect(layout.visible_tick_indices.length).toBeGreaterThanOrEqual(2)
      expect(
        layout.labels.every(
          ({ visible, lines }) => !visible || !/^…*$/u.test(lines.join(`\n`).trim()),
        ),
      ).toBe(true)
      return { layout, measure_text_calls }
    })
    const [small, large] = results
    expect(small.measure_text_calls).toBeGreaterThan(0)
    expect(large.measure_text_calls).toBeGreaterThan(small.measure_text_calls)
    expect(large.measure_text_calls / small.measure_text_calls).toBeLessThan(6)
    expect(large.layout.visible_tick_indices.length).toBeGreaterThan(2)
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
  })
})
