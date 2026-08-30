import { element_data } from '$lib/element'
import type { Vec3 } from '$lib/math'
import {
  DEFAULT_FMT,
  ELEM_HEATMAP_KEYS,
  ELEM_HEATMAP_LABELS,
  ELEM_PROPERTY_LABELS,
  format_fractional,
  format_num,
  format_tick_values,
  format_value,
  format_vec3,
  superscript_digits,
  symbol_map,
  symbol_names,
  trajectory_property_config,
} from '$lib/labels'
import * as d3_symbols from 'd3-shape'
import { describe, expect, test } from 'vitest'

test(`ELEM_HEATMAP_LABELS maps each heatmap key to exactly one label`, () => {
  const by_text = (left: unknown, right: unknown) => String(left).localeCompare(String(right))
  expect(Object.values(ELEM_HEATMAP_LABELS).toSorted(by_text)).toEqual(
    ELEM_HEATMAP_KEYS.toSorted(by_text),
  )
})

test.each([
  [`ELEM_HEATMAP_KEYS`, ELEM_HEATMAP_KEYS],
  [`ELEM_PROPERTY_LABELS`, Object.keys(ELEM_PROPERTY_LABELS)],
])(`%s are valid element data keys`, (_name, keys) => {
  expect(Object.keys(element_data[0])).toEqual(expect.arrayContaining(keys))
})

// Consumers resolve property keys case-insensitively (`config[key] ?? config[key.toLowerCase()]`),
// so capitalised duplicates (`Energy`, `Fmax`, `Alpha`) must not creep back in
test(`trajectory_property_config keys are lowercase`, () => {
  const keys = Object.keys(trajectory_property_config)
  expect(keys.filter((key) => key !== key.toLowerCase() && !key.includes(` `))).toEqual([])
})

const [gt_1_fmt, lt_1_fmt] = DEFAULT_FMT
test.each([
  // no explicit format: DEFAULT_FMT picks the SI form at |x| >= 1 and plain decimals below
  [1234, undefined, `1.23k`],
  [0.123, undefined, `0.123`],
  [1234, gt_1_fmt, `1.23k`],
  [0.123, lt_1_fmt, `0.123`],
  [1.2, `.3f`, `1.200`],
  [0, undefined, `0`],
  [0, lt_1_fmt, `0`],
  // d3 scientific formats render 0 as "0e+0"; collapse to a plain 0 (keeping any prefix/suffix)
  [0, `.2~e`, `0`],
  [-0, `.2~e`, `0`],
  [0, `$.2e`, `$0`],
  [0, `.2~%`, `0%`],
  [1, undefined, `1`],
  [10, undefined, `10`],
  [100, undefined, `100`],
  [1000, undefined, `1k`],
  [10_000, undefined, `10k`],
  [100_000, undefined, `100k`],
  [1_000_000, undefined, `1M`],
  [10_000_000, undefined, `10M`],
  [100_000_000, undefined, `100M`],
  [1_000_000_000, undefined, `1G`],
  [0.1, undefined, `0.1`],
  [0.01, undefined, `0.01`],
  [0.001, undefined, `0.001`],
  [-0.0001, undefined, `−0.0001`],
  [-0.00001, undefined, `−0.00001`],
  [-0.000001, undefined, `−0.000001`],
  [-0.0000001, undefined, `−1e-7`],
  [-1.1, undefined, `−1.1`],
  [-1.14123, undefined, `−1.14`],
  [-1.14123e-7, `.5~g`, `−1.1412e-7`],
])(`format_num(%s, %s) = %s`, (num, fmt, expected) => {
  expect(format_num(num, fmt)).toBe(expected)
})

// adaptive labels gain precision only until adjacent distinct values render distinctly;
// an explicit format is authoritative even when it collides
test.each([
  [[-1539, -1538, -1537], undefined, [`−1539`, `−1538`, `−1537`]],
  [[-1539.000001, -1539.000002], undefined, [`−1539.000001`, `−1539.000002`]],
  [[-1539, -1000, -1538], undefined, [`−1.54k`, `−1k`, `−1.54k`]],
  [[1000, 1000], undefined, [`1k`, `1k`]],
  [[-1539, -1538], `.3~s`, [`-1.54k`, `-1.54k`]],
])(`format_tick_values(%j, %s) = %j`, (values, formatter, expected) => {
  expect(format_tick_values(values, formatter)).toEqual(expected)
})

