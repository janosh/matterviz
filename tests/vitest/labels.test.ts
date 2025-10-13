import { element_data } from '$lib/element'
import {
  default_fmt,
  format_fractional,
  format_num,
  format_value,
  heatmap_keys,
  heatmap_labels,
  parse_si_float,
  property_labels,
  superscript_digits,
  trajectory_property_config,
} from '$lib/labels'
import { format as d3_format } from 'd3-format'
import { describe, expect, test } from 'vitest'

describe(`labels utils`, () => {
  test(`heatmap_labels maps each label to a valid heatmap key`, () => {
    const mapped_keys = new Set(Object.values(heatmap_labels))
    heatmap_keys.forEach((key) => {
      expect(mapped_keys.has(key)).toBe(true)
    })
    // Ensure 1:1 mapping (no duplicate labels collapsing entries)
    expect(Object.values(heatmap_labels)).toHaveLength(heatmap_keys.length)
  })

  test.each([
    [0, `0`],
    [0.5, `½`],
    [1 / 3, `⅓`],
    [3 / 4, `¾`],
  ])(`format_fractional maps %p to %p`, (input, expected) => {
    expect(format_fractional(input)).toBe(expected)
  })

  test(`format_num uses defaults and respects overrides`, () => {
    const [gt_1_fmt, lt_1_fmt] = default_fmt
    expect(format_num(1234)).toBe(d3_format(gt_1_fmt)(1234))
    expect(format_num(0.123)).toBe(d3_format(lt_1_fmt)(0.123))
    expect(format_num(1234, gt_1_fmt)).toBe(d3_format(gt_1_fmt)(1234))
    expect(format_num(0.123, lt_1_fmt)).toBe(d3_format(lt_1_fmt)(0.123))
  })

  test.each([
    [`Fe2+`, `Fe²⁺`],
    [`O2-`, `O²⁻`],
    [`H2O`, `H²O`],
  ])(`superscript_digits(%p) -> %p`, (input, expected) => {
    expect(superscript_digits(input)).toBe(expected)
  })

  test(`trajectory_property_config provides label and unit`, () => {
    Object.keys(trajectory_property_config).forEach((key) => {
      const info = trajectory_property_config[key]
      expect(typeof info.label).toBe(`string`)
      expect(typeof info.unit).toBe(`string`)
      expect(info.label.length).toBeGreaterThan(0)
      expect(info.unit.length).toBeGreaterThan(0)
    })
  })
})

test(`format_num`, () => {
  expect(format_num(0)).toBe(`0`)
  expect(format_num(1)).toBe(`1`)
  expect(format_num(10)).toBe(`10`)
  expect(format_num(100)).toBe(`100`)
  expect(format_num(1_000)).toBe(`1k`)
  expect(format_num(10_000)).toBe(`10k`)
  expect(format_num(100_000)).toBe(`100k`)
  expect(format_num(1_000_000)).toBe(`1M`)
  expect(format_num(10_000_000)).toBe(`10M`)
  expect(format_num(100_000_000)).toBe(`100M`)
  expect(format_num(1_000_000_000)).toBe(`1G`)

  expect(format_num(0.1)).toBe(`0.1`)
  expect(format_num(0.01)).toBe(`0.01`)
  expect(format_num(0.001)).toBe(`0.001`)
  expect(format_num(-0.000_1)).toBe(`−0.0001`)
  expect(format_num(-0.000_01)).toBe(`−0.00001`)
  expect(format_num(-0.000_001)).toBe(`−0.000001`)
  expect(format_num(-0.000_000_1)).toBe(`−1e-7`)

  expect(format_num(-1.1)).toBe(`−1.1`)
  expect(format_num(-1.14123)).toBe(`−1.14`)
  expect(format_num(-1.14123e-7, `.5~g`)).toBe(`−1.1412e-7`)
})

test(`default_fmt`, () => {
  expect(default_fmt).toEqual([`,.3~s`, `.3~g`])

  expect(format_num(12_345)).toBe(`12.3k`)
  default_fmt[0] = `,.5~s`
  expect(format_num(12_345)).toBe(`12.345k`)
  default_fmt[0] = `,.3~s`
})

const element_data_keys = Object.keys(element_data[0])

test(`heatmap_keys are valid element data keys`, () => {
  expect(element_data_keys).toEqual(expect.arrayContaining(heatmap_keys))
})

test(`property_labels are valid element data keys`, () => {
  const prop_keys = Object.keys(property_labels)
  expect(element_data_keys).toEqual(expect.arrayContaining(prop_keys))
})

