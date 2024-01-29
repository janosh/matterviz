import * as struct_utils from '$lib/structure'
import { structures } from '$site'
import fs from 'fs'
import { describe, expect, test } from 'vitest'

const ref_data = {
  'mp-1': {
    amounts: { Cs: 2 },
    density: 1.8,
    center_of_mass: [1.564, 1.564, 1.564],
  },
  'mp-2': {
    amounts: { Pd: 4 },
    density: 11.76,
    center_of_mass: [0.979, 0.979, 0.979],
  },
  'mp-1234': {
    amounts: { Lu: 8, Al: 16 },
    density: 6.63,
    center_of_mass: [3.535, 3.535, 3.535],
  },
  'mp-30855': {
    amounts: { U: 2, Pt: 6 },
    density: 19.14,
    center_of_mass: [3.535, 3.535, 3.535],
  },
  'mp-756175': {
    amounts: { Zr: 16, Bi: 16, O: 56 },
    density: 7.46,
    center_of_mass: [4.798, 4.798, 4.798],
  },
  'mp-1229155': {
    amounts: { Ag: 4, Hg: 4, S: 4, Br: 1, Cl: 3 },
    density: 6.11,
    center_of_mass: [2.282, 3.522, 6.642],
  },
  'mp-1229168': {
    amounts: { Al: 54, Fe: 4, Ni: 8 },
    density: 3.66,
    center_of_mass: [1.785, 2.959, 12.51],
  },
} as const

test(`tests are actually running`, () => {
  expect(structures.length).toBeGreaterThan(0)
})

describe.each(structures)(`structure-utils`, (structure) => {
  const { id } = structure
  const expected = ref_data[id]

  test.runIf(id in ref_data)(
    `get_elem_amount should return the correct element amounts for a given structure`,
    () => {
      const result = struct_utils.get_elem_amounts(structure)
      expect(JSON.stringify(result), id).toBe(JSON.stringify(expected.amounts))
    },
  )

  test.runIf(id in ref_data)(
    `get_elements should return the unique elements in a given structure`,
    () => {
      const result = struct_utils.get_elements(structure)
      expect(JSON.stringify(result), id).toBe(
        JSON.stringify(Object.keys(expected.amounts).sort()),
      )
    },
  )

  test.runIf(id in ref_data)(
    `density should return the correct density for a given structure`,
    () => {
      const result = struct_utils.density(structure)
      expect(Number(result), id).toBe(expected.density)
    },
  )
})

test.each(structures)(`find_image_atoms`, async (structure) => {
  const image_atoms = struct_utils.find_image_atoms(structure)
  // write reference data
  // fs.writeFileSync(
  //   `${__dirname}/fixtures/find_image_atoms/${structure.id}.json`,
  //   JSON.stringify(result)
  // )
  const path = `./fixtures/find_image_atoms/${structure.id}.json`
  if (!fs.existsSync(path)) return
  const { default: expected } = await import(path)
  expect(image_atoms).toEqual(expected)
})

test.each(structures)(`symmetrize_structure`, async (structure) => {
  const orig_len = structure.sites.length
  const symmetrized = struct_utils.get_pbc_image_sites(structure)
  const { id } = structure
  const expected = {
    'mp-1': 12,
    'mp-2': 40,
    'mp-1234': 72,
    'mp-756175': 448,
  }[id]
  // No ref data for id
  if (!expected) return
  const msg = `${id} has ${symmetrized.sites.length} sites, expected ${expected}`
  expect(symmetrized.sites.length, msg).toEqual(expected)
  expect(symmetrized.sites.length, msg).toBeGreaterThan(orig_len)
  expect(structure.sites.length, msg).toBe(orig_len)
})

test.each(structures)(`get_center_of_mass for $id`, async (struct) => {
  const center = struct_utils.get_center_of_mass(struct)
  const expected = ref_data[struct.id]?.center_of_mass
  if (!expected) return
  expect(
    center.map((val) => Math.round(val * 1e3) / 1e3),
    struct.id,
  ).toEqual(expected)
})
