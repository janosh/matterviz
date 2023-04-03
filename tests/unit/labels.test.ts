import { element_data } from '$lib'
import {
  default_precision,
  heatmap_keys,
  pretty_num,
  property_labels,
} from '$lib/labels'
import { expect, test } from 'vitest'

test(`pretty_num`, () => {
  expect(pretty_num(0)).toBe(`0`)
  expect(pretty_num(1)).toBe(`1`)
  expect(pretty_num(10)).toBe(`10`)
  expect(pretty_num(100)).toBe(`100`)
  expect(pretty_num(1_000)).toBe(`1k`)
  expect(pretty_num(10_000)).toBe(`10k`)
  expect(pretty_num(100_000)).toBe(`100k`)
  expect(pretty_num(1_000_000)).toBe(`1M`)
  expect(pretty_num(10_000_000)).toBe(`10M`)
  expect(pretty_num(100_000_000)).toBe(`100M`)
  expect(pretty_num(1_000_000_000)).toBe(`1G`)

  expect(pretty_num(0.1)).toBe(`0.1`)
  expect(pretty_num(0.01)).toBe(`0.01`)
  expect(pretty_num(0.001)).toBe(`0.001`)
  // TODO: figure out how to make pretty_num(-0.0001) = '1e-4'
  expect(pretty_num(-0.000_1)).toBe(`−0.0001`) // want −1e-4
  expect(pretty_num(-0.000_01)).toBe(`−0.00001`) // want −1e-5
  expect(pretty_num(-0.000_001)).toBe(`−0.000001`) // want −1e-6
  expect(pretty_num(-0.000_000_1)).toBe(`−1e-7`)

  expect(pretty_num(-1.1)).toBe(`−1.1`)
  expect(pretty_num(-1.14123)).toBe(`−1.14`)
  expect(pretty_num(-1.14123e-7, `.5~g`)).toBe(`−1.1412e-7`)
})

test(`default_precision`, () => {
  expect(default_precision).toEqual([`,.3~s`, `.3~g`])

  expect(pretty_num(12_345)).toBe(`12.3k`)
  default_precision[0] = `,.5~s`
  expect(pretty_num(12_345)).toBe(`12.345k`)
  default_precision[0] = `,.3~s`
})

const element_data_keys = Object.keys(element_data[0])

test(`heatmap_keys are valid element data keys`, () => {
  expect(element_data_keys).toEqual(expect.arrayContaining(heatmap_keys))
})

test(`property_labels are valid element data keys`, () => {
  const prop_keys = Object.keys(property_labels)
  expect(element_data_keys).toEqual(expect.arrayContaining(prop_keys))
})
