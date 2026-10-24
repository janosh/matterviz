import type { BondOrder, BondPair, ElementSymbol, Vec3 } from '#lib'
import type { AnyStructure, Crystal, StructureBond } from '#lib/structure/index.js'
import type { BondEditState } from '#lib/structure/bonding.js'
import { element_by_symbol } from '#lib/element/data.js'
import * as bonding from '#lib/structure/bonding.js'
import { BondFrame, bond_neighbor_summary, pack_bonds } from '#lib/structure/bond-rendering.js'
import { numeric_sites } from '#lib/structure/site.js'
import {
  create_numeric_md_frame,
  FrameView,
  materialize_frame,
  wrap_frame_coordinates,
} from '#lib/trajectory/frame.js'
import { calc_coordination_nums } from '#lib/coordination/calc-coordination.js'
import * as math from '#lib/math.js'
import { get_pbc_image_sites, type Pbc } from '#lib/structure/pbc.js'
import { make_supercell } from '#lib/structure/supercell.js'
import { test_molecules } from '#site/molecules.js'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import { make_rng } from '../numeric-helpers'
import {
  cubic_matrix,
  FCC_FACE_CENTRES,
  image_options,
  make_crystal,
  make_molecule,
  make_rocksalt,
  make_struct,
} from '../test-fixtures'
import type { SimpleSite } from '../test-fixtures'

const make_random_structure = (n_atoms: number, seed = 7): Crystal => {
  const elements = [`C`, `H`, `N`, `O`, `S`, `Fe`, `Na`, `Cl`]
  const rand = make_rng(seed)
  return make_crystal(
    10,
    Array.from({ length: n_atoms }, (_, idx) => ({
      element: elements[idx % elements.length],
      xyz: [rand() * 10, rand() * 10, rand() * 10] as Vec3,
    })),
  )
}

// Find the bond between two site indices regardless of stored order
const find_bond = (bonds: BondPair[], idx_a: number, idx_b: number): BondPair | undefined =>
  bonds.find(
    (bond) =>
      (bond.site_idx_1 === idx_a && bond.site_idx_2 === idx_b) ||
      (bond.site_idx_1 === idx_b && bond.site_idx_2 === idx_a),
  )

// Order-independent bond list (discovery order follows the search's bin width)
const sort_bonds = (bonds: BondPair[]): BondPair[] =>
  bonds.toSorted(
    (left, right) => left.site_idx_1 - right.site_idx_1 || left.site_idx_2 - right.site_idx_2,
  )

// Step-0 numeric MD frame without metadata or vector columns
const md_frame = (
  positions: Float64Array,
  numbers: Uint8Array,
  lattice?: math.Matrix3x3,
  pbc?: Pbc,
) => create_numeric_md_frame(positions, numbers, lattice, pbc, 0, {}, [])
const NO_PBC: Pbc = [false, false, false]
const xyz_array = (structure: AnyStructure) =>
  Float64Array.from(structure.sites.flatMap(({ xyz }) => xyz))

// number of bonds touching each site
const bonds_per_site = (bonds: BondPair[], n_sites: number): number[] => {
  const counts = Array<number>(n_sites).fill(0)
  for (const { site_idx_1, site_idx_2 } of bonds) {
    counts[site_idx_1]++
    counts[site_idx_2]++
  }
  return counts
}

// Fe-O bonded at 2 A, C 2 A further along x
const make_fe_o_c = () =>
  make_struct([
    { xyz: [0, 0, 0], element: `Fe` },
    { xyz: [2, 0, 0], element: `O` },
    { xyz: [4, 0, 0], element: `C` },
  ])

// 4600 H atoms (10.6M pairs) on a 17 x 17 x 16 grid
const hydrogen_grid = (spacing: number): [string, Vec3][] =>
  Array.from({ length: 4600 }, (_, idx) => [
    `H`,
    [
      (idx % 17) * spacing,
      (Math.floor(idx / 17) % 17) * spacing,
      Math.floor(idx / 289) * spacing,
    ],
  ])

describe(`Bonding Algorithms`, () => {
  test(`electroneg_ratio returns valid BondPair format`, () => {
    const structure = make_fe_o_c()
    const bonds = bonding.electroneg_ratio(structure)
    // Fe-O at 2.0 A (covalent sum 1.98) bonds; O-C at 2.0 A is 1.4x its covalent sum and Fe-C
    // at 4.0 A is far out of range
    expect(bonds.map((bond) => [bond.site_idx_1, bond.site_idx_2])).toEqual([[0, 1]])
    expect(bonds[0].bond_length).toBeCloseTo(2, 12)
    // positions correspond to their site indices
    expect(bonds[0].pos_1).toEqual(structure.sites[0].xyz)
    expect(bonds[0].pos_2).toEqual(structure.sites[1].xyz)
  })

  test(`electroneg_ratio generates unique bonds`, () => {
    const bonds = bonding.electroneg_ratio(make_random_structure(50))
    const bond_keys = bonds.map((bond) =>
      bonding.get_bond_key(bond.site_idx_1, bond.site_idx_2),
    )
    expect(new Set(bond_keys).size).toBe(bonds.length)
    // Cross-bin discovery must keep the lower site index, regardless of spatial order.
    const chain = make_struct(
      [7.5, 0, 5, 2.5].map((coord) => ({ element: `Cu`, xyz: [coord, 0, 0] })),
    )
    const chain_bonds = bonding.electroneg_ratio(chain)
    expect(chain_bonds.map((bond) => `${bond.site_idx_1}-${bond.site_idx_2}`)).toEqual([
      `0-2`,
      `1-3`,
      `2-3`,
    ])
    expect(chain_bonds.map((bond) => bond.bond_length)).toEqual([2.5, 2.5, 2.5])
  })

  test(`electroneg_ratio handles edge cases`, () => {
    expect(bonding.electroneg_ratio(make_struct([]))).toHaveLength(0)
    expect(bonding.electroneg_ratio(make_struct([{ xyz: [0, 0, 0] }]))).toHaveLength(0)
    // unknown element symbols have no radius data and are skipped rather than thrown on
    expect(
      bonding.electroneg_ratio(
        make_struct([
          // @ts-expect-error unknown element symbol
          { xyz: [0, 0, 0], element: `Xx` },
          // @ts-expect-error unknown element symbol
          { xyz: [1, 0, 0], element: `Yy` },
          // co-located: the min_bond_dist floor also covers pairs that cannot bond
          { xyz: [1, 0, 0], element: `C` },
        ]),
      ),
    ).toEqual([])
  })
})