test(`symbol_names lists d3's fill-then-stroke symbols once each, symbol_map resolves them`, () => {
  // `symbolX` aliases `symbolTimes`; the first export naming the object wins
  expect(symbol_names).toEqual([
    `Circle`,
    `Cross`,
    `Diamond`,
    `Square`,
    `Star`,
    `Triangle`,
    `Wye`,
    `Plus`,
    `Times`,
    `Triangle2`,
    `Asterisk`,
    `Square2`,
    `Diamond2`,
  ])
  expect(Object.keys(symbol_map)).toEqual(symbol_names)
  expect(symbol_map.Times).toBe(d3_symbols.symbolTimes)
  expect(symbol_map.Times).toBe(d3_symbols.symbolX) // the alias resolves to the same object
  expect(symbol_map.Circle).toBe(d3_symbols.symbolCircle)
  expect(symbol_map.Diamond2).toBe(d3_symbols.symbolDiamond2)
})

test.each([
  [`Cr3+ O2- Ac3+`, `Cr³⁺ O²⁻ Ac³⁺`],
  [`1234567890`, `¹²³⁴⁵⁶⁷⁸⁹⁰`],
  [`+123-456+789-0`, `⁺¹²³⁻⁴⁵⁶⁺⁷⁸⁹⁻⁰`],
  [`No digits here`, `No digits here`],
])(`superscript_digits(%s) = %s`, (input, expected) => {
  expect(superscript_digits(input)).toBe(expected)
})

test.each([
  [[1, 2, 3], undefined, `(1, 2, 3)`],
  [[1.23456, -2.34567, 1e-5], undefined, `(1.23, −2.35, 0.00001)`],
  [[0.5, 1e6, -1], `.2f`, `(0.50, 1000000.00, −1.00)`],
] as [Vec3, string | undefined, string][])(
  `format_vec3(%j, %j) is %j`,
  (vec, fmt, expected) => {
    expect(format_vec3(vec, fmt)).toBe(expected)
  },
)

// The integer part is dropped and negatives wrap into [0, 1), so -0.25 reads as ¾. The zero
// glyph matches up to and including eps (1e-3); every other fraction strictly below eps.
test.each([
  [0, `0`],
  [1, `0`],
  [2, `0`],
  [0.5, `½`],
  [1.5, `½`],
  [2.5, `½`],
  [-1.5, `½`],
  [-10.5, `½`],
  [0.25, `¼`],
  [0.75, `¾`],
  [-2.25, `¾`],
  [0.333333333, `⅓`],
  [0.666666667, `⅔`],
  [1.333333333, `⅓`],
  [2.666666667, `⅔`],
  [666.67 / 1000, `⅔`], // Mn666.67Sc333.33 normalised composition
  [333.33 / 1000, `⅓`],
  [0.2, `⅕`],
  [0.4, `⅖`],
  [0.6, `⅗`],
  [0.8, `⁴⁄₅`],
  [0.166666667, `⅙`],
  [0.125, `⅛`],
  [0.083333333, `¹⁄₁₂`],
  [-0.5, `½`],
  [-0.25, `¾`],
  [-0.75, `¼`],
  [-0.333333333, `⅔`],
  [-0.125, `⁷⁄₈`],
  [0.1, `0.1`],
  [0.65, `0.65`],
  [0.85, `0.85`],
  [0.999, `0.999`],
  [-0.1, `−0.1`],
  [-0.9, `−0.9`],
  [0.001, `0`],
  [0.001 - 1e-6, `0`],
  [0.001 + 1e-6, `0.001001`],
  [1.001, `0`],
  [1.001 - 1e-6, `0`],
  [0.5 + 1e-3 - 1e-6, `½`],
  [0.5 + 1e-3 + 1e-6, `0.501`],
  [0.25 + 1e-3 - 1e-6, `¼`],
  [0.25 + 1e-3 + 1e-6, `0.251`],
  [Infinity, `Infinity`],
  [-Infinity, `-Infinity`],
  [NaN, `NaN`],
])(`format_fractional(%s) = %s`, (input, expected) => {
  expect(format_fractional(input)).toBe(expected)
})

