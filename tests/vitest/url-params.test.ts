import {
  apply_weights_param,
  sort_from_query,
  sort_url_entries,
  weights_to_param,
} from '$lib/url-params'
import type { WeightsConfig } from '$lib/url-params'
import { expect, test } from 'vitest'

const default_sort = { column: `force`, dir: `desc` } as const

test.each([
  [`sort=energy&dir=asc`, undefined, { column: `energy`, dir: `asc` }],
  [`sort=energy&dir=sideways`, undefined, { column: `energy`, dir: `desc` }],
  [`dir=asc`, undefined, { column: `force`, dir: `asc` }],
  [`sort=`, undefined, { column: `force`, dir: `desc` }],
  [`sort=energy`, { energy: true }, { column: `energy`, dir: `desc` }],
  [`sort=constructor`, { energy: true }, { column: `force`, dir: `desc` }],
  [`sort=unknown`, new Set([`energy`, `force`]), { column: `force`, dir: `desc` }],
] as const)(`sort_from_query(%s)`, (query, valid_columns, expected) => {
  expect(sort_from_query(new URLSearchParams(query), default_sort, valid_columns)).toEqual(
    expected,
  )
})

test(`sort_url_entries includes current and default values`, () => {
  expect(sort_url_entries({ column: `energy`, dir: `asc` }, default_sort)).toEqual([
    [`sort`, `energy`, `force`],
    [`dir`, `asc`, `desc`],
  ])
})

const make_weights = (weights: number[]): WeightsConfig => ({
  energy: { weight: weights[0] },
  force: { weight: weights[1] },
  stress: { weight: weights[2] },
})
const make_reversed_weights = (weights: number[]): WeightsConfig =>
  Object.fromEntries(Object.entries(make_weights(weights)).toReversed())
const default_weights = make_weights([0.5, 0.4, 0.1])

test.each([
  [`default weights`, make_weights([0.5, 0.4, 0.1]), ``],
  [`non-default weights`, make_weights([0.7, 0.2, 0.1]), `0.7,0.2,0.1`],
  [`rounded weights`, make_weights([1 / 3, 1 / 3, 1 / 3]), `0.333,0.333,0.333`],
  [`reversed config keys`, make_reversed_weights([0.7, 0.2, 0.1]), `0.7,0.2,0.1`],
] as const)(`weights_to_param serializes %s`, (_case_name, config, expected) => {
  expect(weights_to_param(config, default_weights)).toBe(expected)
})

test.each([
  [`missing`, { energy: { weight: 0.5 }, force: { weight: 0.5 } }],
  [`extra`, { ...make_weights([0.5, 0.4, 0.1]), other: { weight: 0 } }],
])(`weight parameter helpers reject %s keys`, (_case_name, config) => {
  expect(() => weights_to_param(config, default_weights)).toThrow(
    `Weight config keys must exactly match defaults: energy, force, stress`,
  )
  expect(() => apply_weights_param(null, config, default_weights)).toThrow(
    `Weight config keys must exactly match defaults: energy, force, stress`,
  )
})

test.each([
  [`0.7,0.2,0.1`, [0.7, 0.2, 0.1]],
  [`2,1,1`, [0.5, 0.25, 0.25]],
  [`0.5,,0.5`, [0.5, 0.4, 0.1]],
  [`-1,1,1`, [0.5, 0.4, 0.1]],
  [`0,0,0`, [0.5, 0.4, 0.1]],
  [`1e308,1e308,1`, [0.5, 0.4, 0.1]],
  [` `, [0.5, 0.4, 0.1]],
  [null, [0.5, 0.4, 0.1]],
] as const)(`apply_weights_param(%s)`, (param, expected) => {
  const config = make_weights([0.2, 0.3, 0.5])
  apply_weights_param(param, config, default_weights)
  for (const [idx, { weight }] of Object.values(config).entries()) {
    expect(weight).toBeCloseTo(expected[idx], 10)
  }
})

test(`apply_weights_param uses canonical order for reversed config`, () => {
  const config = make_reversed_weights([0.2, 0.3, 0.5])
  apply_weights_param(`0.7,0.2,0.1`, config, default_weights)
  expect(Object.keys(config)).toEqual([`stress`, `force`, `energy`])
  expect(config.energy.weight).toBeCloseTo(0.7)
  expect(config.force.weight).toBeCloseTo(0.2)
  expect(config.stress.weight).toBeCloseTo(0.1)
})