describe(`Explicit Bond Metadata`, () => {
  test.each(Object.entries(bonding.BONDING_STRATEGIES))(
    `%s maps structure.properties.bonds onto computed and missing bonds`,
    (_name, strategy) => {
      const structure = make_struct([
        { xyz: [0, 0, 0], element: `C` },
        { xyz: [1.4, 0, 0], element: `C` },
        { xyz: [5, 0, 0], element: `O` },
      ])
      structure.properties = {
        bonds: [
          { site_idx_1: 0, site_idx_2: 1, order: 2 },
          { site_idx_1: 2, site_idx_2: 0, order: 3 },
        ],
      }

      expect(bonding.get_explicit_bond_metadata(structure)).toEqual([
        { site_idx_1: 0, site_idx_2: 1, order: 2 },
        { site_idx_1: 0, site_idx_2: 2, order: 3 },
      ])

      const bonds = strategy(structure)
      expect(find_bond(bonds, 0, 1)?.bond_order).toBe(2)
      const explicit_only_bond = find_bond(bonds, 0, 2)
      expect(explicit_only_bond).toMatchObject({ site_idx_1: 0, site_idx_2: 2, bond_order: 3 })
      expect(explicit_only_bond?.bond_length).toBeCloseTo(5)
    },
  )

  const invalid = (idx: number, reason: string) =>
    `Ignoring invalid explicit bond at index ${idx}: ${reason}`
  const duplicate = (idx: number, sites: string, order: BondOrder) =>
    `Duplicate explicit bond definition at index ${idx} for site indices ${sites} with order ${order}; will overwrite the previous entry`
  test.each<{
    desc: string
    bonds: unknown[]
    expected: StructureBond[]
    warnings: string[]
    molecule?: boolean
  }>([
    {
      desc: `drops invalid entries`,
      bonds: [
        { site_idx_1: 0, site_idx_2: 1, order: `aromatic` },
        { site_idx_1: 0.5, site_idx_2: 1, order: 2 },
        { site_idx_1: 0, site_idx_2: 8, order: 2 },
        { site_idx_1: 1, site_idx_2: 1, order: 1 },
        { site_idx_1: 0, site_idx_2: 1, order: 4 },
        { site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0.5, 0] },
        null,
      ],
      expected: [{ site_idx_1: 0, site_idx_2: 1, order: `aromatic` }],
      warnings: [
        invalid(1, `site indices must be integers`),
        invalid(2, `site indices 0, 8 are out of range for 2 sites`),
        invalid(3, `endpoints match`),
        invalid(4, `unsupported order 4`),
        invalid(5, `cell_shift must be three integers`),
        invalid(6, `expected object`),
      ],
    },
    {
      desc: `drops periodic bonds of a lattice-free structure`,
      bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 1, cell_shift: [1, 0, 0] }],
      expected: [],
      warnings: [invalid(0, `cell_shift requires a crystal lattice`)],
      molecule: true,
    },
    {
      desc: `lets a later duplicate overwrite an earlier one`,
      bonds: [
        { site_idx_1: 0, site_idx_2: 1, order: 1 },
        { site_idx_1: 1, site_idx_2: 0, order: 2 },
      ],
      expected: [{ site_idx_1: 0, site_idx_2: 1, order: 2 }],
      warnings: [duplicate(1, `1, 0`, 2)],
    },
    {
      // a zero-shift self-bond is invalid, but periodic ones key under their canonical shift
      desc: `keeps periodic self-bonds distinct from zero-shift ones`,
      bonds: [
        { site_idx_1: 0, site_idx_2: 0, order: 1 },
        { site_idx_1: 0, site_idx_2: 0, order: 2, cell_shift: [1, 0, 0] },
        { site_idx_1: 0, site_idx_2: 0, order: 3, cell_shift: [-1, 0, 0] },
      ],
      expected: [{ site_idx_1: 0, site_idx_2: 0, order: 3, cell_shift: [1, 0, 0] }],
      warnings: [invalid(0, `endpoints match`), duplicate(2, `0, 0`, 3)],
    },
  ])(
    `explicit bond metadata $desc with warnings`,
    ({ bonds, expected, warnings, molecule }) => {
      const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => undefined)
      onTestFinished(() => warn_spy.mockRestore())
      const structure = molecule
        ? make_molecule([
            [`C`, [0, 0, 0]],
            [`C`, [1.4, 0, 0]],
          ])
        : make_struct([
            { xyz: [0, 0, 0], element: `C` },
            { xyz: [1.4, 0, 0], element: `C` },
          ])
      structure.properties = { bonds: bonds as unknown as StructureBond[] }
      expect(bonding.get_explicit_bond_metadata(structure)).toEqual(expected)
      expect(warn_spy.mock.calls.map(([message]) => message)).toEqual(warnings)
    },
  )

  const empty_bond_edit_state = (): BondEditState => ({
    added_bonds: [],
    removed_bonds: [],
    bond_order_overrides: [],
  })

  const calculated_bonds = (bond_order?: BondOrder) => [
    {
      site_idx_1: 0,
      site_idx_2: 1,
      ...(bond_order === undefined ? {} : { bond_order }),
    },
  ]

  const edge = (site_idx_1: number, site_idx_2: number, order: BondOrder) => ({
    site_idx_1,
    site_idx_2,
    order,
  })
  const bond_0_1 = (order: BondOrder) => [edge(0, 1, order)]

  // oxfmt-ignore
  test.each<{
    desc: string
    base: StructureBond[]
    added: StructureBond[]
    removed: StructureBond[]
    overrides: StructureBond[]
    expected: StructureBond[]
    visible?: boolean
  }>([
    { desc: `lets overrides win over additions`, base: [], added: bond_0_1(1), removed: [], overrides: bond_0_1(3), expected: bond_0_1(3) },
    { desc: `lets removals win over stale additions and overrides`, base: bond_0_1(1), added: bond_0_1(1), removed: [edge(1, 0, 1)], overrides: bond_0_1(3), expected: [], visible: false },
    { desc: `normalizes reversed bond records`, base: [], added: [edge(3, 1, 2)], removed: [], overrides: [], expected: [edge(1, 3, 2)] },
  ])(`merge_bond_edits $desc`, ({ base, added, removed, overrides, expected, visible }) => {
    expect(bonding.merge_bond_edits(base, added, removed, overrides)).toEqual(expected)
    if (visible !== undefined) {
      expect(
        bonding.has_visible_bond(
          { added_bonds: added, removed_bonds: removed, bond_order_overrides: overrides },
          base[0],
          [],
        ),
      ).toBe(visible)
    }
  })

  // Each edit runs against a calculated 0-1 bond (order 1 unless calc_order says otherwise);
  // reversed targets check the helpers normalize site order. Expected state is a subset.
  type EditCase = [
    desc: string,
    op: `add` | `delete` | `order`,
    before: Partial<BondEditState>,
    target: [number, number],
    order: BondOrder,
    calc_order: BondOrder | undefined,
    action: string,
    changed: boolean,
    after: Partial<BondEditState>,
  ]
  // oxfmt-ignore
  test.each<EditCase>([
    [`adds a missing bond`, `add`, {}, [2, 0], 2, undefined, `added`, true, { added_bonds: [edge(0, 2, 2)] }],
    [`leaves a visible bond alone`, `add`, { added_bonds: [edge(0, 2, 2)] }, [0, 1], 3, undefined, `already-visible`, false, { removed_bonds: [] }],
    [`restores a removed bond at its calculated order`, `add`, { removed_bonds: bond_0_1(1) }, [1, 0], 1, undefined, `restored`, true, { removed_bonds: [], bond_order_overrides: [] }],
    [`restores a removed bond with a new order`, `add`, { removed_bonds: bond_0_1(1) }, [1, 0], 2, undefined, `restored`, true, { removed_bonds: [], bond_order_overrides: bond_0_1(2) }],
    [`restores a removed order-2 bond as order 1`, `add`, { removed_bonds: bond_0_1(2) }, [0, 1], 1, 2, `restored`, true, { removed_bonds: [], bond_order_overrides: bond_0_1(1) }],
    // removed, then no longer calculated (bonding settings changed): only an addition shows it
    [`adds a removed bond the strategy no longer finds`, `add`, { removed_bonds: [edge(2, 3, 1)] }, [3, 2], 1, undefined, `added`, true, { added_bonds: [edge(2, 3, 1)], removed_bonds: [] }],
    [`ordering a removed bond the strategy no longer finds adds it`, `order`, { removed_bonds: [edge(2, 3, 1)] }, [2, 3], 2, undefined, `ordered-added`, true, { added_bonds: [edge(2, 3, 2)], removed_bonds: [] }],
    [`restoring clears stale same-key edits`, `add`, { added_bonds: bond_0_1(1), removed_bonds: bond_0_1(2), bond_order_overrides: bond_0_1(3) }, [1, 0], 2, 2, `restored`, true, { added_bonds: [], removed_bonds: [], bond_order_overrides: [] }],
    [`deletes a calculated bond`, `delete`, {}, [1, 0], 1, undefined, `deleted-calculated`, true, { removed_bonds: bond_0_1(1) }],
    [`deleting records the calculated order`, `delete`, {}, [1, 0], 1, 2, `deleted-calculated`, true, { removed_bonds: bond_0_1(2) }],
    [`deletes a manually added bond`, `delete`, { added_bonds: [edge(2, 3, 3)] }, [3, 2], 1, undefined, `deleted-added`, true, { added_bonds: [] }],
    // added while absent, then also calculated (bonding options changed): must leave both sets
    [`deletes a bond both added and calculated`, `delete`, { added_bonds: bond_0_1(2) }, [1, 0], 1, undefined, `deleted-added`, true, { added_bonds: [], removed_bonds: bond_0_1(1) }],
    [`ignores deleting a missing bond`, `delete`, {}, [4, 5], 1, undefined, `not-visible`, false, {}],
    [`overrides a calculated bond's order`, `order`, {}, [1, 0], 3, undefined, `ordered-calculated`, true, { bond_order_overrides: bond_0_1(3) }],
    [`restores a removed bond when ordering it`, `order`, { removed_bonds: bond_0_1(1) }, [0, 1], 2, undefined, `ordered-calculated`, true, { removed_bonds: [], bond_order_overrides: bond_0_1(2) }],
    [`adds a bond when ordering a missing pair`, `order`, {}, [2, 3], `aromatic`, undefined, `ordered-added`, true, { added_bonds: [edge(2, 3, `aromatic`)] }],
    [`skips a redundant calculated override`, `order`, {}, [1, 0], 2, 2, `ordered-calculated`, false, { bond_order_overrides: [] }],
    [`drops a stale override matching the calculated order`, `order`, { bond_order_overrides: bond_0_1(3) }, [1, 0], 2, 2, `ordered-calculated`, true, { bond_order_overrides: [] }],
  ])(`bond edit: %s`, (_desc, op, before, [site_idx_1, site_idx_2], order, calc_order, action, changed, after) => {
    const args = [
      { ...empty_bond_edit_state(), ...before },
      { site_idx_1, site_idx_2 },
      calculated_bonds(calc_order),
    ] as const
    const result =
      op === `add`
        ? bonding.add_or_restore_bond(...args, order)
        : op === `delete`
          ? bonding.delete_bond(...args)
          : bonding.set_bond_order(...args, order)
    expect(result).toMatchObject({ action, changed, state: after })
    if (op === `delete` && changed) {
      const target = { site_idx_1, site_idx_2 }
      expect(bonding.has_visible_bond(result.state, target, calculated_bonds(calc_order))).toBe(false)
    }
  })

  test(`bond edit helpers preserve periodic cell-shift keys`, () => {
    const shifted_bonds = [
      { site_idx_1: 0, site_idx_2: 1, cell_shift: [1, 0, 0] as Vec3 },
      { site_idx_1: 0, site_idx_2: 1, cell_shift: [0, 1, 0] as Vec3 },
    ]
    const result = bonding.delete_bond(
      empty_bond_edit_state(),
      { site_idx_1: 1, site_idx_2: 0, cell_shift: [-1, 0, 0] },
      shifted_bonds,
    )
    expect(result.state.removed_bonds).toEqual([
      { site_idx_1: 0, site_idx_2: 1, order: 1, cell_shift: [1, 0, 0] },
    ])
    expect(
      bonding.has_visible_bond(
        result.state,
        { site_idx_1: 0, site_idx_2: 1, cell_shift: [0, 1, 0] },
        shifted_bonds,
      ),
    ).toBe(true)
  })

  test(`canonicalizes image-atom bond edit targets to original sites with cell shifts`, () => {
    // O on the low-x face gets a face copy at x=10.05 beside C
    const structure = make_crystal(10, [
      [`C`, [0.95, 0.5, 0.5]],
      [`O`, [0.005, 0.5, 0.5]],
    ])
    const structure_with_images = get_pbc_image_sites(structure, image_options())
    const image_site_idx = structure_with_images.sites.findIndex(
      (site) => site.provenance?.image_of === 1 && site.abc[0] > 1,
    )

    expect(image_site_idx).toBeGreaterThan(1)
    for (const [site_idx_1, site_idx_2] of [
      [0, image_site_idx],
      [image_site_idx, 0],
    ]) {
      const target = { site_idx_1, site_idx_2 }
      expect(bonding.canonicalize_bond_target(target, structure_with_images.sites)).toEqual({
        site_idx_1: 0,
        site_idx_2: 1,
        cell_shift: [1, 0, 0],
      })
    }
  })

  // Matching site indices with opposite shifts stay two distinct bonds, and explicit_only
  // draws each to its image: the +1 image of O sits at x=10.5, 1 A from C at x=9.5 (not the
  // 9 A in-cell distance)
  test(`parses explicit crystal bonds with cell shifts and draws them to their images`, () => {
    const structure = make_crystal(10, [
      [`C`, [0.95, 0.5, 0.5]],
      [`O`, [0.05, 0.5, 0.5]],
    ])
    const declared: StructureBond[] = [
      { site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0, 0] },
      { site_idx_1: 0, site_idx_2: 1, order: 3, cell_shift: [-1, 0, 0] },
    ]
    structure.properties = { bonds: declared }

    expect(bonding.get_explicit_bond_metadata(structure)).toEqual(declared)
    expect(bonding.get_bond_key(0, 1, [1, 0, 0])).toBe(`0-1@1,0,0`)
    // swapped endpoints negate the shift, a zero shift keys like an in-cell bond and a periodic
    // self-bond keys under its canonical shift (first nonzero component positive)
    expect(bonding.get_bond_key(1, 0, [-1, 0, 0])).toBe(`0-1@1,0,0`)
    expect(bonding.get_bond_key(1, 0, [0, 0, 0])).toBe(`0-1`)
    expect(bonding.get_bond_key(2, 2, [0, -1, 1])).toBe(`2-2@0,1,-1`)

    const drawn = bonding
      .explicit_only(structure)
      .map(({ pos_1, pos_2, bond_length, bond_order, cell_shift }) => [
        pos_1,
        pos_2,
        Number(bond_length.toFixed(9)),
        bond_order,
        cell_shift,
      ])
    // oxfmt-ignore
    expect(drawn).toEqual([
      [[9.5, 5, 5], [10.5, 5, 5], 1, 2, [1, 0, 0]],
      [[9.5, 5, 5], [-9.5, 5, 5], 19, 3, [-1, 0, 0]],
    ])
  })

  // With image atoms shown, the perceived bond ends on the O image: O is a corner of Si's
  // polyhedron, so its copy across the face is drawn (Si's copy beside O is not)
  test(`explicit periodic bonds tag the bonds drawn to PBC image atoms`, () => {
    const structure = make_crystal(10, [
      [`Si`, [0.9, 0.5, 0.5]],
      [`O`, [0.06, 0.5, 0.5]],
    ])
    structure.properties = {
      bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0, 0] }],
    }
    const imaged = get_pbc_image_sites(structure, image_options())
    const bonds = bonding.electroneg_ratio(imaged)
    const lengths = bonds.map((bond) => math.euclidean_dist(bond.pos_1, bond.pos_2))
    expect(lengths.map((length) => Number(length.toFixed(6)))).toEqual([1.6])
    expect(bonds.map(({ bond_order }) => bond_order)).toEqual([2])
    expect(bonds[0].pos_2.map(Math.round)).toEqual([11, 5, 5])
  })
})

describe(`explicit_only strategy`, () => {
  // All 3 pairs are within covalent bonding range, so electroneg_ratio perceives bonds
  // between them regardless of what the structure declares
  const make_bonded_triangle = (bonds?: StructureBond[]): Crystal => {
    const structure = make_struct([
      { xyz: [0, 0, 0], element: `C` },
      { xyz: [1.4, 0, 0], element: `C` },
      { xyz: [0, 1.2, 0], element: `O` },
    ])
    if (bonds) structure.properties = { bonds }
    return structure
  }

  test.each([
    { desc: `no bonds property`, declared: undefined, expected: [] },
    { desc: `an empty bonds array`, declared: [], expected: [] },
    {
      desc: `a single declared bond`,
      declared: [{ site_idx_1: 0, site_idx_2: 1, order: 2 }],
      expected: [[0, 1, 2]],
    },
    {
      desc: `declared bonds of mixed order`,
      declared: [
        { site_idx_1: 2, site_idx_2: 0, order: 1 },
        { site_idx_1: 0, site_idx_2: 1, order: `aromatic` },
      ],
      // reversed indices are normalized to ascending order, declaration order is kept
      expected: [
        [0, 2, 1],
        [0, 1, `aromatic`],
      ],
    },
  ] satisfies {
    desc: string
    declared?: StructureBond[]
    expected: [number, number, BondOrder][]
  }[])(`returns exactly the bonds for $desc`, ({ declared, expected }) => {
    const structure = make_bonded_triangle(declared)
    const bonds = bonding.explicit_only(structure)
    // no silent fallback to proximity perception (which would mask a missing or unparsed bond
    // block in PDB/MOL/MOL2/SDF): the undeclared C-O pair is perceived but never returned
    expect(find_bond(bonding.electroneg_ratio(structure), 0, 2)).toBeDefined()

    expect(bonds.map((bond) => [bond.site_idx_1, bond.site_idx_2, bond.bond_order])).toEqual(
      expected,
    )
    for (const bond of bonds) {
      expect(bond.pos_1).toEqual(structure.sites[bond.site_idx_1].xyz)
      expect(bond.pos_2).toEqual(structure.sites[bond.site_idx_2].xyz)
      expect(bond.bond_length).toBeCloseTo(
        Math.hypot(...bond.pos_2.map((coord, idx) => coord - bond.pos_1[idx])),
      )
    }
  })
})