test(`superscript_digits`, () => {
  expect(superscript_digits(`Cr3+ O2- Ac3+`)).toBe(`Cr³⁺ O²⁻ Ac³⁺`)
  expect(superscript_digits(`1234567890`)).toBe(`¹²³⁴⁵⁶⁷⁸⁹⁰`)
  expect(superscript_digits(`+123-456+789-0`)).toBe(`⁺¹²³⁻⁴⁵⁶⁺⁷⁸⁹⁻⁰`)
  expect(superscript_digits(`No digits here`)).toBe(`No digits here`)
})

describe(`parse_si_float function`, () => {
  test.each([
    [`123`, 123], // int
    [`123.45`, 123.45], // float
    [`1,234.45`, 1234.45], // with comma
    [`1,234,567.89`, 1234567.89], // 2 commas
    [`1k`, 1000],
    [`1.5k`, 1500],
    [`2M`, 2000000],
    [`3.14G`, 3140000000],
    [`5T`, 5000000000000],
    [`1m`, 0.001],
    [`500µ `, 0.0005],
    [`10n`, 1e-8],
    [`2p`, 2e-12],
    [`3f`, 3e-15],
    [`4a`, 4e-18],
    [` 5z`, 5e-21], // leading whitespace
    [`6y`, 6e-24],
    [`-1.5k`, -1500],
    [`-500µ`, -0.0005],
    [`abc`, `abc`],
    [``, ``],
    [` 123 `, 123], // leading/trailing whitespace
    [`-123`, -123],
    [`1 k`, 1000], // with space
    [`2 µ`, 0.000002], // with space
    [`foo`, `foo`],
    [`123foo`, `123foo`],
    [-12, -12], // int -> int
    [124.847321, 124.847321], // float -> float
    [``, ``], // empty string
    [undefined, undefined], // undefined
    [null, null], // null
    [`123.456.789`, `123.456.789`], // phone number
  ])(`parseValue(%s) should return %s`, (input, expected) => {
    const result = parse_si_float(input as string)
    if (typeof expected === `number`) {
      expect(result).toBeCloseTo(expected, 15) // Increased precision for very small numbers
    } else {
      expect(result).toEqual(expected)
    }
  })
})

