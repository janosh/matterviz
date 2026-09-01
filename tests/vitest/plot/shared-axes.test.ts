import {
  axis_with_range,
  is_valid_range,
  max_side_padding,
  union_ranges,
} from '$lib/plot/core/shared-axes'
import { describe, expect, it } from 'vitest'

describe(`shared range helpers`, () => {
  it.each([
    [
      `unions overlapping and disjoint ranges`,
      [
        [-2, 4],
        [1, 8],
        [20, 30],
      ],
      [-2, 30],
    ],
    [
      `normalizes reversed ranges`,
      [
        [5, 1],
        [-3, -8],
      ],
      [-8, 5],
    ],
    [`ignores missing and invalid ranges`, [undefined, null, [NaN, 4], [2, 6]], [2, 6]],
    [`returns undefined without a finite range`, [], undefined],
  ] as const)(`union_ranges %s`, (_name, ranges, expected) => {
    expect(union_ranges(ranges)).toEqual(expected)
  })

  it.each([
    [[0, 10], true],
    [[0, 0], true],
    [[0, null], false],
    [[0, Infinity], false],
    [[0, 1, 2], false],
  ])(`is_valid_range(%j) -> %s`, (range, expected) => {
    expect(is_valid_range(range)).toBe(expected)
  })

  it(`axis_with_range adds a valid range without dropping axis configuration`, () => {
    expect(axis_with_range({ label: `Y`, ticks: 4 }, [0, 10])).toEqual({
      label: `Y`,
      ticks: 4,
      range: [0, 10],
    })
    expect(axis_with_range({ range: [2, 8] }, undefined)).toEqual({ range: [2, 8] })
  })
})

describe(`max_side_padding`, () => {
  it(`returns selected side-wise maxima and omits unshared sides`, () => {
    expect(
      max_side_padding(
        [{ t: 5, b: 50, l: 80 }, { t: 20, b: 40, r: 30 }, { b: 60 }],
        [`t`, `b`],
      ),
    ).toEqual({ t: 20, b: 60 })
  })

  it(`reconciles every side by default and preserves zero`, () => {
    expect(
      max_side_padding([
        { t: 0, l: 10 },
        { t: -2, r: 0 },
      ]),
    ).toEqual({
      t: 0,
      l: 10,
      r: 0,
    })
  })

  it(`rejects non-finite padding with its location`, () => {
    expect(() => max_side_padding([{ t: 5 }, { t: NaN }], [`t`])).toThrow(
      `Invalid t padding at index 1`,
    )
  })
})
