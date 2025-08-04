import { element_data } from '$lib'
import {
  default_fmt,
  format_num,
  heatmap_keys,
  parse_si_float,
  property_labels,
  superscript_digits,
} from '$lib/labels'
import { describe, expect, test } from 'vitest'

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
