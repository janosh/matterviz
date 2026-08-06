import { TICK_GEOMETRY_EPSILON } from '$lib/plot/core/tick-geometry'
import { create_tick_candidate, type TickStrategy } from '$lib/plot/core/tick-strategies'
import { select_tick_candidate } from '$lib/plot/core/tick-strategies/scoring'
import type { MeasuredTickCandidate } from '$lib/plot/core/tick-strategies/types'
import { expect, test } from 'vitest'

const measured = (
  id: string,
  measurements: Partial<MeasuredTickCandidate['measurements']> = {},
  strategy: TickStrategy = `upright`,
  rotation_deg = 0,
  visible = true,
): MeasuredTickCandidate => ({
  candidate: create_tick_candidate({
    id,
    strategy,
    rotation_deg,
    labels: [{ full_text: id, visible }],
  }),
  measurements: {
    collisions: 0,
    edge_overflow_px: 0,
    band_fraction: 0,
    ...measurements,
  },
})

test.each([
  [`a collision`, { collisions: 1 }, {}],
  [
    `overflow beyond the geometry epsilon`,
    { edge_overflow_px: 2 * TICK_GEOMETRY_EPSILON },
    { edge_overflow_px: TICK_GEOMETRY_EPSILON },
  ],
])(`prefers a feasible candidate over one with %s`, (_name, failure, boundary) => {
  const infeasible = measured(`infeasible`, failure)
  const feasible = measured(`feasible`, boundary, `rotate`, 90)

  expect(select_tick_candidate([infeasible, feasible])).toBe(feasible)
})

test(`orders infeasible fallbacks by collisions then overflow`, () => {
  const fewer_collisions = measured(`fewer-collisions`, {
    collisions: 1,
    edge_overflow_px: 20,
  })
  const more_collisions = measured(`more-collisions`, { collisions: 2 })
  const less_overflow = measured(`less-overflow`, { collisions: 1, edge_overflow_px: 10 })

  expect(select_tick_candidate([more_collisions, fewer_collisions])).toBe(fewer_collisions)
  expect(select_tick_candidate([fewer_collisions, less_overflow])).toBe(less_overflow)
})

test(`prefers visible upright labels across feasible candidates`, () => {
  const upright = measured(`upright`)
  const rotated = measured(`rotated`, {}, `rotate`, 90)
  const hidden = measured(`hidden`, {}, `upright`, 0, false)

  expect(select_tick_candidate([rotated, hidden, upright])).toBe(upright)
})

test(`keeps input order for exact ties`, () => {
  const first = measured(`first`)
  const second = measured(`second`)

  expect(select_tick_candidate([second, first])).toBe(second)
})