describe(`Molecular Bonding Analysis`, () => {
  // Lower strength threshold to ensure all bond types (incl. C-C) are captured
  const loose_opts = { max_distance_ratio: 2, strength_threshold: 0.2 }

  test.each([
    [`water`, test_molecules.water, 2, 0.8, 1.2, undefined],
    [`methane`, test_molecules.methane, 4, 0.9, 1.3, undefined],
    [`ethanol`, test_molecules.ethanol, 6, 0.8, 2.0, loose_opts],
  ] as [string, Crystal, number, number, number, typeof loose_opts | undefined][])(
    `%s has expected bonds`,
    (_name, molecule, expected_bonds, min_dist, max_dist, options) => {
      const bonds = bonding.electroneg_ratio(molecule, options)
      expect(bonds.length).toBeGreaterThanOrEqual(expected_bonds)
      for (const bond of bonds) {
        expect(bond.bond_length).toBeGreaterThan(min_dist)
        expect(bond.bond_length).toBeLessThan(max_dist)
      }
    },
  )

  test(`benzene has aromatic C-C bonds`, () => {
    const bonds = bonding.electroneg_ratio(test_molecules.benzene, loose_opts)
    expect(bonds.length).toBeGreaterThanOrEqual(6)
    const cc_bonds = bonds.filter((bond) => {
      const elem_1 = test_molecules.benzene.sites[bond.site_idx_1].species[0].element
      const elem_2 = test_molecules.benzene.sites[bond.site_idx_2].species[0].element
      return (
        elem_1 === `C` && elem_2 === `C` && bond.bond_length > 1.3 && bond.bond_length < 1.6
      )
    })
    expect(cc_bonds.length).toBeGreaterThanOrEqual(6)
  })
})

// === Coordination-number benchmark ===
// Perceived bonding is a pile of interacting heuristics, so the only meaningful
// regression net is whether it reproduces textbook coordination numbers on structures
// whose answer is not in doubt. Every atom of the unit cell is checked on the periodic
// bond graph, so boundary atoms count the neighbors across the cell faces too.

const wrap_frac = (val: number) => val - Math.floor(val)
// sites of one element at the given fractional coordinates
const sites_at = (element: ElementSymbol, abcs: Vec3[]) =>
  abcs.map((abc) => ({ element, abc }))
// fcc lattice sites for `element`, once per basis vector
const fcc = (element: ElementSymbol, basis: Vec3[] = [[0, 0, 0]]) =>
  FCC_FACE_CENTRES.flatMap((off) =>
    basis.map((vec) => ({
      element,
      abc: off.map((coord, axis) => wrap_frac(coord + vec[axis])) as Vec3,
    })),
  )
// oxfmt-ignore
const diamond_basis: Vec3[] = [[0, 0, 0], [0.25, 0.25, 0.25]]
// oxfmt-ignore
const bcc = (element: ElementSymbol) => sites_at(element, [[0, 0, 0], [0.5, 0.5, 0.5]])
// oxfmt-ignore
const hcp = (element: ElementSymbol) => sites_at(element, [[1 / 3, 2 / 3, 0.25], [2 / 3, 1 / 3, 0.75]])
// Expand Wyckoff representatives through the 8 operations of Pnma (No. 62), deduping
// the special positions (4a, 4c) that fewer ops map to distinct sites
const pnma = (element: ElementSymbol, [coord_x, coord_y, coord_z]: Vec3) => {
  const images: Vec3[] = [
    [coord_x, coord_y, coord_z],
    [-coord_x + 0.5, -coord_y, coord_z + 0.5],
    [-coord_x, coord_y + 0.5, -coord_z],
    [coord_x + 0.5, -coord_y + 0.5, -coord_z + 0.5],
    [-coord_x, -coord_y, -coord_z],
    [coord_x + 0.5, coord_y, -coord_z + 0.5],
    [coord_x, -coord_y + 0.5, coord_z],
    [-coord_x + 0.5, coord_y + 0.5, coord_z + 0.5],
  ]
  const unique = new Map<string, Vec3>()
  for (const image of images) {
    const abc = image.map(wrap_frac) as Vec3
    const key = abc.map((val) => val.toFixed(5)).join(`,`)
    if (!unique.has(key)) unique.set(key, abc)
  }
  return sites_at(element, [...unique.values()])
}
const tetragonal = (value_a: number, value_c: number): Vec3[] => [
  [value_a, 0, 0],
  [0, value_a, 0],
  [0, 0, value_c],
]
const hexagonal = (value_a: number, value_c: number): Vec3[] => [
  [value_a, 0, 0],
  [-value_a / 2, (value_a * Math.sqrt(3)) / 2, 0],
  [0, 0, value_c],
]

// [label, lattice, sites, expected coordination number per element]
// oxfmt-ignore
const cn_benchmark: [string, number | Vec3[], SimpleSite[], Record<string, number>][] = [
  [`diamond C`, 3.567, fcc(`C`, diamond_basis), { C: 4 }],
  [`Si diamond`, 5.431, fcc(`Si`, diamond_basis), { Si: 4 }],
  [`fcc Cu`, 3.615, fcc(`Cu`), { Cu: 12 }],
  [`fcc Al`, 4.05, fcc(`Al`), { Al: 12 }],
  [`fcc Pb`, 4.95, fcc(`Pb`), { Pb: 12 }],
  [`fcc Ag`, 4.085, fcc(`Ag`), { Ag: 12 }],
  // bcc: 8 nearest at a*sqrt(3)/2, then 6 at a - only 15.5% further, so the first-shell
  // window must be tight. Cs is the stress case: its covalent radius (2.44) undershoots the
  // 5.32 A contact by 9%, the 12-coordinate metallic radius (2.65) fits it
  [`bcc Fe`, 2.866, bcc(`Fe`), { Fe: 8 }],
  [`bcc Cs`, 6.141, bcc(`Cs`), { Cs: 8 }],
  // MgCu2-type Laves phase: Lu on the diamond sublattice (8a), Al on the 16d
  // tetrahedra. Al has 6 Al at 2.74 A and 6 Lu at 3.21 A; Lu has 12 Al and 4 Lu at 3.35 A.
  // Covalent radii called the Al-Al contact stretched and dropped it (Al CN 6), and Lu-Lu
  // fell to a same-species penalty; the metallic radii (1.43 / 1.74) recover both shells
  [`LuAl2 Laves`, 7.742, [...fcc(`Lu`, diamond_basis), ...fcc(`Al`, [[0.625, 0.625, 0.625], [0.375, 0.875, 0.125], [0.875, 0.125, 0.375], [0.125, 0.375, 0.875]])], { Al: 12, Lu: 16 }],
  // Cuprite: linear O-Cu-O (Cu-O 1.85 A) with a Cu-Cu contact at 3.02 A, 1.18x the
  // covalent-radii sum but 1.18x the metallic sum too. Both Cu carry an anion, so the
  // Cu-Cu contact is a stretched cation-cation pair and must not be drawn
  [`Cu2O cuprite`, 4.27, [...sites_at(`O`, [[0, 0, 0], [0.5, 0.5, 0.5]]), ...sites_at(`Cu`, [[0.25, 0.25, 0.25], [0.75, 0.75, 0.25], [0.75, 0.25, 0.75], [0.25, 0.75, 0.75]])], { Cu: 2, O: 4 }],
  // Olivine LiFePO4 (Pnma). P sits 2.64-2.68 A from Li and 2.83-2.86 A from Fe - well
  // inside 2x the covalent radii - so a metal-only cation test bonded P to its cation
  // neighbors (P CN 7). Both ends of Li-P / Fe-P carry anions: the tight stretch rule
  // rejects them and leaves the PO4 tetrahedra and FeO6 octahedra.
  [`LiFePO4 olivine`, [[10.329, 0, 0], [0, 6.0065, 0], [0, 0, 4.6908]], [
    ...pnma(`Li`, [0, 0, 0]), ...pnma(`Fe`, [0.28222, 0.25, 0.97472]), ...pnma(`P`, [0.09486, 0.25, 0.4182]),
    ...pnma(`O`, [0.09678, 0.25, 0.74279]), ...pnma(`O`, [0.4571, 0.25, 0.20602]), ...pnma(`O`, [0.16558, 0.04646, 0.28478]),
  ], { Li: 6, Fe: 6, P: 4 }],
  [`NaCl rocksalt`, 5.64, [...fcc(`Na`), ...fcc(`Cl`, [[0.5, 0, 0]])], { Na: 6, Cl: 6 }],
  [`MgO rocksalt`, 4.212, [...fcc(`Mg`), ...fcc(`O`, [[0.5, 0, 0]])], { Mg: 6, O: 6 }],
  [`ZnS zincblende`, 5.41, [...fcc(`Zn`), ...fcc(`S`, [[0.25, 0.25, 0.25]])], { Zn: 4, S: 4 }],
  [`CaF2 fluorite`, 5.463, [...fcc(`Ca`), ...fcc(`F`, [[0.25, 0.25, 0.25]]), ...fcc(`F`, [[0.75, 0.75, 0.75]])], { Ca: 8, F: 4 }],
  // Pa-3 (No. 205) with S on 8c (x,x,x): S2 dimers at 2.16 A, next S...S at 3.08 A. An
  // fcc-translated (x,x,x)+(1-x,1-x,1-x) stand-in puts non-bonded S...S at 2.41 A.
  [`pyrite FeS2`, 5.416, [...fcc(`Fe`), ...sites_at(`S`, [
    [0.385, 0.385, 0.385], [0.615, 0.615, 0.615], [0.885, 0.115, 0.615], [0.115, 0.615, 0.885],
    [0.615, 0.885, 0.115], [0.115, 0.885, 0.385], [0.885, 0.385, 0.115], [0.385, 0.115, 0.885],
  ])], { Fe: 6, S: 4 }],
  [`CsCl`, 4.119, [[`Cs`, [0, 0, 0]], [`Cl`, [0.5, 0.5, 0.5]]], { Cs: 8, Cl: 8 }],
  // Sr 12 / Ti 6 only hold if Sr-Ti does NOT bond; O sees 2 Ti and 4 Sr.
  [`SrTiO3 perovskite`, 3.905, [[`Sr`, [0.5, 0.5, 0.5]], [`Ti`, [0, 0, 0]], ...sites_at(`O`, [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]])], { Sr: 12, Ti: 6, O: 6 }],
  // TiC and Ti2O are the pair that pins cation_cation_penalty's anion-shell gate. Both are
  // Ti plus a nonmetal, and in both the Ti-Ti contact is SHORTER than Ti-nonmetal once
  // normalized by covalent radii (0.956 vs 0.915, and 0.919 vs 0.923), so no
  // distance-based rule separates them. What separates them is saturation: TiC's Ti has a
  // complete octahedral C shell and its Ti-Ti at 3.06 A is a genuine second shell, while
  // Ti2O's Ti has only 3 O and the hcp Ti framework at 2.95 A IS the structure. Applying
  // the penalty unconditionally took Ti2O from CN 15 to 3 and erased that framework.
  [`TiC rocksalt`, 4.33, [...fcc(`Ti`), ...fcc(`C`, [[0.5, 0, 0]])], { Ti: 6, C: 6 }],
  // 12 Ti + 3 O around each Ti
  [`Ti2O suboxide`, hexagonal(2.9587, 4.7852), [...hcp(`Ti`), [`O`, [0, 0, 0]]], { Ti: 15, O: 6 }],
  // control: no anion-former, so the gate is inert either way
  [`hcp Ti`, hexagonal(2.9587, 4.7852), hcp(`Ti`), { Ti: 12 }],
  [`graphite C`, [[2.464, 0, 0], [-1.232, 2.13389, 0], [0, 0, 6.711]], sites_at(`C`, [[0, 0, 0.25], [0, 0, 0.75], [1 / 3, 2 / 3, 0.25], [2 / 3, 1 / 3, 0.75]]), { C: 3 }],
  [`rutile TiO2`, tetragonal(4.594, 2.959), [
    ...sites_at(`Ti`, [[0, 0, 0], [0.5, 0.5, 0.5]]),
    ...sites_at(`O`, [[0.3053, 0.3053, 0], [0.6947, 0.6947, 0], [0.8053, 0.1947, 0.5], [0.1947, 0.8053, 0.5]]),
  ], { Ti: 6, O: 3 }],
]

describe(`coordination number benchmark`, () => {
  test.each(cn_benchmark)(`%s`, (_label, lattice, sites, expected) => {
    const base = make_crystal(
      typeof lattice === `number`
        ? lattice
        : ([lattice[0], lattice[1], lattice[2]] as [Vec3, Vec3, Vec3]),
      sites,
    )
    // the infinite crystal's bond graph: every site has its full shell across the faces
    const periodic_bonds = bonding.electroneg_ratio(base, { pbc: base.lattice.pbc })
    const counts = bonds_per_site(periodic_bonds, base.sites.length)
    const actual: Record<string, number[]> = {}
    for (let idx = 0; idx < base.sites.length; idx++) {
      const element = bonding.get_majority_element(base.sites[idx]) ?? `?`
      ;(actual[element] ??= []).push(counts[idx])
    }
    for (const [element, cns] of Object.entries(actual)) {
      if (!(element in expected)) continue
      // every atom of that element must hit the textbook CN, boundary copies included
      expect({ element, min: Math.min(...cns), max: Math.max(...cns) }).toEqual({
        element,
        min: expected[element],
        max: expected[element],
      })
    }
  })
})

