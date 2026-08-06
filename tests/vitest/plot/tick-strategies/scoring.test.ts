import { TICK_GEOMETRY_EPSILON } from '$lib/plot/core/tick-geometry'
import {
  create_tick_candidate,
  resolve_tick_score_weights,
  score_tick_candidate,
  select_tick_candidate,
  type MeasuredTickCandidate,
  type TickCandidateMeasurements,
  type TickScoringConfig,
  type TickStrategyCandidate,
} from '$lib/plot/core/tick-strategies'
import { describe, expect, test } from 'vitest'

const measurements = (
  overrides: Partial<TickCandidateMeasurements> = {},
): TickCandidateMeasurements => ({
  collisions: 0,
  edge_overflow_px: 0,
  band_fraction: 0.5,
  ...overrides,
})

const measured = (
  candidate: TickStrategyCandidate,
  overrides: Partial<TickCandidateMeasurements> = {},
): MeasuredTickCandidate => ({ candidate, measurements: measurements(overrides) })

const candidate = (
  id: string,
  overrides: Partial<Parameters<typeof create_tick_candidate>[0]> = {},
): TickStrategyCandidate =>
  create_tick_candidate({
    id,
    strategy: `upright`,
    labels: [`Alpha`, `Beta`],
    ...overrides,
  })

