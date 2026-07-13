import type { BondOrder, BondPair, ElementSymbol, Vec2, Vec3 } from '$lib'
import type { Crystal, StructureBond } from '$lib/structure'
import type { BondEditState, BondingAlgo, BondingStrategy } from '$lib/structure/bonding'
import * as bonding from '$lib/structure/bonding'
import { get_pbc_image_sites } from '$lib/structure/pbc'
import { test_molecules } from '$site/molecules'
import process from 'node:process'
import { describe, expect, test, vi } from 'vitest'
import { create_test_structure, make_crystal } from '../setup'

const measure_performance = (func: () => void): number => {
  const start = performance.now()
  func()
  return performance.now() - start
}

// Simple helper for tests that only need xyz coordinates
const get_test_structure = (sites: { xyz: Vec3; element?: ElementSymbol }[]): Crystal =>
  make_crystal(
    1, // 1x1x1 cubic lattice
    sites.map(({ xyz, element = `C` }) => ({ element, xyz })),
  )

const make_random_structure = (n_atoms: number): Crystal => {
  const elements = [`C`, `H`, `N`, `O`, `S`, `Fe`, `Na`, `Cl`]
  return make_crystal(
    10,
    Array.from({ length: n_atoms }, (_, idx) => ({
      element: elements[idx % elements.length],
      xyz: [Math.random() * 10, Math.random() * 10, Math.random() * 10] as Vec3,
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

describe(`Bonding Algorithms`, () => {
  const algorithms: [BondingAlgo, BondingStrategy, Vec2[]][] = [
    [
      bonding.electroneg_ratio,
      `electroneg_ratio`,
      [
        [50, 60],
        [200, 200],
        [1000, 800],
      ],
    ],
    [
      bonding.solid_angle,
      `solid_angle`,
      [
        [50, 100],
        [200, 200],
        [1000, 800],
      ],
    ],
  ]

  test.each(algorithms)(`$name performance benchmarks`, (_func, name, times) => {
    for (const [atom_count, max_time] of times) {
      const structure = make_random_structure(atom_count)
      const func = bonding.BONDING_STRATEGIES[name]
      func(structure) // Warm-up
      const measurements = Array.from({ length: 3 }, () =>
        measure_performance(() => func(structure)),
      )
      const avg_time = measurements.reduce((sum, val) => sum + val, 0) / measurements.length
      const is_ci =
        typeof process !== `undefined` && [`true`, `1`].includes(process.env?.CI ?? ``)
      const max_allowed = max_time * (is_ci ? 5 : 2)

      expect(
        avg_time,
        `${name} with ${atom_count} atoms: ${avg_time.toFixed(1)}ms > ${max_allowed}ms`,
      ).toBeLessThanOrEqual(max_allowed)
    }
  })

  test.each(algorithms)(`$name returns valid BondPair format`, (func) => {
    const structure = get_test_structure([
      { xyz: [0, 0, 0], element: `Fe` },
      { xyz: [2, 0, 0], element: `O` },
      { xyz: [4, 0, 0], element: `C` },
    ])
    const bonds = func(structure)
    for (const bond of bonds) {
      expect(bond.pos_1).toHaveLength(3)
      expect(bond.pos_2).toHaveLength(3)
      expect(bond.site_idx_1).toBeTypeOf(`number`)
      expect(bond.site_idx_2).toBeTypeOf(`number`)
      expect(bond.bond_length).toBeGreaterThan(0)
      expect(bond.strength).toBeGreaterThanOrEqual(0)
      expect(bond.strength).toBeLessThanOrEqual(2.0)
      // positions correspond to their site indices and a 4x4 transform is emitted
      expect(bond.pos_1).toEqual(structure.sites[bond.site_idx_1].xyz)
      expect(bond.pos_2).toEqual(structure.sites[bond.site_idx_2].xyz)
      expect(bond.transform_matrix).toHaveLength(16)
    }
  })

  test.each(algorithms)(`$name generates unique bonds`, (func) => {
    const bonds = func(make_random_structure(50))
    const bond_pairs = bonds.map(
      (bond) =>
        `${Math.min(bond.site_idx_1, bond.site_idx_2)}-${Math.max(
          bond.site_idx_1,
          bond.site_idx_2,
        )}`,
    )
    expect(new Set(bond_pairs).size).toBe(bonds.length)
  })

  test.each(algorithms)(`$name handles edge cases`, (func) => {
    expect(func(get_test_structure([]))).toHaveLength(0)
    expect(func(get_test_structure([{ xyz: [0, 0, 0] }]))).toHaveLength(0)
    expect(
      func(
        get_test_structure([
          // @ts-expect-error unknown element symbol
          { xyz: [0, 0, 0], element: `Xx` },
          // @ts-expect-error unknown element symbol
          { xyz: [1, 0, 0], element: `Yy` },
        ]),
      ),
    ).toBeDefined()
  })

  test.each(algorithms)(`$name handles distant atoms`, (func) => {
    const structure = create_test_structure(
      [
        [20, 0, 0],
        [0, 20, 0],
        [0, 0, 20],
      ],
      [`H`, `H`],
      [
        [0, 0, 0],
        [10, 10, 10],
      ],
    )
    const bonds = func(structure)
    bonds.forEach((bond) => expect(bond.bond_length).toBeGreaterThan(5))
  })
})

describe(`Explicit Bond Metadata`, () => {
  test.each(Object.values(bonding.BONDING_STRATEGIES))(
    `maps structure.properties.bonds onto computed and missing bonds`,
    (strategy) => {
      const structure = get_test_structure([
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
      const computed_bond = bonds.find(
        (bond) => bonding.get_bond_key(bond.site_idx_1, bond.site_idx_2) === `0-1`,
      )
      const explicit_only_bond = bonds.find(
        (bond) => bonding.get_bond_key(bond.site_idx_1, bond.site_idx_2) === `0-2`,
      )

      expect(computed_bond?.bond_order).toBe(2)
      expect(explicit_only_bond?.bond_order).toBe(3)
      expect(explicit_only_bond?.site_idx_1).toBe(0)
      expect(explicit_only_bond?.site_idx_2).toBe(2)
      expect(explicit_only_bond?.bond_length).toBeCloseTo(5)
    },
  )

  test(`ignores invalid explicit bond metadata with warnings`, () => {
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => undefined)
    const structure = get_test_structure([
      { xyz: [0, 0, 0], element: `C` },
      { xyz: [1.4, 0, 0], element: `C` },
    ])
    const raw_bonds = [
      { site_idx_1: 0, site_idx_2: 1, order: `aromatic` },
      { site_idx_1: 0.5, site_idx_2: 1, order: 2 },
      { site_idx_1: 0, site_idx_2: 8, order: 2 },
      { site_idx_1: 1, site_idx_2: 1, order: 1 },
      { site_idx_1: 0, site_idx_2: 1, order: 4 },
      { site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0.5, 0] },
      null,
    ]
    structure.properties = { bonds: raw_bonds as unknown as StructureBond[] }

    try {
      expect(bonding.get_explicit_bond_metadata(structure)).toEqual([
        { site_idx_1: 0, site_idx_2: 1, order: `aromatic` },
      ])
      expect(warn_spy).toHaveBeenCalledTimes(6)
    } finally {
      warn_spy.mockRestore()
    }
  })

  test(`warns before duplicate explicit bonds overwrite earlier entries`, () => {
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => undefined)
    const structure = get_test_structure([
      { xyz: [0, 0, 0], element: `C` },
      { xyz: [1.4, 0, 0], element: `C` },
    ])
    structure.properties = {
      bonds: [
        { site_idx_1: 0, site_idx_2: 1, order: 1 },
        { site_idx_1: 1, site_idx_2: 0, order: 2 },
      ],
    }

    try {
      expect(bonding.get_explicit_bond_metadata(structure)).toEqual([
        { site_idx_1: 0, site_idx_2: 1, order: 2 },
      ])
      expect(warn_spy).toHaveBeenCalledWith(
        expect.stringContaining(
          `Duplicate explicit bond definition at index 1 for site indices 1, 0 ` +
            `with order 2; will overwrite the previous entry`,
        ),
      )
    } finally {
      warn_spy.mockRestore()
    }
  })

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

  test.each([
    {
      desc: `lets overrides win over additions`,
      base: [],
      added: [{ site_idx_1: 0, site_idx_2: 1, order: 1 }],
      removed: [],
      overrides: [{ site_idx_1: 0, site_idx_2: 1, order: 3 }],
      expected: [{ site_idx_1: 0, site_idx_2: 1, order: 3 }],
    },
    {
      desc: `lets removals win over stale additions and overrides`,
      base: [{ site_idx_1: 0, site_idx_2: 1, order: 1 }],
      added: [{ site_idx_1: 0, site_idx_2: 1, order: 1 }],
      removed: [{ site_idx_1: 1, site_idx_2: 0, order: 1 }],
      overrides: [{ site_idx_1: 0, site_idx_2: 1, order: 3 }],
      expected: [],
      visible: false,
    },
    {
      desc: `normalizes reversed bond records`,
      base: [],
      added: [{ site_idx_1: 3, site_idx_2: 1, order: 2 }],
      removed: [],
      overrides: [],
      expected: [{ site_idx_1: 1, site_idx_2: 3, order: 2 }],
    },
  ] satisfies {
    desc: string
    base: StructureBond[]
    added: StructureBond[]
    removed: StructureBond[]
    overrides: StructureBond[]
    expected: StructureBond[]
    visible?: boolean
  }[])(`merge_bond_edits $desc`, ({ base, added, removed, overrides, expected, visible }) => {
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

  test(`adds, reports, and restores bonds without toggling visible bonds`, () => {
    const add_result = bonding.add_or_restore_bond(
      empty_bond_edit_state(),
      { site_idx_1: 2, site_idx_2: 0 },
      calculated_bonds(),
      2,
    )
    expect(add_result).toMatchObject({ action: `added`, changed: true })
    expect(add_result.state.added_bonds).toEqual([{ site_idx_1: 0, site_idx_2: 2, order: 2 }])

    const visible_result = bonding.add_or_restore_bond(
      add_result.state,
      { site_idx_1: 0, site_idx_2: 1 },
      calculated_bonds(),
      3,
    )
    expect(visible_result).toMatchObject({ action: `already-visible`, changed: false })
    expect(visible_result.state.removed_bonds).toEqual([])

    const removed_state: BondEditState = {
      ...empty_bond_edit_state(),
      removed_bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 1 }],
    }
    const restore_result = bonding.add_or_restore_bond(
      removed_state,
      { site_idx_1: 1, site_idx_2: 0 },
      calculated_bonds(),
      1,
    )
    expect(restore_result).toMatchObject({ action: `restored`, changed: true })
    expect(restore_result.state.removed_bonds).toEqual([])
    expect(restore_result.state.bond_order_overrides).toEqual([])

    const restore_with_order_result = bonding.add_or_restore_bond(
      removed_state,
      { site_idx_1: 1, site_idx_2: 0 },
      calculated_bonds(),
      2,
    )
    expect(restore_with_order_result).toMatchObject({ action: `restored`, changed: true })
    expect(restore_with_order_result.state.removed_bonds).toEqual([])
    expect(restore_with_order_result.state.bond_order_overrides).toEqual([
      { site_idx_1: 0, site_idx_2: 1, order: 2 },
    ])
  })

  test(`deletes calculated and manually added bonds explicitly`, () => {
    const calculated_result = bonding.delete_bond(
      empty_bond_edit_state(),
      { site_idx_1: 1, site_idx_2: 0 },
      calculated_bonds(),
    )
    expect(calculated_result).toMatchObject({
      action: `deleted-calculated`,
      changed: true,
    })
    expect(calculated_result.state.removed_bonds).toEqual([
      { site_idx_1: 0, site_idx_2: 1, order: 1 },
    ])

    const added_state: BondEditState = {
      ...empty_bond_edit_state(),
      added_bonds: [{ site_idx_1: 2, site_idx_2: 3, order: 3 }],
    }
    const added_result = bonding.delete_bond(
      added_state,
      { site_idx_1: 3, site_idx_2: 2 },
      calculated_bonds(),
    )
    expect(added_result).toMatchObject({ action: `deleted-added`, changed: true })
    expect(added_result.state.added_bonds).toEqual([])

    const missing_result = bonding.delete_bond(
      empty_bond_edit_state(),
      { site_idx_1: 4, site_idx_2: 5 },
      calculated_bonds(),
    )
    expect(missing_result).toMatchObject({ action: `not-visible`, changed: false })
  })

  test.each<{ selected_order: BondOrder; expected_overrides: StructureBond[] }>([
    { selected_order: 2, expected_overrides: [] },
    {
      selected_order: 1,
      expected_overrides: [{ site_idx_1: 0, site_idx_2: 1, order: 1 }],
    },
  ])(
    `restores deleted order-2 calculated bonds as $selected_order`,
    ({ selected_order, expected_overrides }) => {
      const deleted_result = bonding.delete_bond(
        empty_bond_edit_state(),
        { site_idx_1: 1, site_idx_2: 0 },
        calculated_bonds(2),
      )

      expect(deleted_result.state.removed_bonds).toEqual([
        { site_idx_1: 0, site_idx_2: 1, order: 2 },
      ])

      const restored_result = bonding.add_or_restore_bond(
        deleted_result.state,
        { site_idx_1: 0, site_idx_2: 1 },
        calculated_bonds(2),
        selected_order,
      )

      expect(restored_result.state.bond_order_overrides).toEqual(expected_overrides)
    },
  )

  test(`restoring a deleted bond clears stale same-key edits`, () => {
    const stale_state: BondEditState = {
      added_bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 1 }],
      removed_bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 2 }],
      bond_order_overrides: [{ site_idx_1: 0, site_idx_2: 1, order: 3 }],
    }

    const restored_result = bonding.add_or_restore_bond(
      stale_state,
      { site_idx_1: 1, site_idx_2: 0 },
      calculated_bonds(2),
      2,
    )

    expect(restored_result.state).toEqual({
      added_bonds: [],
      removed_bonds: [],
      bond_order_overrides: [],
    })
  })

  test(`sets bond order for calculated, added, and removed bonds`, () => {
    const calculated_result = bonding.set_bond_order(
      empty_bond_edit_state(),
      { site_idx_1: 1, site_idx_2: 0 },
      calculated_bonds(),
      3,
    )
    expect(calculated_result).toMatchObject({
      action: `ordered-calculated`,
      changed: true,
    })
    expect(calculated_result.state.bond_order_overrides).toEqual([
      { site_idx_1: 0, site_idx_2: 1, order: 3 },
    ])

    const removed_state: BondEditState = {
      ...empty_bond_edit_state(),
      removed_bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 1 }],
    }
    const restored_order_result = bonding.set_bond_order(
      removed_state,
      { site_idx_1: 0, site_idx_2: 1 },
      calculated_bonds(),
      2,
    )
    expect(restored_order_result.state.removed_bonds).toEqual([])
    expect(restored_order_result.state.bond_order_overrides).toEqual([
      { site_idx_1: 0, site_idx_2: 1, order: 2 },
    ])

    const added_result = bonding.set_bond_order(
      empty_bond_edit_state(),
      { site_idx_1: 2, site_idx_2: 3 },
      calculated_bonds(),
      `aromatic`,
    )
    expect(added_result).toMatchObject({ action: `ordered-added`, changed: true })
    expect(added_result.state.added_bonds).toEqual([
      { site_idx_1: 2, site_idx_2: 3, order: `aromatic` },
    ])
  })

  test.each([
    { state: empty_bond_edit_state(), expected_changed: false },
    {
      state: {
        ...empty_bond_edit_state(),
        bond_order_overrides: [{ site_idx_1: 0, site_idx_2: 1, order: 3 }],
      } satisfies BondEditState,
      expected_changed: true,
    },
  ])(`set_bond_order skips redundant calculated overrides`, ({ state, expected_changed }) => {
    const result = bonding.set_bond_order(
      state,
      { site_idx_1: 1, site_idx_2: 0 },
      calculated_bonds(2),
      2,
    )

    expect(result).toMatchObject({
      action: `ordered-calculated`,
      changed: expected_changed,
    })
    expect(result.state.bond_order_overrides).toEqual([])
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
    const structure = make_crystal(10, [
      [`C`, [0.95, 0.5, 0.5]],
      [`O`, [0.04, 0.5, 0.5]],
    ])
    const structure_with_images = get_pbc_image_sites(structure)
    const image_site_idx = structure_with_images.sites.findIndex(
      (site) => site.properties?.orig_site_idx === 1 && site.abc[0] > 1,
    )

    expect(image_site_idx).toBeGreaterThan(1)
    expect(
      bonding.canonicalize_bond_target(
        { site_idx_1: 0, site_idx_2: image_site_idx },
        structure_with_images.sites,
      ),
    ).toEqual({ site_idx_1: 0, site_idx_2: 1, cell_shift: [1, 0, 0] })
    expect(
      bonding.canonicalize_bond_target(
        { site_idx_1: image_site_idx, site_idx_2: 0 },
        structure_with_images.sites,
      ),
    ).toEqual({ site_idx_1: 0, site_idx_2: 1, cell_shift: [1, 0, 0] })
  })

  test(`parses and renders explicit crystal bonds with cell shifts`, () => {
    const structure = make_crystal(10, [
      [`C`, [0.95, 0.5, 0.5]],
      [`O`, [0.05, 0.5, 0.5]],
    ])
    structure.properties = {
      bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0, 0] }],
    }

    const explicit_bonds = bonding.get_explicit_bond_metadata(structure)
    expect(explicit_bonds).toEqual([
      { site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0, 0] },
    ])
    expect(bonding.get_bond_key(0, 1, [1, 0, 0])).toBe(`0-1@1,0,0`)

    const bond = bonding.structure_bond_to_bond_pair(structure, explicit_bonds[0])

    expect(bond.pos_1).toEqual([9.5, 5, 5])
    expect(bond.pos_2).toEqual([10.5, 5, 5])
    expect(bond.bond_length).toBeCloseTo(1)
    expect(bond.bond_order).toBe(2)
    expect(bond.cell_shift).toEqual([1, 0, 0])
    expect(bonding.apply_explicit_bond_metadata(structure, [])).toHaveLength(1)
  })

  test(`keeps explicit periodic bonds with matching site indices distinct`, () => {
    const structure = make_crystal(10, [
      [`C`, [0.95, 0.5, 0.5]],
      [`O`, [0.05, 0.5, 0.5]],
    ])
    structure.properties = {
      bonds: [
        { site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0, 0] },
        { site_idx_1: 0, site_idx_2: 1, order: 3, cell_shift: [-1, 0, 0] },
      ],
    }

    const bonds = bonding.apply_explicit_bond_metadata(structure, [])
    const bonds_by_key = new Map(
      bonds.map((bond) => [
        bonding.get_bond_key(bond.site_idx_1, bond.site_idx_2, bond.cell_shift),
        bond,
      ]),
    )

    expect([...bonds_by_key.keys()].sort()).toEqual([`0-1@-1,0,0`, `0-1@1,0,0`])
    expect(bonds_by_key.get(`0-1@1,0,0`)?.bond_order).toBe(2)
    expect(bonds_by_key.get(`0-1@-1,0,0`)?.bond_order).toBe(3)
  })

  test(`keeps explicit periodic self-bonds distinct from zero-shift self-bonds`, () => {
    const structure = make_crystal(10, [[`C`, [0.5, 0.5, 0.5]]])
    structure.properties = {
      bonds: [
        { site_idx_1: 0, site_idx_2: 0, order: 1 },
        { site_idx_1: 0, site_idx_2: 0, order: 2, cell_shift: [1, 0, 0] },
        { site_idx_1: 0, site_idx_2: 0, order: 3, cell_shift: [-1, 0, 0] },
      ],
    }
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => undefined)

    try {
      expect(bonding.get_explicit_bond_metadata(structure)).toEqual([
        { site_idx_1: 0, site_idx_2: 0, order: 3, cell_shift: [1, 0, 0] },
      ])
      expect(warn_spy).toHaveBeenCalledWith(
        expect.stringContaining(`Ignoring invalid explicit bond at index 0`),
      )
    } finally {
      warn_spy.mockRestore()
    }
  })

  test.each([
    { order: undefined, expected_count: 1 },
    { order: 1 as const, expected_count: 1 },
    { order: 2 as const, expected_count: 2 },
    { order: 3 as const, expected_count: 3 },
    { order: 1.5 as const, expected_count: 2 },
    { order: `aromatic` as const, expected_count: 2 },
  ])(
    `renders $order bond order as $expected_count cylinder matrices`,
    ({ order, expected_count }: { order?: BondOrder; expected_count: number }) => {
      const bond: BondPair = {
        pos_1: [0, 0, 0],
        pos_2: [1, 0, 0],
        site_idx_1: 0,
        site_idx_2: 1,
        bond_length: 1,
        strength: 1,
        ...(order === undefined ? {} : { bond_order: order }),
        transform_matrix: bonding.compute_bond_transform([0, 0, 0], [1, 0, 0]),
      }

      const matrices = bonding.get_bond_render_matrices(bond, 0.1)
      expect(matrices).toHaveLength(expected_count)
      if (expected_count > 1) {
        const offsets = matrices.map((matrix) => `${matrix[12]},${matrix[13]},${matrix[14]}`)
        expect(new Set(offsets).size).toBeGreaterThan(1)
      }
    },
  )
})

