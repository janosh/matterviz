import { element_data } from '#lib/element/index.js'
import type { Vec3 } from '#lib/math.js'
import {
  ELEM_HEATMAP_KEYS,
  ELEM_HEATMAP_LABELS,
  ELEM_PROPERTY_LABELS,
  format_fractional,
  format_num,
  format_tick_values,
  format_value,
  format_vec3,
  parse_axis_label,
  parse_warnings_notice,
  zero_if_negligible,
  superscript_digits,
  symbol_map,
  symbol_names,
  trajectory_property_config,
} from '#lib/labels.js'
import { tickStep, ticks } from 'd3-array'
import * as d3_symbols from 'd3-shape'
import { describe, expect, test } from 'vite-plus/test'

test.each([
  [`Energy (eV)`, { name: `Energy`, unit: `eV` }],
  [`Heat capacity (J/(mol·K))`, { name: `Heat capacity`, unit: `J/(mol·K)` }],
  [`Energy (relative) (eV/atom)`, { name: `Energy (relative)`, unit: `eV/atom` }],
  [`g(r)`, { name: `g(r)` }],
  [`Energy`, { name: `Energy` }],
  [`Energy (eV`, { name: `Energy (eV` }],
])(`separates units in %s`, (label, expected) => {
  expect(parse_axis_label(label)).toEqual(expected)
})

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
// so capitalised duplicates (`Energy`, `Fmax`, `Alpha`) must not creep back in, and a
// capitalised key (`Force Max`) would be unreachable from `FORCE MAX` or `force max`
test(`trajectory_property_config keys are lowercase`, () => {
  const keys = Object.keys(trajectory_property_config)
  expect(keys.filter((key) => key !== key.toLowerCase())).toEqual([])
})

// oxfmt-ignore
test.each([
  // no explicit format: DEFAULT_FMT picks the SI form at |x| >= 1 and plain decimals below
  [1234, undefined, `1.23k`], [0.123, undefined, `0.123`], [1.2, `.3f`, `1.200`],
  [0, undefined, `0`], [1, undefined, `1`], [1000, undefined, `1k`],
  [1_000_000, undefined, `1M`], [1_000_000_000, undefined, `1G`], [0.001, undefined, `0.001`],
  [0.1, undefined, `0.1`], [-1.1, undefined, `−1.1`],
  // d3 scientific formats render 0 as "0e+0"; collapse to a plain 0 (keeping any prefix/suffix)
  [0, `.2~e`, `0`], [-0, `.2~e`, `0`], [0, `$.2e`, `$0`], [0, `.2~%`, `0%`],
  [-0.000001, undefined, `−0.000001`], [-0.0000001, undefined, `−1e-7`],
  [-1.14123, undefined, `−1.14`], [-1.14123e-7, `.5~g`, `−1.1412e-7`],
  // past yotta d3 has no SI prefix left (1e27 read 1,000Y and 1e100 ran past 100 chars)
  [9.99e26, undefined, `999Y`], [1e27, undefined, `1e27`], [-1.234e27, undefined, `−1.23e27`],
  [1e100, undefined, `1e100`], [Number.MAX_VALUE, undefined, `1.8e308`],
])(`format_num(%s, %s) = %s`, (num, fmt, expected) => {
  expect(format_num(num, fmt)).toBe(expected)
})

// adaptive labels gain precision only until adjacent distinct values render distinctly;
// an explicit format is authoritative even when it collides
// oxfmt-ignore
test.each([
  [[-1539, -1538, -1537], undefined, [`−1539`, `−1538`, `−1537`]],
  [[-1539.000001, -1539.000002], undefined, [`−1539.000001`, `−1539.000002`]],
  [[-1539, -1000, -1538], undefined, [`−1.54k`, `−1k`, `−1.54k`]],
  [[1000, 1000], undefined, [`1k`, `1k`]],
  [[-1539, -1538], `.3~s`, [`-1.54k`, `-1.54k`]],
  // labels must resolve the tick step, not just differ from their neighbours: d3.ticks(998,
  // 1000.5, 5) read 1k, 1.001k for the last two ticks
  [[998, 998.5, 999, 999.5, 1000, 1000.5], undefined,
    [`998`, `998.5`, `999`, `999.5`, `1000`, `1000.5`]],
  // no adjacent collision at the default precision, but 1005 still rounded to 1.01k
  [[995, 1000, 1005], undefined, [`995`, `1000`, `1005`]],
  [[999_000, 999_500, 1_000_000, 1_000_500], undefined, [`999k`, `999.5k`, `1M`, `1.0005M`]],
  [[0, 0.5, 1, 1.5], undefined, [`0`, `0.5`, `1`, `1.5`]],
  // log-axis decades: compact scientific below 0.01 instead of 0.000001, SI above 1
  [[1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 0.1, 1, 10], undefined,
    [`1e-9`, `1e-8`, `1e-7`, `1e-6`, `1e-5`, `1e-4`, `1e-3`, `0.01`, `0.1`, `1`, `10`]],
  [[1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4], undefined,
    [`1e-6`, `2e-6`, `5e-6`, `1e-5`, `2e-5`, `5e-5`, `1e-4`]],
  [[1, 10, 100, 1000, 10_000], undefined, [`1`, `10`, `100`, `1k`, `10k`]],
  // evenly spaced ticks over a wide range stay linear-formatted
  [[0, 2000, 4000, 6000], undefined, [`0`, `2k`, `4k`, `6k`]],
])(`format_tick_values(%j, %s) = %j`, (values, formatter, expected) => {
  expect(format_tick_values(values, formatter)).toEqual(expected)
})