describe(`Electronegativity-Based Bonding`, () => {
  test.each([
    [`Na`, `Cl`, 2.3, 2.5, 1], // ionic
    [`C`, `C`, 1.5, 2.5, 1], // covalent, same species
    [`C`, `O`, 1.5, 2.5, 1], // covalent, heteronuclear
    [`Na`, `Cl`, 10, 5, 0], // inside max_distance_ratio but far too weak
  ] as [ElementSymbol, ElementSymbol, number, number, number][])(
    `%s-%s at %s A with max_distance_ratio %s forms %s bonds`,
    (elem_1, elem_2, dist, max_distance_ratio, n_bonds) => {
      const structure = make_struct([
        { xyz: [0, 0, 0], element: elem_1 },
        { xyz: [dist, 0, 0], element: elem_2 },
      ])
      const bonds = bonding.electroneg_ratio(structure, { max_distance_ratio })
      expect(bonds).toHaveLength(n_bonds)
      for (const bond of bonds) expect(bond.bond_length).toBeCloseTo(dist, 1)
    },
  )

  test(`parameter sensitivity`, () => {
    const structure = make_struct([
      { xyz: [0, 0, 0], element: `Fe` },
      { xyz: [2.5, 0, 0], element: `Fe` },
      { xyz: [1.25, 2.2, 0], element: `O` },
    ])
    // One bridging O leaves both Fe far short of an anion shell, so the cation gate stays
    // out of the way and the Fe-Fe contact is kept alongside the two Fe-O bonds
    expect(bonding.electroneg_ratio(structure)).toHaveLength(3)

    // Surround each Fe with enough O to saturate it and the same Fe-Fe contact is dropped:
    // now it really is a second shell behind a complete coordination environment
    const saturated = make_struct([
      { xyz: [0, 0, 0], element: `Fe` },
      { xyz: [2.5, 0, 0], element: `Fe` },
      ...(
        [
          [1.25, 1.7, 0],
          [1.25, -1.7, 0],
          [1.25, 0, 1.7],
          [1.25, 0, -1.7],
          [-1.9, 0, 0],
          [4.4, 0, 0],
        ] as Vec3[]
      ).map((xyz) => ({ xyz, element: `O` as const })),
    ])
    const fe_fe = (bonds: BondPair[]) =>
      bonds.filter((bond) => bond.site_idx_1 === 0 && bond.site_idx_2 === 1)
    expect(fe_fe(bonding.electroneg_ratio(saturated))).toHaveLength(0)
    // lifting the gate brings it back, confirming that is what removed it
    expect(
      fe_fe(bonding.electroneg_ratio(saturated, { cation_cation_penalty: 1 })),
    ).toHaveLength(1)

    // with no anion present the gate is inert and metal_metal_penalty governs again
    const metal_only = make_struct([
      { xyz: [0, 0, 0], element: `Fe` },
      { xyz: [2.5, 0, 0], element: `Fe` },
    ])
    const lenient = bonding.electroneg_ratio(metal_only, { metal_metal_penalty: 0.8 })
    const strict = bonding.electroneg_ratio(metal_only, { metal_metal_penalty: 0.1 })
    expect(lenient).toHaveLength(1)
    expect(strict).toHaveLength(0)
  })
})

test(`electroneg_ratio treats original and image atoms symmetrically`, () => {
  // Regression: image atoms used to get fewer bonds than their originals because
  // closest-neighbor penalties were applied in processing order — an image inherited
  // its original's `closest` distance and penalized bonds the original had accepted.

  // Two copies of identical local geometry (a Na with a "Long" 3.0 A and a "Short" 2.0 A Cl
  // neighbor): sites 0-2 are originals, 3-5 are images (image_of 0,1,2) placed 100 A away.
  const structure = make_crystal(1000, [
    { element: `Na`, xyz: [0, 0, 0], properties: { orig_site_idx: 0 } },
    { element: `Cl`, xyz: [3, 0, 0], properties: { orig_site_idx: 1 } }, // Long (3.0 A)
    { element: `Cl`, xyz: [0, 2, 0], properties: { orig_site_idx: 2 } }, // Short (2.0 A)
    { element: `Na`, xyz: [100, 0, 0], properties: { orig_site_idx: 0 } },
    { element: `Cl`, xyz: [103, 0, 0], properties: { orig_site_idx: 1 } }, // Long image
    { element: `Cl`, xyz: [100, 2, 0], properties: { orig_site_idx: 2 } }, // Short image
  ])
  for (let idx = 3; idx < structure.sites.length; idx++)
    structure.sites[idx].provenance = { image_of: idx - 3 }

  // Threshold tuned so the Long-bond penalty (applied once closest=2.0 is known) drops it below
  // threshold. Pre-fix the original kept 2 bonds (it saw Long before Short set closest) while the
  // image kept 1; the fix gathers all closest distances before penalizing, so both bond the same.
  const bonds = bonding.electroneg_ratio(structure, { strength_threshold: 0.6 })
  const counts = bonds_per_site(bonds, structure.sites.length)
  expect(counts[3]).toBe(counts[0]) // image (idx 3) bonds identically to original (idx 0)
})

test(`bonding logic treats original and image atoms consistently`, () => {
  const structure = make_crystal(10, [
    [`C`, [0.005, 0.5, 0.5]], // x=0.05, within the 0.1 Å face tolerance => image at 10.05
    [`C`, [0.135, 0.5, 0.5]], // x=1.35, 1.3 Å from C1: its copy at 11.35 bonds C1's image
    [`H`, [0.0, 0.5, 0.5]], // H_distractor on the face, x=0.0
  ])
  // completing every bond of the face atoms draws C2's copy beside C1's image
  const with_images = get_pbc_image_sites(structure, image_options(`boundary`))

  const c1_img_idx = with_images.sites.findIndex(
    (site, idx) => idx > 2 && Math.abs(site.xyz[0] - 10.05) < 0.01,
  )
  expect(c1_img_idx).toBeGreaterThan(2)

  const bonds = bonding.electroneg_ratio(with_images, {
    min_bond_dist: 0.1,
    max_distance_ratio: 5.0,
    strength_threshold: 0.0001,
  })
  const counts = bonds_per_site(bonds, with_images.sites.length)
  expect(counts[c1_img_idx]).toBe(counts[0])
  const h_img_idx = with_images.sites.findIndex(
    (site, idx) => idx > 2 && Math.abs(site.xyz[0] - 10.0) < 0.1,
  )
  if (h_img_idx !== -1) expect(counts[h_img_idx]).toBe(counts[2])
})

// Site 0's closest-neighbor penalty must use distances normalized by covalent-radii sums
// and only accepted bonds. C-H (1.09 A) is shorter than C-C (1.40 A) raw but not normalized
// (1.02 vs 0.92), so a raw-distance penalty would drop C-C. Na-Na (2.0 A, weak metal-metal)
// is rejected by the threshold and must not set the "closest" distance that drops Na-Cl.
// oxfmt-ignore
test.each([
  [`keeps a longer C-C beside a shorter C-H`, [`C`, `H`, `C`], [[0, 0, 0], [1.09, 0, 0], [0, 1.4, 0]], {}, true],
  [`ignores a rejected weak Na-Na contact`, [`Na`, `Na`, `Cl`], [[0, 0, 0], [2, 0, 0], [0, 3, 0]], { strength_threshold: 0.4 }, false],
] as [string, ElementSymbol[], Vec3[], { strength_threshold?: number }, boolean][])(
  `electroneg_ratio closest-neighbor penalty %s`,
  (_desc, elements, coords, options, keeps_0_1) => {
    const structure = make_struct(elements.map((element, idx) => ({ element, xyz: coords[idx] })))
    const bonds = bonding.electroneg_ratio(structure, options)
    expect(Boolean(find_bond(bonds, 0, 1))).toBe(keeps_0_1)
    expect(find_bond(bonds, 0, 2)).toBeDefined()
  },
)

describe(`remap_bonds_after_deletion`, () => {
  const bond = (
    site_idx_1: number,
    site_idx_2: number,
    extra: Partial<StructureBond> = {},
  ): StructureBond => ({ site_idx_1, site_idx_2, order: 1, ...extra })

  const shifted: Partial<StructureBond> = { order: 2, cell_shift: [1, 0, 0] }
  test.each([
    [`decrements indices past deleted site`, [bond(1, 2)], [0], [bond(0, 1)]],
    [`drops bonds touching deleted sites`, [bond(0, 2)], [2], []],
    [
      `mixed drop and shift`, // only the 3-4 bond survives, shifted down by 2
      [bond(0, 1), bond(1, 3), bond(3, 4), bond(2, 4)],
      [1, 2],
      [bond(1, 2)],
    ],
    [`no deletions is a no-op`, [bond(0, 1), bond(1, 2)], [], [bond(0, 1), bond(1, 2)]],
    [`preserves order and cell_shift`, [bond(2, 3, shifted)], [0], [bond(1, 2, shifted)]],
  ])(`%s`, (_desc, bonds, deleted, expected) => {
    expect(bonding.remap_bonds_after_deletion(bonds, new Set(deleted))).toEqual(expected)
  })
})

