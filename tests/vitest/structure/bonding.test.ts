import type { BondOrder, BondPair, ElementSymbol } from '#lib'
import type { Vec3 } from '#lib/math'
import type { AnyStructure, Crystal, StructureBond } from '#lib/structure/index'
import type { BondEditState } from '#lib/structure/bonding'
import { element_by_symbol } from '#lib/element/data'
import * as bonding from '#lib/structure/bonding'
import * as neighbor_list from '#lib/structure/neighbor-list'
import { BondFrame, bond_neighbor_summary, pack_bonds } from '#lib/structure/bond-rendering'
import { numeric_sites } from '#lib/structure/site'
import {
  create_numeric_md_frame,
  FrameView,
  materialize_frame,
  wrap_frame_coordinates,
} from '#lib/trajectory/frame'
import { compute_coordination_nums } from '#lib/coordination/compute-coordination'
import * as math from '#lib/math'
import { get_pbc_image_sites, type Pbc } from '#lib/structure/pbc'
import { make_supercell } from '#lib/structure/supercell'
import { test_molecules } from '#site/molecules'
import { describe, expect, onTestFinished, test, vi } from 'vite-plus/test'
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

// Explicit bond record as structure.properties.bonds stores it
const edge = (
  site_idx_1: number,
  site_idx_2: number,
  order: BondOrder = 1,
  cell_shift?: Vec3,
): StructureBond => ({ site_idx_1, site_idx_2, order, ...(cell_shift && { cell_shift }) })

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
// Spies on a numeric structure's site columns, to assert that no Site object gets built
const spy_site_reads = (structure: AnyStructure) => {
  const sites = numeric_sites.get(structure)
  if (!sites) throw new Error(`Missing numeric sites`)
  return [vi.spyOn(sites, `materialize`), vi.spyOn(sites, `get`)]
}
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

// atoms on a line along x (at y = z = `offset`) of a cubic cell, one per element at the
// matching x coordinate
const x_chain = (elements: ElementSymbol[], x_coords: number[], lattice = 10, offset = 0) =>
  make_struct(
    elements.map((element, idx) => ({ element, xyz: [x_coords[idx], offset, offset] })),
    lattice,
  )

// Fe-O bonded at 2 A, C 2 A further along x
const make_fe_o_c = () => x_chain([`Fe`, `O`, `C`], [0, 2, 4])

// idx-th point of a grid filled x-fastest with n_x * n_y points per z layer
const grid_point = (idx: number, n_x: number, n_y: number, spacing: number): Vec3 =>
  math.scale<Vec3>(
    [idx % n_x, Math.floor(idx / n_x) % n_y, Math.floor(idx / (n_x * n_y))],
    spacing,
  )

// 4600 H atoms (10.6M pairs) on a 17 x 17 x 16 grid
const hydrogen_grid = (spacing: number): [string, Vec3][] =>
  Array.from({ length: 4600 }, (_, idx) => [`H`, grid_point(idx, 17, 17, spacing)])

const unknown_option = (strategy: string, key: string, allowed: string[]) =>
  `Unknown ${strategy} bonding option '${key}', expected one of ${allowed.join(`, `)}`

const bond_key_of = (bond: BondPair): string =>
  bonding.get_bond_key(bond.site_idx_1, bond.site_idx_2, bond.cell_shift)

type Contact = { center: number; partner: number; shift: Vec3; dist: number; delta: Vec3 }
// Every (center, partner, integer image) within `cutoff` by direct enumeration of up to
// `reach` images per periodic axis; a molecule's zero lattice vectors are never applied
const brute_force = (
  structure: AnyStructure,
  cutoff: number,
  pbc: readonly boolean[],
  reach = 3,
): Map<string, Contact> => {
  const [vec_a, vec_b, vec_c] =
    `lattice` in structure
      ? structure.lattice.matrix
      : Array.from({ length: 3 }, (): Vec3 => [0, 0, 0])
  const range = (axis: number) =>
    pbc[axis] ? Array.from({ length: 2 * reach + 1 }, (_, idx) => idx - reach) : [0]
  const shifts = range(0).flatMap((shift_a) =>
    range(1).flatMap((shift_b) =>
      range(2).map((shift_c): Vec3 => [shift_a, shift_b, shift_c]),
    ),
  )
  const found = new Map<string, Contact>()
  for (const [center, site_a] of structure.sites.entries()) {
    for (const [partner, site_b] of structure.sites.entries()) {
      for (const shift of shifts) {
        if (center === partner && shift.every((val) => val === 0)) continue
        const delta = [0, 1, 2].map(
          (axis) =>
            site_b.xyz[axis] +
            shift[0] * vec_a[axis] +
            shift[1] * vec_b[axis] +
            shift[2] * vec_c[axis] -
            site_a.xyz[axis],
        ) as Vec3
        const dist = Math.hypot(...delta)
        if (dist <= cutoff)
          found.set(`${center}|${partner}|${shift}`, { center, partner, shift, dist, delta })
      }
    }
  }
  return found
}

describe(`Bonding Algorithms`, () => {
  // Fe-O at 2.0 A (covalent sum 1.98) bonds (length and positions: see the Fe-O row of the
  // Electronegativity-Based Bonding table); O-C at 2.0 A beside it is 1.4x its covalent sum
  // and Fe-C at 4.0 A is far out of range
  test(`electroneg_ratio bonds Fe-O but neither longer pair of Fe-O-C`, () => {
    expect(bonding.electroneg_ratio(make_fe_o_c()).map(bond_key_of)).toEqual([`0-1`])
  })

  // duplicate-free bonds: see the spatial grid coverage tests
  test(`electroneg_ratio keeps the lower site index first`, () => {
    // Cross-bin discovery must keep the lower site index, regardless of spatial order.
    const chain = x_chain([`Cu`, `Cu`, `Cu`, `Cu`], [7.5, 0, 5, 2.5])
    const chain_bonds = bonding
      .electroneg_ratio(chain)
      .map(({ site_idx_1, site_idx_2, bond_length }) => [site_idx_1, site_idx_2, bond_length])
    // oxfmt-ignore
    expect(chain_bonds).toEqual([[0, 2, 2.5], [1, 3, 2.5], [2, 3, 2.5]])
  })

  test(`electroneg_ratio handles edge cases`, () => {
    expect(bonding.electroneg_ratio(make_struct([]))).toHaveLength(0)
    expect(bonding.electroneg_ratio(make_struct([{ xyz: [0, 0, 0] }]))).toHaveLength(0)
    // unknown element symbols have no radius data and are skipped rather than thrown on
    const unknown_elements = make_struct([
      // @ts-expect-error unknown element symbol
      { xyz: [0, 0, 0], element: `Xx` },
      // @ts-expect-error unknown element symbol
      { xyz: [1, 0, 0], element: `Yy` },
      // co-located: the min_bond_dist floor also covers pairs that cannot bond
      { xyz: [1, 0, 0], element: `C` },
    ])
    expect(bonding.electroneg_ratio(unknown_elements)).toEqual([])
  })
})

