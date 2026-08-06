import {
  clear_tick_metrics_cache,
  resolve_tick_layout,
  type MeasuredAxis,
} from '$lib/plot/core/layout'
import { analyze_tick_label_geometry, type TickLabelItem } from '$lib/plot/core/tick-geometry'
import {
  create_tick_candidate,
  select_tick_candidate,
  TICK_STRATEGIES,
  type MeasuredTickCandidate,
  type TickCandidateLabelInput,
  type TickStrategy,
} from '$lib/plot/core/tick-strategies'
import { solve_decorations, type DecorationScene } from '$lib/plot/core/decorations'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

const AXIS_SIZE = 1200
const CI_MULTIPLIER = [`true`, `1`].includes(process.env.CI ?? ``) ? 4 : 1
const benchmark_measurements: { workload: string; elapsed_ms: number }[] = []

const best_of = <Result>(
  repetitions: number,
  run: () => Result,
  setup: () => void = () => {},
): { elapsed_ms: number; result: Result } => {
  if (repetitions < 1) throw new Error(`repetitions must be positive, got ${repetitions}`)
  setup()
  let started = performance.now()
  let best_result = run()
  let best_ms = performance.now() - started
  for (let repetition = 1; repetition < repetitions; repetition++) {
    setup()
    started = performance.now()
    const result = run()
    const elapsed_ms = performance.now() - started
    if (elapsed_ms < best_ms) {
      best_ms = elapsed_ms
      best_result = result
    }
  }
  return { elapsed_ms: best_ms, result: best_result }
}

const generated_labels = (tick_count: number): string[] =>
  Array.from(
    { length: tick_count },
    (_unused, tick_idx) =>
      `Phase ${String(tick_idx).padStart(3, `0`)} formation-energy average temperature`,
  )

const generated_positions = (tick_count: number): number[] =>
  Array.from({ length: tick_count }, (_unused, tick_idx) =>
    tick_count === 1 ? AXIS_SIZE / 2 : (tick_idx * AXIS_SIZE) / (tick_count - 1),
  )

const generated_axis = (tick_count: number): MeasuredAxis => ({
  tick_values: generated_labels(tick_count),
  tick_positions: generated_positions(tick_count),
  axis_extent: { start: 0, end: AXIS_SIZE },
  tick: {
    label: {
      max_lines: 3,
      auto_layout: { strategies: [`wrap`], endpoint_policy: `preserve` },
    },
  },
})