describe(`Molecular Bonding Analysis`, () => {
  test.each([
    [`water`, test_molecules.water, 2, 0.8, 1.2],
    [`methane`, test_molecules.methane, 4, 0.9, 1.3],
  ])(`%s has expected bonds`, (_name, molecule, expected_bonds, min_dist, max_dist) => {
    const bonds = bonding.electroneg_ratio(molecule)
    expect(bonds.length).toBeGreaterThanOrEqual(expected_bonds)
    bonds.forEach((bond) => {
      expect(bond.bond_length).toBeGreaterThan(min_dist)
      expect(bond.bond_length).toBeLessThan(max_dist)
    })
  })

  test(`benzene has aromatic C-C bonds`, () => {
    // Lower strength threshold to ensure C-C bonds are captured alongside C-H bonds
    const bonds = bonding.electroneg_ratio(test_molecules.benzene, {
      max_distance_ratio: 2,
      strength_threshold: 0.2,
      same_species_penalty: 0.8,
    })
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

  test(`ethanol has multiple bond types`, () => {
    // Lower strength threshold to ensure all bond types are captured
    const bonds = bonding.electroneg_ratio(test_molecules.ethanol, {
      max_distance_ratio: 2,
      strength_threshold: 0.2,
      same_species_penalty: 0.8,
    })
    expect(bonds.length).toBeGreaterThanOrEqual(6)
    const distances = bonds.map((bond) => bond.bond_length)
    expect(Math.min(...distances)).toBeGreaterThan(0.8)
    expect(Math.max(...distances)).toBeLessThan(2.0)
  })
})

describe(`Crystal Structure Bonding`, () => {
  test(`simple cubic lattice`, () => {
    const structure = create_test_structure(
      [
        [3, 0, 0],
        [0, 3, 0],
        [0, 0, 3],
      ],
      [`Na`, `Cl`],
      [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
      ],
    )
    const bonds = bonding.electroneg_ratio(structure, { max_distance_ratio: 3 })
    expect(bonds.length).toBeGreaterThan(0)
  })

  test(`diamond structure`, () => {
    const structure = create_test_structure(
      [
        [3.57, 0, 0],
        [0, 3.57, 0],
        [0, 0, 3.57],
      ],
      [`C`, `C`],
      [
        [0, 0, 0],
        [0.25, 0.25, 0.25],
      ],
    )
    const bonds = bonding.electroneg_ratio(structure, { max_distance_ratio: 3 })
    expect(bonds.length).toBeGreaterThan(0)
    bonds.forEach((bond) => {
      expect(bond.bond_length).toBeGreaterThan(1.2)
      expect(bond.bond_length).toBeLessThan(2.5)
    })
  })
})

describe(`Electronegativity-Based Bonding`, () => {
  test(`bond type identification`, () => {
    const na_cl = get_test_structure([
      { xyz: [0, 0, 0], element: `Na` },
      { xyz: [2.3, 0, 0], element: `Cl` },
    ])
    const c_c = get_test_structure([
      { xyz: [0, 0, 0], element: `C` },
      { xyz: [1.5, 0, 0], element: `C` },
    ])
    const ionic = bonding.electroneg_ratio(na_cl, { max_distance_ratio: 2.5 })
    const covalent = bonding.electroneg_ratio(c_c, { max_distance_ratio: 2.5 })
    expect(ionic).toHaveLength(1)
    expect(covalent).toHaveLength(1)
    expect(ionic[0].bond_length).toBeCloseTo(2.3, 1)
    expect(covalent[0].bond_length).toBeCloseTo(1.5, 1)
  })

  test(`parameter sensitivity`, () => {
    const structure = get_test_structure([
      { xyz: [0, 0, 0], element: `Fe` },
      { xyz: [2.5, 0, 0], element: `Fe` },
      { xyz: [1.25, 2.2, 0], element: `O` },
    ])
    const lenient = bonding.electroneg_ratio(structure, {
      metal_metal_penalty: 0.8,
      metal_nonmetal_bonus: 1.2,
    })
    const strict = bonding.electroneg_ratio(structure, {
      metal_metal_penalty: 0.1,
      metal_nonmetal_bonus: 2.5,
    })
    expect(lenient).not.toHaveLength(strict.length)
  })

  test(`distance constraints`, () => {
    const structure = get_test_structure([
      { xyz: [0, 0, 0], element: `Na` },
      { xyz: [10, 0, 0], element: `Cl` },
    ])
    expect(bonding.electroneg_ratio(structure, { max_distance_ratio: 5 })).toHaveLength(0)
  })
})

describe(`Algorithm Comparison`, () => {
  test(`simple bonds`, () => {
    const structure = get_test_structure([
      { xyz: [0, 0, 0], element: `C` },
      { xyz: [1.5, 0, 0], element: `O` },
    ])
    expect(bonding.solid_angle(structure)).toHaveLength(1)
    expect(bonding.electroneg_ratio(structure)).toHaveLength(1)
  })
})

test(`electroneg_ratio treats original and image atoms symmetrically`, () => {
  // Regression: image atoms used to get fewer bonds than their originals because
  // closest-neighbor penalties were applied in processing order — an image inherited
  // its original's `closest` distance and penalized bonds the original had accepted.

  // Two copies of identical local geometry (a Na with a "Long" 3.0 A and a "Short" 2.0 A Cl
  // neighbor): sites 0-2 are originals, 3-5 are images (orig_site_idx 0,1,2) placed 100 A away.
  const structure = make_crystal(1000, [
    { element: `Na`, xyz: [0, 0, 0], properties: { orig_site_idx: 0 } },
    { element: `Cl`, xyz: [3, 0, 0], properties: { orig_site_idx: 1 } }, // Long (3.0 A)
    { element: `Cl`, xyz: [0, 2, 0], properties: { orig_site_idx: 2 } }, // Short (2.0 A)
    { element: `Na`, xyz: [100, 0, 0], properties: { orig_site_idx: 0 } },
    { element: `Cl`, xyz: [103, 0, 0], properties: { orig_site_idx: 1 } }, // Long image
    { element: `Cl`, xyz: [100, 2, 0], properties: { orig_site_idx: 2 } }, // Short image
  ])

  // Threshold tuned so the Long-bond penalty (applied once closest=2.0 is known) drops it below
  // threshold. Pre-fix the original kept 2 bonds (it saw Long before Short set closest) while the
  // image kept 1; the fix gathers all closest distances before penalizing, so both bond the same.
  const bonds = bonding.electroneg_ratio(structure, { strength_threshold: 0.6 })
  const bond_count = (anchor: number) =>
    bonds.filter((bond) => bond.site_idx_1 === anchor || bond.site_idx_2 === anchor).length

  expect(bond_count(3)).toBe(bond_count(0)) // image (idx 3) bonds identically to original (idx 0)
})
test(`electroneg_ratio preserves longer C-C bonds in presence of shorter C-H bonds`, () => {
  // Benzene-like fragment: in raw distance C-H (1.09 Å) < C-C (1.40 Å), so a raw-distance
  // closest-neighbor penalty would penalize C-C (1.40/1.09 = 1.28). Normalized by
  // covalent-radii sums, C-C (1.40/1.52 = 0.92) is closer than C-H (1.09/1.07 = 1.02),
  // so both bonds survive.
  const structure = make_crystal(10, [
    { element: `C`, xyz: [0, 0, 0] }, // central C
    { element: `H`, xyz: [1.09, 0, 0] }, // C-H at 1.09 A (shorter raw distance)
    { element: `C`, xyz: [0, 1.4, 0] }, // C-C at 1.40 A (closer in normalized space)
  ])

  const bonds = bonding.electroneg_ratio(structure)

  // Both C1-H1 and C1-C2 must survive (normalized distance keeps the longer C-C bond)
  expect(find_bond(bonds, 0, 1)).toBeDefined()
  expect(find_bond(bonds, 0, 2)).toBeDefined()
})

test(`bonding logic treats original and image atoms consistently`, () => {
  const structure = make_crystal(10, [
    [`C`, [0.1, 0.5, 0.5]], // x=1.0
    [`C`, [0.25, 0.5, 0.5]], // x=2.5
    [`H`, [0.0, 0.5, 0.5]], // H_distractor, x=0.0
  ])

  // Explicit tolerance 0.3 => 30% of 10A = 3.0A.
  // C1 at 1.0A from edge (0.1 frac) < 3.0A => should image.
  // C2 at 2.5A from edge (0.25 frac) < 3.0A => should image (needed for C1' neighbor).
  const with_images = get_pbc_image_sites(structure, { tolerance: 0.3 })

  const c1_img_idx = with_images.sites.findIndex(
    (site, idx) => idx > 2 && Math.abs(site.xyz[0] - 11.0) < 0.1,
  )
  expect(c1_img_idx).toBeGreaterThan(2)

  // Compute bonds
  const bonds = bonding.electroneg_ratio(with_images, {
    min_bond_dist: 0.1,
    max_distance_ratio: 5.0,
    strength_threshold: 0.0001,
  })

  const bond_counts = new Map<number, number>()
  for (const bond of bonds) {
    bond_counts.set(bond.site_idx_1, (bond_counts.get(bond.site_idx_1) ?? 0) + 1)
    bond_counts.set(bond.site_idx_2, (bond_counts.get(bond.site_idx_2) ?? 0) + 1)
  }

  const c1_bonds = bond_counts.get(0) ?? 0
  const c1_img_bonds = bond_counts.get(c1_img_idx) ?? 0

  expect(c1_img_bonds).toBe(c1_bonds)

  const h_img_idx = with_images.sites.findIndex(
    (site, idx) => idx > 2 && Math.abs(site.xyz[0] - 10.0) < 0.1,
  )
  if (h_img_idx !== -1) {
    const h_bonds = bond_counts.get(2) ?? 0
    const h_img_bonds = bond_counts.get(h_img_idx) ?? 0
    expect(h_img_bonds).toBe(h_bonds)
  }
})

test(`electroneg_ratio ignores weak bonds for closest neighbor penalty`, () => {
  const structure = make_crystal(10, [
    { element: `Na`, xyz: [0, 0, 0] },
    { element: `Na`, xyz: [2, 0, 0] }, // weak (metal-metal, same species), short 2.0 A
    { element: `Cl`, xyz: [0, 3, 0] }, // strong (ionic), longer 3.0 A
  ])

  // Na-Na (2.0 A) is weak -> rejected by threshold; Na-Cl (3.0 A) is strong -> accepted. If the
  // rejected Na-Na wrongly set the "closest" distance, Na-Cl would be over-penalized and dropped.
  const bonds = bonding.electroneg_ratio(structure, { strength_threshold: 0.4 })

  expect(find_bond(bonds, 0, 1)).toBeUndefined() // weak Na-Na rejected
  expect(find_bond(bonds, 0, 2)).toBeDefined() // strong Na-Cl survives
})

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
  const structure = get_test_structure([
    { xyz: [0, 0, 0], element: `Fe` },
    { xyz: [2, 0, 0], element: `O` },
    { xyz: [4, 0, 0], element: `C` },
  ])

  test(`matches the underlying strategy result`, () => {
    expect(bonding.compute_bonds(structure, `electroneg_ratio`)).toEqual(
      bonding.electroneg_ratio(structure),
    )
  })

  test(`repeated identical calls reuse the cached array (multi-view dedup)`, () => {
    // simulate the 4 panes computing bonds for the same structure in one flush
    const first = bonding.compute_bonds(structure, `electroneg_ratio`, {})
    const second = bonding.compute_bonds(structure, `electroneg_ratio`, {})
    expect(second).toBe(first) // same reference => no recompute
  })

  const other_structure = get_test_structure([{ xyz: [0, 0, 0] }])
  test.each([
    [`different structure`, other_structure, `electroneg_ratio`, {}],
    [`different strategy`, structure, `solid_angle`, {}],
    [`different options`, structure, `electroneg_ratio`, { max_distance_ratio: 3 }],
  ] as const)(`recomputes on %s`, (_desc, struct, strategy, options) => {
    const base = bonding.compute_bonds(structure, `electroneg_ratio`, {})
    const next = bonding.compute_bonds(struct, strategy, options)
    expect(next).not.toBe(base)
  })

  test(`caches per-structure so interleaved distinct structures don't thrash`, () => {
    // Two Structure components on one page compute bonds for different structures in the same
    // flush. A single global memo slot would evict each other every call; the per-structure
    // WeakMap keeps both warm so repeat calls still hit the cache.
    const a1 = bonding.compute_bonds(structure, `electroneg_ratio`, {})
    const b1 = bonding.compute_bonds(other_structure, `electroneg_ratio`, {})
    expect(bonding.compute_bonds(structure, `electroneg_ratio`, {})).toBe(a1)
    expect(bonding.compute_bonds(other_structure, `electroneg_ratio`, {})).toBe(b1)
  })

  test(`alternating strategies/options on one structure reuse results (no slot thrash)`, () => {
    // A single { sig, bonds } slot per structure would evict the prior result on every
    // strategy/options switch; the per-signature map keeps each warm so switching back hits cache.
    const eneg = bonding.compute_bonds(structure, `electroneg_ratio`, {})
    const solid = bonding.compute_bonds(structure, `solid_angle`, {})
    expect(bonding.compute_bonds(structure, `electroneg_ratio`, {})).toBe(eneg)
    expect(bonding.compute_bonds(structure, `solid_angle`, {})).toBe(solid)
  })
})