describe(`Explicit Bond Metadata`, () => {
  const strategies = Object.entries(bonding.BONDING_STRATEGIES)
  test.each(strategies)(`%s adds and orders declared bonds`, (_name, strategy) => {
    const structure = x_chain([`C`, `C`, `O`], [0, 1.4, 5])
    structure.properties = { bonds: [edge(0, 1, 2), edge(2, 0, 3)] }
    const metadata = bonding.get_explicit_bond_metadata(structure)
    expect(metadata).toEqual([edge(0, 1, 2), edge(0, 2, 3)])

    const bonds = strategy(structure)
    expect(find_bond(bonds, 0, 1)?.bond_order).toBe(2)
    const explicit_only_bond = find_bond(bonds, 0, 2)
    expect(explicit_only_bond).toMatchObject({ site_idx_1: 0, site_idx_2: 2, bond_order: 3 })
    expect(explicit_only_bond?.bond_length).toBeCloseTo(5)
  })

  const invalid = (idx: number, reason: string) =>
    `Ignoring invalid explicit bond at index ${idx}: ${reason}`
  const duplicate = (idx: number, sites: string, order: BondOrder) =>
    `Duplicate explicit bond definition at index ${idx} for site indices ${sites} with order ${order}; will overwrite the previous entry`
  // oxfmt-ignore
  test.each<[string, unknown[], StructureBond[], string[], boolean?]>([
    [`drops invalid entries`, [
      edge(0, 1, `aromatic`), { site_idx_1: 0.5, site_idx_2: 1, order: 2 }, edge(0, 8, 2), edge(1, 1),
      { site_idx_1: 0, site_idx_2: 1, order: 4 }, edge(0, 1, 2, [1, 0.5, 0]), null,
    ], [edge(0, 1, `aromatic`)], [
      invalid(1, `site indices must be integers`), invalid(2, `site indices 0, 8 are out of range for 2 sites`),
      invalid(3, `endpoints match`), invalid(4, `unsupported order 4`),
      invalid(5, `cell_shift must be three integers`), invalid(6, `expected object`),
    ]],
    [`drops periodic bonds of a lattice-free structure`, [edge(0, 1, 1, [1, 0, 0])], [],
      [invalid(0, `cell_shift requires a crystal lattice`)], true],
    [`lets a later duplicate overwrite an earlier one`, [edge(0, 1), edge(1, 0, 2)], [edge(0, 1, 2)],
      [duplicate(1, `1, 0`, 2)]],
    // a zero-shift self-bond is invalid, but periodic ones key under their canonical shift
    [`keeps periodic self-bonds distinct from zero-shift ones`,
      [edge(0, 0), edge(0, 0, 2, [1, 0, 0]), edge(0, 0, 3, [-1, 0, 0])], [edge(0, 0, 3, [1, 0, 0])],
      [invalid(0, `endpoints match`), duplicate(2, `0, 0`, 3)]],
  ])(`explicit bond metadata %s with warnings`, (_desc, bonds, expected, warnings, molecule) => {
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => undefined)
    onTestFinished(() => warn_spy.mockRestore())
    const atoms: [ElementSymbol, Vec3][] = [[`C`, [0, 0, 0]], [`C`, [1.4, 0, 0]]]
    const structure = molecule ? make_molecule(atoms) : x_chain([`C`, `C`], [0, 1.4])
    structure.properties = { bonds: bonds as StructureBond[] }
    expect(bonding.get_explicit_bond_metadata(structure)).toEqual(expected)
    expect(warn_spy.mock.calls.map(([message]) => message)).toEqual(warnings)
  })

  const empty_bond_edit_state = (): BondEditState => ({
    added_bonds: [],
    removed_bonds: [],
    bond_order_overrides: [],
  })

  const calculated_bonds = (bond_order?: BondOrder) => [
    { site_idx_1: 0, site_idx_2: 1, ...(bond_order === undefined ? {} : { bond_order }) },
  ]

  const bond_0_1 = (order: BondOrder) => [edge(0, 1, order)]

  // oxfmt-ignore
  test.each<{
    desc: string; base: StructureBond[]; added: StructureBond[]; removed: StructureBond[]
    overrides: StructureBond[]; expected: StructureBond[]; visible?: boolean
  }>([
    { desc: `lets overrides win over additions`, base: [], added: bond_0_1(1), removed: [], overrides: bond_0_1(3), expected: bond_0_1(3) },
    { desc: `lets removals win over stale additions and overrides`, base: bond_0_1(1), added: bond_0_1(1), removed: [edge(1, 0, 1)], overrides: bond_0_1(3), expected: [], visible: false },
    { desc: `normalizes reversed bond records`, base: [], added: [edge(3, 1, 2)], removed: [], overrides: [], expected: [edge(1, 3, 2)] },
  ])(`merge_bond_edits $desc`, ({ base, added, removed, overrides, expected, visible }) => {
    expect(bonding.merge_bond_edits(base, added, removed, overrides)).toEqual(expected)
    if (visible === undefined) return
    const state = { added_bonds: added, removed_bonds: removed, bond_order_overrides: overrides }
    expect(bonding.has_visible_bond(state, base[0], [])).toBe(visible)
  })

  // Each edit runs against a calculated 0-1 bond (order 1 unless calc_order says otherwise);
  // reversed targets check the helpers normalize site order. Expected state is a subset.
  // oxfmt-ignore
  type EditCase = [
    desc: string, op: `add` | `delete` | `order`, before: Partial<BondEditState>, target: [number, number],
    order: BondOrder, calc_order: BondOrder | undefined, action: string, changed: boolean, after: Partial<BondEditState>,
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
    const reversed_target = { site_idx_1: 1, site_idx_2: 0, cell_shift: [-1, 0, 0] as Vec3 }
    const { state } = bonding.delete_bond(
      empty_bond_edit_state(),
      reversed_target,
      shifted_bonds,
    )
    expect(state.removed_bonds).toEqual([edge(0, 1, 1, [1, 0, 0])])
    // the other periodic copy of the same site pair stays visible
    expect(bonding.has_visible_bond(state, shifted_bonds[1], shifted_bonds)).toBe(true)
  })

  test(`canonicalizes image-atom bond edit targets to original sites with cell shifts`, () => {
    // O on the low-x face gets a face copy at x=10.05 beside C
    const structure = x_chain([`C`, `O`], [9.5, 0.05], 10, 5)
    const structure_with_images = get_pbc_image_sites(structure, image_options())
    const image_site_idx = structure_with_images.sites.findIndex(
      (site) => site.provenance?.image_of === 1 && site.abc[0] > 1,
    )

    expect(image_site_idx).toBeGreaterThan(1)
    for (const reversed of [false, true]) {
      const [site_idx_1, site_idx_2] = reversed ? [image_site_idx, 0] : [0, image_site_idx]
      const target = { site_idx_1, site_idx_2 }
      const canonical = bonding.canonicalize_bond_target(target, structure_with_images.sites)
      expect(canonical).toEqual({ site_idx_1: 0, site_idx_2: 1, cell_shift: [1, 0, 0] })
    }
  })

  // Matching site indices with opposite shifts stay two distinct bonds, and explicit_only
  // draws each to its image: the +1 image of O sits at x=10.5, 1 A from C at x=9.5 (not the
  // 9 A in-cell distance)
  test(`parses explicit crystal bonds with cell shifts and draws them to their images`, () => {
    const structure = x_chain([`C`, `O`], [9.5, 0.5], 10, 5)
    const declared = [edge(0, 1, 2, [1, 0, 0]), edge(0, 1, 3, [-1, 0, 0])]
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
    const structure = x_chain([`Si`, `O`], [9, 0.6], 10, 5)
    structure.properties = { bonds: [edge(0, 1, 2, [1, 0, 0])] }
    const imaged = get_pbc_image_sites(structure, image_options())
    const bonds = bonding.electroneg_ratio(imaged)
    const lengths = bonds.map((bond) => math.euclidean_dist(bond.pos_1, bond.pos_2))
    expect(lengths.map((length) => Number(length.toFixed(6)))).toEqual([1.6])
    expect(bonds.map(({ bond_order }) => bond_order)).toEqual([2])
    expect(bonds[0].pos_2.map(Math.round)).toEqual([11, 5, 5])
  })
})

describe(`explicit_only strategy`, () => {
  // oxfmt-ignore
  test.each<[string, StructureBond[] | undefined, [number, number, BondOrder][]]>([
    [`no bonds property`, undefined, []],
    [`an empty bonds array`, [], []],
    [`a single declared bond`, [edge(0, 1, 2)], [[0, 1, 2]]],
    // reversed indices are normalized to ascending order, declaration order is kept
    [`declared bonds of mixed order`, [edge(2, 0), edge(0, 1, `aromatic`)], [[0, 2, 1], [0, 1, `aromatic`]]],
  ])(`returns exactly the bonds for %s`, (_desc, declared, expected) => {
    // All 3 pairs are within covalent bonding range, so electroneg_ratio perceives bonds
    // between them regardless of what the structure declares
    const structure = make_struct([
      { xyz: [0, 0, 0], element: `C` },
      { xyz: [1.4, 0, 0], element: `C` },
      { xyz: [0, 1.2, 0], element: `O` },
    ])
    if (declared) structure.properties = { bonds: declared }
    const bonds = bonding.explicit_only(structure)
    // no silent fallback to proximity perception (which would mask a missing or unparsed bond
    // block in PDB/MOL/MOL2/SDF): the undeclared C-O pair is perceived but never returned
    expect(find_bond(bonding.electroneg_ratio(structure), 0, 2)).toBeDefined()

    const { sites } = structure
    const triples = bonds.map((bond) => [bond.site_idx_1, bond.site_idx_2, bond.bond_order])
    expect(triples).toEqual(expected)
    for (const { site_idx_1, site_idx_2, pos_1, pos_2, bond_length } of bonds) {
      expect([pos_1, pos_2]).toEqual([site_idx_1, site_idx_2].map((idx) => sites[idx].xyz))
      expect(bond_length).toBeCloseTo(math.euclidean_dist(pos_1, pos_2))
    }
  })
})

