import * as module from '$lib/structure'
import { structures } from '$site'
import { describe, expect, test } from 'vitest'

const ref_data = {
  'mp-1': {
    amounts: { Cs: 2 },
    density: 1.8,
  },
  'mp-2': {
    amounts: { Pd: 4 },
    density: 11.76,
  },
  'mp-1234': {
    amounts: { Lu: 8, Al: 16 },
    density: 6.63,
  },
  'mp-30855': {
    amounts: { U: 2, Pt: 6 },
    density: 19.14,
  },
  'mp-756175': {
    amounts: { Zr: 16, Bi: 16, O: 56 },
    density: 7.46,
  },
} as const

test(`tests are actually running`, () => {
  expect(structures.length).toBeGreaterThan(0)
})

describe.each(structures)(`structure-utils`, (structure) => {
  const { id } = structure
  const expected = ref_data[id]
  if (!expected) {
    throw new Error(`No ref data for ${id}, have ${Object.keys(ref_data)}}`)
  }

  describe(`get_elem_amount`, () => {
    test(`should return the correct element amounts for a given structure`, () => {
      const result = module.get_elem_amounts(structure)
      expect(JSON.stringify(result), id).toBe(JSON.stringify(expected.amounts))
    })
  })

  describe(`get_elements`, () => {
    test(`should return the unique elements in a given structure`, () => {
      const result = module.get_elements(structure)
      expect(JSON.stringify(result), id).toBe(
        JSON.stringify(Object.keys(expected.amounts).sort())
      )
    })
  })

  describe(`density`, () => {
    test(`should return the correct density for a given structure`, () => {
      const result = module.density(structure)
      expect(Number(result), id).toBe(expected.density)
    })
  })
})

test.each(structures)(`find_image_atoms`, async (structure) => {
  const result = module.find_image_atoms(structure)
  // write reference data
  // fs.writeFileSync(
  //   `${__dirname}/fixtures/find_image_atoms/${structure.id}.json`,
  //   JSON.stringify(result)
  // )

  const { default: expected } = await import(
    `./fixtures/find_image_atoms/${structure.id}.json`
  )
  expect(result).toEqual(expected)
})