describe(`compute_bonds memo`, () => {
  test.each([false, true])(
    `rebuilds after cumulative diagonal motion exceeds the skin (numeric: %s)`,
    (numeric) => {
      const search = new bonding.BondSearch()
      // Si-Si reaches 3.33 A; 3.9 A lies beyond it plus the 0.5 A skin
      const separation = 3.9 / Math.sqrt(3)
      for (const displacement of [0, 0.05, 0.1, 0.2]) {
        const source = make_struct([
          { element: `Si`, xyz: [displacement, displacement, displacement] },
          { element: `Si`, xyz: Array(3).fill(separation - displacement) as Vec3 },
        ])
        const frame = md_frame(xyz_array(source), Uint8Array.of(14, 14), undefined, NO_PBC)
        const structure = numeric ? new FrameView().update(frame).structure : source
        const actual = search.compute_columns(structure)
        const expected = pack_bonds(bonding.electroneg_ratio(structure))
        expect(actual).toEqual(expected)
        // The initial pair lies beyond the candidate skin. Both atoms approach by
        // 0.2 A on each axis: below skin/2 per axis, but above it in total distance.
        expect(actual.lengths).toHaveLength(displacement === 0.2 ? 1 : 0)
        // two reuses paid for the list, so the rebuild keeps its skin
        expect(Reflect.get(search, `candidates`)).toBeDefined()
      }
    },
  )
  test.each([`Si`, `Ge`, `C`, `O`, `Fe`] as const)(
    `homogeneous %s keeps the complete chemistry result`,
    (element) => {
      const source = make_random_structure(100, 9)
      for (const [idx, site] of source.sites.entries()) {
        site.species = [{ element, occu: 1, oxidation_state: 0 }]
        site.xyz = site.xyz.map((coord) => coord / 2) as Vec3
        if (idx % 7 === 0) site.provenance = { unit_cell_idx: 0 }
      }
      // A disconnected second element forces the full role calculation, without changing
      // any original contact. Compare several reach/strength boundaries, not just a lattice.
      const mixed = structuredClone(source)
      mixed.sites.push(
        make_struct([{ element: element === `Fe` ? `O` : `Fe`, xyz: [1e6, 1e6, 1e6] }])
          .sites[0],
      )
      for (const strength_threshold of [0, 0.1, 0.3, 0.8, 1.2]) {
        const actual = sort_bonds(bonding.electroneg_ratio(source, { strength_threshold }))
        const expected = sort_bonds(bonding.electroneg_ratio(mixed, { strength_threshold }))
        expect(actual).toEqual(expected)
      }
    },
  )
  // oxfmt-ignore
  test.each([
    [[40, 0, 0], [0, 40, 0], [0, 0, 40]],
    [[40, 0, 0], [8, 40, 0], [3, 4, 40]],
  ])(`keeps finite bonds exact across wrapping in cell %j`, (...matrix) => {
    const search = new bonding.BondSearch()
    const source = make_crystal(40, [
      { element: `Si`, xyz: [39.9, 0, 0] },
      { element: `Si`, xyz: [1.8, 0, 0] },
      { element: `Si`, xyz: [4, 0, 0] },
    ])
    source.lattice.matrix = matrix as math.Matrix3x3
    for (const position of [39.9, 0.1, 0.2, 0.3, 39.8, 0.4, 1, 2, 3]) {
      const structure = structuredClone(source)
      structure.sites[0].xyz[0] = position
      const actual = sort_bonds(
        new BondFrame(structure, search.compute_columns(structure)).materialize(),
      )
      const expected = sort_bonds(bonding.electroneg_ratio(structure))
      expect(actual).toEqual(expected)
      expect(actual.every(({ cell_shift }) => cell_shift === undefined)).toBe(true)
      if (position === 0.1) expect(find_bond(actual, 0, 1)).toBeDefined()
    }
    const changed_cell = structuredClone(source)
    changed_cell.lattice.matrix[0][0] = 45
    expect(search.compute_columns(changed_cell)).toEqual(
      pack_bonds(bonding.electroneg_ratio(changed_cell)),
    )
    changed_cell.lattice.pbc = [false, false, false]
    expect(search.compute_columns(changed_cell)).toEqual(
      pack_bonds(bonding.electroneg_ratio(changed_cell)),
    )
  })
  test.each([7, 42, 123])(
    `reuses geometric candidates without losing bonds (seed %i)`,
    (seed) => {
      const search = new bonding.BondSearch()
      const source = make_random_structure(200, seed)
      const rand = make_rng(seed)
      for (let frame_idx = 0; frame_idx < 16; frame_idx++) {
        const structure = structuredClone(source)
        for (const site of structure.sites) {
          for (let axis = 0; axis < 3; axis++)
            site.xyz[axis] += ((rand() - 0.5) * frame_idx) / 10
        }
        if (frame_idx === 5) structure.sites[0].species[0].element = `Si`
        if (frame_idx === 8) structure.sites.pop()
        const options =
          frame_idx === 10
            ? { max_distance_ratio: 1.1 }
            : frame_idx === 12
              ? { pbc: [true, true, true] as [boolean, boolean, boolean] }
              : {}
        const expected = sort_bonds(bonding.electroneg_ratio(structure, options))
        const columns = search.compute_columns(structure, options)
        if (frame_idx === 0) {
          expect(Reflect.get(search, `candidates`)).toEqual({
            offsets: expect.any(Int32Array),
            neighbors: expect.any(Int32Array),
            distances: expect.any(Float64Array),
          })
          const allocate = vi.spyOn(globalThis, `Int32Array`)
          try {
            expect(search.compute_columns(structure, options)).toEqual(columns)
            expect(allocate.mock.calls.map((args) => Reflect.get(args, 0))).not.toContain(
              Math.max(256, structure.sites.length * 4),
            )
          } finally {
            allocate.mockRestore()
          }
        }
        const actual = sort_bonds(new BondFrame(structure, columns).materialize())
        expect(actual).toEqual(expected)
      }
      expect(search.compute_columns({ sites: [] })).toEqual(pack_bonds([]))
    },
  )

  test.each(
    [false, true].flatMap((periodic) =>
      [false, true].map((numeric) => ({ periodic, numeric })),
    ),
  )(
    `direct columns preserve explicit bonds and images (periodic: $periodic, numeric: $numeric)`,
    ({ periodic, numeric }) => {
      const source = make_crystal(4, [
        { element: `Si`, xyz: [0.1, 0, 0] },
        { element: `O`, xyz: [1.8, 0, 0] },
        { element: `Si`, xyz: [3.9, 0, 0] },
        { element: `Fe`, xyz: [0.1, 2, 0] },
      ])
      source.sites[2].properties.orig_unit_cell_idx = 0
      source.properties = {
        bonds: [
          { site_idx_1: 0, site_idx_2: 1, order: 2 },
          { site_idx_1: 0, site_idx_2: 2, order: 1.5 },
          { site_idx_1: 1, site_idx_2: 3, order: 3 },
          { site_idx_1: 0, site_idx_2: 2, order: `aromatic`, cell_shift: [-1, 0, 0] },
          { site_idx_1: 0, site_idx_2: 0, order: 1, cell_shift: [1, 0, 0] },
        ],
      }
      const { matrix, pbc } = source.lattice
      const frame = md_frame(xyz_array(source), Uint8Array.of(14, 8, 14, 26), matrix, pbc)
      frame.scalar_columns = { orig_unit_cell_idx: Float64Array.of(0, 1, 0, 3) }
      frame.structure.properties = source.properties
      const structure = numeric ? new FrameView().update(frame).structure : source
      const search = new bonding.BondSearch()
      const options = { pbc: [periodic, periodic, periodic] as [boolean, boolean, boolean] }
      const first = search.compute_columns(structure, options)
      const retained = structuredClone(first)
      for (const strength_threshold of [0, 0.3, 0.8, 2]) {
        const settings = { ...options, strength_threshold }
        const result = search.compute_columns(structure, settings)
        const expected = bonding.electroneg_ratio(structure, settings)
        expect(result).toEqual(pack_bonds(expected))
        expect(new BondFrame(structure, result).materialize()).toEqual(expected)
      }
      expect(first).toEqual(retained)
    },
  )

  test.each([`none`, `unit`, `image`, `both`, `short`])(
    `bonds numeric snapshots without materializing sites (%s source provenance properties)`,
    (provenance) => {
      const view = new FrameView()
      const search = new bonding.BondSearch()
      const reference_search = new bonding.BondSearch()
      for (let step = 0; step < 4; step++) {
        const frame = create_numeric_md_frame(
          Float64Array.of(0.1 + step / 100, 0, 0, 1.8, 0, 0, 3.9, 0, 0, 0.1, 2, 0, 2, 2, 0),
          Uint8Array.of(14, 8, 14, 26, 6),
          cubic_matrix(30),
          [true, true, true],
          step,
          {},
          [`force`, `velocity`],
        )
        frame.scalar_columns = { charge: Float64Array.of(0, 0.5, 1, -1, 2) }
        if (provenance === `unit` || provenance === `both` || provenance === `short`)
          frame.scalar_columns.orig_unit_cell_idx =
            provenance === `short`
              ? Float64Array.of(step % 2, NaN)
              : Float64Array.of(step % 2, 0.5, NaN, Infinity, -1)
        if (provenance === `image` || provenance === `both` || provenance === `short`)
          frame.scalar_columns.orig_site_idx = Float64Array.of(0, step % 2, 0, 1, 1)
        const reference = materialize_frame(wrap_frame_coordinates(frame)).structure
        const { structure } = view.update(frame)
        const sites = numeric_sites.get(structure)
        if (!sites) throw new Error(`Missing numeric sites`)
        const materialize = vi.spyOn(sites, `materialize`)
        const get = vi.spyOn(sites, `get`)
        const actual = search.compute_columns(structure)
        const expected = reference_search.compute_columns(reference)
        expect(actual).toEqual(expected) // exact: toEqual tells -0 from 0 and 1-ulp changes
        expect(materialize).not.toHaveBeenCalled()
        expect(get).not.toHaveBeenCalled()
      }
      const invalid = md_frame(Float64Array.of(0, 0, 0), Uint8Array.of(0))
      expect(() => search.compute_columns(view.update(invalid).structure)).toThrow(
        `Invalid atomic number 0 at site 1`,
      )
    },
  )

  // Thermal jitter around fcc sites (atoms cross the periodic faces): slow frames reuse the
  // skinned list, fast ones make it fail before paying off and switch to plain searches,
  // slow motion again restores the skin. Every frame matches a fresh full search.
  test.each([false, true])(`adapts its skin to the motion (numeric: %s)`, (numeric) => {
    const search = new bonding.BondSearch()
    const view = new FrameView()
    const copper = make_supercell(make_crystal(3.61, fcc(`Cu`)), 6)
    const sites = copper.sites.flatMap(({ xyz }) => xyz)
    const rand = make_rng(11)
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
    const sigmas = [0.01, 0.01, 0.01, 0.01, 0.3, 0.3, 0.3, 0.01, 0.01, 0.01, 0.01]
    const skinned = sigmas.map((sigma) => {
      const frame = wrap_frame_coordinates(
        md_frame(
          Float64Array.from(sites, (coord) => coord + sigma * gauss()),
          new Uint8Array(sites.length / 3).fill(29),
          copper.lattice.matrix,
          [true, true, true],
        ),
      )
      const structure = numeric
        ? view.update(frame).structure
        : materialize_frame(frame).structure
      const actual = new BondFrame(structure, search.compute_columns(structure)).materialize()
      expect(sort_bonds(actual)).toEqual(sort_bonds(bonding.electroneg_ratio(structure)))
      expect(actual.length).toBeGreaterThan(sites.length / 3)
      return Number(Reflect.get(search, `candidates`) !== undefined)
    })
    // 1 = frame served by skinned candidates. build, 3 reuses | rebuild (paid off), rebuilt
    // without reuse -> plain, plain | plain (big jump from the last fast frame), slow again
    // -> skinned build, 2 reuses
    expect(skinned.join(``)).toBe(`11111000111`)
  })

  // A distant Cs pair fixes the longest reach, so swapping H for S changes only the C-X band:
  // C-H at 2.3 A lies outside the skin-widened C-H candidates, C-S at 2.3 A bonds
  test(`rebuilds candidates when an element swap changes one pair's band`, () => {
    const search = new bonding.BondSearch()
    for (const element of [`H`, `S`]) {
      const molecule = make_molecule([
        [`C`, [0, 0, 0]],
        [element, [2.3, 0, 0]],
        [`Cs`, [100, 0, 0]],
        [`Cs`, [105, 0, 0]],
      ])
      const bonds = new BondFrame(molecule, search.compute_columns(molecule)).materialize()
      expect(bonds).toEqual(bonding.electroneg_ratio(molecule))
      expect(Boolean(find_bond(bonds, 0, 1))).toBe(element === `S`)
    }
  })
  const structure = make_fe_o_c()

  test.each([`solid_angle`, `toString`])(`rejects unknown strategy %s by name`, (strategy) => {
    expect(() =>
      bonding.compute_bonds(structure, strategy as bonding.BondingStrategy),
    ).toThrow(
      `Unknown bonding strategy '${strategy}', expected one of electroneg_ratio, explicit_only`,
    )
  })

  test(`caches per structure and per strategy/options signature`, () => {
    // Several Structure components (or the multi-side view's panes) compute bonds for
    // different structures and settings in one flush; a single memo slot would thrash
    const other_structure = make_struct([{ xyz: [0, 0, 0] }])
    const eneg = bonding.compute_bonds(structure, `electroneg_ratio`, {})
    expect(eneg).toEqual(bonding.electroneg_ratio(structure))
    const other = bonding.compute_bonds(other_structure, `electroneg_ratio`, {})
    const wide_opts = { max_distance_ratio: 3 }
    const wide = bonding.compute_bonds(structure, `electroneg_ratio`, wide_opts)
    const explicit = bonding.compute_bonds(structure, `explicit_only`, {})
    // a different structure, options or strategy each recompute
    expect(new Set([eneg, other, wide, explicit]).size).toBe(4)
    expect(bonding.compute_bonds(structure, `electroneg_ratio`, {})).toBe(eneg)
    expect(bonding.compute_bonds(other_structure, `electroneg_ratio`, {})).toBe(other)
    expect(bonding.compute_bonds(structure, `electroneg_ratio`, { ...wide_opts })).toBe(wide)
  })
})

describe(`electroneg_ratio across periodic boundaries`, () => {
  // Rocksalt conventional cell: every ion has 6 counter-ions, but only 3 of each ion's
  // partners sit inside the box. Bonding with the lattice's pbc finds the other 3 as
  // periodic images, tagged with the image shift and positioned at the image.
  const rocksalt = make_rocksalt()

  test(`pbc bonds carry cell_shift and an image pos_2; default stays finite`, () => {
    expect(bonding.electroneg_ratio(rocksalt)).toHaveLength(12) // 8 ions x 3 in-box / 2
    const bonds = bonding.electroneg_ratio(rocksalt, { pbc: rocksalt.lattice.pbc })
    expect(bonds).toHaveLength(24)
    let max_len_err = 0
    for (const { site_idx_1, site_idx_2, pos_1, pos_2, bond_length, cell_shift } of bonds) {
      expect(site_idx_1).toBeLessThan(site_idx_2)
      expect(pos_1).toBe(rocksalt.sites[site_idx_1].xyz)
      // pos_2 = partner + cell_shift . lattice, and |pos_2 - pos_1| is the bond length
      const shift = cell_shift ?? [0, 0, 0]
      const expected_pos_2 = rocksalt.sites[site_idx_2].xyz.map(
        (coord, axis) => coord + shift[axis] * 5.64,
      )
      for (let axis = 0; axis < 3; axis++) {
        expect(Math.abs(pos_2[axis] - expected_pos_2[axis])).toBeLessThan(1e-12)
      }
      max_len_err = Math.max(max_len_err, Math.abs(bond_length - 2.82))
      max_len_err = Math.max(
        max_len_err,
        Math.abs(math.euclidean_dist(pos_1, pos_2) - bond_length),
      )
    }
    expect(bonds_per_site(bonds, 8)).toEqual(Array(8).fill(6))
    expect(max_len_err).toBeLessThan(1e-12)
    expect(bonds.filter((bond) => bond.cell_shift !== undefined)).toHaveLength(12)
  })

  test(`a one-atom cell bonds to its own images once per canonical shift`, () => {
    const radius = element_by_symbol.get(`Po`)?.covalent_radius ?? 0
    const simple_cubic = make_crystal(2 * radius, [[`Po`, [0, 0, 0]]])
    expect(bonding.electroneg_ratio(simple_cubic)).toHaveLength(0)
    const bonds = bonding.electroneg_ratio(simple_cubic, { pbc: [true, true, true] })
    // +x, +y, +z (the -x, -y, -z images are the same three bonds seen from the other end)
    const shifts = bonds.map((bond) => (bond.cell_shift ?? [0, 0, 0]).join(`,`))
    expect(shifts.toSorted((shift_a, shift_b) => shift_a.localeCompare(shift_b))).toEqual([
      `0,0,1`,
      `0,1,0`,
      `1,0,0`,
    ])
    for (const bond of bonds) {
      expect([bond.site_idx_1, bond.site_idx_2]).toEqual([0, 0])
      expect(bond.bond_length).toBeCloseTo(2 * radius, 12)
    }
    // a slab: the vacuum axis contributes no image bond
    expect(bonding.electroneg_ratio(simple_cubic, { pbc: [true, true, false] })).toHaveLength(
      2,
    )
  })

  test(`pbc bonds of a 2x2x2 supercell match the unit cell's per-site count`, () => {
    // the unit cell's 6 per site is asserted in the first test of this block
    const supercell = make_supercell(rocksalt, [2, 2, 2])
    const bonds = bonding.electroneg_ratio(supercell, { pbc: supercell.lattice.pbc })
    expect(bonds_per_site(bonds, 64)).toEqual(Array(64).fill(6))
  })
})

