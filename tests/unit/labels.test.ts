import { element_data } from '$lib'
import { heatmap_keys, pretty_num, property_labels } from '$lib/labels'
import { expect, test } from 'vitest'

test(`pretty_num`, () => {
  expect(pretty_num(0)).toBe(`0`)
  expect(pretty_num(1)).toBe(`1`)
  expect(pretty_num(10)).toBe(`10`)
  expect(pretty_num(100)).toBe(`100`)
  expect(pretty_num(1_000)).toBe(`1,000`)
  expect(pretty_num(10_000)).toBe(`10,000`)
  expect(pretty_num(100_000)).toBe(`100,000`)
  expect(pretty_num(1_000_000)).toBe(`1,000,000`)
  expect(pretty_num(10_000_000)).toBe(`1.00e+7`)
  expect(pretty_num(100_000_000)).toBe(`1.00e+8`)
  expect(pretty_num(1_000_000_000)).toBe(`1.00e+9`)

  expect(pretty_num(0.1)).toBe(`0.1`)
  expect(pretty_num(0.01)).toBe(`0.01`)
  expect(pretty_num(0.001)).toBe(`1.00e-3`)
  expect(pretty_num(-0.0001)).toBe(`-1.00e-4`)

  expect(pretty_num(-1.1)).toBe(`-1.1`)
})

const element_data_keys = Object.keys(element_data[0])

test(`heatmap_keys are valid element data keys`, () => {
  expect(element_data_keys).toEqual(expect.arrayContaining(heatmap_keys))
})

test(`property_labels are valid element data keys`, () => {
  const prop_keys = Object.keys(property_labels)
  expect(element_data_keys).toEqual(expect.arrayContaining(prop_keys))
})
