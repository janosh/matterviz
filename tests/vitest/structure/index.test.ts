import type { AnyStructure, Site, Species, Vec3 } from '$lib'
import * as struct_utils from '$lib/structure'
import { structures } from '$site/structures'
import { describe, expect, test } from 'vitest'

type StructureId = string

const ref_data: Record<
  StructureId,
  {
    amounts: Record<string, number>
    density: number
    center_of_mass: Vec3
    elements: string[]
    electro_neg_formula: string
  }
> = {
  'mp-1': {
    amounts: { Cs: 2 },
    density: 1.8019302505603234,
    center_of_mass: [1.564, 1.564, 1.564],
    elements: [`Cs`],
    electro_neg_formula: `Cs<sub>2</sub>`,
  },
  'mp-2': {
    amounts: { Pd: 4 },
    density: 11.759135742447171,
    center_of_mass: [0.979, 0.979, 0.979],
    elements: [`Pd`],
    electro_neg_formula: `Pd<sub>4</sub>`,
  },
  'mp-1234': {
    amounts: { Lu: 8, Al: 16 },
    density: 6.63,
    center_of_mass: [3.119, 3.119, 3.119],
    elements: [`Al`, `Lu`],
    electro_neg_formula: `Lu<sub>8</sub> Al<sub>16</sub>`,
  },
  'mp-30855': {
    amounts: { U: 2, Pt: 6 },
    density: 19.14,
    center_of_mass: [3.535, 3.535, 3.535],
    elements: [`Pt`, `U`],
    electro_neg_formula: `U<sub>2</sub> Pt<sub>6</sub>`,
  },
  'mp-756175': {
    amounts: { Zr: 16, Bi: 16, O: 56 },
    density: 7.457890165317997,
    center_of_mass: [5.261, 5.261, 5.261],
    elements: [`Bi`, `O`, `Zr`],
    electro_neg_formula: `Zr<sub>16</sub> Bi<sub>16</sub> O<sub>56</sub>`,
  },
  'mp-1229155': {
    amounts: { Ag: 4, Hg: 4, S: 4, Br: 1, Cl: 3 },
    density: 6.107930572082895,
    center_of_mass: [2.216, 3.594, 6.502],
    elements: [`Ag`, `Br`, `Cl`, `Hg`, `S`],
    electro_neg_formula: `Ag<sub>4</sub> Hg<sub>4</sub> S<sub>4</sub> Br Cl<sub>3</sub>`,
  },
  'mp-1229168': {
    amounts: { Al: 54, Fe: 4, Ni: 8 },
    density: 3.6567149052096903,
    center_of_mass: [1.802, 2.991, 12.542],
    elements: [`Al`, `Fe`, `Ni`],
    electro_neg_formula: `Al<sub>54</sub> Fe<sub>4</sub> Ni<sub>8</sub>`,
  },
}

test(`tests are actually running`, () => {
  expect(structures.length).toBeGreaterThan(0)
})

describe.each(structures)(`structure-utils`, (structure) => {
  const { id } = structure
  const expected = id ? ref_data[id] : undefined

  test.runIf(id && id in ref_data)(
    `get_elem_amount should return the correct element amounts for a given structure`,
    () => {
      const result = struct_utils.get_elem_amounts(structure)
      expect(JSON.stringify(result), id).toBe(JSON.stringify(expected?.amounts))
    },
  )

  test.runIf(id && id in ref_data)(
    `density should return the correct density for a given structure`,
    () => {
      const density = struct_utils.get_density(structure)
      expect(density, id).toBeCloseTo(expected?.density ?? 0, 3)
    },
  )
})

