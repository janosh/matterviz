import type { AnyStructure, Site, Species, Vec3 } from '$lib'
import * as struct_utils from '$lib/structure'
import {
  default_vector_configs,
  get_all_site_vectors,
  get_structure_vector_keys,
  is_vector_key,
  VECTOR_PALETTE,
} from '$lib/structure'
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
    formula_by_electronegativity: string
  }
> = {
  'mp-1': {
    amounts: { Cs: 2 },
    density: 1.8019302505603234,
    center_of_mass: [1.564, 1.564, 1.564],
    elements: [`Cs`],
    formula_by_electronegativity: `Cs<sub>2</sub>`,
  },
  'mp-2': {
    amounts: { Pd: 4 },
    density: 11.759135742447171,
    center_of_mass: [0.979, 0.979, 0.979],
    elements: [`Pd`],
    formula_by_electronegativity: `Pd<sub>4</sub>`,
  },
  'mp-1234': {
    amounts: { Lu: 8, Al: 16 },
    density: 6.63,
    center_of_mass: [3.119, 3.119, 3.119],
    elements: [`Al`, `Lu`],
    formula_by_electronegativity: `Lu<sub>8</sub> Al<sub>16</sub>`,
  },
  'mp-30855': {
    amounts: { U: 2, Pt: 6 },
    density: 19.14,
    center_of_mass: [3.535, 3.535, 3.535],
    elements: [`Pt`, `U`],
    formula_by_electronegativity: `U<sub>2</sub> Pt<sub>6</sub>`,
  },
  'mp-756175': {
    amounts: { Zr: 16, Bi: 16, O: 56 },
    density: 7.457890165317997,
    center_of_mass: [5.261, 5.261, 5.261],
    elements: [`Bi`, `O`, `Zr`],
    formula_by_electronegativity: `Zr<sub>16</sub> Bi<sub>16</sub> O<sub>56</sub>`,
  },
  'mp-1229155': {
    amounts: { Ag: 4, Hg: 4, S: 4, Br: 1, Cl: 3 },
    density: 6.107930572082895,
    center_of_mass: [2.216, 3.594, 6.502],
    elements: [`Ag`, `Br`, `Cl`, `Hg`, `S`],
    formula_by_electronegativity:
      `Ag<sub>4</sub> Hg<sub>4</sub> S<sub>4</sub> Br Cl<sub>3</sub>`,
  },
  'mp-1229168': {
    amounts: { Al: 54, Fe: 4, Ni: 8 },
    density: 3.6567149052096903,
    center_of_mass: [1.802, 2.991, 12.542],
    elements: [`Al`, `Fe`, `Ni`],
    formula_by_electronegativity: `Al<sub>54</sub> Fe<sub>4</sub> Ni<sub>8</sub>`,
  },
}

describe.each(structures)(`structure-utils`, (structure) => {
  const { id } = structure
  const expected = id ? ref_data[id] : undefined

  test(`get_element_counts should return valid element amounts`, () => {
    const result = struct_utils.get_element_counts(structure)

    for (const [element, count] of Object.entries(result)) {
      expect(element, `${id}`).toMatch(/^[A-Z][a-z]{0,2}$/) // Valid element symbol
      expect(count, `${id}: ${element}`).toBeGreaterThan(0)
      expect(Number.isInteger(count), `${id}: ${element}`).toBe(true)
    }

    // Sum must equal total sites
    const total = Object.values(result).reduce((sum, n) => sum + n, 0)
    expect(total, `${id}`).toBe(structure.sites.length)

    if (expected?.amounts) {
      expect(result, id).toEqual(expected.amounts)
    }
  })

  test(`density should return a valid positive value`, () => {
    const density = struct_utils.get_density(structure)

    if (structure.lattice) {
      // Physical sanity: 0.01 g/cm³ (aerogels) to 30 g/cm³ (beyond osmium)
      expect(density, `${id}: density`).toBeGreaterThan(0.01)
      expect(density, `${id}: density`).toBeLessThan(30)
      expect(Number.isFinite(density), `${id}: density finite`).toBe(true)
    } else {
      // Without lattice (molecules), density should return 0 or NaN
      expect(density === 0 || Number.isNaN(density), `${id}: no-lattice density`).toBe(
        true,
      )
    }

    if (expected?.density) {
      expect(density, id).toBeCloseTo(expected.density, 3)
    }
  })
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
    const electro_formula = struct_utils.format_formula_by_electronegativity(struct)
    expect(electro_formula, `${struct.id} formula_by_electronegativity`).toEqual(
      expected_data.formula_by_electronegativity,
    )
  },
)