describe(`format_value`, () => {
  test.each([
    // Basic decimal formatting
    { value: 123.456, formatter: `.2f`, expected: `123.46` },
    { value: 123.4, formatter: `.2f`, expected: `123.4` },
    { value: 123.0, formatter: `.2f`, expected: `123` },
    { value: 0.001, formatter: `.3f`, expected: `0.001` },
    { value: 0.1, formatter: `.3f`, expected: `0.1` },
    { value: 0.0, formatter: `.4f`, expected: `0` },
    { value: 123.4, formatter: `.4f`, expected: `123.4` },
    { value: 0.1, formatter: `.4f`, expected: `0.1` },

    // Scientific notation
    { value: 1000000, formatter: `.2e`, expected: `1.00e+6` },
    { value: 0.000001, formatter: `.2e`, expected: `1.00e-6` },
    { value: 123000, formatter: `.2e`, expected: `1.23e+5` },
    { value: 0.00123, formatter: `.2e`, expected: `1.23e-3` },

    // Integer formatting
    { value: 42, formatter: `d`, expected: `42` },
    { value: 42.7, formatter: `d`, expected: `43` },
    { value: -42.3, formatter: `d`, expected: `-42` },
    { value: 0, formatter: `d`, expected: `0` },

    // Comma-separated formatting
    { value: 1234.5, formatter: `,.1f`, expected: `1,234.5` },
    { value: 1234.0, formatter: `,.1f`, expected: `1,234` },
    { value: 12345678.9, formatter: `,.2f`, expected: `12,345,678.9` },
    { value: 999.999, formatter: `,.0f`, expected: `1,000` },

    // Percentage formatting
    { value: 0.123, formatter: `.1%`, expected: `12.3%` },
    { value: 0.1, formatter: `.1%`, expected: `10%` },
    { value: 1.0, formatter: `.0%`, expected: `100%` },
    { value: 0.0, formatter: `.1%`, expected: `0%` },
    { value: 2.5, formatter: `.0%`, expected: `250%` },
    // only `%`-type formats strip zeros before the sign; `p` and padded outputs stay verbatim
    { value: 1e-7, formatter: `.2p`, expected: `0.000010%` },
    { value: 0.5, formatter: `<8.2%`, expected: `50.00%  ` },
    { value: 1.5, formatter: `<8.2f`, expected: `1.50    ` },

    // Currency formatting
    { value: 1234.5, formatter: `$,.2f`, expected: `$1,234.50` },
    { value: 1234.0, formatter: `$,.2f`, expected: `$1,234.00` },
    { value: 0.99, formatter: `$,.2f`, expected: `$0.99` },
    { value: -50.25, formatter: `$,.2f`, expected: `-$50.25` },

    // Special values
    { value: NaN, formatter: `.2f`, expected: `NaN` },
    { value: Infinity, formatter: `.2f`, expected: `Infinity` },
    { value: -Infinity, formatter: `.2f`, expected: `-Infinity` },

    // Edge cases
    { value: 0, formatter: `.2f`, expected: `0` },
    { value: -0, formatter: `.2f`, expected: `0` },
    { value: -0, formatter: `.0f`, expected: `0` },
    { value: -0, formatter: `.0%`, expected: `0%` },
    { value: -0, formatter: `$,.2f`, expected: `$0.00` },
    // Scientific zeros collapse to plain 0 (same path plot ticks use via format_value_or_num)
    { value: 0, formatter: `.2~e`, expected: `0` },
    { value: -0, formatter: `.2e`, expected: `0` },
    { value: 0, formatter: `$.2e`, expected: `$0` },
    { value: -0.001, formatter: `.2f`, expected: `0` },
    { value: 0.0001, formatter: `.4f`, expected: `0.0001` },
    { value: 999.9999, formatter: `.2f`, expected: `1000` },
    { value: -123.456, formatter: `.2f`, expected: `-123.46` },

    // No formatter/empty formatter
    { value: 123.456, formatter: ``, expected: `123.456` },
    { value: 123.456, formatter: undefined, expected: `123.456` },
    { value: 0, formatter: ``, expected: `0` },
    { value: -42, formatter: undefined, expected: `-42` },
  ])(
    `formats $value with formatter "$formatter" as "$expected"`,
    ({ value, formatter, expected }) => {
      expect(format_value(value, formatter)).toBe(expected)
    },
  )

  test.each([
    // Date formatting
    {
      value: new Date(2023, 0, 1).getTime(),
      formatter: `%Y-%m-%d`,
      expected: `2023-01-01`,
    },
    {
      value: new Date(2023, 5, 15).getTime(),
      formatter: `%b %d, %Y`,
      expected: `Jun 15, 2023`,
    },
    {
      value: new Date(2023, 11, 31, 23, 59, 59).getTime(),
      formatter: `%Y-%m-%d %H:%M:%S`,
      expected: `2023-12-31 23:59:59`,
    },
    {
      value: new Date(2023, 0, 1).getTime(),
      formatter: `%A, %B %d, %Y`,
      expected: `Sunday, January 01, 2023`,
    },
    {
      value: new Date(2023, 0, 1, 12, 0, 0).getTime(),
      formatter: `%I:%M %p`,
      expected: `12:00 PM`,
    },
    {
      value: new Date(2023, 0, 1, 0, 0, 0).getTime(),
      formatter: `%I:%M %p`,
      expected: `12:00 AM`,
    },
    {
      value: new Date(2023, 6, 4).getTime(),
      formatter: `%j`,
      expected: `185`,
    },
    {
      value: new Date(2020, 1, 29).getTime(), // Leap year
      formatter: `%Y-%m-%d`,
      expected: `2020-02-29`,
    },
  ])(
    `formats timestamp $value with formatter "$formatter" as "$expected"`,
    ({ value, formatter, expected }) => {
      expect(format_value(value, formatter)).toBe(expected)
    },
  )
})