describe(`spatial grid coverage`, () => {
  // Deterministic grid of atoms at bonding distance so repeated runs are comparable
  const make_deterministic_structure = (n_atoms: number): Crystal => {
    const per_edge = Math.ceil(Math.cbrt(n_atoms))
    const spacing = 1.5 // Å, within covalent bonding range for C/N/O
    return make_crystal(
      per_edge * spacing + 1,
      Array.from({ length: n_atoms }, (_, idx) => ({
        element: ([`C`, `N`, `O`] as const)[idx % 3],
        xyz: [
          (idx % per_edge) * spacing,
          (Math.floor(idx / per_edge) % per_edge) * spacing,
          Math.floor(idx / (per_edge * per_edge)) * spacing,
        ] as Vec3,
      })),
    )
  }

  test(`bonds are stable and duplicate-free across repeated + interleaved calls`, () => {
    // Interleaving two structures then recomputing the first would surface any state
    // leaking between calls through module-level scratch.
    const struct_a = make_deterministic_structure(80)
    const struct_b = make_deterministic_structure(120)
    const bond_key = (bond: BondPair) => `${bond.site_idx_1}-${bond.site_idx_2}`

    const first_a = bonding.electroneg_ratio(struct_a)
    const first_b = bonding.electroneg_ratio(struct_b)
    const second_a = bonding.electroneg_ratio(struct_a)

    expect(first_a.length).toBeGreaterThan(0)
    expect(second_a.map(bond_key)).toEqual(first_a.map(bond_key))
    expect(new Set(first_a.map(bond_key)).size).toBe(first_a.length)
    expect(new Set(first_b.map(bond_key)).size).toBe(first_b.length)
  })

  // neighbor_query's sweep visits only the 13 "forward" neighbor bins of each center,
  // relying on the other 13 pairs being found from the opposite end — a wrong offset set
  // would silently drop bonds in whole directions. The bin is one C-C reach wide (the
  // covalent sum 1.52 A times max_distance_ratio 2), so partners 1.62 A away along each
  // axis land in neighboring bins, and strength_threshold 0 keeps the distance model from
  // dropping the diagonals.
  test(`grid scan finds partners in the own cell and all 26 neighbors`, () => {
    const center = (2 * 0.76 * 2) / 2
    const offset = center + 0.1
    const partner_sites = [-1, 0, 1].flatMap((delta_x) =>
      [-1, 0, 1].flatMap((delta_y) =>
        [-1, 0, 1]
          .filter((delta_z) => delta_x || delta_y || delta_z)
          .map((delta_z) => ({
            element: `C` as const,
            xyz: [
              center + delta_x * offset,
              center + delta_y * offset,
              center + delta_z * offset,
            ] as Vec3,
          })),
      ),
    )
    const structure = make_crystal(500, [
      { element: `C`, xyz: [center, center, center] },
      ...partner_sites,
      // 27th partner stays inside the center's own cell, which the scan reaches by a
      // different route (index filter rather than a neighbor offset)
      { element: `C`, xyz: [center + 1, center, center] },
      // pad past the 50-site grid threshold with far-apart, non-bonding atoms
      ...Array.from({ length: 40 }, (_, idx) => ({
        element: `C` as const,
        xyz: [200 + idx * 20, 200, 200] as Vec3,
      })),
    ])

    const partners = bonding
      .electroneg_ratio(structure, { strength_threshold: 0 })
      .filter((bond) => bond.site_idx_1 === 0 || bond.site_idx_2 === 0)
      .map((bond) => (bond.site_idx_1 === 0 ? bond.site_idx_2 : bond.site_idx_1))
    expect(partners.toSorted((left_value, right_value) => left_value - right_value)).toEqual(
      Array.from({ length: 27 }, (_, idx) => idx + 1),
    )
  })
})