describe(`spatial grid scratch array reuse`, () => {
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

  test.each([`electroneg_ratio`, `solid_angle`] as const)(
    `%s bonds are stable and duplicate-free across repeated + interleaved calls`,
    (strategy) => {
      // >50 sites forces the spatial-grid path, whose neighbor lookup fills a
      // REUSED module-level scratch array. Interleaving two structures then
      // recomputing the first would surface any state leaking between calls.
      const struct_a = make_deterministic_structure(80)
      const struct_b = make_deterministic_structure(120)
      const bond_key = (bond: BondPair) => `${bond.site_idx_1}-${bond.site_idx_2}`

      const first_a = bonding.BONDING_STRATEGIES[strategy](struct_a)
      const first_b = bonding.BONDING_STRATEGIES[strategy](struct_b)
      const second_a = bonding.BONDING_STRATEGIES[strategy](struct_a)

      expect(first_a.length).toBeGreaterThan(0)
      expect(second_a.map(bond_key)).toEqual(first_a.map(bond_key))
      expect(new Set(first_a.map(bond_key)).size).toBe(first_a.length)
      expect(new Set(first_b.map(bond_key)).size).toBe(first_b.length)
    },
  )
})

test(`pack_cell_key is injective in a dense block and safe-integer at ±512 range corners`, () => {
  const keys = new Set<number>()
  for (let x = -5; x <= 5; x++) {
    for (let y = -5; y <= 5; y++)
      for (let z = -5; z <= 5; z++) keys.add(bonding.pack_cell_key(x, y, z))
  }
  expect(keys.size).toBe(11 ** 3)
  for (const [x, y, z] of [
    [-512, -512, -512],
    [511, 511, 511],
    [-512, 511, -512],
  ]) {
    expect(Number.isSafeInteger(bonding.pack_cell_key(x, y, z))).toBe(true)
  }
})