describe(`Molecular Bonding Analysis`, () => {
  // Lower strength threshold to ensure all bond types (incl. C-C) are captured
  const loose_opts = { max_distance_ratio: 2, strength_threshold: 0.2 }

  test.each<[string, Crystal, number, number, number, typeof loose_opts | undefined]>([
    [`water`, test_molecules.water, 2, 0.8, 1.2, undefined],
    [`methane`, test_molecules.methane, 4, 0.9, 1.3, undefined],
    [`ethanol`, test_molecules.ethanol, 6, 0.8, 2.0, loose_opts],
  ])(`%s has expected bonds`, (_name, molecule, n_bonds, min_dist, max_dist, options) => {
    const bonds = bonding.electroneg_ratio(molecule, options)
    expect(bonds.length).toBeGreaterThanOrEqual(n_bonds)
    for (const bond of bonds) {
      expect(bond.bond_length).toBeGreaterThan(min_dist)
      expect(bond.bond_length).toBeLessThan(max_dist)
    }
  })

  test(`benzene has aromatic C-C bonds`, () => {
    const { benzene } = test_molecules
    const is_carbon = (idx: number) => benzene.sites[idx].species[0].element === `C`
    const cc_bonds = bonding
      .electroneg_ratio(benzene, loose_opts)
      .filter(
        ({ site_idx_1, site_idx_2, bond_length }) =>
          is_carbon(site_idx_1) &&
          is_carbon(site_idx_2) &&
          bond_length > 1.3 &&
          bond_length < 1.6,
      )
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
  // oxfmt-ignore
  const images: Vec3[] = [
    [coord_x, coord_y, coord_z], [-coord_x + 0.5, -coord_y, coord_z + 0.5],
    [-coord_x, coord_y + 0.5, -coord_z], [coord_x + 0.5, -coord_y + 0.5, -coord_z + 0.5],
    [-coord_x, -coord_y, -coord_z], [coord_x + 0.5, coord_y, -coord_z + 0.5],
    [coord_x, -coord_y + 0.5, coord_z], [-coord_x + 0.5, coord_y + 0.5, coord_z + 0.5],
  ]
  const unique = new Map<string, Vec3>()
  for (const image of images) {
    const abc = image.map(wrap_frac) as Vec3
    const key = abc.map((val) => val.toFixed(5)).join(`,`)
    if (!unique.has(key)) unique.set(key, abc)
  }
  return sites_at(element, [...unique.values()])
}
// oxfmt-ignore
const hexagonal = (value_a: number, value_c: number): math.Matrix3x3 => [
  [value_a, 0, 0], [-value_a / 2, (value_a * Math.sqrt(3)) / 2, 0], [0, 0, value_c],
]

// [label, lattice, sites, expected coordination number per element]
// oxfmt-ignore
const cn_benchmark: [string, number | math.Matrix3x3, SimpleSite[], Record<string, number>][] = [
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
  // TiC and Ti2O pin cation_cation_penalty's anion-shell gate. In both, Ti-Ti is SHORTER than
  // Ti-nonmetal once normalized by covalent radii (0.956 vs 0.915, 0.919 vs 0.923), so no
  // distance rule separates them; saturation does: TiC's Ti has a full octahedral C shell and
  // its Ti-Ti at 3.06 A is a second shell, while Ti2O's Ti has only 3 O and its hcp Ti
  // framework at 2.95 A IS the structure (an unconditional penalty took Ti2O from CN 15 to 3).
  [`TiC rocksalt`, 4.33, [...fcc(`Ti`), ...fcc(`C`, [[0.5, 0, 0]])], { Ti: 6, C: 6 }],
  // 12 Ti + 3 O around each Ti
  [`Ti2O suboxide`, hexagonal(2.9587, 4.7852), [...hcp(`Ti`), [`O`, [0, 0, 0]]], { Ti: 15, O: 6 }],
  // control: no anion-former, so the gate is inert either way
  [`hcp Ti`, hexagonal(2.9587, 4.7852), hcp(`Ti`), { Ti: 12 }],
  [`graphite C`, [[2.464, 0, 0], [-1.232, 2.13389, 0], [0, 0, 6.711]], sites_at(`C`, [[0, 0, 0.25], [0, 0, 0.75], [1 / 3, 2 / 3, 0.25], [2 / 3, 1 / 3, 0.75]]), { C: 3 }],
  [`rutile TiO2`, [[4.594, 0, 0], [0, 4.594, 0], [0, 0, 2.959]], [
    ...sites_at(`Ti`, [[0, 0, 0], [0.5, 0.5, 0.5]]),
    ...sites_at(`O`, [[0.3053, 0.3053, 0], [0.6947, 0.6947, 0], [0.8053, 0.1947, 0.5], [0.1947, 0.8053, 0.5]]),
  ], { Ti: 6, O: 3 }],
]

describe(`coordination number benchmark`, () => {
  test.each(cn_benchmark)(`%s`, (_label, lattice, sites, expected) => {
    const base = make_crystal(lattice, sites)
    // the infinite crystal's bond graph: every site has its full shell across the faces
    const periodic_bonds = bonding.electroneg_ratio(base, { pbc: base.lattice.pbc })
    const counts = bonds_per_site(periodic_bonds, base.sites.length)
    const elements = base.sites.map((site) => bonding.get_majority_element(site))
    for (const [element, cn] of Object.entries(expected)) {
      // every atom of that element must hit the textbook CN, boundary copies included
      const cns = counts.filter((_, idx) => elements[idx] === element)
      expect(cns, element).toEqual(cns.map(() => cn))
    }
  })
})

describe(`Electronegativity-Based Bonding`, () => {
  test.each<[ElementSymbol, ElementSymbol, number, number, number]>([
    [`Na`, `Cl`, 2.3, 2.5, 1], // ionic
    [`C`, `C`, 1.5, 2.5, 1], // covalent, same species
    [`C`, `O`, 1.5, 2.5, 1], // covalent, heteronuclear
    [`Na`, `Cl`, 10, 5, 0], // inside max_distance_ratio but far too weak
    [`Fe`, `O`, 2, 2, 1], // 1.01x the covalent sum 1.98, at the default ratio
  ])(`%s-%s at %s A (ratio %s): %s bonds`, (elem_1, elem_2, dist, max_ratio, n_bonds) => {
    const structure = x_chain([elem_1, elem_2], [0, dist])
    const bonds = bonding.electroneg_ratio(structure, { max_distance_ratio: max_ratio })
    expect(bonds).toHaveLength(n_bonds)
    for (const bond of bonds) {
      expect(bond.bond_length).toBeCloseTo(dist, 12)
      // positions correspond to their site indices
      expect([bond.pos_1, bond.pos_2]).toEqual([0, 1].map((idx) => structure.sites[idx].xyz))
    }
  })

  test(`parameter sensitivity`, () => {
    const fe_pair: { xyz: Vec3; element: ElementSymbol }[] = [
      { xyz: [0, 0, 0], element: `Fe` },
      { xyz: [2.5, 0, 0], element: `Fe` },
    ]
    const structure = make_struct([...fe_pair, { xyz: [1.25, 2.2, 0], element: `O` }])
    // One bridging O leaves both Fe far short of an anion shell, so the cation gate stays
    // out of the way and the Fe-Fe contact is kept alongside the two Fe-O bonds
    expect(bonding.electroneg_ratio(structure)).toHaveLength(3)

    // Surround each Fe with enough O to saturate it and the same Fe-Fe contact is dropped:
    // now it really is a second shell behind a complete coordination environment
    // oxfmt-ignore
    const o_shell: Vec3[] = [
      [1.25, 1.7, 0], [1.25, -1.7, 0], [1.25, 0, 1.7], [1.25, 0, -1.7], [-1.9, 0, 0], [4.4, 0, 0],
    ]
    const o_sites = o_shell.map((xyz) => ({ xyz, element: `O` as const }))
    const saturated = make_struct([...fe_pair, ...o_sites])
    expect(find_bond(bonding.electroneg_ratio(saturated), 0, 1)).toBeUndefined()
    // lifting the gate brings it back, confirming that is what removed it
    const ungated = bonding.electroneg_ratio(saturated, { cation_cation_penalty: 1 })
    expect(find_bond(ungated, 0, 1)).toBeDefined()

    // with no anion present the gate is inert and metal_metal_penalty governs again
    const metal_only = make_struct(fe_pair)
    expect(bonding.electroneg_ratio(metal_only, { metal_metal_penalty: 0.8 })).toHaveLength(1)
    expect(bonding.electroneg_ratio(metal_only, { metal_metal_penalty: 0.1 })).toHaveLength(0)
  })
})

describe(`pair_cutoffs strategy`, () => {
  const cutoffs: Record<string, [number, number]> = {
    'Si-O': [1.2, 2.4],
    'O-O': [0.5, 3.1],
    'Si-Si': [2.5, 4.2], // reaches past the shortest cell height of some cells
  }
  // Every in-range contact, each pair once (get_bond_key canonicalizes the direction and a
  // self-image's shift sign)
  const brute_force_bonds = (structure: Crystal, pbc: Pbc): Map<string, number> => {
    const heights = math.cell_heights(structure.lattice.matrix)
    const reach = Math.max(...heights.map((height) => Math.ceil(4.2 / height) + 1))
    const element_of = (idx: number) => structure.sites[idx].species[0].element
    const found = new Map<string, number>()
    for (const { center, partner, shift, dist } of brute_force(
      structure,
      4.2,
      pbc,
      reach,
    ).values()) {
      const pair = [center, partner].map(element_of)
      const range = cutoffs[pair.join(`-`)] ?? cutoffs[pair.toReversed().join(`-`)]
      if (range && dist >= range[0] && dist <= range[1])
        found.set(bonding.get_bond_key(center, partner, shift), dist)
    }
    return found
  }
  const rng = make_rng(17)
  // a sheared cell, so a cubic-only image search would miss contacts
  const random_crystal = (n_sites: number, elements: ElementSymbol[]): Crystal =>
    make_crystal(
      [
        [4 + 2 * rng(), 0, 0],
        [1.5 * rng() - 0.75, 4 + 2 * rng(), 0],
        [1.5 * rng() - 0.75, 1.5 * rng() - 0.75, 4 + 2 * rng()],
      ],
      Array.from({ length: n_sites }, (_, idx) => ({
        element: elements[idx % elements.length],
        abc: [rng(), rng(), rng()] as Vec3,
      })),
    )

  test.each([
    [`fully periodic`, [true, true, true]],
    [`a slab`, [true, true, false]],
    [`finite`, [false, false, false]],
  ] as [string, Pbc][])(`matches brute-force image enumeration (%s)`, (_label, pbc) => {
    for (let trial = 0; trial < 12; trial++) {
      const structure = random_crystal(2 + trial, [`Si`, `O`, `O`])
      const expected = brute_force_bonds(structure, pbc)
      const options = { pair_cutoffs: cutoffs, pbc }
      const bonds = bonding.compute_bonds(structure, `pair_cutoffs`, options)
      const actual = new Map(bonds.map((bond) => [bond_key_of(bond), bond.bond_length]))
      expect(actual.size, `trial ${trial}: one bond per contact`).toBe(bonds.length)
      expect([...actual.keys()].toSorted(), `trial ${trial}`).toEqual(
        [...expected.keys()].toSorted(),
      )
      for (const [key, dist] of expected) expect(actual.get(key)).toBeCloseTo(dist, 10)
    }
  })

  test(`either element order names a pair; unlisted pairs and absent elements never bond`, () => {
    const structure = random_crystal(10, [`Si`, `O`])
    const pbc: Pbc = [true, true, true]
    const keys = (pair_cutoffs: Record<string, [number, number]>) =>
      bonding
        .compute_bonds(structure, `pair_cutoffs`, { pair_cutoffs, pbc })
        .map(bond_key_of)
        .toSorted()
    expect(keys({ 'O-Si': [0, 3] })).toEqual(keys({ 'Si-O': [0, 3] }))
    expect(keys({ 'Si-O': [0, 3] }).length).toBeGreaterThan(0)
    // no Na in the structure, no Si-Si row: nothing to bond
    expect(keys({ 'Na-Cl': [0, 5], 'O-O': [0, 0.01] })).toEqual([])
    expect(keys({})).toEqual([])
  })

  const not_pair = (pair: string) => `'${pair}' is not an element pair like 'Si-O'`
  const bad_range = `'Si-O' must be [min, max] in Å`
  // oxfmt-ignore
  test.each([
    [`a non-element pair`, { 'Si-Xx': [0, 2] }, not_pair(`Si-Xx`)],
    [`a missing separator`, { SiO: [0, 2] }, not_pair(`SiO`)],
    [`three elements`, { 'Si-O-H': [0, 2] }, not_pair(`Si-O-H`)],
    [`a pair named twice`, { 'Si-O': [0, 2], 'O-Si': [0, 3] }, `'Si-O' and 'O-Si' name the same pair`],
    [`min above max`, { 'Si-O': [2, 1] }, bad_range],
    [`a negative min`, { 'Si-O': [-1, 2] }, bad_range],
    [`a zero max`, { 'Si-O': [0, 0] }, bad_range],
    [`one bound`, { 'Si-O': [2] }, bad_range],
    [`a string bound`, { 'Si-O': [0, `2`] }, bad_range],
    [`a list instead of a map`, [[`Si`, `O`, 0, 2]], `expected an object mapping 'A-B' element pairs`],
  ])(`rejects %s`, (_label, pair_cutoffs, problem) => {
    const options = { pair_cutoffs } as unknown as bonding.BondingOptions<`pair_cutoffs`>
    const run = () => bonding.compute_bonds(random_crystal(2, [`Si`, `O`]), `pair_cutoffs`, options)
    expect(run).toThrow(`Invalid pair_cutoffs bonding option pair_cutoffs: ${problem}`)
  })

  test(`takes only its own options`, () => {
    const options = { pair_cutoffs: {}, strength_threshold: 1 } as bonding.BondingOptions
    const run = () =>
      bonding.compute_bonds(random_crystal(2, [`Si`, `O`]), `pair_cutoffs`, options)
    expect(run).toThrow(
      unknown_option(`pair_cutoffs`, `strength_threshold`, [`pbc`, `pair_cutoffs`]),
    )
  })
})

describe(`bonding options`, () => {
  const nacl = () => x_chain([`Na`, `Cl`], [0, 2.8])
  // every electroneg_ratio tuning knob at its default
  // oxfmt-ignore
  const defaults = {
    electronegativity_threshold: 1.7, max_distance_ratio: 2, min_bond_dist: 0.4, metal_metal_penalty: 0.7,
    cation_cation_penalty: 0, metal_nonmetal_bonus: 1.5, similar_electronegativity_bonus: 1.2, strength_threshold: 0.3,
  }
  const electroneg_keys = [`pbc`, ...Object.keys(defaults)]
  // Options cross the type boundary untyped (settings, workers, hosts): only the runtime
  // check stands between a misspelled key and a silently ignored setting
  type Untyped = Record<string, unknown>
  const untyped = (options: Untyped) => options as bonding.BondingOptions
  const search = new bonding.BondSearch()
  const entry_points = {
    get_bond_data: (opts: Untyped) =>
      bonding.get_bond_data(nacl(), `electroneg_ratio`, untyped(opts)),
    compute_bonds: (opts: Untyped) =>
      bonding.compute_bonds(nacl(), `electroneg_ratio`, untyped(opts)),
    electroneg_ratio: (opts: Untyped) => bonding.electroneg_ratio(nacl(), untyped(opts)),
    'BondSearch.compute_columns': (opts: Untyped) =>
      search.compute_columns(nacl(), untyped(opts)),
    compute_coordination_nums: (opts: Untyped) =>
      compute_coordination_nums(nacl(), { bonding_options: untyped(opts) }),
  }

  test.each(
    Object.keys(entry_points).flatMap((entry) =>
      [`max_distnce_ratio`, `strenght_threshold`, `strategy`].map((key) => [entry, key]),
    ),
  )(`%s throws on the misspelled or misplaced option %s`, (entry, key) => {
    const run = entry_points[entry as keyof typeof entry_points]
    expect(() => run({ [key]: 0.5 })).toThrow(
      unknown_option(`electroneg_ratio`, key, electroneg_keys),
    )
  })

  test(`typos are rejected at compile time too`, () => {
    const typo = () =>
      bonding.compute_bonds(nacl(), `electroneg_ratio`, {
        // @ts-expect-error misspelled option
        strenght_threshold: 9,
      })
    expect(typo).toThrow(`option 'strenght_threshold'`) // full message checked above
    const misplaced = () =>
      bonding.get_bond_data(nacl(), `explicit_only`, {
        // @ts-expect-error electroneg_ratio tuning means nothing to explicit_only
        strength_threshold: 9,
      })
    expect(misplaced).toThrow(unknown_option(`explicit_only`, `strength_threshold`, [`pbc`]))
  })

  // oxfmt-ignore
  test.each([
    [`a numeric string`, { strength_threshold: `0.3` }, `strength_threshold: expected a finite number, got "0.3"`],
    [`NaN`, { max_distance_ratio: NaN }, `max_distance_ratio: expected a finite number`],
    [`Infinity`, { min_bond_dist: Infinity }, `min_bond_dist: expected a finite number`],
    [`a 2-axis pbc`, { pbc: [true, true] }, `pbc: expected three booleans [a, b, c], got [true,true]`],
  ])(`electroneg_ratio rejects %s`, (_label, options, detail) => {
    expect(() => bonding.compute_bonds(nacl(), `electroneg_ratio`, untyped(options))).toThrow(
      `Invalid electroneg_ratio bonding option ${detail}`,
    )
  })

  test.each([
    [`no options`, {}, 1],
    [`an unset option`, { strength_threshold: undefined }, 1],
    [`pbc`, { pbc: [false, false, false] }, 1],
    [`every tuning knob at its default`, defaults, 1],
    [`a threshold no bond clears`, { strength_threshold: 99 }, 0],
    [`a distance ratio below the contact`, { max_distance_ratio: 0.5 }, 0],
  ])(`electroneg_ratio accepts %s`, (_label, options, n_bonds) => {
    const bonds = bonding.compute_bonds(nacl(), `electroneg_ratio`, untyped(options))
    expect(bonds).toHaveLength(n_bonds)
  })

  const explicit_options = [{}, { pbc: [true, true, true] as Pbc }, { pbc: undefined }]
  test.each(explicit_options)(`explicit_only accepts %j and reads its bonds`, (options) => {
    const structure = nacl()
    structure.properties = { bonds: [edge(0, 1)] }
    const bonds = bonding.compute_bonds(structure, `explicit_only`, options)
    expect(bonds.map(bond_key_of)).toEqual([`0-1`])
  })

  test.each([
    [`electroneg_ratio`, { strength_threshold: 99 }],
    [`explicit_only`, {}],
  ] as const)(`strategy_bonding_options picks the %s entry`, (strategy, expected) => {
    const by_strategy = { electroneg_ratio: { strength_threshold: 99 } }
    expect(bonding.strategy_bonding_options(by_strategy, strategy)).toEqual(expected)
    expect(bonding.strategy_bonding_options(undefined, strategy)).toEqual({})
  })
})

// Regression: closest-neighbor penalties applied in processing order gave images fewer bonds
// than their originals. Two copies of a Na with a Long (3.0 A) and a Short (2.0 A) Cl
// neighbor: sites 0-2 are originals, 3-5 their images placed 100 A away.
test(`electroneg_ratio treats original and image atoms symmetrically`, () => {
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

  // Threshold tuned so the Long-bond penalty (once closest=2.0 is known) drops it. Pre-fix
  // the original saw Long before Short set closest and kept 2 bonds, the image only 1.
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

  const options = { min_bond_dist: 0.1, max_distance_ratio: 5.0, strength_threshold: 0.0001 }
  const bonds = bonding.electroneg_ratio(with_images, options)
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
test.each<[string, ElementSymbol[], Vec3[], { strength_threshold?: number }, boolean]>([
  [`keeps a longer C-C beside a shorter C-H`, [`C`, `H`, `C`], [[0, 0, 0], [1.09, 0, 0], [0, 1.4, 0]], {}, true],
  [`ignores a rejected weak Na-Na contact`, [`Na`, `Na`, `Cl`], [[0, 0, 0], [2, 0, 0], [0, 3, 0]], { strength_threshold: 0.4 }, false],
])(`electroneg_ratio closest-neighbor penalty %s`, (_desc, elements, coords, options, keeps_0_1) => {
  const structure = make_struct(elements.map((element, idx) => ({ element, xyz: coords[idx] })))
  const bonds = bonding.electroneg_ratio(structure, options)
  expect(Boolean(find_bond(bonds, 0, 1))).toBe(keeps_0_1)
  expect(find_bond(bonds, 0, 2)).toBeDefined()
})

describe(`remap_bonds_after_deletion`, () => {
  const shifted = (idx_1: number, idx_2: number) => edge(idx_1, idx_2, 2, [1, 0, 0])
  test.each([
    [`decrements indices past deleted site`, [edge(1, 2)], [0], [edge(0, 1)]],
    [`drops bonds touching deleted sites`, [edge(0, 2)], [2], []],
    // only the 3-4 bond survives, shifted down by 2
    [
      `mixed drop and shift`,
      [edge(0, 1), edge(1, 3), edge(3, 4), edge(2, 4)],
      [1, 2],
      [edge(1, 2)],
    ],
    [`no deletions is a no-op`, [edge(0, 1), edge(1, 2)], [], [edge(0, 1), edge(1, 2)]],
    [`preserves order and cell_shift`, [shifted(2, 3)], [0], [shifted(1, 2)]],
  ])(`%s`, (_desc, bonds, deleted, expected) => {
    expect(bonding.remap_bonds_after_deletion(bonds, new Set(deleted))).toEqual(expected)
  })
})

describe(`compute_bonds memo`, () => {
  const cluster_rand = make_rng(3)
  const cluster_atoms = Array.from({ length: 1500 }, (_, idx): [string, Vec3] => [
    [`C`, `H`, `N`, `O`][idx % 4],
    [0, 1, 2].map(() => 30 * cluster_rand()) as Vec3,
  ])
  const copper_cell = make_crystal(3.61, fcc(`Cu`))
  // Drag-like edits (a few sites move per call) re-search only the moved sites' contacts. Each
  // step must equal a full search without a query cache (bit-identical lengths, any order): a
  // supercell whose shells pool all copies of a unit-cell atom, a metal, an organic cluster.
  test.each([
    [`rocksalt supercell`, make_supercell(make_rocksalt(), 6)],
    [`fcc Cu supercell`, make_supercell(copper_cell, 7)],
    [`C/H/N/O cluster`, make_molecule(cluster_atoms)],
  ])(`incremental search after site moves matches a full search: %s`, (_, base) => {
    const rand = make_rng(5)
    let { sites } = base
    const query = bonding.create_bond_query()
    const bonds_of = (struct: AnyStructure, with_query?: bonding.BondNeighborQuery) =>
      sort_bonds(bonding.electroneg_ratio(struct, {}, with_query))
    bonds_of(base, query)
    // Shift random sites up to 0.25 A per axis per draw, none, or one onto another's position;
    // 250 draws exceed the moved-site share and run a full search the next step reuses
    for (const n_moved of [1, 1, 3, 30, 0, 2, 250, 1]) {
      sites = sites.slice()
      for (let draw = 0; draw < n_moved; draw++) {
        const site_idx = Math.floor(rand() * sites.length)
        const xyz = sites[site_idx].xyz.map((coord) => coord + 0.5 * (rand() - 0.5)) as Vec3
        sites[site_idx] = { ...sites[site_idx], xyz }
      }
      if (n_moved === 2) sites[0] = { ...sites[0], xyz: [...sites[1].xyz] }
      const structure = { ...base, sites }
      const actual = bonds_of(structure, query)
      expect(actual).toEqual(bonds_of(structure))
      expect(actual.length).toBeGreaterThan(100)
    }
  })
  test.each([false, true])(`skin rebuild on diagonal drift (numeric: %s)`, (numeric) => {
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
  })
  const homogeneous_elements = [`Si`, `Ge`, `C`, `O`, `Fe`] as const
  test.each(homogeneous_elements)(`homogeneous %s keeps full chemistry result`, (element) => {
    const source = make_random_structure(100, 9)
    for (const [idx, site] of source.sites.entries()) {
      site.species = [{ element, occu: 1 }]
      site.xyz = site.xyz.map((coord) => coord / 2) as Vec3
      if (idx % 7 === 0) site.provenance = { unit_cell_idx: 0 }
    }
    // A disconnected second element forces the full role calculation, without changing
    // any original contact. Compare several reach/strength boundaries, not just a lattice.
    const mixed = structuredClone(source)
    const other = element === `Fe` ? `O` : `Fe`
    mixed.sites.push(...make_struct([{ element: other, xyz: [1e6, 1e6, 1e6] }]).sites)
    for (const strength_threshold of [0, 0.1, 0.3, 0.8, 1.2]) {
      const actual = sort_bonds(bonding.electroneg_ratio(source, { strength_threshold }))
      const expected = sort_bonds(bonding.electroneg_ratio(mixed, { strength_threshold }))
      expect(actual).toEqual(expected)
    }
  })
  // oxfmt-ignore
  test.each([
    [[40, 0, 0], [0, 40, 0], [0, 0, 40]],
    [[40, 0, 0], [8, 40, 0], [3, 4, 40]],
  ])(`keeps finite bonds exact across wrapping in cell %j`, (...matrix) => {
    const search = new bonding.BondSearch()
    const source = x_chain([`Si`, `Si`, `Si`], [39.9, 1.8, 4], 40)
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
    // a changed cell, then dropped periodicity, each invalidate the reused candidates
    for (const pbc of [changed_cell.lattice.pbc, NO_PBC]) {
      changed_cell.lattice.pbc = pbc
      const expected = pack_bonds(bonding.electroneg_ratio(changed_cell))
      expect(search.compute_columns(changed_cell)).toEqual(expected)
    }
  })
  test.each([7, 42, 123])(`reuses candidates without losing bonds (seed %i)`, (seed) => {
    const search = new bonding.BondSearch()
    const source = make_random_structure(200, seed)
    const rand = make_rng(seed)
    // new options in frames 10 and 12 must invalidate the reused candidates
    const frame_options: Record<number, bonding.BondingOptions> = {
      10: { max_distance_ratio: 1.1 },
      12: { pbc: [true, true, true] },
    }
    for (let frame_idx = 0; frame_idx < 16; frame_idx++) {
      const structure = structuredClone(source)
      for (const site of structure.sites) {
        for (let axis = 0; axis < 3; axis++)
          site.xyz[axis] += ((rand() - 0.5) * frame_idx) / 10
      }
      if (frame_idx === 5) structure.sites[0].species[0].element = `Si`
      if (frame_idx === 8) structure.sites.pop()
      const options = frame_options[frame_idx] ?? {}
      const expected = sort_bonds(bonding.electroneg_ratio(structure, options))
      const columns = search.compute_columns(structure, options)
      if (frame_idx === 0) {
        expect(Reflect.get(search, `candidates`)).toEqual({
          offsets: expect.any(Int32Array),
          neighbors: expect.any(Int32Array),
          distances: expect.any(Float64Array),
        })
        const allocate = vi.spyOn(globalThis, `Int32Array`)
        onTestFinished(() => allocate.mockRestore())
        expect(search.compute_columns(structure, options)).toEqual(columns)
        const allocated = allocate.mock.calls.map((args) => Reflect.get(args, 0))
        expect(allocated).not.toContain(Math.max(256, structure.sites.length * 4))
      }
      const actual = sort_bonds(new BondFrame(structure, columns).materialize())
      expect(actual).toEqual(expected)
    }
    expect(search.compute_columns({ sites: [] })).toEqual(pack_bonds([]))
  })

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
      // oxfmt-ignore
      const bonds = [
        edge(0, 1, 2), edge(0, 2, 1.5), edge(1, 3, 3), edge(0, 2, `aromatic`, [-1, 0, 0]), edge(0, 0, 1, [1, 0, 0]),
      ]
      source.properties = { bonds }
      const { matrix, pbc } = source.lattice
      const frame = md_frame(xyz_array(source), Uint8Array.of(14, 8, 14, 26), matrix, pbc)
      frame.scalar_columns = { orig_unit_cell_idx: Float64Array.of(0, 1, 0, 3) }
      frame.structure.properties = source.properties
      const structure = numeric ? new FrameView().update(frame).structure : source
      const search = new bonding.BondSearch()
      const options = { pbc: [periodic, periodic, periodic] as Pbc }
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

  const modes = [`none`, `unit`, `image`, `both`, `short`]
  test.each(modes)(`bonds unmaterialized numeric frames (%s provenance)`, (provenance) => {
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
      const site_reads = spy_site_reads(structure)
      const actual = search.compute_columns(structure)
      const expected = reference_search.compute_columns(reference)
      expect(actual).toEqual(expected) // exact: toEqual tells -0 from 0 and 1-ulp changes
      for (const spy of site_reads) expect(spy).not.toHaveBeenCalled()
    }
    const invalid = md_frame(Float64Array.of(0, 0, 0), Uint8Array.of(0))
    expect(() => search.compute_columns(view.update(invalid).structure)).toThrow(
      `Invalid atomic number 0 at site 1`,
    )
  })

  // A lattice-free chain caps the k search at its bounding-box diagonal, so a misread packed
  // column (vector columns make the stride 12) would drop neighbours here
  test(`k-NN reads an unmaterialized molecular frame's packed columns`, () => {
    const frame = create_numeric_md_frame(
      Float64Array.of(0, 0, 0, 1.1, 0, 0, 2.9, 0.4, 0, 4.2, 0, 0.3, 7.5, 0, 0),
      Uint8Array.of(6, 6, 8, 6, 1),
      undefined,
      undefined,
      0,
      {},
      [`force`, `velocity`],
    )
    const reference = materialize_frame(frame).structure
    const { structure } = new FrameView().update(frame)
    const site_reads = spy_site_reads(structure)
    const knn = neighbor_list.neighbor_query(structure, { k: 4 })
    expect(knn.offsets.at(-1)).toBe(20) // every site reaches all 4 others
    expect(knn).toEqual(neighbor_list.neighbor_query(reference, { k: 4 }))
    for (const spy of site_reads) expect(spy).not.toHaveBeenCalled()
  })

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
    const { matrix } = copper.lattice
    const skinned = sigmas.map((sigma) => {
      const positions = Float64Array.from(sites, (coord) => coord + sigma * gauss())
      const numbers = new Uint8Array(sites.length / 3).fill(29)
      const frame = wrap_frame_coordinates(
        md_frame(positions, numbers, matrix, [true, true, true]),
      )
      const structure = (numeric ? view.update(frame) : materialize_frame(frame)).structure
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
      `Unknown bonding strategy '${strategy}', expected one of electroneg_ratio, pair_cutoffs, explicit_only`,
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
      const partner = rocksalt.sites[site_idx_2].xyz
      const pos_errs = pos_2.map((coord, axis) =>
        Math.abs(coord - (partner[axis] + shift[axis] * 5.64)),
      )
      expect(Math.max(...pos_errs)).toBeLessThan(1e-12)
      const len_errs = [bond_length - 2.82, math.euclidean_dist(pos_1, pos_2) - bond_length]
      max_len_err = Math.max(max_len_err, ...len_errs.map(Math.abs))
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
    expect(shifts.toSorted()).toEqual([`0,0,1`, `0,1,0`, `1,0,0`])
    for (const bond of bonds) {
      expect([bond.site_idx_1, bond.site_idx_2]).toEqual([0, 0])
      expect(bond.bond_length).toBeCloseTo(2 * radius, 12)
    }
    // a slab: the vacuum axis contributes no image bond
    const slab_pbc: Pbc = [true, true, false]
    expect(bonding.electroneg_ratio(simple_cubic, { pbc: slab_pbc })).toHaveLength(2)
  })

  test(`pbc bonds of a 2x2x2 supercell match the unit cell's 6 per site`, () => {
    const supercell = make_supercell(rocksalt, [2, 2, 2])
    const bonds = bonding.electroneg_ratio(supercell, { pbc: supercell.lattice.pbc })
    expect(bonds_per_site(bonds, 64)).toEqual(Array(64).fill(6))
  })
})

describe(`spatial grid coverage`, () => {
  // C/N/O grid 1.5 A apart (covalent bonding range), so repeated runs are comparable
  const make_grid = (n_atoms: number): Crystal => {
    const per_edge = Math.ceil(Math.cbrt(n_atoms))
    return make_crystal(
      per_edge * 1.5 + 1,
      Array.from({ length: n_atoms }, (_, idx) => ({
        element: ([`C`, `N`, `O`] as const)[idx % 3],
        xyz: grid_point(idx, per_edge, per_edge, 1.5),
      })),
    )
  }

  // Interleaving two structures then recomputing the first would surface any state leaking
  // between calls through module-level scratch
  test(`bonds are stable and duplicate-free across repeated + interleaved calls`, () => {
    const struct_a = make_grid(80)
    const random = make_random_structure(50)
    const [first_a, first_b, second_a] = [struct_a, random, struct_a].map((struct) =>
      bonding.electroneg_ratio(struct).map(bond_key_of),
    )
    expect(first_a.length).toBeGreaterThan(0)
    expect(second_a).toEqual(first_a)
    for (const keys of [first_a, first_b]) expect(new Set(keys).size).toBe(keys.length)
  })

  // neighbor_query sweeps only the 13 "forward" neighbor bins of each center, finding the other
  // 13 from the opposite end: a wrong offset set silently drops whole directions. A bin is one
  // C-C reach wide (1.52 A covalent sum x max_distance_ratio 2), so partners 1.62 A away per
  // axis land in neighboring bins; strength_threshold 0 keeps the diagonals.
  test(`grid scan finds partners in the own cell and all 26 neighbors`, () => {
    const center = (2 * 0.76 * 2) / 2
    const offset = center + 0.1
    // 3x3x3 block of C, minus its middle, around the center atom
    const partner_xyzs = Array.from(
      { length: 27 },
      (_, idx) => grid_point(idx, 3, 3, 1).map((step) => center + (step - 1) * offset) as Vec3,
    ).filter((_, idx) => idx !== 13)
    const structure = make_crystal(500, [
      { element: `C`, xyz: [center, center, center] },
      ...partner_xyzs.map((xyz) => ({ element: `C` as const, xyz })),
      // 27th partner stays inside the center's own cell, which the scan reaches by a
      // different route (index filter rather than a neighbor offset)
      { element: `C`, xyz: [center + 1, center, center] },
      // pad past the 50-site grid threshold with far-apart, non-bonding atoms
      ...Array.from({ length: 40 }, (_, idx) => ({
        element: `C` as const,
        xyz: [200 + idx * 20, 200, 200] as Vec3,
      })),
    ])

    // site 0 is the lowest index, so it is site_idx_1 of each of its bonds
    const bonds = bonding.electroneg_ratio(structure, { strength_threshold: 0 })
    const partners = bonds
      .filter((bond) => bond.site_idx_1 === 0)
      .map((bond) => bond.site_idx_2)
    const expected = Array.from({ length: 27 }, (_, idx) => idx + 1)
    expect(partners.toSorted((left, right) => left - right)).toEqual(expected)
  })
})

describe(`neighbor_query`, () => {
  // [center, slot] of every listed contact, center-major
  const slots = (list: neighbor_list.NeighborList) =>
    Array.from({ length: list.n_centers }, (_, center) =>
      Array.from(
        { length: list.offsets[center + 1] - list.offsets[center] },
        (_slot, rank) => [center, list.offsets[center] + rank] as const,
      ),
    ).flat()
  // contacts keyed like brute_force's, so both lists compare as sets
  const as_map = (list: neighbor_list.NeighborList) => {
    const found = new Map<string, { dist: number; delta: Vec3 }>()
    for (const [center, slot] of slots(list)) {
      const key = `${center}|${list.neighbors[slot]}|${list.images.subarray(slot * 3, slot * 3 + 3)}`
      expect(found.has(key)).toBe(false) // each (partner, image) listed once per center
      found.set(key, {
        dist: list.distances[slot],
        delta: Array.from(list.deltas.subarray(slot * 3, slot * 3 + 3)) as Vec3,
      })
    }
    return found
  }
  type QueryOptions = Parameters<typeof neighbor_list.visit_neighbor_distances>[1]
  // every streamed [center, neighbor, distance] in visit order
  const stream = (structure: AnyStructure, options: QueryOptions) => {
    const contacts: number[][] = []
    neighbor_list.visit_neighbor_distances(structure, options, (...contact) =>
      contacts.push(contact),
    )
    return contacts
  }
  // distances streamed from site 1 to site 2 and back
  const stream_pair = (structure: Crystal, options: QueryOptions) => {
    const visits: number[][] = [[], []]
    neighbor_list.visit_neighbor_distances(structure, options, (center, neighbor, dist) => {
      if (center === 1 && neighbor === 2) visits[0].push(dist)
      if (center === 2 && neighbor === 1) visits[1].push(dist)
    })
    return visits
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
    const list = neighbor_list.neighbor_query(structure, { cutoff, pbc })
    // pbc off keeps source positions; the query supplies its own PBC
    const silicon = new Uint8Array(structure.sites.length).fill(14)
    const frame = md_frame(xyz_array(structure), silicon, structure.lattice.matrix, NO_PBC)
    const numeric = new FrameView().update(frame).structure
    const site_reads = spy_site_reads(numeric)
    const original = frame.coordinates.slice()
    expect(neighbor_list.neighbor_query(numeric, { cutoff, pbc })).toEqual(list)
    const unsorted_options = { cutoff, pbc, sorted: false }
    const unsorted = neighbor_list.neighbor_query(structure, unsorted_options)
    expect(neighbor_list.neighbor_query(numeric, unsorted_options)).toEqual(unsorted)
    // sorted: false keeps the same per-center contacts, only their slot order may differ
    expect(as_map(unsorted)).toEqual(as_map(list))
    const actual = as_map(list)
    const expected = brute_force(structure, cutoff, pbc)
    expect([...actual.keys()].toSorted()).toEqual([...expected.keys()].toSorted())
    let max_dist_err = 0
    let max_delta_err = 0
    for (const [key, { dist, delta }] of expected) {
      const got = actual.get(key)
      if (!got) throw new Error(`missing ${key}`)
      max_dist_err = Math.max(max_dist_err, Math.abs(got.dist - dist))
      max_delta_err = Math.max(max_delta_err, math.euclidean_dist(got.delta, delta))
    }
    // wrapped-then-shifted vs direct arithmetic: a few ulps of ~10 A coordinates
    expect(max_dist_err).toBeLessThan(1e-11)
    expect(max_delta_err).toBeLessThan(1e-11)
    // per-center blocks are sorted ascending
    for (const [center, slot] of slots(list))
      if (slot > list.offsets[center])
        expect(list.distances[slot]).toBeGreaterThanOrEqual(list.distances[slot - 1])
    expect(list.offsets[list.n_centers]).toBe(list.neighbors.length)
    expect(list.offsets[list.n_centers]).toBe(expected.size)
    const streamed = stream(structure, { cutoff, pbc })
    expect(stream(numeric, { cutoff, pbc })).toEqual(streamed)
    for (const spy of site_reads) expect(spy).not.toHaveBeenCalled()
    expect(frame.coordinates).toStrictEqual(original)
    const listed = slots(list).map(([center, slot]) => [
      center,
      list.neighbors[slot],
      list.distances[slot],
    ])
    const by_neighbor = (first: number[], second: number[]) =>
      first[0] - second[0] || first[1] - second[1] || first[2] - second[2]
    expect(streamed.toSorted(by_neighbor)).toEqual(listed.toSorted(by_neighbor))
  })

  // Si atoms at the given Cartesian positions in a 10 A cell
  const si_cloud = (positions: Vec3[]) =>
    make_crystal(
      10,
      positions.map((xyz) => ({ element: `Si`, xyz })),
    )
  // 12 x 12 points per x layer, 0.2 A apart
  const grid_positions = (count: number, origin = 0): Vec3[] =>
    Array.from({ length: count }, (_, idx): Vec3 => [
      origin + Math.floor(idx / 144) * 0.2,
      origin + (Math.floor(idx / 12) % 12) * 0.2,
      origin + (idx % 12) * 0.2,
    ])

  // Contact distances keyed center * n_sites + neighbor, -1 for none: a dense table, since a
  // Map of the ~600k contacts of 2000 grid sites cost most of these tests' runtime
  const contact_table = (n_sites: number) => new Float64Array(n_sites * n_sites).fill(-1)

  // Max |streamed - expected| distance among Si sites at `positions`, after checking that
  // streaming visits exactly the expected contacts (a contact_table), by default the listed ones
  const stream_error = (positions: Vec3[], cutoff: number, given?: Float64Array) => {
    const structure = si_cloud(positions)
    const options = { cutoff, pbc: NO_PBC }
    const list = neighbor_list.neighbor_query(structure, options)
    const expected = given ?? contact_table(positions.length)
    let remaining = 0
    if (given) for (const dist of given) remaining += Number(dist >= 0)
    else {
      for (const [center, slot] of slots(list)) {
        const key = center * positions.length + list.neighbors[slot]
        remaining += Number(expected[key] < 0) // a repeated contact counts once
        expected[key] = list.distances[slot]
      }
      expect(remaining).toBe(list.neighbors.length)
    }
    let max_error = 0
    neighbor_list.visit_neighbor_distances(structure, options, (center, neighbor, dist) => {
      const key = center * positions.length + neighbor
      const reference = expected[key]
      if (reference < 0) throw new Error(`Unexpected contact ${center}, ${neighbor}`)
      max_error = Math.max(max_error, Math.abs(reference - dist))
      expected[key] = -1
      remaining--
    })
    expect(remaining).toBe(0)
    return max_error
  }

  test.each([1999, 2000, 2047, 2048])(`dense streaming across gates: %i sites`, (count) => {
    // past 2000 sites, the density gate: 4³ original bins hold 2047/64 < 32, 2048/64 === 32
    // cloud points each
    const density_gate = count > 2000
    const positions = density_gate
      ? Array.from({ length: count }, (_, idx): Vec3 => [
          (Math.floor(idx / 256) * 1.5) / 7,
          ((Math.floor(idx / 16) % 16) * 1.5) / 15,
          ((idx % 16) * 1.5) / 15,
        ])
      : grid_positions(count)
    expect(stream_error(positions, density_gate ? 0.5 : 1)).toBe(0)
  })

  const next_float = (value: number, direction: number): number => {
    const view = new DataView(new ArrayBuffer(8))
    view.setFloat64(0, value)
    view.setBigUint64(0, view.getBigUint64(0) + BigInt(value < 0 ? -direction : direction))
    return view.getFloat64(0)
  }

  test.each([0, -7, 17])(`dense half-bin cutoff boundaries at origin %i`, (origin) => {
    // 2,000 sites in 27 coarse bins activate the dense grid for every perturbation.
    const structure = si_cloud(grid_positions(2000, origin))
    for (const first_ulp of [-1, 0, 1]) {
      for (const second_ulp of [-1, 0, 1]) {
        structure.sites[1].xyz = [next_float(origin + 0.5, first_ulp), origin, origin]
        structure.sites[2].xyz = [next_float(origin + 1.5, second_ulp), origin, origin]
        const delta_x = structure.sites[2].xyz[0] - structure.sites[1].xyz[0]
        const dist_sq = delta_x * delta_x
        const expected = dist_sq <= 1 ? [Math.sqrt(dist_sq)] : []
        // .5 - 1 ULP and 1.5 have rounded distance 1, but unpadded half bins 0 and 3.
        expect(stream_pair(structure, { cutoff: 1, pbc: NO_PBC })).toEqual([
          expected,
          expected,
        ])
      }
    }
  })

  const pbc_masks = Array.from({ length: 8 }, (_, mask): Pbc => [
    Boolean(mask & 1),
    Boolean(mask & 2),
    Boolean(mask & 4),
  ])
  const with_axes = <T>(values: T[]) =>
    values.flatMap((value) => [0, 1, 2].map((axis) => [value, axis] as const))
  test.each(with_axes(pbc_masks))(`small cutoff boundaries, pbc %j, axis %i`, (pbc, axis) => {
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
            expect(stream_pair(structure, options)).toEqual([expected, expected])
            for (const sorted of [true, false]) {
              const list = neighbor_list.neighbor_query(structure, { ...options, sorted })
              const listed = [1, 2].map((from) =>
                slots(list)
                  .filter(
                    ([center, slot]) => center === from && list.neighbors[slot] === 3 - from,
                  )
                  .map(([, slot]) => list.distances[slot]),
              )
              expect(listed).toEqual([expected, expected])
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
    const options = { cutoff: 1, pbc: NO_PBC }
    for (const sorted of [true, false]) {
      const list = neighbor_list.neighbor_query(structure, { ...options, sorted })
      expect([...list.offsets]).toEqual([0, 0, 2, 4, 6])
      // From site 1, (+1, 0, 0) must precede the new (+1, -2, 0) contact.
      expect([...list.neighbors]).toEqual([3, 2, 1, 3, 1, 2])
      expect([...list.distances]).toEqual([Number.EPSILON / 2, 1, 1, 1, Number.EPSILON / 2, 1])
    }
    expect(stream(structure, options)).toEqual([
      [2, 3, 1],
      [3, 2, 1],
      [1, 3, Number.EPSILON / 2],
      [3, 1, Number.EPSILON / 2],
      [1, 2, 1],
      [2, 1, 1],
    ])
  })

  test.each(with_axes([3, 2000]))(`whole-bin rounding: %i sites, axis %i`, (count, axis) => {
    const positions = grid_positions(count)
    positions[1] = [0, 0, 0]
    positions[2] = [0, 0, 0]
    positions[1][axis] = 1 - Number.EPSILON / 2
    positions[2][axis] = 2
    const expected = contact_table(positions.length)
    for (let center = 0; center < positions.length; center++) {
      for (let neighbor = center + 1; neighbor < positions.length; neighbor++) {
        const delta = math.subtract(positions[neighbor], positions[center])
        const dist_sq = delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2]
        if (dist_sq > 1) continue
        expected[center * positions.length + neighbor] = Math.sqrt(dist_sq)
        expected[neighbor * positions.length + center] = Math.sqrt(dist_sq)
      }
    }
    // Rounded subtraction gives distance 1; unpadded whole bins 0 and 2 miss this pair.
    expect(expected[positions.length + 2]).toBe(1)
    expect(stream_error(positions, 1, expected)).toBe(0)
    expect(stream_error(positions, 1)).toBe(0)
  })

  test(`1-atom cell: own images are neighbors; fcc k=12 shell exact`, () => {
    const simple_cubic = make_crystal(3, [{ element: `Fe`, abc: [0, 0, 0] }])
    const list = neighbor_list.neighbor_query(simple_cubic, { cutoff: 3.01 })
    expect(Array.from(list.neighbors)).toEqual([0, 0, 0, 0, 0, 0])
    expect(Array.from(list.distances).every((dist) => Math.abs(dist - 3) < 1e-12)).toBe(true)
    const fcc_cu = make_crystal(3.6, fcc(`Cu`))
    const knn = neighbor_list.neighbor_query(fcc_cu, { k: 12 })
    expect(Array.from(knn.offsets)).toEqual([0, 12, 24, 36, 48])
    const nn_dist = 3.6 / Math.SQRT2
    for (const dist of knn.distances) expect(Math.abs(dist - nn_dist)).toBeLessThan(1e-12)
    // distances = |deltas| and deltas = partner + image·L - center
    for (const [center, slot] of slots(knn)) {
      const partner = fcc_cu.sites[knn.neighbors[slot]].xyz
      const img = knn.images.subarray(slot * 3, slot * 3 + 3)
      const delta = knn.deltas.subarray(slot * 3, slot * 3 + 3)
      const center_xyz = fcc_cu.sites[center].xyz
      const expected = partner.map((coord, axis) => coord + img[axis] * 3.6 - center_xyz[axis])
      for (const [axis, coord] of expected.entries())
        expect(delta[axis]).toBeCloseTo(coord, 12)
      expect(Math.hypot(...delta)).toBeCloseTo(knn.distances[slot], 12)
    }
  })

  // the k-search radius cap used to be four cell heights whatever the periodicity, so a chain
  // periodic along one axis stopped at 8 of its 14 nearest images (±1..±4 cells)
  const sqrt_2 = Array<number>(4).fill(Math.SQRT2)
  // oxfmt-ignore
  test.each([
    [[true, false, false], [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]],
    [[true, true, false], [1, 1, 1, 1, ...sqrt_2, 2, 2, 2, 2, Math.sqrt(5), Math.sqrt(5)]],
  ] as const)(`k=14 reaches every nearest image with pbc=%j`, (pbc, expected) => {
    const lattice = make_crystal(1, [{ element: `Fe`, abc: [0, 0, 0] }], { pbc: [...pbc] })
    const knn = neighbor_list.neighbor_query(lattice, { k: 14 })
    expect(Array.from(knn.offsets)).toEqual([0, 14])
    const distances = Array.from(knn.distances)
    for (const [idx, dist] of expected.entries()) expect(distances[idx]).toBeCloseTo(dist, 12)
  })

  // non-periodic coordinates are not wrapped into the cell, so sites 100 A apart along y
  // still need the radius to reach k of their own x images, not just the cell's extent
  test(`k=14 reaches each site's own images when sites spread far along a non-periodic axis`, () => {
    const sites = Array.from({ length: 14 }, (_, idx) => ({
      element: `Fe`,
      xyz: [0, 100 * idx, 0] as Vec3,
    }))
    const spread = make_crystal(1, sites, { pbc: [true, false, false] })
    const knn = neighbor_list.neighbor_query(spread, { k: 14 })
    expect(Array.from(knn.offsets)).toEqual(Array.from({ length: 15 }, (_, idx) => 14 * idx))
    expect(Math.max(...knn.distances)).toBeCloseTo(7, 9)
  })

  test(`molecule: no images, k capped by system size, cutoff list sorted`, () => {
    const water = make_molecule([
      [`O`, [0, 0, 0]],
      [`H`, [0.96, 0, 0]],
      [`H`, [-0.24, 0.93, 0]],
    ])
    const knn = neighbor_list.neighbor_query(water, { k: 5 })
    expect(Array.from(knn.offsets)).toEqual([0, 2, 4, 6])
    expect(Array.from(knn.images).every((shift) => shift === 0)).toBe(true)
    // the radius may grow to the cluster's bounding-box diagonal: a 100 A chain of 3 atoms
    // has a 9.3 A cube-root volume, which left every atom with 0 of its 2 partners
    const chain = make_molecule([0, 50, 100].map((x_coord) => [`O`, [x_coord, 0, 0]]))
    const chain_knn = neighbor_list.neighbor_query(chain, { k: 2 })
    expect(Array.from(chain_knn.offsets)).toEqual([0, 2, 4, 6])
    expect(Array.from(chain_knn.distances)).toEqual([50, 100, 50, 50, 50, 100])
    // two atoms at opposite box corners: their distance rounds 1 ulp above hypot(extents)
    const corners = make_molecule([
      [`O`, [2.4347959638802195, 4.836360971011535, 4.090214663192215]],
      [`O`, [5.182636053845052, -0.16486257602122423, 0.654857615062942]],
    ])
    const corners_knn = neighbor_list.neighbor_query(corners, { k: 1 })
    expect(Array.from(corners_knn.offsets)).toEqual([0, 1, 2])
    const list = neighbor_list.neighbor_query(water, { cutoff: 1.2 })
    expect(list.offsets[3]).toBeGreaterThanOrEqual(4) // two O-H contacts, both ends
    for (const [center, slot] of slots(list))
      if (slot > list.offsets[center])
        expect(list.distances[slot]).toBeGreaterThanOrEqual(list.distances[slot - 1])
  })

  test.each([
    [{ cutoff: 0 }, /cutoff must be a positive finite number/],
    [{ cutoff: -1 }, /cutoff must be a positive finite number/],
    [{ cutoff: Number.NaN }, /cutoff must be a positive finite number/],
    [{ k: 0 }, /k must be a positive integer/],
    [{ k: 1.5 }, /k must be a positive integer/],
  ])(`rejects %j`, (options, message) => {
    expect(() => neighbor_list.neighbor_query(triclinic, options)).toThrow(message)
    if (!(`cutoff` in options)) return
    const visit = () => neighbor_list.visit_neighbor_distances(triclinic, options, () => {})
    expect(visit).toThrow(message)
  })

  test(`rejects a degenerate lattice and absurd cutoffs, not in-band bond perception`, () => {
    // oxfmt-ignore
    const flat = make_crystal([[3, 0, 0], [0, 3, 0], [3, 3, 0]], [{ element: `C`, abc: [0, 0, 0] }])
    expect(() => neighbor_list.neighbor_query(flat, { cutoff: 2 })).toThrow(/degenerate/)
    // no periodic axis: the lattice is never used, so a singular one is fine
    const flat_finite = neighbor_list.neighbor_query(flat, { cutoff: 2, pbc: NO_PBC })
    expect(flat_finite.neighbors).toHaveLength(0)
    // 40 cells of images along every axis: 81^3 * 200 = 106M positions
    const big = make_random_structure(200)
    expect(() => neighbor_list.neighbor_query(big, { cutoff: 400 })).toThrow(
      /reaches 40, 40, 40 cells .* needs \d+ periodic images of 200 sites; refusing to build more than 4000000 positions, a cutoff this far past the cell is almost always a unit mix-up/,
    )
    // The cloud is small but every one of 4600 sites sees every other: 10.6M pairs, more
    // than the lists could hold in memory. Refused mid-sweep rather than allocated.
    const dense = make_molecule(hydrogen_grid(0.5))
    expect(() => neighbor_list.neighbor_query(dense, { cutoff: 100 })).toThrow(
      /more than 10,000,000 pairs within 100 A of 4600 sites/,
    )
    // BondSearch's skin-widened band keeps every pair of a grid inside 0.2 A (the plain band
    // drops them all under min_bond_dist): refused the same way, no silent plain fallback
    const blob = make_molecule(hydrogen_grid(0.012))
    const search_blob = () => new bonding.BondSearch().compute_columns(blob)
    expect(search_blob).toThrow(/more than 10,000,000/)
    // Streaming has no pair storage to exhaust, so this cloud can be processed in full.
    let n_visits = 0
    neighbor_list.visit_neighbor_distances(dense, { cutoff: 100 }, () => n_visits++)
    expect(n_visits).toBe(4600 * 4599)
    // Cs-Cs reaches 39 A under these options, putting all 10.6M grid pairs inside the longest
    // reach, but only ~60k H-H pairs lie in their own band: bond perception stores just those
    const options = { metal_metal_penalty: 1e100, max_distance_ratio: 100 }
    const cesium = [40, 45].map((x_coord): [string, Vec3] => [`Cs`, [x_coord, 0, 0]])
    const mixed = make_molecule([...hydrogen_grid(0.5), ...cesium])
    const bonds = sort_bonds(bonding.electroneg_ratio(mixed, options))
    const hydrogen_bonds = sort_bonds(bonding.electroneg_ratio(dense, options))
    expect(hydrogen_bonds.length).toBeGreaterThan(4600 * 2)
    expect(bonds.slice(0, -1)).toEqual(hydrogen_bonds)
    expect(bonds.at(-1)).toMatchObject({ site_idx_1: 4600, site_idx_2: 4601, bond_length: 5 })
    // Inherently heavy: the refusals must actually cross the fixed 10M-pair limit (~160 MB of
    // pair buffers) and the streaming check visits 21M pairs: ~0.6 s alone but 5-7 s under a
    // loaded full-suite run
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
    const list = neighbor_list.neighbor_query(structure, { cutoff: 15 })
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
    // oxfmt-ignore
    const atoms: [string, Vec3][] = [
      [`O`, [0, 0, 0]], [`H`, [0.96, 0, 0]], [`H`, [-0.24, 0.93, 0]], [`O`, [3.1, 0.2, 0.1]], [`H`, [3.9, 0.7, 0.1]],
    ]
    const water = make_molecule(
      atoms.map(([element, xyz]) => [element, math.add(xyz, offset)]),
    )
    const found = as_map(neighbor_list.neighbor_query(water, { cutoff: 1 }))
    const expected = brute_force(water, 1, NO_PBC)
    expect(expected.size).toBe(6) // two O-H per water, both directions
    expect([...found.keys()].toSorted()).toEqual([...expected.keys()].toSorted())
    for (const [key, { dist }] of expected) expect(found.get(key)?.dist).toBeCloseTo(dist, 12)
  })

  // One ejected atom (an MD blow-up frame) stretches the bounding box along one axis. Cube-root
  // widening of a cubic bin left ~span/bin bins on it (5e7 at 1e11 A, tens of GB at 1e14 A);
  // widening a cubic bin until the grid fits put the cluster in one bin, an O(n^2) sweep (timed
  // in perf-baselines.test.ts; the memory one fails allocation here). Only the stretched axis may
  // widen.
  test.each([
    [1e6, 10],
    [1e11, 10],
    [1e14, 10],
    [1e9, 34],
  ])(`a flyaway atom at %s A keeps the grid bounded (%s^3 cluster)`, (far, n_side) => {
    const n_cluster = n_side ** 3
    const xyzs = Array.from({ length: n_cluster }, (_, idx) =>
      grid_point(idx, n_side, n_side, 1.1),
    )
    xyzs.push([far, 0, 0])
    const cloud = make_molecule(xyzs.map((xyz) => [`C`, xyz]))
    const list = neighbor_list.neighbor_query(cloud, { cutoff: 1.2 })
    // cubic grid at 1.1 A: 3 n_side^2 (n_side - 1) axis-adjacent pairs, each listed from both ends
    expect(list.neighbors).toHaveLength(6 * n_side ** 2 * (n_side - 1))
    expect(
      list.offsets[n_cluster + 1] - list.offsets[n_cluster],
      `the flyaway atom has no contacts`,
    ).toBe(0)
  })

  // the same contacts as sorted: covered by the brute-force comparison above
  test(`sorted: false preserves slot discovery order`, () => {
    // Bin-major traversal is reserved for streamed histograms. Materialized contacts keep
    // their slot order because bond consumers deduplicate geometric vertices in that order.
    const interleaved = make_crystal(
      10,
      [3, 0, 1, 2, 4, 5].map((coord) => ({ element: `Si`, xyz: [coord, 0, 0] as Vec3 })),
    )
    const list = neighbor_list.neighbor_query(interleaved, {
      cutoff: 2.1,
      sorted: false,
      pbc: NO_PBC,
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
    expect(() => neighbor_list.neighbor_query(crystal, { cutoff: 3 })).toThrow(/non-finite/)
    const molecule = {
      sites: crystal.sites.map((site) => ({ ...site, abc: [0, 0, 0] as Vec3 })),
    }
    expect(() => neighbor_list.neighbor_query(molecule, { cutoff: 3 })).toThrow(
      `neighbor_query: site 2 has a non-finite position (${bad}, 2, 2)`,
    )
  })

  test.each([
    [`missing`, undefined],
    [`non-boolean`, [1, 0, 1]],
  ])(`%s lattice.pbc is malformed input, not a finite cluster`, (_desc, pbc) => {
    // pbc is required on LatticeType; hand-built props can omit it, and the analyses used to
    // fall through to a finite bonding pass that under-counted every coordination number
    const crystal = make_crystal(4, [{ element: `Na`, abc: [0, 0, 0] }])
    const lattice = { ...crystal.lattice, pbc } as unknown as typeof crystal.lattice
    const malformed = { ...crystal, lattice }
    expect(() => neighbor_list.neighbor_query(malformed, { cutoff: 3 })).toThrow(
      /lattice\.pbc/,
    )
    expect(() => compute_coordination_nums(malformed)).toThrow(/lattice\.pbc/)
    // BondSearch's finite path reads lattice.pbc for its periodic candidate superset
    expect(() => new bonding.BondSearch().compute_columns(malformed)).toThrow(/lattice\.pbc/)
    // an explicit override still works on the same object
    expect(
      neighbor_list.neighbor_query(malformed, { cutoff: 3, pbc: [true, true, true] })
        .n_centers,
    ).toBe(1)
  })
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