test(`near-coincident log ticks keep distinct labels`, () => {
  expect(new Set(format_tick_values([1e-6, 1.0001e-6, 1e-3])).size).toBe(3)
})

// sweep d3 tick sets straddling 1000: each label must read back within half a tick step
test.each([0.5, 1, 2, 5, 10, 25])(`tick labels near 1000 resolve a span of %s`, (span) => {
  const parse_label = (label: string) => {
    const { digits, prefix } =
      /^(?<digits>.*?)(?<prefix>k|M)?$/.exec(label.replaceAll(`,`, ``))?.groups ?? {}
    return Number(digits) * (prefix === `M` ? 1e6 : prefix === `k` ? 1e3 : 1)
  }
  for (let start = 990; start <= 1000.5; start += 0.25) {
    for (const count of [3, 5, 10]) {
      const values = ticks(start, start + span, count)
      if (values.length < 2) continue
      const step = tickStep(start, start + span, count)
      const labels = format_tick_values(values)
      for (const [idx, value] of values.entries()) {
        expect(Math.abs(parse_label(labels[idx]) - value), `${labels}`).toBeLessThan(step / 2)
      }
    }
  }
})

test(`adaptive formatting handles large arrays of colliding labels`, () => {
  const values = Array.from({ length: 150_000 }, (_, idx) => -1539 + (idx % 2))
  const labels = format_tick_values(values)
  expect(labels).toHaveLength(values.length)
  expect(new Set(labels)).toEqual(new Set([`−1539`, `−1538`]))
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

test.each<[Vec3, string | undefined, string]>([
  [[1, 2, 3], undefined, `(1, 2, 3)`],
  [[1.23456, -2.34567, 1e-5], undefined, `(1.23, −2.35, 0.00001)`],
  [[0.5, 1e6, -1], `.2f`, `(0.50, 1000000.00, −1.00)`],
])(`format_vec3(%j, %j) is %j`, (vec, fmt, expected) => {
  expect(format_vec3(vec, fmt)).toBe(expected)
})

// The integer part is dropped and negatives wrap into [0, 1), so -0.25 reads as ¾. The zero
// glyph matches up to and including eps (1e-3); every other fraction strictly below eps.
// oxfmt-ignore
test.each([
  [0, `0`], [1, `0`], [0.5, `½`], [1.5, `½`], [-10.5, `½`], [0.25, `¼`], [0.75, `¾`],
  [0.333333333, `⅓`], [0.666666667, `⅔`], [-0.5, `½`], [-0.75, `¼`],
  [666.67 / 1000, `⅔`], [333.33 / 1000, `⅓`], // Mn666.67Sc333.33 normalised composition
  [0.2, `⅕`], [0.4, `⅖`], [0.6, `⅗`], [0.8, `⁴⁄₅`], [0.166666667, `⅙`], [0.125, `⅛`],
  [0.083333333, `¹⁄₁₂`], [-0.25, `¾`], [-0.333333333, `⅔`], [-0.125, `⁷⁄₈`],
  [0.1, `0.1`], [0.65, `0.65`], [0.999, `0.999`], [0.998, `0.998`], [-0.1, `−0.1`],
  [0.001, `0`], [0.001 - 1e-6, `0`], [0.001 + 1e-6, `0.001001`], [1.001, `0`],
  [1.001 - 1e-6, `0`], [0.5 + 1e-3 - 1e-6, `½`], [0.5 + 1e-3 + 1e-6, `0.501`],
  [0.25 + 1e-3 - 1e-6, `¼`], [0.25 + 1e-3 + 1e-6, `0.251`],
  // symmetric around integers: just below one wraps to just below 1, still the zero glyph
  [-1e-7, `0`], [1e-7, `0`], [0.9995, `0`], [1.0005, `0`], [0.9999999, `0`], [-0.0005, `0`],
  [Infinity, `Infinity`], [-Infinity, `-Infinity`], [NaN, `NaN`],
])(`format_fractional(%s) = %s`, (input, expected) => {
  expect(format_fractional(input)).toBe(expected)
})

describe(`format_value`, () => {
  // oxfmt-ignore
  test.each([
    // trailing zeros are stripped
    [123.456, `.2f`, `123.46`], [123.4, `.2f`, `123.4`], [123.0, `.2f`, `123`], [0.0, `.4f`, `0`],
    [0.1, `.3f`, `0.1`], [0.001, `.3f`, `0.001`], [0.0001, `.4f`, `0.0001`],
    [-123.456, `.2f`, `-123.46`],
    [999.9999, `.2f`, `1000`],
    // scientific notation, positive exponents without d3's redundant + sign
    [1000000, `.2e`, `1.00e6`], [0.000001, `.2e`, `1.00e-6`], [1.06e29, `.3~g`, `1.06e29`],
    [42, `d`, `42`], [42.7, `d`, `43`], [-42.3, `d`, `-42`], [0, `d`, `0`],
    [1234.5, `,.1f`, `1,234.5`], [1234.0, `,.1f`, `1,234`], [12345678.9, `,.2f`, `12,345,678.9`],
    [999.999, `,.0f`, `1,000`],
    [0.123, `.1%`, `12.3%`], [0.1, `.1%`, `10%`], [1.0, `.0%`, `100%`], [0.0, `.1%`, `0%`],
    // only `%`-type formats strip zeros before the sign; `p` and padded outputs stay verbatim
    [1e-7, `.2p`, `0.000010%`], [0.5, `<8.2%`, `50.00%  `], [1.5, `<8.2f`, `1.50    `],
    // currency keeps its zeros
    [1234.5, `$,.2f`, `$1,234.50`], [1234.0, `$,.2f`, `$1,234.00`], [-50.25, `$,.2f`, `-$50.25`],
    [0.99, `$,.2f`, `$0.99`],
    [NaN, `.2f`, `NaN`], [Infinity, `.2f`, `Infinity`], [-Infinity, `.2f`, `-Infinity`],
    [-0, `.2f`, `0`], [-0, `.0f`, `0`], [-0, `.0%`, `0%`], [-0, `$,.2f`, `$0.00`],
    [-0.001, `.2f`, `0`],
    // scientific zeros collapse to plain 0 (same path plot ticks use via format_value_or_num)
    [-0, `.2e`, `0`], [0, `$.2e`, `$0`],
    [123.456, ``, `123.456`], [123.456, undefined, `123.456`],
  ])(`format_value(%s, %j) = %j`, (value, formatter, expected) => {
    expect(format_value(value, formatter)).toBe(expected)
  })

  test.each([
    [new Date(2023, 0, 1).getTime(), `%Y-%m-%d`, `2023-01-01`],
    [new Date(2023, 5, 15).getTime(), `%b %d, %Y`, `Jun 15, 2023`],
    [new Date(2023, 11, 31, 23, 59, 59).getTime(), `%Y-%m-%d %H:%M:%S`, `2023-12-31 23:59:59`],
    [new Date(2023, 0, 1, 0, 0, 0).getTime(), `%I:%M %p`, `12:00 AM`],
  ])(`formats timestamp %s with %s as %s`, (value, formatter, expected) => {
    expect(format_value(value, formatter)).toBe(expected)
  })
})

test.each([
  [9.43e-125, 13.4, 0], // a density's vacuum
  [-1e-17, 0.5, 0], // noise on either side of zero
  [4.55e-4, 0.868, 4.55e-4], // a real small minimum stays
  [1e-7, 0.1, 0], // the cutoff (1e-6 of the magnitude) is inclusive
  [2e-7, 0.1, 2e-7],
  [5, 0, 5], // no magnitude: nothing to compare against
  [0, 0, 0],
])(`zero_if_negligible(%s, %s) → %s`, (value, magnitude, expected) => {
  expect(zero_if_negligible(value, magnitude)).toBe(expected)
})

// The notice spells out the first 5 warnings, so thousands of skipped rows stay readable
test.each([
  [[], undefined],
  [[`a`], `1 parse warning: a`],
  [[`a`, `b`, `c`, `d`, `e`], `5 parse warnings: a; b; c; d; e`],
  [[`a`, `b`, `c`, `d`, `e`, `f`, `g`], `7 parse warnings: a; b; c; d; e (and 2 more)`],
])(`parse_warnings_notice(%j) → %s`, (warnings, expected) => {
  expect(parse_warnings_notice(warnings)).toBe(expected)
})