describe(`neighbor_query`, () => {
  // Reference: every (center, partner, integer image) over a generous ±3 image range on the
  // periodic axes, keyed so both lists can be compared as sets
  const brute_force = (structure: AnyStructure, cutoff: number, pbc: readonly boolean[]) => {
    // a molecule has no periodic axis, so its zero lattice vectors are never applied
    const [vec_a, vec_b, vec_c] =
      `lattice` in structure
        ? structure.lattice.matrix
        : Array.from({ length: 3 }, (): Vec3 => [0, 0, 0])
    const range = (axis: number) => (pbc[axis] ? [-3, -2, -1, 0, 1, 2, 3] : [0])
    const found = new Map<string, { dist: number; delta: Vec3 }>()
    for (const [center, site_a] of structure.sites.entries()) {
      for (const [partner, site_b] of structure.sites.entries()) {
        for (const shift_a of range(0)) {
          for (const shift_b of range(1)) {
            for (const shift_c of range(2)) {
              if (center === partner && shift_a === 0 && shift_b === 0 && shift_c === 0)
                continue
              const delta = [0, 1, 2].map(
                (axis_x) =>
                  site_b.xyz[axis_x] +
                  shift_a * vec_a[axis_x] +
                  shift_b * vec_b[axis_x] +
                  shift_c * vec_c[axis_x] -
                  site_a.xyz[axis_x],
              ) as Vec3
              const dist = Math.hypot(...delta)
              if (dist <= cutoff)
                found.set(`${center}|${partner}|${shift_a},${shift_b},${shift_c}`, {
                  dist,
                  delta,
                })
            }
          }
        }
      }
    }
    return found
  }
  const as_map = (list: bonding.NeighborList) => {
    const found = new Map<string, { dist: number; delta: Vec3 }>()
    for (let center = 0; center < list.n_centers; center++) {
      for (let slot = list.offsets[center]; slot < list.offsets[center + 1]; slot++) {
        const image = Array.from(list.images.subarray(slot * 3, slot * 3 + 3))
        const key = `${center}|${list.neighbors[slot]}|${image.join(`,`)}`
        expect(found.has(key)).toBe(false) // each (partner, image) listed once per center
        found.set(key, {
          dist: list.distances[slot],
          delta: Array.from(list.deltas.subarray(slot * 3, slot * 3 + 3)) as Vec3,
        })
      }
    }
    return found
  }
  // Skewed triclinic cell (angles far from 90°) with sites deliberately outside [0, 1)
  // oxfmt-ignore
  const triclinic: Crystal = make_crystal([[4.1, 0, 0], [1.9, 3.6, 0], [-1.2, 1.4, 3.9]], [
    [`Na`, [0.02, 0.1, 0.95]], [`Cl`, [0.5, 0.5, 0.5]], [`Na`, [1.3, -0.4, 0.25]], // unwrapped
    [`O`, [0.8, 0.9, 0.1]], [`Cl`, [0.25, 0.75, 0.6]],
  ])
  // Several consecutive sites share each bin; reordering revisits bins after crossing
  // their edges. Clusters near opposite faces also populate repeated periodic-image bins.
  const clustered = make_crystal(
    4,
    Array.from({ length: 24 }, (_, idx) => ({
      element: `Si`,
      abc: [
        [0.01, 0.48, 0.99][Math.floor(idx / 8)],
        0.01 + (idx % 4) * 0.005,
        0.98 + (Math.floor(idx / 4) % 2) * 0.005,
      ] as Vec3,
    })),
  )

  // oxfmt-ignore
  test.each([
    [`triclinic, full pbc`, triclinic, [true, true, true], 5.5],
    [`triclinic, slab (pbc z off)`, triclinic, [true, true, false], 5.5],
    [`triclinic, wire (only pbc y)`, triclinic, [false, true, false], 6.0],
    [`triclinic, no pbc`, triclinic, [false, false, false], 6.0],
    [`clustered, full pbc`, clustered, [true, true, true], 2.1],
    [`clustered, no pbc`, clustered, [false, false, false], 2.1],
    [`image-dominated small cell`, make_crystal(3, [[`Si`, [0.2, 0.3, 0.4]]]), [true, true, true], 7.5],
    [`reversed clusters, full pbc`, { ...clustered, sites: clustered.sites.toReversed() }, [true, true, true], 2.1],
    [`interleaved clusters, full pbc`, { ...clustered, sites: clustered.sites.map((_, idx) => clustered.sites[(idx * 7) % 24]) }, [true, true, true], 2.1],
  ] as const)(`matches brute force over ±3 images: %s`, (_label, structure, pbc, cutoff) => {
    const list = bonding.neighbor_query(structure, { cutoff, pbc })
    // pbc off keeps source positions; the query supplies its own PBC
    const frame = md_frame(
      xyz_array(structure),
      new Uint8Array(structure.sites.length).fill(14),
      structure.lattice.matrix,
      NO_PBC,
    )
    const numeric = new FrameView().update(frame).structure
    const columns = numeric_sites.get(numeric)
    if (!columns) throw new Error(`Missing numeric sites`)
    const materialize = vi.spyOn(columns, `materialize`)
    const get = vi.spyOn(columns, `get`)
    const original = frame.coordinates.slice()
    for (const sorted of [false, true]) {
      const expected = sorted
        ? list
        : bonding.neighbor_query(structure, { cutoff, pbc, sorted })
      const actual = bonding.neighbor_query(numeric, { cutoff, pbc, sorted })
      expect(actual).toEqual(expected)
    }
    const actual = as_map(list)
    const expected = brute_force(structure, cutoff, pbc)
    expect([...actual.keys()].toSorted()).toEqual([...expected.keys()].toSorted())
    let max_dist_err = 0
    let max_delta_err = 0
    for (const [key, { dist, delta }] of expected) {
      const got = actual.get(key)
      if (!got) throw new Error(`missing ${key}`)
      max_dist_err = Math.max(max_dist_err, Math.abs(got.dist - dist))
      for (let axis_x = 0; axis_x < 3; axis_x++) {
        max_delta_err = Math.max(max_delta_err, Math.abs(got.delta[axis_x] - delta[axis_x]))
      }
    }
    // wrapped-then-shifted vs direct arithmetic: a few ulps of ~10 A coordinates
    expect(max_dist_err).toBeLessThan(1e-11)
    expect(max_delta_err).toBeLessThan(1e-11)
    // per-center blocks are sorted ascending
    for (let center = 0; center < list.n_centers; center++) {
      for (let slot = list.offsets[center] + 1; slot < list.offsets[center + 1]; slot++) {
        expect(list.distances[slot]).toBeGreaterThanOrEqual(list.distances[slot - 1])
      }
    }
    expect(list.offsets[list.n_centers]).toBe(list.neighbors.length)
    expect(list.offsets[list.n_centers]).toBe(expected.size)
    const streamed: [number, number, number][] = []
    bonding.visit_neighbor_distances(structure, { cutoff, pbc }, (center, neighbor, dist) => {
      streamed.push([center, neighbor, dist])
    })
    const numeric_streamed: typeof streamed = []
    bonding.visit_neighbor_distances(numeric, { cutoff, pbc }, (center, neighbor, dist) => {
      numeric_streamed.push([center, neighbor, dist])
    })
    expect(numeric_streamed).toEqual(streamed)
    expect(materialize).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expect(frame.coordinates).toStrictEqual(original)
    const listed: typeof streamed = []
    for (let center = 0; center < list.n_centers; center++) {
      for (let slot = list.offsets[center]; slot < list.offsets[center + 1]; slot++) {
        listed.push([center, list.neighbors[slot], list.distances[slot]])
      }
    }
    const by_neighbor = (first: number[], second: number[]) =>
      first[0] - second[0] || first[1] - second[1] || first[2] - second[2]
    expect(streamed.toSorted(by_neighbor)).toEqual(listed.toSorted(by_neighbor))
  })

  const grid_positions = (count: number, origin = 0): Vec3[] =>
    Array.from({ length: count }, (_, idx): Vec3 => [
      origin + Math.floor(idx / 144) * 0.2,
      origin + (Math.floor(idx / 12) % 12) * 0.2,
      origin + (idx % 12) * 0.2,
    ])

  const stream_distance_error = (
    structure: Crystal,
    cutoff: number,
    expected: Map<number, number>,
  ) => {
    let max_error = 0
    bonding.visit_neighbor_distances(
      structure,
      { cutoff, pbc: [false, false, false] },
      (center, neighbor, distance) => {
        const key = center * structure.sites.length + neighbor
        const reference = expected.get(key)
        if (reference === undefined)
          throw new Error(`Unexpected contact ${center}, ${neighbor}`)
        max_error = Math.max(max_error, Math.abs(reference - distance))
        expected.delete(key)
      },
    )
    expect(expected.size).toBe(0)
    return max_error
  }

  const stream_list_error = (positions: Vec3[], cutoff: number) => {
    const structure = make_crystal(
      10,
      positions.map((xyz) => ({ element: `Si`, xyz })),
    )
    const options = { cutoff, pbc: [false, false, false] as const }
    const list = bonding.neighbor_query(structure, options)
    const expected = new Map<number, number>()
    for (let center = 0; center < positions.length; center++) {
      for (let slot = list.offsets[center]; slot < list.offsets[center + 1]; slot++) {
        expected.set(center * positions.length + list.neighbors[slot], list.distances[slot])
      }
    }
    expect(expected.size).toBe(list.neighbors.length)
    return stream_distance_error(structure, cutoff, expected)
  }

  test.each([
    [1999, false],
    [2000, false],
    [2047, true],
    [2048, true],
  ] as const)(
    `dense streaming across grid-size/density gates: %i sites`,
    (count, density_gate) => {
      const positions = density_gate
        ? Array.from({ length: count }, (_, idx): Vec3 =>
            // 4³ original bins: 2047/64 < 32, 2048/64 === 32 cloud points per bin.
            [
              (Math.floor(idx / 256) * 1.5) / 7,
              ((Math.floor(idx / 16) % 16) * 1.5) / 15,
              ((idx % 16) * 1.5) / 15,
            ],
          )
        : grid_positions(count)
      expect(stream_list_error(positions, density_gate ? 0.5 : 1)).toBe(0)
    },
  )

  const next_float = (value: number, direction: number): number => {
    const view = new DataView(new ArrayBuffer(8))
    view.setFloat64(0, value)
    view.setBigUint64(0, view.getBigUint64(0) + BigInt(value < 0 ? -direction : direction))
    return view.getFloat64(0)
  }

  test.each([0, -7, 17])(`dense half-bin cutoff boundaries at origin %i`, (origin) => {
    // 2,000 sites in 27 coarse bins activate the dense grid for every perturbation.
    const structure = make_crystal(
      10,
      grid_positions(2000, origin).map((xyz) => ({ element: `Si`, xyz })),
    )
    for (const first_ulp of [-1, 0, 1]) {
      for (const second_ulp of [-1, 0, 1]) {
        structure.sites[1].xyz = [next_float(origin + 0.5, first_ulp), origin, origin]
        structure.sites[2].xyz = [next_float(origin + 1.5, second_ulp), origin, origin]
        const delta_x = structure.sites[2].xyz[0] - structure.sites[1].xyz[0]
        const dist_sq = delta_x * delta_x
        const expected = dist_sq <= 1 ? [Math.sqrt(dist_sq)] : []
        const visits: number[][] = [[], []]
        bonding.visit_neighbor_distances(
          structure,
          { cutoff: 1, pbc: [false, false, false] },
          (center, neighbor, distance) => {
            if (center === 1 && neighbor === 2) visits[0].push(distance)
            if (center === 2 && neighbor === 1) visits[1].push(distance)
          },
        )
        // .5 - 1 ULP and 1.5 have rounded distance 1, but unpadded half bins 0 and 3.
        expect(visits).toEqual([expected, expected])
      }
    }
  })

  test.each(
    Array.from({ length: 8 }, (_, mask) =>
      [0, 1, 2].map(
        (axis) =>
          [[Boolean(mask & 1), Boolean(mask & 2), Boolean(mask & 4)] as const, axis] as const,
      ),
    ).flat(),
  )(`small cutoff boundaries with pbc %j along axis %i`, (pbc, axis) => {
    const options = { cutoff: 1, pbc }
    for (const origin of [0, -7, 17]) {
      for (const boundary of [0.5, 1]) {
        for (const first_ulp of [-1, 0, 1]) {
          for (const second_ulp of [-1, 0, 1]) {
            const first = next_float(origin + boundary, first_ulp)
            const second = next_float(origin + boundary + 1, second_ulp)
            const structure = make_crystal(
              8,
              [origin, first, second].map((coordinate) => {
                const xyz: Vec3 = [origin, origin, origin]
                xyz[axis] = coordinate
                return { element: `Si`, xyz }
              }),
            )
            const dist_sq = (second - first) ** 2
            const expected = dist_sq <= 1 ? [Math.sqrt(dist_sq)] : []
            const visits: number[][] = [[], []]
            bonding.visit_neighbor_distances(structure, options, (center, neighbor, dist) => {
              if (center === 1 && neighbor === 2) visits[0].push(dist)
              if (center === 2 && neighbor === 1) visits[1].push(dist)
            })
            expect(visits).toEqual([expected, expected])
            for (const sorted of [true, false]) {
              const list = bonding.neighbor_query(structure, { ...options, sorted })
              for (const center of [1, 2]) {
                const start = list.offsets[center]
                const distances = [
                  ...list.distances.subarray(start, list.offsets[center + 1]),
                ].filter((_distance, idx) => list.neighbors[start + idx] === 3 - center)
                expect(distances).toEqual(expected)
              }
            }
          }
        }
      }
    }
  })

  test(`mixed forward cutoff contact preserves adjacent-bin order`, () => {
    const structure = make_crystal(8, [
      { element: `Si`, xyz: [0, 0, 0] },
      { element: `Si`, xyz: [1 - Number.EPSILON / 2, 2, 0] },
      { element: `Si`, xyz: [1, 1 - Number.EPSILON / 2, 0] },
      { element: `Si`, xyz: [1, 2, 0] },
    ])
    const options = { cutoff: 1, pbc: [false, false, false] as const }
    for (const sorted of [true, false]) {
      const list = bonding.neighbor_query(structure, { ...options, sorted })
      expect([...list.offsets]).toEqual([0, 0, 2, 4, 6])
      // From site 1, (+1, 0, 0) must precede the new (+1, -2, 0) contact.
      expect([...list.neighbors]).toEqual([3, 2, 1, 3, 1, 2])
      expect([...list.distances]).toEqual([Number.EPSILON / 2, 1, 1, 1, Number.EPSILON / 2, 1])
    }
    const streamed: number[][] = []
    bonding.visit_neighbor_distances(structure, options, (...contact) =>
      streamed.push(contact),
    )
    expect(streamed).toEqual([
      [2, 3, 1],
      [3, 2, 1],
      [1, 3, Number.EPSILON / 2],
      [3, 1, Number.EPSILON / 2],
      [1, 2, 1],
      [2, 1, 1],
    ])
  })

  test.each([3, 2000].flatMap((count) => [0, 1, 2].map((axis) => [count, axis] as const)))(
    `rounded whole-bin cutoff contacts with %i sites along axis %i`,
    (count, axis) => {
      const positions = grid_positions(count)
      positions[1] = [0, 0, 0]
      positions[2] = [0, 0, 0]
      positions[1][axis] = 1 - Number.EPSILON / 2
      positions[2][axis] = 2
      const structure = make_crystal(
        10,
        positions.map((xyz) => ({ element: `Si`, xyz })),
      )
      const expected = new Map<number, number>()
      for (let center = 0; center < positions.length; center++) {
        for (let neighbor = center + 1; neighbor < positions.length; neighbor++) {
          const delta_x = positions[neighbor][0] - positions[center][0]
          const delta_y = positions[neighbor][1] - positions[center][1]
          const delta_z = positions[neighbor][2] - positions[center][2]
          const dist_sq = delta_x * delta_x + delta_y * delta_y + delta_z * delta_z
          if (dist_sq > 1) continue
          expected.set(center * positions.length + neighbor, Math.sqrt(dist_sq))
          expected.set(neighbor * positions.length + center, Math.sqrt(dist_sq))
        }
      }
      // Rounded subtraction gives distance 1; unpadded whole bins 0 and 2 miss this pair.
      expect(expected.get(positions.length + 2)).toBe(1)
      expect(stream_distance_error(structure, 1, expected)).toBe(0)
      expect(stream_list_error(positions, 1)).toBe(0)
    },
  )

  test(`1-atom cell: own images are neighbors; fcc k=12 shell exact`, () => {
    const simple_cubic = make_crystal(3, [{ element: `Fe`, abc: [0, 0, 0] }])
    const list = bonding.neighbor_query(simple_cubic, { cutoff: 3.01 })
    expect(list.neighbors).toHaveLength(6)
    expect(Array.from(list.neighbors)).toEqual([0, 0, 0, 0, 0, 0])
    expect(Array.from(list.distances).every((dist) => Math.abs(dist - 3) < 1e-12)).toBe(true)
    const fcc_cu = make_crystal(3.6, fcc(`Cu`))
    const knn = bonding.neighbor_query(fcc_cu, { k: 12 })
    expect(Array.from(knn.offsets)).toEqual([0, 12, 24, 36, 48])
    const nn_dist = 3.6 / Math.SQRT2
    for (const dist of knn.distances) expect(Math.abs(dist - nn_dist)).toBeLessThan(1e-12)
    // distances = |deltas| and deltas = partner + image·L - center
    for (let slot = 0; slot < knn.distances.length; slot++) {
      const center = knn.offsets.findLastIndex((offset) => offset <= slot)
      const partner = fcc_cu.sites[knn.neighbors[slot]].xyz
      const img = knn.images.subarray(slot * 3, slot * 3 + 3)
      for (let axis_x = 0; axis_x < 3; axis_x++) {
        const expected = partner[axis_x] + img[axis_x] * 3.6 - fcc_cu.sites[center].xyz[axis_x]
        expect(knn.deltas[slot * 3 + axis_x]).toBeCloseTo(expected, 12)
      }
      expect(Math.hypot(...knn.deltas.subarray(slot * 3, slot * 3 + 3))).toBeCloseTo(
        knn.distances[slot],
        12,
      )
    }
  })

  test(`molecule: no images, k capped by system size, cutoff list sorted`, () => {
    const water = make_molecule([
      [`O`, [0, 0, 0]],
      [`H`, [0.96, 0, 0]],
      [`H`, [-0.24, 0.93, 0]],
    ])
    const knn = bonding.neighbor_query(water, { k: 5 })
    expect(Array.from(knn.offsets)).toEqual([0, 2, 4, 6])
    expect(Array.from(knn.images).every((shift) => shift === 0)).toBe(true)
    // the radius may grow to the cluster's bounding-box diagonal: a 100 A chain of 3 atoms
    // has a 9.3 A cube-root volume, which left every atom with 0 of its 2 partners
    const chain = make_molecule([0, 50, 100].map((x_coord) => [`O`, [x_coord, 0, 0]]))
    const chain_knn = bonding.neighbor_query(chain, { k: 2 })
    expect(Array.from(chain_knn.offsets)).toEqual([0, 2, 4, 6])
    expect(Array.from(chain_knn.distances)).toEqual([50, 100, 50, 50, 50, 100])
    // two atoms at opposite box corners: their distance rounds 1 ulp above hypot(extents)
    const corners = make_molecule([
      [`O`, [2.4347959638802195, 4.836360971011535, 4.090214663192215]],
      [`O`, [5.182636053845052, -0.16486257602122423, 0.654857615062942]],
    ])
    expect(Array.from(bonding.neighbor_query(corners, { k: 1 }).offsets)).toEqual([0, 1, 2])
    const list = bonding.neighbor_query(water, { cutoff: 1.2 })
    expect(list.offsets[3]).toBeGreaterThanOrEqual(4) // two O-H contacts, both ends
    for (let center = 0; center < 3; center++) {
      for (let slot = list.offsets[center] + 1; slot < list.offsets[center + 1]; slot++) {
        expect(list.distances[slot]).toBeGreaterThanOrEqual(list.distances[slot - 1])
      }
    }
  })

  test.each([
    [{ cutoff: 0 }, /cutoff must be a positive finite number/],
    [{ cutoff: -1 }, /cutoff must be a positive finite number/],
    [{ cutoff: Number.NaN }, /cutoff must be a positive finite number/],
    [{ k: 0 }, /k must be a positive integer/],
    [{ k: 1.5 }, /k must be a positive integer/],
  ])(`rejects %j`, (options, message) => {
    expect(() => bonding.neighbor_query(triclinic, options)).toThrow(message)
    if (`cutoff` in options) {
      expect(() => bonding.visit_neighbor_distances(triclinic, options, () => {})).toThrow(
        message,
      )
    }
  })

  test(`rejects a degenerate lattice and absurd cutoffs, not in-band bond perception`, () => {
    const flat = make_crystal(
      [
        [3, 0, 0],
        [0, 3, 0],
        [3, 3, 0],
      ],
      [{ element: `C`, abc: [0, 0, 0] }],
    )
    expect(() => bonding.neighbor_query(flat, { cutoff: 2 })).toThrow(/degenerate/)
    // no periodic axis: the lattice is never used, so a singular one is fine
    const free = bonding.neighbor_query(flat, { cutoff: 2, pbc: [false, false, false] })
    expect(free.neighbors).toHaveLength(0)
    // 40 cells of images along every axis: 81^3 * 200 = 106M positions
    const big = make_random_structure(200)
    expect(() => bonding.neighbor_query(big, { cutoff: 400 })).toThrow(
      /reaches 40, 40, 40 cells .* needs \d+ periodic images of 200 sites; refusing to build more than 4000000 positions, a cutoff this far past the cell is almost always a unit mix-up/,
    )
    // The cloud is small but every one of 4600 sites sees every other: 10.6M pairs, more
    // than the lists could hold in memory. Refused mid-sweep rather than allocated.
    const dense = make_molecule(hydrogen_grid(0.5))
    expect(() => bonding.neighbor_query(dense, { cutoff: 100 })).toThrow(
      /more than 10,000,000 pairs within 100 A of 4600 sites/,
    )
    // BondSearch's skin-widened band keeps every pair of a grid inside 0.2 A (the plain band
    // drops them all under min_bond_dist): refused the same way, no silent plain fallback
    const blob = make_molecule(hydrogen_grid(0.012))
    expect(() => new bonding.BondSearch().compute_columns(blob)).toThrow(
      /more than 10,000,000/,
    )
    // Streaming has no pair storage to exhaust, so this cloud can be processed in full.
    let n_visits = 0
    bonding.visit_neighbor_distances(dense, { cutoff: 100 }, () => n_visits++)
    expect(n_visits).toBe(4600 * 4599)
    // Cs-Cs reaches 39 A under these options, putting all 10.6M grid pairs inside the longest
    // reach, but only ~60k H-H pairs lie in their own band: bond perception stores just those
    const options = { metal_metal_penalty: 1e100, max_distance_ratio: 100 }
    const mixed = make_molecule([
      ...hydrogen_grid(0.5),
      [`Cs`, [40, 0, 0]],
      [`Cs`, [45, 0, 0]],
    ])
    const bonds = sort_bonds(bonding.electroneg_ratio(mixed, options))
    const hydrogen_bonds = sort_bonds(bonding.electroneg_ratio(dense, options))
    expect(hydrogen_bonds.length).toBeGreaterThan(4600 * 2)
    expect(bonds.slice(0, -1)).toEqual(hydrogen_bonds)
    expect(bonds.at(-1)).toMatchObject({ site_idx_1: 4600, site_idx_2: 4601, bond_length: 5 })
    // Inherently heavy: the refusals must actually cross the fixed 10M-pair limit (~160 MB of
    // pair buffers) and the streaming check visits 21M pairs. ~0.6 s alone but 5-7 s under a
    // loaded full-suite run.
  }, 20_000)

  // The refusal estimate counts the images that will actually be built (only those within
  // `cutoff` of the cell), not 27x the site count: here 27 * 150k = 4.05M exceeds the limit,
  // but the boundary shell is 1.5% of the box, so the real cloud is ~157k positions.
  test(`accepts a large sparse box whose 27x replica bound exceeds the limit`, () => {
    const n_sites = 150_000
    const box = 1000
    const rand = make_rng(12345)
    const structure = make_crystal(
      box,
      Array.from({ length: n_sites }, () => ({
        element: `Ar` as const,
        xyz: [rand() * box, rand() * box, rand() * box] as Vec3,
      })),
    )
    const list = bonding.neighbor_query(structure, { cutoff: 15 })
    expect(list.n_centers).toBe(n_sites)
    // mean neighbor count = density * sphere volume = 1.5e-4 * 4/3 pi 15^3 = 2.12
    const mean = list.neighbors.length / n_sites
    expect(mean).toBeGreaterThan(1.9)
    expect(mean).toBeLessThan(2.4)
    // and the periodic images are real: some contacts cross the box boundary
    expect(Array.from(list.images).some((shift) => shift !== 0)).toBe(true)
  })

  // Binning is relative to the cloud's own bounding box, so only the SPAN of the positions
  // matters: a molecule 600 A from the origin with a 1 A cutoff used to fall outside the
  // spatial grid's fixed +-511-cell window and throw.
  test(`far-offset molecule matches brute force (span, not magnitude, sizes the grid)`, () => {
    const offset: Vec3 = [600, -450, 1200]
    const water = make_molecule(
      (
        [
          [`O`, [0, 0, 0]],
          [`H`, [0.96, 0, 0]],
          [`H`, [-0.24, 0.93, 0]],
          [`O`, [3.1, 0.2, 0.1]],
          [`H`, [3.9, 0.7, 0.1]],
        ] as [string, Vec3][]
      ).map(([element, xyz]) => [element, math.add(xyz, offset)]),
    )
    const found = as_map(bonding.neighbor_query(water, { cutoff: 1 }))
    const expected = brute_force(water, 1, [false, false, false])
    expect(expected.size).toBe(6) // two O-H per water, both directions
    expect([...found.keys()].toSorted()).toEqual([...expected.keys()].toSorted())
    for (const [key, { dist }] of expected) expect(found.get(key)?.dist).toBeCloseTo(dist, 12)
  })

  // One ejected atom (an MD blow-up frame) stretches the bounding box along one axis. A
  // cube-root widening of a cubic bin left that axis with ~span/bin bins (5e7 bins at 1e11 A,
  // tens of GB at 1e14 A); a cubic bin widened until the grid fits put the whole cluster into
  // one bin, so the sweep went O(n^2) (50k atoms: 0.1 -> 4 s). Only the stretched axis may
  // widen; the cluster must stay spread over the other two. The memory blow-up surfaces here
  // as an allocation failure; the O(n^2) one is timed in perf-baselines.test.ts.
  test.each([
    [1e6, 10],
    [1e11, 10],
    [1e14, 10],
    [1e9, 34],
  ])(`a flyaway atom at %s A keeps the grid bounded (%s^3 cluster)`, (far, edge) => {
    const n_cluster = edge ** 3
    const xyzs: Vec3[] = Array.from({ length: n_cluster }, (_, idx) => [
      (idx % edge) * 1.1,
      (Math.floor(idx / edge) % edge) * 1.1,
      Math.floor(idx / edge ** 2) * 1.1,
    ])
    xyzs.push([far, 0, 0])
    const cloud = make_molecule(xyzs.map((xyz) => [`C`, xyz]))
    const list = bonding.neighbor_query(cloud, { cutoff: 1.2 })
    // cubic grid at 1.1 A: 3 edge^2 (edge - 1) axis-adjacent pairs, each listed from both ends
    expect(list.neighbors).toHaveLength(6 * edge ** 2 * (edge - 1))
    expect(
      list.offsets[n_cluster + 1] - list.offsets[n_cluster],
      `the flyaway atom has no contacts`,
    ).toBe(0)
  })

  test(`sorted: false preserves slot discovery order and the same contacts`, () => {
    const sorted = bonding.neighbor_query(triclinic, { cutoff: 5.5 })
    const unsorted = bonding.neighbor_query(triclinic, { cutoff: 5.5, sorted: false })
    expect(Array.from(unsorted.offsets)).toEqual(Array.from(sorted.offsets))
    const keys = (list: bonding.NeighborList, center: number) =>
      Array.from({ length: list.offsets[center + 1] - list.offsets[center] }, (_, rank) => {
        const slot = list.offsets[center] + rank
        const image = Array.from(list.images.subarray(slot * 3, slot * 3 + 3))
        return `${list.neighbors[slot]}|${image.join(`,`)}|${list.distances[slot]}`
      })
    for (let center = 0; center < sorted.n_centers; center++) {
      expect(keys(unsorted, center).toSorted()).toEqual(keys(sorted, center).toSorted())
    }
    // Bin-major traversal is reserved for streamed histograms. Materialized contacts keep
    // their slot order because bond consumers deduplicate geometric vertices in that order.
    const interleaved = make_crystal(
      10,
      [3, 0, 1, 2, 4, 5].map((coord) => ({ element: `Si`, xyz: [coord, 0, 0] as Vec3 })),
    )
    const list = bonding.neighbor_query(interleaved, {
      cutoff: 2.1,
      sorted: false,
      pbc: [false, false, false],
    })
    expect(Array.from(list.offsets)).toEqual([0, 4, 6, 9, 13, 16, 18])
    expect(Array.from(list.neighbors)).toEqual([
      4, 5, 2, 3, 2, 3, 1, 3, 0, 1, 2, 0, 4, 0, 3, 5, 0, 4,
    ])
  })

  test.each([Number.NaN, Infinity])(`rejects a %s coordinate instead of binning it`, (bad) => {
    // Map keys compare NaN equal, so without the guard the NaN site collected each of its
    // own 26 images 27 times with NaN distances
    const crystal = make_crystal(4, [
      { element: `Na`, abc: [0, 0, 0] },
      { element: `Na`, xyz: [bad, 2, 2] },
    ])
    expect(() => bonding.neighbor_query(crystal, { cutoff: 3 })).toThrow(/non-finite/)
    const molecule = {
      sites: crystal.sites.map((site) => ({ ...site, abc: [0, 0, 0] as Vec3 })),
    }
    expect(() => bonding.neighbor_query(molecule, { cutoff: 3 })).toThrow(
      `neighbor_query: site 2 has a non-finite position (${bad}, 2, 2)`,
    )
  })

  test.each([
    [`missing`, undefined],
    [`non-boolean`, [1, 0, 1]],
  ])(
    `a crystal with %s lattice.pbc is malformed input, not a finite cluster`,
    (_desc, pbc) => {
      // pbc is required on LatticeType; hand-built props can omit it, and the analyses used to
      // fall through to a finite bonding pass that under-counted every coordination number
      const crystal = make_crystal(4, [{ element: `Na`, abc: [0, 0, 0] }])
      const malformed = {
        ...crystal,
        lattice: { ...crystal.lattice, pbc },
      } as unknown as typeof crystal
      expect(() => bonding.neighbor_query(malformed, { cutoff: 3 })).toThrow(/lattice\.pbc/)
      expect(() => calc_coordination_nums(malformed)).toThrow(/lattice\.pbc/)
      // BondSearch's finite path reads lattice.pbc for its periodic candidate superset
      expect(() => new bonding.BondSearch().compute_columns(malformed)).toThrow(/lattice\.pbc/)
      // an explicit override still works on the same object
      expect(
        bonding.neighbor_query(malformed, { cutoff: 3, pbc: [true, true, true] }).n_centers,
      ).toBe(1)
    },
  )
})

describe(`bond_neighbor_summary`, () => {
  const molecule = make_molecule(
    [`C`, `O`, `N`, `N`, `H`].map((elem): [string, Vec3] => [elem, [0, 0, 0]]),
  )
  const bond = (site_idx_1: number, site_idx_2: number): BondPair => ({
    pos_1: [0, 0, 0],
    pos_2: [1, 0, 0],
    site_idx_1,
    site_idx_2,
    bond_length: 1,
  })
  // site 0 is the second end of bond 3-0, so neighbours are found from either end
  const bonds = [bond(0, 1), bond(0, 2), bond(3, 0)]

  test.each([
    [`counts by element, alphabetical`, 0, molecule, `3 (N: 2, O: 1)`],
    [`second-end site`, 3, molecule, `1 (C: 1)`],
    [`missing structure marks elements unknown`, 1, undefined, `1 (?: 1)`],
    [`unbonded site`, 4, molecule, null],
  ])(`%s`, (_label, site_idx, structure, expected) => {
    expect(bond_neighbor_summary(bonds, site_idx, structure)).toBe(expected)
  })
})