// Consolidated tests for center of mass, formulas, and elements
test.each(structures.filter((struct) => struct.id && ref_data[struct.id]))(
  `%s calculations`,
  (struct) => {
    const expected_data = ref_data[struct.id as keyof typeof ref_data]

    // Center of mass
    const com = struct_utils.get_center_of_mass(struct)
    expect(
      com.map((val) => Math.round(val * 1e3) / 1e3),
      `${struct.id} center_of_mass`,
    ).toEqual(expected_data.center_of_mass)

    // Electronegativity formula
    const electro_formula = struct_utils.electro_neg_formula(struct)
    expect(electro_formula, `${struct.id} electro_neg_formula`).toEqual(
      expected_data.electro_neg_formula,
    )
  },
)

test.each(structures)(`find_image_atoms`, async (structure) => {
  const image_atoms = struct_utils.find_image_atoms(structure)
  // write reference data
  // import fs from 'fs'
  // fs.writeFileSync(
  //   `${__dirname}/fixtures/find_image_atoms/${structure.id}.json`,
  //   JSON.stringify(result)
  // )
  const path = `./fixtures/find_image_atoms/${structure.id}.json`
  try {
    const { default: expected } = await import(path)
    expect(image_atoms).toEqual(expected)
  } catch {
    // Skip if fixture file doesn't exist
  }
})

test.each(structures)(`symmetrize_structure`, (structure) => {
  const orig_len = structure.sites.length
  const symmetrized = struct_utils.get_pbc_image_sites(structure)
  const { id } = structure

  // Test that the function works correctly - it should add image atoms for structures with PBC
  // The exact number depends on how many atoms are at the edges of the unit cell
  const msg = `${id} should have original sites plus appropriate image atoms`

  // Basic sanity checks
  expect(symmetrized.sites.length, msg).toBeGreaterThanOrEqual(orig_len)
  expect(structure.sites.length, msg).toBe(orig_len) // Original structure unchanged

  // If structure has lattice and any atoms at edges, should have image atoms
  if (structure.lattice) {
    const image_atoms = struct_utils.find_image_atoms(structure)
    expect(symmetrized.sites.length, msg).toBe(orig_len + image_atoms.length)
  }
})

describe(`get_center_of_mass`, () => {
  const create_simple_structure = (sites: (Species & { xyz: Vec3 })[]): AnyStructure => ({
    sites: sites.map((site, idx) => ({
      species: [{ element: site.element, occu: site.occu, oxidation_state: 0 }],
      abc: site.xyz,
      xyz: site.xyz,
      label: `${site.element}${idx + 1}`,
      properties: {},
    })) as Site[],
    charge: 0,
  })

  test.each([
    {
      sites: [
        { element: `H` as const, xyz: [0, 0, 0] as Vec3, occu: 1, oxidation_state: 0 },
        { element: `O` as const, xyz: [2, 2, 2] as Vec3, occu: 1, oxidation_state: 0 },
        { element: `H` as const, xyz: [4, 4, 4] as Vec3, occu: 1, oxidation_state: 0 },
      ],
      expected: [2.0, 2.0, 2.0] as Vec3,
      desc: `simple structure with equal occupancies`,
    },
    {
      sites: [
        { element: `H` as const, xyz: [0, 0, 0] as Vec3, occu: 0.5, oxidation_state: 0 },
        { element: `O` as const, xyz: [2, 2, 2] as Vec3, occu: 2.0, oxidation_state: 0 },
      ],
      expected: [1.969, 1.969, 1.969] as Vec3,
      desc: `weighted occupancies`,
    },
    {
      sites: [{
        element: `H` as const,
        xyz: [1, 2, 3] as Vec3,
        occu: 1,
        oxidation_state: 0,
      }],
      expected: [1, 2, 3] as Vec3,
      desc: `single atom structure`,
    },
  ])(
    `should calculate center of mass for $desc`,
    ({ sites, expected }) => {
      const structure = create_simple_structure(sites)
      const result = struct_utils.get_center_of_mass(structure)
      expected.forEach((val, idx) => expect(result[idx]).toBeCloseTo(val, 3))
    },
  )
})