describe(`tick strategy scoring`, () => {
  test(`reports every weighted penalty component`, () => {
    const detailed = candidate(`detailed`, {
      strategy: `wrap`,
      rotation_deg: 45,
      labels: [
        {
          full_text: `Alpha Beta Gamma`,
          display_lines: [`Alpha`, `Beta`, `Gamma`],
          information_loss: 0.25,
          stagger_row: 1,
        },
        { full_text: `Delta`, visible: false },
      ],
    })
    const result = score_tick_candidate(measured(detailed))

    expect(result.penalties).toEqual({
      hidden_labels: 1,
      information_loss: 0.25,
      band_fraction: 0.5,
      rotation_magnitude: 0.5,
      line_count: 2,
      stagger_rows: 1,
    })
    expect(result.score).toBe(
      Object.values(result.weighted_penalties).reduce((total, penalty) => total + penalty, 0),
    )
  })

  test.each([
    [`collisions`, { collisions: 1 }],
    [`edge overflow`, { edge_overflow_px: 0.01 }],
  ])(`treats %s as a hard feasibility failure`, (_name, metric_overrides) => {
    const infeasible = measured(candidate(`infeasible`), {
      band_fraction: 0,
      ...metric_overrides,
    })
    const fallback = measured(
      candidate(`fallback`, {
        strategy: `thin`,
        labels: [`Alpha`, { full_text: `Beta`, visible: false }],
      }),
      { band_fraction: 1 },
    )
    const selection = select_tick_candidate([infeasible, fallback])
    const scored_infeasible = selection.evaluated.find(
      ({ candidate: item }) => item.id === `infeasible`,
    )

    expect(selection.winner?.candidate.id).toBe(`fallback`)
    expect(scored_infeasible).toMatchObject({ feasible: false })
    expect(scored_infeasible?.score).toSatisfy((score: number) => Number.isFinite(score))
  })

  test.each([
    [`empty labels`, []],
    [
      `all hidden labels`,
      [
        { full_text: `Alpha`, visible: false },
        { full_text: `Beta`, visible: false },
      ],
    ],
  ] as const)(`does not treat %s as readable or feasible`, (name, labels) => {
    const result = score_tick_candidate(measured(candidate(name, { labels })))
    expect(result).toMatchObject({ readable: false, feasible: false })
  })

  test(`treats sub-pixel edge overflow dust as feasible`, () => {
    const result = score_tick_candidate(
      measured(candidate(`dust`), { edge_overflow_px: TICK_GEOMETRY_EPSILON }),
    )
    expect(result.feasible).toBe(true)
  })

  test.each([
    [`auto`, `full-text`],
    [`readable`, `full-text`],
    [`compact`, `hidden-label`],
  ] as const)(`%s mode applies its readability/space priority`, (mode, expected_id) => {
    const full_text = measured(candidate(`full-text`), { band_fraction: 2 })
    const hidden_label = measured(
      candidate(`hidden-label`, {
        strategy: `thin`,
        labels: [`Alpha`, { full_text: `Beta`, visible: false }],
      }),
      { band_fraction: 0.1 },
    )

    expect(
      select_tick_candidate([hidden_label, full_text], { mode }).winner?.candidate.id,
    ).toBe(expected_id)
  })

  test(`auto mode evaluates all candidates and chooses the global minimum`, () => {
    const first_feasible = measured(candidate(`first-feasible`), { band_fraction: 2 })
    const infeasible = measured(candidate(`infeasible`), { collisions: 1, band_fraction: 0 })
    const global_minimum = measured(candidate(`global-minimum`), { band_fraction: 0.1 })
    const selection = select_tick_candidate([first_feasible, infeasible, global_minimum])

    expect(selection.evaluated).toHaveLength(3)
    expect(selection.winner?.candidate.id).toBe(`global-minimum`)
  })

  test(`rejects information-destroying text and ranks readable fallback first`, () => {
    const readable_collision = measured(candidate(`readable-collision`), {
      collisions: 1,
      band_fraction: 0.2,
    })
    const bare_ellipsis = measured(
      candidate(`bare-ellipsis`, {
        strategy: `ellipsis`,
        labels: [
          {
            full_text: `Formation energy`,
            display_lines: [`…`],
            information_loss: 1,
          },
          {
            full_text: `Average temperature`,
            display_lines: [``],
            information_loss: 1,
          },
        ],
      }),
      { band_fraction: 0.1 },
    )
    const selection = select_tick_candidate([bare_ellipsis, readable_collision])

    expect(selection.winner).toBeNull()
    expect(selection.evaluated.map(({ candidate: item }) => item.id)).toEqual([
      `readable-collision`,
      `bare-ellipsis`,
    ])
    expect(selection.evaluated[1]).toMatchObject({ feasible: false })
  })

  test(`ranks readable infeasible candidates by geometric violation before soft cost`, () => {
    const crowded_upright = measured(candidate(`crowded-upright`), {
      collisions: 20,
      band_fraction: 0.1,
    })
    const clearer_rotation = measured(
      candidate(`clearer-rotation`, { strategy: `rotate`, rotation_deg: 90 }),
      { collisions: 2, band_fraction: 2 },
    )
    const selection = select_tick_candidate([crowded_upright, clearer_rotation])

    expect(selection.winner).toBeNull()
    expect(selection.evaluated.map(({ candidate: item }) => item.id)).toEqual([
      `clearer-rotation`,
      `crowded-upright`,
    ])
  })

  test(`valid custom weights override the selected mode`, () => {
    expect(
      resolve_tick_score_weights({
        mode: `compact`,
        weights: { hidden_labels: 7, rotation_magnitude: 0 },
      }),
    ).toMatchObject({
      hidden_labels: 7,
      band_fraction: 60,
      rotation_magnitude: 0,
    })
  })

  test.each([
    [
      `unknown mode`,
      { mode: `aggressive` } as unknown as TickScoringConfig,
      /unknown tick scoring mode/u,
    ],
    [`negative weight`, { weights: { hidden_labels: -1 } }, /finite non-negative/u],
    [`non-finite weight`, { weights: { line_count: Number.NaN } }, /finite non-negative/u],
    [
      `unknown weight`,
      { weights: { mystery: 1 } } as unknown as TickScoringConfig,
      /unknown tick scoring weight/u,
    ],
  ])(`rejects %s`, (_name, config, expected_error) => {
    expect(() => resolve_tick_score_weights(config)).toThrow(expected_error)
  })

  test.each([
    [`a fractional collision count`, `collisions`, 0.5, /integer/u],
    [`a negative collision count`, `collisions`, -1, /finite non-negative/u],
    [`negative edge overflow`, `edge_overflow_px`, -1, /finite non-negative/u],
    [`a negative band fraction`, `band_fraction`, -1, /finite non-negative/u],
    [`a non-finite band fraction`, `band_fraction`, Infinity, /finite non-negative/u],
  ] as const)(`rejects %s`, (_name, metric, value, expected_error) => {
    const metric_overrides: Partial<TickCandidateMeasurements> = { [metric]: value }
    expect(() =>
      score_tick_candidate(measured(candidate(`invalid-measurement`), metric_overrides)),
    ).toThrow(expected_error)
  })

  test(`rejects duplicate candidate ids`, () => {
    expect(() =>
      select_tick_candidate([
        measured(candidate(`duplicate`)),
        measured(candidate(`duplicate`, { strategy: `rotate` })),
      ]),
    ).toThrow(`tick candidate ids must be unique, found duplicate "duplicate"`)
  })

  test(`breaks ties by strategy then lexical id independent of input order`, () => {
    const rotated = measured(candidate(`rotated`, { strategy: `rotate`, rotation_deg: 0 }))
    const wrapped_z = measured(candidate(`z-wrapped`, { strategy: `wrap` }))
    const wrapped_a = measured(candidate(`a-wrapped`, { strategy: `wrap` }))
    const zero_weights = {
      hidden_labels: 0,
      information_loss: 0,
      band_fraction: 0,
      rotation_magnitude: 0,
      line_count: 0,
      stagger_rows: 0,
    }
    const measured_candidates = [rotated, wrapped_z, wrapped_a]
    const selection = select_tick_candidate(measured_candidates, {
      weights: zero_weights,
    })

    expect(selection.evaluated.map(({ candidate: item }) => item.id)).toEqual([
      `a-wrapped`,
      `z-wrapped`,
      `rotated`,
    ])
    expect(selection.winner?.candidate.id).toBe(`a-wrapped`)
    expect(measured_candidates).toEqual([rotated, wrapped_z, wrapped_a])
  })
})
