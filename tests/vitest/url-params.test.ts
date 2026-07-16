import {
  apply_weights_param,
  bool_from_param,
  bool_url_entry,
  sort_from_query,
  sort_url_entries,
  sync_url_params,
  url_with_params,
  weights_to_param,
  type WeightsConfig,
} from '$lib/url-params'
import { expect, test, vi } from 'vitest'

test.each([
  [``, false, false],
  [`flag=1`, false, true],
  [``, true, true],
  [`flag=0`, true, false],
] as const)(`bool_from_param(%s, fallback=%s) is %s`, (query, fallback, expected) => {
  expect(bool_from_param(new URLSearchParams(query), `flag`, fallback)).toBe(expected)
})

test.each([
  [true, false, [`flag`, `1`]],
  [false, false, [`flag`, ``]],
  [false, true, [`flag`, `0`]],
  [true, true, [`flag`, ``]],
] as const)(`bool_url_entry(value=%s, fallback=%s)`, (value, fallback, expected) => {
  expect(bool_url_entry(`flag`, value, fallback)).toEqual(expected)
})

test.each([
  [`sort=energy&dir=asc`, undefined, { column: `energy`, dir: `asc` }],
  [`sort=energy&dir=sideways`, undefined, { column: `energy`, dir: `desc` }],
  [`dir=asc`, undefined, { column: `force`, dir: `asc` }],
  [`sort=`, undefined, { column: `force`, dir: `desc` }],
  [`sort=energy`, { energy: true }, { column: `energy`, dir: `desc` }],
  [`sort=constructor`, { energy: true }, { column: `force`, dir: `desc` }],
  [`sort=unknown`, new Set([`energy`, `force`]), { column: `force`, dir: `desc` }],
] as const)(`sort_from_query(%s)`, (query, valid_columns, expected) => {
  const default_sort = { column: `force`, dir: `desc` } as const
  expect(sort_from_query(new URLSearchParams(query), default_sort, valid_columns)).toEqual(
    expected,
  )
  expect(sort_url_entries(expected, default_sort)).toEqual([
    [`sort`, expected.column, `force`],
    [`dir`, expected.dir, `desc`],
  ])
})

const make_weights = (weights: number[]): WeightsConfig => ({
  energy: { weight: weights[0] },
  force: { weight: weights[1] },
  stress: { weight: weights[2] },
})
const make_reversed_weights = (weights: number[]): WeightsConfig => ({
  stress: { weight: weights[2] },
  force: { weight: weights[1] },
  energy: { weight: weights[0] },
})
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

test(`URL entries preserve unrelated params, commas, and hashes`, () => {
  const current_url = new URL(`https://example.com/tasks/md?keep=1&drop=default#results`)
  expect(
    url_with_params(
      [
        [`weights`, `0.6,0.3,0.1`],
        [`drop`, `default`, `default`],
      ],
      current_url,
    ),
  ).toBe(`/tasks/md?keep=1&weights=0.6,0.3,0.1#results`)
})

test(`sync_url_params writes only semantic URL changes`, () => {
  const write_url = vi.fn()
  const current_url = new URL(`https://example.com/tasks/md?sort=force`)
  sync_url_params([[`sort`, `force`]], current_url, write_url)
  sync_url_params([[`sort`, `energy`]], current_url, write_url)
  expect(write_url.mock.calls).toEqual([[`/tasks/md?sort=energy`]])

  write_url.mockClear()
  const encoded_url = new URL(`https://example.com/?weights=0.5%2C0.4%2C0.1`)
  sync_url_params([[`weights`, `0.5,0.4,0.1`]], encoded_url, write_url)
  expect(write_url).not.toHaveBeenCalled()
})