const generated_geometry_items = (tick_count: number): TickLabelItem[] => {
  const labels = generated_labels(tick_count)
  const positions = generated_positions(tick_count)
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

const candidate_labels = (
  labels: readonly string[],
  strategy: TickStrategy,
): TickCandidateLabelInput[] =>
  labels.map((full_text, tick_idx) => ({
    full_text,
    display_lines:
      strategy === `wrap`
        ? [`Phase ${tick_idx}`, `formation-energy`, `average temperature`]
        : [strategy === `ellipsis` ? `${full_text.slice(0, 12)}…` : full_text],
    visible: strategy !== `thin` || tick_idx % 2 === 0,
    stagger_row: strategy === `stagger` && tick_idx % 2 === 1 ? 1 : 0,
    information_loss: strategy === `abbreviate` ? 0.2 : strategy === `ellipsis` ? 0.5 : 0,
  }))

const generated_measured_candidates = (tick_count: number): MeasuredTickCandidate[] => {
  const labels = generated_labels(tick_count)
  return TICK_STRATEGIES.map((strategy, strategy_idx) => ({
    candidate: create_tick_candidate({
      id: strategy,
      strategy,
      labels: candidate_labels(labels, strategy),
      rotation_deg: strategy === `rotate` ? 45 : 0,
    }),
    measurements: {
      collisions: 0,
      edge_overflow_px: 0,
      band_fraction: 0.25 + strategy_idx * 0.1,
    },
  }))
}

const generated_obstacles = (obstacle_count: number): DecorationScene[`obstacles_norm`] =>
  Array.from({ length: obstacle_count }, (_unused, obstacle_idx) => ({
    x: (((obstacle_idx * 73) % obstacle_count) + 0.5) / obstacle_count,
    y: (((obstacle_idx * 197) % obstacle_count) + 0.5) / obstacle_count,
  }))

const tick_cases = [
  { tick_count: 20, wrap_ceiling_ms: 100, geometry_ceiling_ms: 50, scoring_ceiling_ms: 50 },
  {
    tick_count: 100,
    wrap_ceiling_ms: 350,
    geometry_ceiling_ms: 120,
    scoring_ceiling_ms: 120,
  },
  {
    tick_count: 500,
    wrap_ceiling_ms: 1500,
    geometry_ceiling_ms: 400,
    scoring_ceiling_ms: 400,
  },
] as const

describe(`adaptive layout performance`, () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue({
      font: ``,
      measureText: (text: string) => ({ width: Array.from(text).length * 6 }),
    } as unknown as CanvasRenderingContext2D)
  })

  afterAll(() => {
    const timings = benchmark_measurements.map(({ workload, elapsed_ms }) => ({
      workload,
      elapsed_ms: Math.round(elapsed_ms * 100) / 100,
    }))
    console.info(`adaptive layout benchmark timings: ${JSON.stringify(timings)}`)
    clear_tick_metrics_cache()
    vi.restoreAllMocks()
  })

  test.each(tick_cases)(
    `$tick_count ticks keep wrap, geometry, and scoring bounded`,
    ({ tick_count, wrap_ceiling_ms, geometry_ceiling_ms, scoring_ceiling_ms }) => {
      const axis = generated_axis(tick_count)
      const wrap = best_of(
        2,
        () => resolve_tick_layout(axis, AXIS_SIZE, `x`),
        clear_tick_metrics_cache,
      )
      benchmark_measurements.push({
        workload: `wrap-${tick_count}`,
        elapsed_ms: wrap.elapsed_ms,
      })
      expect(wrap.result).toMatchObject({
        strategy: `wrap`,
        rotation: 0,
        visible_tick_indices: Array.from(
          { length: tick_count },
          (_unused, tick_idx) => tick_idx,
        ),
      })
      expect(wrap.result.labels).toHaveLength(tick_count)
      expect(
        wrap.result.labels.every(
          ({ full_text, lines, visible }) =>
            full_text.length > 0 && lines.length >= 1 && lines.length <= 3 && visible,
        ),
      ).toBe(true)
      expect(
        wrap.elapsed_ms,
        `${tick_count}-tick cold wrap took ${wrap.elapsed_ms}ms`,
      ).toBeLessThan(wrap_ceiling_ms * CI_MULTIPLIER)

      const geometry_items = generated_geometry_items(tick_count)
      const geometry = best_of(3, () =>
        analyze_tick_label_geometry({
          items: geometry_items,
          side: `x`,
          axis_extent: { start: 0, end: AXIS_SIZE },
          gap: 4,
          edge_gap: 2,
          collision_method: `sweep`,
        }),
      )
      benchmark_measurements.push({
        workload: `geometry-${tick_count}`,
        elapsed_ms: geometry.elapsed_ms,
      })
      expect(geometry.result.labels).toHaveLength(tick_count)
      expect(geometry.result.collisions.count).toBe(geometry.result.collisions.pairs.length)
      expect(
        geometry.result.labels.every(({ aabb }) =>
          [aabb.min_x, aabb.min_y, aabb.max_x, aabb.max_y, aabb.width, aabb.height].every(
            Number.isFinite,
          ),
        ),
      ).toBe(true)
      expect(
        geometry.result.collisions.pairs.every(
          ({ first_idx, second_idx }) =>
            first_idx >= 0 && first_idx < second_idx && second_idx < tick_count,
        ),
      ).toBe(true)
      expect(
        geometry.elapsed_ms,
        `${tick_count}-tick geometry took ${geometry.elapsed_ms}ms`,
      ).toBeLessThan(geometry_ceiling_ms * CI_MULTIPLIER)

      const measured_candidates = generated_measured_candidates(tick_count)
      const scoring = best_of(3, () => select_tick_candidate(measured_candidates))
      benchmark_measurements.push({
        workload: `scoring-${tick_count}`,
        elapsed_ms: scoring.elapsed_ms,
      })
      expect(scoring.result.winner?.candidate.id).toBe(`upright`)
      expect(scoring.result.evaluated).toHaveLength(TICK_STRATEGIES.length)
      expect(scoring.result.evaluated.map(({ candidate }) => candidate.id).toSorted()).toEqual(
        [...TICK_STRATEGIES].toSorted(),
      )
      expect(
        scoring.elapsed_ms,
        `${tick_count}-tick scoring took ${scoring.elapsed_ms}ms`,
      ).toBeLessThan(scoring_ceiling_ms * CI_MULTIPLIER)
    },
    3000,
  )

  test(`500-tick layout cache makes identical hot lookups cheap`, () => {
    const axis = generated_axis(500)
    clear_tick_metrics_cache()
    const cold_started = performance.now()
    const cold_result = resolve_tick_layout(axis, AXIS_SIZE, `x`)
    const cold_ms = performance.now() - cold_started

    const hot_repetitions = 50
    const hot_batch = best_of(3, () => {
      let result = cold_result
      for (let repetition = 0; repetition < hot_repetitions; repetition++) {
        result = resolve_tick_layout(axis, AXIS_SIZE, `x`)
        if (result !== cold_result) {
          throw new Error(`identical adaptive-layout input missed the public cache`)
        }
      }
      return result
    })
    const hot_average_ms = hot_batch.elapsed_ms / hot_repetitions
    benchmark_measurements.push(
      { workload: `cache-cold-500`, elapsed_ms: cold_ms },
      { workload: `cache-hot-500`, elapsed_ms: hot_average_ms },
    )

    expect(hot_batch.result).toBe(cold_result)
    expect(cold_result.labels).toHaveLength(500)
    expect(cold_ms, `500-tick cold layout took ${cold_ms}ms`).toBeLessThan(
      1500 * CI_MULTIPLIER,
    )
    expect(hot_average_ms, `500-tick hot layout averaged ${hot_average_ms}ms`).toBeLessThan(
      10 * CI_MULTIPLIER,
    )
  })

  test(`decoration solve stays bounded with 1k obstacles`, () => {
    const scene: DecorationScene = {
      width: 800,
      height: 500,
      base_pad: { t: 24, r: 28, b: 48, l: 56 },
      obstacles_norm: generated_obstacles(1000),
      items: [
        {
          id: `note`,
          kind: `free-annotation`,
          footprint: { width: 120, height: 72 },
          clearance: 12,
        },
      ],
      grid_resolution: 10,
    }
    const solve = best_of(3, () => solve_decorations(scene))
    benchmark_measurements.push({
      workload: `decoration-1000-obstacles`,
      elapsed_ms: solve.elapsed_ms,
    })

    expect(scene.obstacles_norm).toHaveLength(1000)
    expect(solve.result.placements).toHaveLength(1)
    const [placement] = solve.result.placements
    expect(placement).toMatchObject({
      id: `note`,
      kind: `free-annotation`,
      location: `interior`,
      side: null,
    })
    expect([placement.x, placement.y, placement.score]).toSatisfy((values: unknown[]) =>
      values.every((value) => typeof value === `number` && Number.isFinite(value)),
    )
    expect(placement.x).toBeGreaterThanOrEqual(solve.result.plot_bounds.x)
    expect(placement.y).toBeGreaterThanOrEqual(solve.result.plot_bounds.y)
    expect(placement.x + placement.footprint.width).toBeLessThanOrEqual(
      solve.result.plot_bounds.x + solve.result.plot_bounds.width,
    )
    expect(placement.y + placement.footprint.height).toBeLessThanOrEqual(
      solve.result.plot_bounds.y + solve.result.plot_bounds.height,
    )
    expect(
      solve.elapsed_ms,
      `1k-obstacle decoration solve took ${solve.elapsed_ms}ms`,
    ).toBeLessThan(150 * CI_MULTIPLIER)
  })
})
