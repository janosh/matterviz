import type { BondOrder, BondPair, Vec3 } from '$lib'
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
const get_test_structure = (sites: { xyz: Vec3; element?: string }[]): Crystal =>
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

describe(`Bonding Algorithms`, () => {
  const algorithms: [BondingAlgo, BondingStrategy, [number, number][]][] = [
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
      const avg_time = measurements.reduce((a, b) => a + b, 0) / measurements.length
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
          { xyz: [0, 0, 0], element: `Xx` },
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

  test.each([
    { selected_order: 2 as BondOrder, expected_overrides: [] },
    {
      selected_order: 1 as BondOrder,
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
    expect(bonds.filter((b) => b.site_idx_1 !== b.site_idx_2).length).toBeGreaterThan(0)
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
  test(`chemical preferences`, () => {
    const ionic = get_test_structure([
      { xyz: [0, 0, 0], element: `Na` },
      { xyz: [2.3, 0, 0], element: `Cl` },
      { xyz: [4.6, 0, 0], element: `Na` },
      { xyz: [6.9, 0, 0], element: `Cl` },
    ])
    const metal = get_test_structure([
      { xyz: [0, 0, 0], element: `Fe` },
      { xyz: [2.5, 0, 0], element: `Fe` },
      { xyz: [1.25, 2.2, 0], element: `Fe` },
      { xyz: [3.75, 2.2, 0], element: `Fe` },
    ])
    const ionic_bonds = bonding.electroneg_ratio(ionic, { max_distance_ratio: 2.5 })
    const metal_bonds = bonding.electroneg_ratio(metal, { max_distance_ratio: 2 })
    expect(ionic_bonds.length).toBeGreaterThan(0)
    expect(metal_bonds.length).toBeGreaterThan(0)
  })

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
    expect(lenient.length).not.toBe(strict.length)
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

  test(`large structures`, () => {
    const large_structure = make_random_structure(500)
    expect(bonding.electroneg_ratio(large_structure)).toBeInstanceOf(Array)
    expect(bonding.solid_angle(large_structure)).toBeInstanceOf(Array)
  })
})

describe(`Bond Strength Validation`, () => {
  test.each(Object.values(bonding.BONDING_STRATEGIES))(`valid strength values`, (strategy) => {
    const structure = get_test_structure([
      { xyz: [0, 0, 0], element: `C` },
      { xyz: [1.5, 0, 0], element: `O` },
      { xyz: [0, 1.5, 0], element: `H` },
    ])
    strategy(structure).forEach((bond: BondPair) => {
      expect(bond.strength).toBeGreaterThanOrEqual(0)
      expect(bond.strength).toBeLessThanOrEqual(2)
    })
  })
})
test(`electroneg_ratio treats original and image atoms symmetrically`, () => {
  // This test reproduces a bug where image atoms get fewer bonds than original atoms
  // due to the order in which neighbor distance penalties are applied.

  // Construct a structure where:
  // 1. Original Na (idx 0) is processed.
  // 2. It sees a "Long" neighbor first. Distance 3.0.
  //    Since no shorter bond is known yet, it accepts this bond.
  // 3. It sees a "Short" neighbor second. Distance 2.0.
  //    It accepts this bond too, and updates "closest" to 2.0.
  //    Result: Original Na has 2 bonds.
  //
  // 4. Image Na (idx 3) is processed later.
  //    It shares `orig_site_idx: 0`, so it inherits `closest = 2.0` from step 3.
  // 5. It sees "Long" neighbor. Distance 3.0.
  //    3.0 > 2.0, so penalty is applied!
  //    If penalty is strong enough, this bond is rejected (or has much lower strength).
  // 6. It sees "Short" neighbor. Distance 2.0. Accepted.
  //    Result: Image Na has 1 bond (or 2 bonds with different strengths).

  const Na_props = { element: `Na` as const, occu: 1, oxidation_state: 0 }
  const Cl_props = { element: `Cl` as const, occu: 1, oxidation_state: 0 }

  const structure: Crystal = {
    sites: [
      // 0: Original Na
      {
        species: [Na_props],
        abc: [0, 0, 0],
        xyz: [0, 0, 0],
        label: `Na`,
        properties: { orig_site_idx: 0 },
      },
      // 1: Cl at distance 3.0 (Long)
      {
        species: [Cl_props],
        abc: [0, 0, 0],
        xyz: [3.0, 0, 0],
        label: `Cl_long`,
        properties: { orig_site_idx: 1 },
      },
      // 2: Cl at distance 2.0 (Short)
      {
        species: [Cl_props],
        abc: [0, 0, 0],
        xyz: [0, 2.0, 0],
        label: `Cl_short`,
        properties: { orig_site_idx: 2 },
      },

      // 3: Image Na (shifted by 10 in y, but we manually place neighbors relative to it to mimic periodicity)
      // Actually, we can just place it far away and give it its own neighbors with same local geometry
      {
        species: [Na_props],
        abc: [0, 0, 0],
        xyz: [100, 0, 0],
        label: `Na_img`,
        properties: { orig_site_idx: 0 },
      },
      // 4: Image Cl Long (relative to Na_img: +3.0 x)
      {
        species: [Cl_props],
        abc: [0, 0, 0],
        xyz: [103.0, 0, 0],
        label: `Cl_long_img`,
        properties: { orig_site_idx: 1 },
      },
      // 5: Image Cl Short (relative to Na_img: +2.0 y)
      {
        species: [Cl_props],
        abc: [0, 0, 0],
        xyz: [100, 2.0, 0],
        label: `Cl_short_img`,
        properties: { orig_site_idx: 2 },
      },
    ],
    lattice: {
      matrix: [
        [1000, 0, 0],
        [0, 1000, 0],
        [0, 0, 1000],
      ],
      pbc: [true, true, true],
      a: 1000,
      b: 1000,
      c: 1000,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: 1e9,
    },
  }

  // We expect bonds:
  // 0-1 (dist 3.0), 0-2 (dist 2.0)
  // 3-4 (dist 3.0), 3-5 (dist 2.0)

  // To trigger the penalty effectively, we need the penalty to push strength below threshold (default 0.3).
  // Base strength for Na-Cl is high (metal-nonmetal bonus 1.5, en diff ~2.1 > 1.7 -> 1.3 bonus).
  // Na(0.93) Cl(3.16). Diff=2.23.
  // Strength ~= 1.0 * 1.5 (metal-nonmetal) * 1.3 (en_diff) = 1.95.
  // Distance weight: dist/expected. Na(1.54)+Cl(0.99) = 2.53.
  // Long (3.0): ratio = 3.0/2.53 = 1.18. Weight = exp(-((1.18-1)^2)/0.18) = exp(-0.032/0.18) = exp(-0.18) ~= 0.83.
  // Short (2.0): ratio = 2.0/2.53 = 0.79. Weight = exp(-((0.79-1)^2)/0.18) = exp(-0.044/0.18) = exp(-0.24) ~= 0.78.
  //
  // Strength Long ~= 1.95 * 0.83 = 1.6.
  // Strength Short ~= 1.95 * 0.78 = 1.5.
  //
  // Penalty: if dist > closest.
  // closest = 2.0.
  // Long (3.0) > 2.0. Ratio 1.5.
  // Penalty = exp(-(1.5 - 1) / 0.5) = exp(-0.5 / 0.5) = exp(-1) = 0.36.
  // Penalized Long Strength = 1.6 * 0.36 = 0.57.
  // Still > 0.3 threshold?
  //
  // Let's adjust distances to make penalty more severe or initial strength lower.
  // Or increase threshold.

  const options = {
    strength_threshold: 0.6, // Increase threshold so penalized bond drops below
  }

  const bonds = bonding.electroneg_ratio(structure, options)

  const bonds_orig = bonds.filter((b) => b.site_idx_1 === 0 || b.site_idx_2 === 0)
  const bonds_img = bonds.filter((b) => b.site_idx_1 === 3 || b.site_idx_2 === 3)

  // If bug exists:
  // Orig will have 2 bonds (Short + Long, because Long processed first)
  // Img will have 1 bond (Short only, because Long processed after Short was known via Orig)

  // Sort bonds by length for easier debugging
  bonds_orig.sort((a, b) => a.bond_length - b.bond_length)
  bonds_img.sort((a, b) => a.bond_length - b.bond_length)

  expect(bonds_img.length).toBe(bonds_orig.length)

  // If fixed, both should have 1 bond (because the penalty is now applied to both)
  // Or both have 2 (if penalty wasn't strong enough).
  // In our case, we tuned threshold so penalty should remove Long bond.
  // Wait, if penalty removes Long bond, then both should have 1 bond.
  // With bug: Orig had 2, Img had 1.
  // With fix: Both should have 1 (consistent).

  // Actually, the "fix" ensures that original also sees the penalty from the short bond
  // because we calculate closest distances for all pairs BEFORE applying penalties.
  // So the Short bond (2.0) will penalize the Long bond (3.0) even for the original atom.

  expect(bonds_orig.length).toBe(bonds_img.length)
})
test(`electroneg_ratio preserves longer C-C bonds in presence of shorter C-H bonds`, () => {
  // Benzene-like fragment: C bonded to C and H.
  // C-H distance ~1.09 A.
  // C-C distance ~1.40 A.
  // Radius C ~0.76, H ~0.31. Sums: C-H ~1.07, C-C ~1.52.
  // C-H is close to expected sum. C-C is actually shorter than expected sum (aromatic).
  // However, in raw distance, C-H (1.09) < C-C (1.40).
  // If we use raw distance for "closest neighbor" penalty, C-H sets closest=1.09.
  // C-C at 1.40 gets penalized (1.40/1.09 = 1.28).
  // If we use normalized distance:
  // C-H norm = 1.09/1.07 = 1.02.
  // C-C norm = 1.40/1.52 = 0.92.
  // C-C is the "closest" in normalized space. C-H is slightly further.
  // Both should survive.

  const C_props = { element: `C` as const, occu: 1, oxidation_state: 0 }
  const H_props = { element: `H` as const, occu: 1, oxidation_state: 0 }

  const structure: Crystal = {
    sites: [
      // Central C
      {
        species: [C_props],
        abc: [0, 0, 0],
        xyz: [0, 0, 0],
        label: `C1`,
        properties: { orig_site_idx: 0 },
      },
      // Neighbor H (1.09 A away)
      {
        species: [H_props],
        abc: [0, 0, 0],
        xyz: [1.09, 0, 0],
        label: `H1`,
        properties: { orig_site_idx: 1 },
      },
      // Neighbor C (1.40 A away)
      {
        species: [C_props],
        abc: [0, 0, 0],
        xyz: [0, 1.4, 0],
        label: `C2`,
        properties: { orig_site_idx: 2 },
      },
    ],
    lattice: {
      matrix: [
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      pbc: [true, true, true],
      a: 10,
      b: 10,
      c: 10,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: 1000,
    },
  }

  const bonds = bonding.electroneg_ratio(structure)

  // We expect C1-H1 and C1-C2.
  const c_h = bonds.find(
    (b) =>
      (b.site_idx_1 === 0 && b.site_idx_2 === 1) || (b.site_idx_1 === 1 && b.site_idx_2 === 0),
  )
  const c_c = bonds.find(
    (b) =>
      (b.site_idx_1 === 0 && b.site_idx_2 === 2) || (b.site_idx_1 === 2 && b.site_idx_2 === 0),
  )

  expect(c_h).toBeDefined()
  expect(c_c).toBeDefined()
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
    (s, i) => i > 2 && Math.abs(s.xyz[0] - 11.0) < 0.1,
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
    (s, i) => i > 2 && Math.abs(s.xyz[0] - 10.0) < 0.1,
  )
  if (h_img_idx !== -1) {
    const h_bonds = bond_counts.get(2) ?? 0
    const h_img_bonds = bond_counts.get(h_img_idx) ?? 0
    expect(h_img_bonds).toBe(h_bonds)
  }
})

test(`electroneg_ratio ignores weak bonds for closest neighbor penalty`, () => {
  const Na_props = { element: `Na` as const, occu: 1, oxidation_state: 0 }
  const Cl_props = { element: `Cl` as const, occu: 1, oxidation_state: 0 }

  const structure: Crystal = {
    sites: [
      {
        species: [Na_props],
        abc: [0, 0, 0],
        xyz: [0, 0, 0],
        label: `Na`,
        properties: { orig_site_idx: 0 },
      },
      // Weak neighbor (metal-metal, same species) at short distance
      {
        species: [Na_props],
        abc: [0, 0, 0],
        xyz: [2.0, 0, 0],
        label: `Na_weak`,
        properties: { orig_site_idx: 1 },
      },
      // Strong neighbor (ionic) at longer distance
      {
        species: [Cl_props],
        abc: [0, 0, 0],
        xyz: [0, 3.0, 0],
        label: `Cl_strong`,
        properties: { orig_site_idx: 2 },
      },
    ],
    lattice: {
      matrix: [
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      pbc: [true, true, true],
      a: 10,
      b: 10,
      c: 10,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: 1000,
    },
  }

  // Na-Na (2.0A): weak -> should be rejected by threshold
  // Na-Cl (3.0A): strong -> should be accepted
  // If Na-Na incorrectly sets "closest" distance despite being rejected,
  // Na-Cl gets penalized heavily and might be rejected too.
  const bonds = bonding.electroneg_ratio(structure, {
    strength_threshold: 0.4,
  })

  const na_na = bonds.find(
    (b) =>
      (b.site_idx_1 === 0 && b.site_idx_2 === 1) || (b.site_idx_1 === 1 && b.site_idx_2 === 0),
  )
  const na_cl = bonds.find(
    (b) =>
      (b.site_idx_1 === 0 && b.site_idx_2 === 2) || (b.site_idx_1 === 2 && b.site_idx_2 === 0),
  )

  expect(na_na).toBeUndefined()
  expect(na_cl).toBeDefined()
})