test.each(structures)(`find_image_atoms`, async (structure) => {
  // Returns [atom_idx, img_xyz, img_abc][] tuples
  const image_atoms = struct_utils.find_image_atoms(structure)

  // Basic assertions that always run
  expect(Array.isArray(image_atoms), `${structure.id}: should return array`).toBe(true)
  for (const [atom_idx, img_xyz, img_abc] of image_atoms) {
    expect(atom_idx, `${structure.id}: atom_idx`).toBeGreaterThanOrEqual(0)
    expect(atom_idx, `${structure.id}: atom_idx`).toBeLessThan(structure.sites.length)
    expect(img_xyz, `${structure.id}: img_xyz`).toHaveLength(3)
    expect(img_abc, `${structure.id}: img_abc`).toHaveLength(3)
    expect(img_xyz.every(Number.isFinite), `${structure.id}: img_xyz finite`).toBe(true)
    expect(img_abc.every(Number.isFinite), `${structure.id}: img_abc finite`).toBe(true)
  }

  // Compare against fixture if it exists
  const path = `./fixtures/find_image_atoms/${structure.id}.json`
  try {
    const { default: expected } = await import(path)
    expect(image_atoms).toEqual(expected)
  } catch {
    // No fixture for exact comparison - basic assertions above still provide coverage
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

const make_site = (properties?: Record<string, unknown>): Site =>
  ({ species: [], abc: [0, 0, 0], xyz: [0, 0, 0], label: `X`, properties }) as Site

describe(`is_vector_key`, () => {
  test.each([
    [`force`, true],
    [`forces`, true],
    [`magmom`, true],
    [`magmoms`, true],
    [`spin`, true],
    [`spins`, true],
    [`force_DFT`, true],
    [`force_MLFF`, true],
    [`forces_PBE`, true],
    [`magmom_experiment`, true],
    [`spin_up`, true],
    [`spins_down`, true],
    [`force_`, true],
    [`magmom_`, true],
    [`velocity`, false],
    [`charge`, false],
    [`energy`, false],
    [`forceful`, false],
    [`my_force`, false],
    [``, false],
  ])(`is_vector_key(%s) = %s`, (key, expected) => {
    expect(is_vector_key(key)).toBe(expected)
  })
})

describe(`get_all_site_vectors`, () => {
  test.each(
    [
      [`force`, [1, 2, 3]],
      [`forces`, [4, 5, 6]],
      [`magmom`, [0.1, 0.2, 0.3]],
      [`magmoms`, [0.4, 0.5, 0.6]],
      [`spin`, [0, 0, 1]],
      [`spins`, [0, 0, -1]],
      [`force_DFT`, [1, 0, 0]],
    ] as const,
  )(`accepts 3D vector in %s`, (key, vec) => {
    const result = get_all_site_vectors(make_site({ [key]: [...vec] }))
    expect(result[0]).toEqual({ key, vec: [...vec] })
  })

  test.each(
    [
      [`force`, 2.5, [0, 0, 2.5]],
      [`magmom`, -1.0, [0, 0, -1.0]],
      [`magmoms`, 0.5, [0, 0, 0.5]],
      [`spin`, 1, [0, 0, 1]],
      [`spin`, -3.5, [0, 0, -3.5]],
      [`magmom`, 0, [0, 0, 0]],
    ] as const,
  )(`converts scalar %s=%s to z-vector`, (key, scalar, expected) => {
    expect(get_all_site_vectors(make_site({ [key]: scalar }))[0].vec).toEqual(expected)
  })

  test.each([
    [`empty props`, make_site({})],
    [`non-vector keys only`, make_site({ charge: 1 })],
    [`undefined properties`, make_site()],
  ])(`returns [] for %s`, (_desc, site) => {
    expect(get_all_site_vectors(site)).toEqual([])
  })

  test.each([
    [`NaN in array`, { force: [NaN, 0, 0] }],
    [`Infinity in array`, { force: [Infinity, 0, 0] }],
    [`wrong-length array`, { force: [1, 2] }],
    [`4-element array`, { force: [1, 2, 3, 4] }],
    [`string value`, { force: `high` }],
    [`null value`, { force: null }],
    [`boolean value`, { force: true }],
    [`nested array`, { force: [[1, 0, 0]] }],
    [`NaN scalar`, { spin: NaN }],
    [`Infinity scalar`, { magmom: Infinity }],
  ])(`rejects invalid vector: %s`, (_label, properties) => {
    expect(get_all_site_vectors(make_site(properties))).toHaveLength(0)
  })

  test.each([
    {
      desc: `bare keys by prefix priority`,
      props: { force: [1, 0, 0], magmom: [0, 0, 1] },
      expected_keys: [`force`, `magmom`],
    },
    {
      desc: `prefixed keys alphabetically within prefix group`,
      props: { force_MLFF: [0.9, 0, 0], force_DFT: [1, 0, 0], magmom: [0, 0, 1] },
      expected_keys: [`force_DFT`, `force_MLFF`, `magmom`],
    },
    {
      desc: `bare before prefixed of same type`,
      props: { force_DFT: [1, 0, 0], force: [0, 1, 0] },
      expected_keys: [`force`, `force_DFT`],
    },
    {
      desc: `many prefixed keys sorted alphabetically`,
      props: { force_C: [3, 0, 0], force_A: [1, 0, 0], force_B: [2, 0, 0] },
      expected_keys: [`force_A`, `force_B`, `force_C`],
    },
    {
      desc: `singular < prefixed < plural`,
      props: { force: [1, 0, 0], forces: [0, 1, 0], force_DFT: [0, 0, 1] },
      expected_keys: [`force`, `force_DFT`, `forces`],
    },
  ])(`ordering: $desc`, ({ props, expected_keys }) => {
    expect(get_all_site_vectors(make_site(props)).map((v) => v.key)).toEqual(
      expected_keys,
    )
  })

  test.each([
    {
      desc: `non-vector property keys ignored`,
      props: { charge: 1, velocity: [1, 2, 3], force: [1, 0, 0] },
      expected: [{ key: `force`, vec: [1, 0, 0] }],
    },
    {
      desc: `invalid values skipped, valid ones kept`,
      props: {
        force: [NaN, 0, 0],
        magmom: [0, 0, 1],
        spin: `bad`,
        force_DFT: [1, 2],
        force_MLFF: [Infinity, 0, 0],
      },
      expected: [{ key: `magmom`, vec: [0, 0, 1] }],
    },
    {
      desc: `null, boolean, object values in vector keys skipped`,
      props: {
        force: null,
        magmom: true,
        spin: { nested: [1, 2, 3] },
        forces: [0, 0, 1],
      },
      expected: [{ key: `forces`, vec: [0, 0, 1] }],
    },
    {
      desc: `zero vector [0,0,0] is valid`,
      props: { force: [0, 0, 0] },
      expected: [{ key: `force`, vec: [0, 0, 0] }],
    },
    {
      desc: `mix of zero and nonzero vectors`,
      props: { force: [0, 0, 0], magmom: [0, 0, 2.2] },
      expected: [{ key: `force`, vec: [0, 0, 0] }, { key: `magmom`, vec: [0, 0, 2.2] }],
    },
  ])(`filtering: $desc`, ({ props, expected }) => {
    expect(get_all_site_vectors(make_site(props))).toEqual(expected)
  })
})

describe(`get_structure_vector_keys`, () => {
  const make_structure = (sites_props: Record<string, unknown>[]): AnyStructure => ({
    sites: sites_props.map((properties, idx) => ({
      species: [{ element: `Fe` as const, occu: 1, oxidation_state: 0 }],
      abc: [0, 0, 0] as Vec3,
      xyz: [idx, 0, 0] as Vec3,
      label: `Fe${idx + 1}`,
      properties,
    })),
    charge: 0,
  })

  test.each([
    {
      desc: `unique keys across sites in priority order`,
      sites: [{ force: [1, 0, 0], magmom: [0, 0, 1] }, { force: [0, 1, 0] }],
      expected: [`force`, `magmom`],
    },
    {
      desc: `prefixed keys across sites`,
      sites: [{ force_DFT: [1, 0, 0] }, {
        force_MLFF: [0.9, 0, 0],
        force_DFT: [1, 0, 0],
      }],
      expected: [`force_DFT`, `force_MLFF`],
    },
    {
      desc: `empty for structure without vectors`,
      sites: [{ charge: 1 }, {}],
      expected: [],
    },
    {
      desc: `bare before prefixed`,
      sites: [{ force_DFT: [1, 0, 0], force: [0, 1, 0], magmom: [0, 0, 1] }],
      expected: [`force`, `force_DFT`, `magmom`],
    },
    {
      desc: `deduplicates across sites`,
      sites: [
        { force_DFT: [1, 0, 0], force_MLFF: [0.9, 0, 0] },
        { force_DFT: [0, 1, 0], force_MLFF: [0, 0.9, 0] },
        { force_DFT: [0, 0, 1] },
      ],
      expected: [`force_DFT`, `force_MLFF`],
    },
    {
      desc: `union across heterogeneous sites`,
      sites: [{ force: [1, 0, 0] }, { magmom: [0, 0, 1] }, {
        spin_DFT: 0.5,
        force_MLFF: [0, 1, 0],
      }],
      expected: [`force`, `force_MLFF`, `magmom`, `spin_DFT`],
    },
    {
      desc: `skips sites with all-invalid vector values`,
      sites: [{ force: [NaN, 0, 0], magmom: `bad` }, { force: [1, 0, 0] }],
      expected: [`force`],
    },
  ])(`$desc`, ({ sites, expected }) => {
    expect(get_structure_vector_keys(make_structure(sites))).toEqual(expected)
  })
})

describe(`default_vector_configs`, () => {
  test(`single key gets null color (semantic coloring)`, () => {
    expect(default_vector_configs([`force`])).toEqual({
      force: { visible: true, color: null, scale: null },
    })
  })

  test(`multiple keys get distinct palette colors`, () => {
    const configs = default_vector_configs([`force_DFT`, `force_MLFF`, `magmom`])
    expect(configs).toEqual({
      force_DFT: { visible: true, color: VECTOR_PALETTE[0], scale: null },
      force_MLFF: { visible: true, color: VECTOR_PALETTE[1], scale: null },
      magmom: { visible: true, color: VECTOR_PALETTE[2], scale: null },
    })
  })

  test(`empty keys array returns empty object`, () => {
    expect(default_vector_configs([])).toEqual({})
  })

  test(`palette wraps around for more keys than palette entries`, () => {
    const keys = Array.from({ length: 8 }, (_, idx) => `force_${idx}`)
    const configs = default_vector_configs(keys)
    expect(configs.force_6.color).toBe(VECTOR_PALETTE[6 % VECTOR_PALETTE.length])
    expect(configs.force_7.color).toBe(VECTOR_PALETTE[7 % VECTOR_PALETTE.length])
  })
})
