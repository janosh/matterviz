import { element_data } from '$lib'
import {
  default_fmt,
  format_fractional,
  format_num,
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
})
