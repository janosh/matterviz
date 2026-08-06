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

    expect(selection.winner?.candidate.id).toBe(`fallback`)
    expect(
      selection.evaluated.find(({ candidate: item }) => item.id === `infeasible`),
    ).toMatchObject({ feasible: false })
    expect(
      selection.evaluated.find(({ candidate: item }) => item.id === `infeasible`)?.score,
    ).toSatisfy((score: number) => Number.isFinite(score))
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
    const selection = select_tick_candidate([rotated, wrapped_z, wrapped_a], {
      weights: zero_weights,
    })

    expect(selection.evaluated.map(({ candidate: item }) => item.id)).toEqual([
      `a-wrapped`,
      `z-wrapped`,
      `rotated`,
    ])
    expect(selection.winner?.candidate.id).toBe(`a-wrapped`)
  })

  test(`returns no winner when every candidate is infeasible`, () => {
    const selection = select_tick_candidate([
      measured(candidate(`collision`), { collisions: 1 }),
      measured(candidate(`overflow`), { edge_overflow_px: 1 }),
    ])

    expect(selection.winner).toBeNull()
    expect(selection.evaluated).toHaveLength(2)
  })
})