describe(`format_fractional function`, () => {
  test.each([
    [0, `0`], // exact zero
    [1, `0`], // integer wraps to 0
    [0.5, `½`], // exact half
    [1.5, `½`], // wraps to 0.5
    [0.25, `¼`], // exact quarter
    [0.75, `¾`], // exact three-quarters
    [0.333333333, `⅓`], // one-third
    [0.666666667, `⅔`], // two-thirds
    [0.2, `⅕`], // exact fifth
    [0.4, `⅖`], // exact two-fifths
    [0.6, `⅗`], // exact three-fifths
    [0.8, `⁴⁄₅`], // exact four-fifths
    [0.166666667, `⅙`], // one-sixth
    [0.125, `⅛`], // exact eighth
    [0.083333333, `¹⁄₁₂`], // one-twelfth
    [0.1, `0.1`], // not a special fraction
    [0.65, `0.65`], // not a special fraction
    [0.85, `0.85`], // not a special fraction
    [0.001, `0`], // very small (floating point precision issue)
    [Infinity, `Infinity`], // non-finite preserved
    [-Infinity, `-Infinity`], // non-finite preserved
    [NaN, `NaN`], // non-finite preserved
  ])(`format_fractional(%s) should return %s`, (input, expected) => {
    const result = format_fractional(input)
    expect(result).toBe(expected)
  })

  test(`handles edge cases around epsilon boundary`, () => {
    const eps = 1e-3
    expect(format_fractional(0.5 + eps - 1e-6)).toBe(`½`)
    expect(format_fractional(0.5 + eps + 1e-6)).toBe(`0.501`)
  })

  test(`zero case uses <= for exact epsilon values while others use <`, () => {
    const eps = 1e-3
    // Zero case: should now work with exact epsilon (0.001)
    expect(format_fractional(0.001)).toBe(`0`)
    expect(format_fractional(0.001 - 1e-6)).toBe(`0`) // slightly less than eps
    expect(format_fractional(0.001 + 1e-6)).toBe(`0.001001`) // slightly more than eps (not zero)

    // Other targets: should still use < (preserving existing behavior)
    expect(format_fractional(0.5 + eps - 1e-6)).toBe(`½`) // 0.499 works
    expect(format_fractional(0.5 + eps + 1e-6)).toBe(`0.501`) // 0.501 doesn't work (preserved)
    expect(format_fractional(0.25 + eps - 1e-6)).toBe(`¼`) // 0.249 works
    expect(format_fractional(0.25 + eps + 1e-6)).toBe(`0.251`) // 0.251 doesn't work (preserved)
  })

  test(`handles negative inputs and boundary values with proper wrapping`, () => {
    // Special fractions wrap to positive equivalents
    expect(format_fractional(-0.5)).toBe(`½`)
    expect(format_fractional(-0.25)).toBe(`¾`)
    expect(format_fractional(-0.75)).toBe(`¼`)
    expect(format_fractional(-0.333333333)).toBe(`⅔`)
    expect(format_fractional(-0.125)).toBe(`⁷⁄₈`)

    // Non-special fractions remain negative
    expect(format_fractional(-0.1)).toBe(`−0.1`)
    expect(format_fractional(-0.9)).toBe(`−0.9`)

    // Values near 1 boundary
    expect(format_fractional(0.999)).toBe(`0.999`)
    expect(format_fractional(1)).toBe(`0`)
    expect(format_fractional(1.001)).toBe(`0`)
    expect(format_fractional(1.001 - 1e-6)).toBe(`0`)

    // Large negative values
    expect(format_fractional(-1.5)).toBe(`½`)
    expect(format_fractional(-2.25)).toBe(`¾`)
    expect(format_fractional(-10.5)).toBe(`½`)
  })

  test(`formats phase diagram composition ratios correctly`, () => {
    // Test case from bug report: Mn666.67Sc333.33 should display nicely
    // After GCD reduction: Mn has ratio 666.67/333.33 = 2, Sc has ratio 333.33/333.33 = 1
    // But when normalized: Mn = 2/3, Sc = 1/3 of total
    expect(format_fractional(666.67 / 1000)).toBe(`⅔`)
    expect(format_fractional(333.33 / 1000)).toBe(`⅓`)

    // Common stoichiometric ratios
    expect(format_fractional(2)).toBe(`0`) // integers wrap to zero fraction
    expect(format_fractional(1.5)).toBe(`½`)
    expect(format_fractional(2.5)).toBe(`½`)
    expect(format_fractional(1.333333333)).toBe(`⅓`)
    expect(format_fractional(1.666666667)).toBe(`⅔`)
    expect(format_fractional(2.333333333)).toBe(`⅓`)
    expect(format_fractional(2.666666667)).toBe(`⅔`)
  })
})

describe(`format_value`, () => {
  test.each([
    // Basic decimal formatting
    { value: 123.456, formatter: `.2f`, expected: `123.46` },
    { value: 123.400, formatter: `.2f`, expected: `123.4` },
    { value: 123.000, formatter: `.2f`, expected: `123` },
    { value: 0.001, formatter: `.3f`, expected: `0.001` },
    { value: 0.100, formatter: `.3f`, expected: `0.1` },
    { value: 0.0000, formatter: `.4f`, expected: `0` },
    { value: 123.4000, formatter: `.4f`, expected: `123.4` },
    { value: 0.1000, formatter: `.4f`, expected: `0.1` },

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
    { value: 0.100, formatter: `.1%`, expected: `10%` },
    { value: 1.0, formatter: `.0%`, expected: `100%` },
    { value: 0.0, formatter: `.1%`, expected: `0%` },
    { value: 2.5, formatter: `.0%`, expected: `250%` },

    // Currency formatting
    { value: 1234.5, formatter: `$,.2f`, expected: `$1,234.50` },
    { value: 1234.0, formatter: `$,.2f`, expected: `$1,234.00` },
    { value: 0.99, formatter: `$,.2f`, expected: `$0.99` },
    { value: -50.25, formatter: `$,.2f`, expected: `-$50.25` },

    // Special values
    { value: NaN, formatter: `.2f`, expected: `NaN` },
    { value: Infinity, formatter: `.2f`, expected: `Infinity` },
    { value: -Infinity, formatter: `.2f`, expected: `-Infinity` },
    { value: NaN, formatter: `.2e`, expected: `NaN` },
    { value: Infinity, formatter: `d`, expected: `Infinity` },

    // Edge cases
    { value: 0, formatter: `.2f`, expected: `0` },
    { value: -0, formatter: `.2f`, expected: `0` },
    { value: -0, formatter: `.0f`, expected: `0` },
    { value: -0, formatter: `.0%`, expected: `0%` },
    { value: -0, formatter: `$,.2f`, expected: `$0.00` },
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
