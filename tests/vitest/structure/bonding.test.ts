import type { BondOrder, BondPair, ElementSymbol, Vec3 } from '$lib'
import type { Crystal, StructureBond } from '$lib/structure'
import type { BondEditState } from '$lib/structure/bonding'
import * as bonding from '$lib/structure/bonding'
import { get_pbc_image_sites } from '$lib/structure/pbc'
import { test_molecules } from '$site/molecules'
import process from 'node:process'
import { describe, expect, test, vi } from 'vitest'
import { make_crystal } from '../setup'

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
  test(`electroneg_ratio performance benchmarks`, () => {
    const times: [number, number][] = [
      [50, 60],
      [200, 200],
      [1000, 800],
    ]
    for (const [atom_count, max_time] of times) {
      const structure = make_random_structure(atom_count)
      bonding.electroneg_ratio(structure) // Warm-up
      const measurements = Array.from({ length: 3 }, () => {
        const start = performance.now()
        bonding.electroneg_ratio(structure)
        return performance.now() - start
      })
      const avg_time = measurements.reduce((sum, val) => sum + val, 0) / measurements.length
      const is_ci =
        typeof process !== `undefined` && [`true`, `1`].includes(process.env?.CI ?? ``)
      const max_allowed = max_time * (is_ci ? 5 : 2)

      expect(
        avg_time,
        `electroneg_ratio with ${atom_count} atoms: ` +
          `${avg_time.toFixed(1)}ms > ${max_allowed}ms`,
      ).toBeLessThanOrEqual(max_allowed)
    }
  })

  test(`electroneg_ratio returns valid BondPair format`, () => {
    const structure = get_test_structure([
      { xyz: [0, 0, 0], element: `Fe` },
      { xyz: [2, 0, 0], element: `O` },
      { xyz: [4, 0, 0], element: `C` },
    ])
    for (const bond of bonding.electroneg_ratio(structure)) {
      expect(bond.pos_1).toHaveLength(3)
      expect(bond.pos_2).toHaveLength(3)
      expect(bond.site_idx_1).toBeTypeOf(`number`)
      expect(bond.site_idx_2).toBeTypeOf(`number`)
      expect(bond.bond_length).toBeGreaterThan(0)
      // positions correspond to their site indices
      expect(bond.pos_1).toEqual(structure.sites[bond.site_idx_1].xyz)
      expect(bond.pos_2).toEqual(structure.sites[bond.site_idx_2].xyz)
    }
  })

  test(`electroneg_ratio generates unique bonds`, () => {
    const bonds = bonding.electroneg_ratio(make_random_structure(50))
    const bond_pairs = bonds.map(
      (bond) =>
        `${Math.min(bond.site_idx_1, bond.site_idx_2)}-${Math.max(
          bond.site_idx_1,
          bond.site_idx_2,
        )}`,
    )
    expect(new Set(bond_pairs).size).toBe(bonds.length)
  })

  test(`electroneg_ratio handles edge cases`, () => {
    expect(bonding.electroneg_ratio(get_test_structure([]))).toHaveLength(0)
    expect(bonding.electroneg_ratio(get_test_structure([{ xyz: [0, 0, 0] }]))).toHaveLength(0)
    expect(
      bonding.electroneg_ratio(
        get_test_structure([
          // @ts-expect-error unknown element symbol
          { xyz: [0, 0, 0], element: `Xx` },
          // @ts-expect-error unknown element symbol
          { xyz: [1, 0, 0], element: `Yy` },
        ]),
      ),
    ).toBeDefined()
  })
})

describe(`Explicit Bond Metadata`, () => {
  test.each(Object.entries(bonding.BONDING_STRATEGIES))(
    `%s maps structure.properties.bonds onto computed and missing bonds`,
    (_name, strategy) => {
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
      bonds: [
        { site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0, 0] },
        { site_idx_1: 0, site_idx_2: 1, order: 3, cell_shift: [-1, 0, 0] },
      ],
    }

    const explicit_bonds = bonding.get_explicit_bond_metadata(structure)
    expect(explicit_bonds).toEqual([
      { site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0, 0] },
      { site_idx_1: 0, site_idx_2: 1, order: 3, cell_shift: [-1, 0, 0] },
    ])
    expect(bonding.get_bond_key(0, 1, [1, 0, 0])).toBe(`0-1@1,0,0`)

    const bond = bonding.structure_bond_to_bond_pair(structure, explicit_bonds[0])

    expect(bond.pos_1).toEqual([9.5, 5, 5])
    expect(bond.pos_2).toEqual([10.5, 5, 5])
    expect(bond.bond_length).toBeCloseTo(1)
    expect(bond.bond_order).toBe(2)
    expect(bond.cell_shift).toEqual([1, 0, 0])

    // matching site indices with opposite shifts must stay two distinct bonds
    const bonds_by_key = new Map(
      bonding
        .apply_explicit_bond_metadata(structure, [])
        .map((bond_pair) => [
          bonding.get_bond_key(
            bond_pair.site_idx_1,
            bond_pair.site_idx_2,
            bond_pair.cell_shift,
          ),
          bond_pair,
        ]),
    )
    expect([...bonds_by_key.keys()].toSorted()).toEqual([`0-1@-1,0,0`, `0-1@1,0,0`])
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
})

describe(`explicit_only strategy`, () => {
  // All 3 pairs are within covalent bonding range, so electroneg_ratio perceives bonds
  // between them regardless of what the structure declares
  const make_bonded_triangle = (bonds?: StructureBond[]): Crystal => {
    const structure = get_test_structure([
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

  test(`returns no bonds instead of perceived ones when none are declared`, () => {
    const structure = make_bonded_triangle()

    // key regression guard: no silent fallback to a proximity strategy, which would
    // mask a missing or unparsed bond block in formats like PDB/MOL/MOL2/SDF
    expect(bonding.explicit_only(structure)).toEqual([])
    expect(bonding.electroneg_ratio(structure).length).toBeGreaterThan(0)
  })

  test(`does not invent bonds that electroneg_ratio perceives`, () => {
    const declared: StructureBond[] = [{ site_idx_1: 0, site_idx_2: 1, order: 1 }]
    const structure = make_bonded_triangle(declared)

    const explicit_bonds = bonding.explicit_only(structure)
    // electroneg_ratio merges the declared bond in, so its count is the perceived superset
    const perceived_bonds = bonding.electroneg_ratio(structure)

    expect(explicit_bonds).toHaveLength(1)
    expect(perceived_bonds.length).toBeGreaterThan(explicit_bonds.length)
    // the undeclared C-O pair is perceived but must not show up in explicit_only
    expect(find_bond(perceived_bonds, 0, 2)).toBeDefined()
    expect(find_bond(explicit_bonds, 0, 2)).toBeUndefined()
  })

  test(`respects cell_shift on periodic structures`, () => {
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

    const bonds = bonding.explicit_only(structure)
    const by_key = new Map(
      bonds.map((bond) => [
        bonding.get_bond_key(bond.site_idx_1, bond.site_idx_2, bond.cell_shift),
        bond,
      ]),
    )

    expect([...by_key.keys()].toSorted()).toEqual([`0-1@-1,0,0`, `0-1@1,0,0`])
    // the +1 image of O sits at x=10.5, 1 A from C at x=9.5 (not the 9 A in-cell distance)
    expect(by_key.get(`0-1@1,0,0`)?.pos_2).toEqual([10.5, 5, 5])
    expect(by_key.get(`0-1@1,0,0`)?.bond_length).toBeCloseTo(1)
    expect(by_key.get(`0-1@1,0,0`)?.bond_order).toBe(2)
    expect(by_key.get(`0-1@-1,0,0`)?.pos_2).toEqual([-9.5, 5, 5])
    expect(by_key.get(`0-1@-1,0,0`)?.bond_order).toBe(3)
  })
})

describe(`Molecular Bonding Analysis`, () => {
  // Lower strength threshold to ensure all bond types (incl. C-C) are captured
  const loose_opts = {
    max_distance_ratio: 2,
    strength_threshold: 0.2,
    same_species_penalty: 0.8,
  }

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
// whose answer is not in doubt. Every atom of the unit cell is checked (not just
// interior ones), which also pins the PBC boundary completion in find_image_atoms.

const wrap_frac = (val: number) => val - Math.floor(val)
const fcc_offsets: Vec3[] = [
  [0, 0, 0],
  [0.5, 0.5, 0],
  [0.5, 0, 0.5],
  [0, 0.5, 0.5],
]
// fcc lattice sites for `element`, once per basis vector
const fcc = (element: ElementSymbol, basis: Vec3[] = [[0, 0, 0]]) =>
  fcc_offsets.flatMap((off) =>
    basis.map((vec) => ({
      element,
      abc: [
        wrap_frac(off[0] + vec[0]),
        wrap_frac(off[1] + vec[1]),
        wrap_frac(off[2] + vec[2]),
      ] as Vec3,
    })),
  )
const tetragonal = (a: number, c: number): Vec3[] => [
  [a, 0, 0],
  [0, a, 0],
  [0, 0, c],
]
const hexagonal = (a: number, c: number): Vec3[] => [
  [a, 0, 0],
  [-a / 2, (a * Math.sqrt(3)) / 2, 0],
  [0, 0, c],
]

// [label, lattice, sites, expected coordination number per element]
const cn_benchmark: [
  string,
  number | Vec3[],
  ReturnType<typeof fcc>,
  Record<string, number>,
][] = [
  [
    `diamond C`,
    3.567,
    fcc(`C`, [
      [0, 0, 0],
      [0.25, 0.25, 0.25],
    ]),
    { C: 4 },
  ],
  [
    `Si diamond`,
    5.431,
    fcc(`Si`, [
      [0, 0, 0],
      [0.25, 0.25, 0.25],
    ]),
    { Si: 4 },
  ],
  [`fcc Cu`, 3.615, fcc(`Cu`), { Cu: 12 }],
  [`fcc Al`, 4.05, fcc(`Al`), { Al: 12 }],
  [`fcc Pb`, 4.95, fcc(`Pb`), { Pb: 12 }],
  [`fcc Ag`, 4.085, fcc(`Ag`), { Ag: 12 }],
  [`NaCl rocksalt`, 5.64, [...fcc(`Na`), ...fcc(`Cl`, [[0.5, 0, 0]])], { Na: 6, Cl: 6 }],
  [`MgO rocksalt`, 4.212, [...fcc(`Mg`), ...fcc(`O`, [[0.5, 0, 0]])], { Mg: 6, O: 6 }],
  [
    `ZnS zincblende`,
    5.41,
    [...fcc(`Zn`), ...fcc(`S`, [[0.25, 0.25, 0.25]])],
    {
      Zn: 4,
      S: 4,
    },
  ],
  [
    `CaF2 fluorite`,
    5.463,
    [...fcc(`Ca`), ...fcc(`F`, [[0.25, 0.25, 0.25]]), ...fcc(`F`, [[0.75, 0.75, 0.75]])],
    { Ca: 8, F: 4 },
  ],
  [
    `pyrite FeS2`,
    5.416,
    [...fcc(`Fe`), ...fcc(`S`, [[0.385, 0.385, 0.385]]), ...fcc(`S`, [[0.615, 0.615, 0.615]])],
    { Fe: 6, S: 4 },
  ],
  [
    `CsCl`,
    4.119,
    [
      { element: `Cs`, abc: [0, 0, 0] as Vec3 },
      { element: `Cl`, abc: [0.5, 0.5, 0.5] as Vec3 },
    ],
    { Cs: 8, Cl: 8 },
  ],
  [
    `SrTiO3 perovskite`,
    3.905,
    [
      { element: `Sr`, abc: [0.5, 0.5, 0.5] as Vec3 },
      { element: `Ti`, abc: [0, 0, 0] as Vec3 },
      { element: `O`, abc: [0.5, 0, 0] as Vec3 },
      { element: `O`, abc: [0, 0.5, 0] as Vec3 },
      { element: `O`, abc: [0, 0, 0.5] as Vec3 },
      // O is left unchecked: Sr is a spectator A-site cation, so find_image_atoms
      // deliberately generates no Sr images and the base O atoms see 1 Sr instead of 4.
      // Sr 12 / Ti 6 are the point here - they only hold if Sr-Ti does NOT bond.
    ],
    { Sr: 12, Ti: 6 },
  ],
  // TiC and Ti2O are the pair that pins cation_cation_penalty's anion-shell gate. Both are
  // Ti plus a nonmetal, and in both the Ti-Ti contact is SHORTER than Ti-nonmetal once
  // normalized by covalent radii (0.956 vs 0.915, and 0.919 vs 0.923), so no
  // distance-based rule separates them. What separates them is saturation: TiC's Ti has a
  // complete octahedral C shell and its Ti-Ti at 3.06 A is a genuine second shell, while
  // Ti2O's Ti has only 3 O and the hcp Ti framework at 2.95 A IS the structure. Applying
  // the penalty unconditionally took Ti2O from CN 15 to 3 and erased that framework.
  [`TiC rocksalt`, 4.33, [...fcc(`Ti`), ...fcc(`C`, [[0.5, 0, 0]])], { Ti: 6, C: 6 }],
  [
    `Ti2O suboxide`,
    hexagonal(2.9587, 4.7852),
    [
      { element: `Ti`, abc: [1 / 3, 2 / 3, 0.25] as Vec3 },
      { element: `Ti`, abc: [2 / 3, 1 / 3, 0.75] as Vec3 },
      { element: `O`, abc: [0, 0, 0] as Vec3 },
    ],
    { Ti: 15, O: 6 },
  ], // 12 Ti + 3 O around each Ti
  [
    `hcp Ti`,
    hexagonal(2.9587, 4.7852),
    [
      { element: `Ti`, abc: [1 / 3, 2 / 3, 0.25] as Vec3 },
      { element: `Ti`, abc: [2 / 3, 1 / 3, 0.75] as Vec3 },
    ],
    { Ti: 12 },
  ], // control: no anion-former, so the gate is inert either way
  [
    `graphite C`,
    [
      [2.464, 0, 0],
      [-1.232, 2.13389, 0],
      [0, 0, 6.711],
    ] as Vec3[],
    [
      { element: `C`, abc: [0, 0, 0.25] as Vec3 },
      { element: `C`, abc: [0, 0, 0.75] as Vec3 },
      { element: `C`, abc: [1 / 3, 2 / 3, 0.25] as Vec3 },
      { element: `C`, abc: [2 / 3, 1 / 3, 0.75] as Vec3 },
    ],
    { C: 3 },
  ],
  [
    `rutile TiO2`,
    tetragonal(4.594, 2.959),
    [
      { element: `Ti`, abc: [0, 0, 0] },
      { element: `Ti`, abc: [0.5, 0.5, 0.5] },
      { element: `O`, abc: [0.3053, 0.3053, 0] },
      { element: `O`, abc: [0.6947, 0.6947, 0] },
      { element: `O`, abc: [0.8053, 0.1947, 0.5] },
      { element: `O`, abc: [0.1947, 0.8053, 0.5] },
    ],
    { Ti: 6, O: 3 },
  ],
]

describe(`coordination number benchmark`, () => {
  test.each(cn_benchmark)(`%s`, (_label, lattice, sites, expected) => {
    const base = make_crystal(
      typeof lattice === `number`
        ? lattice
        : ([lattice[0], lattice[1], lattice[2]] as [Vec3, Vec3, Vec3]),
      sites,
    )
    // image atoms complete the shells of atoms sitting on cell faces
    const imaged = get_pbc_image_sites(base)
    const counts = Array.from<number>({ length: imaged.sites.length }).fill(0)
    for (const { site_idx_1, site_idx_2 } of bonding.electroneg_ratio(imaged)) {
      counts[site_idx_1]++
      counts[site_idx_2]++
    }
    // only the original unit-cell sites are checked; image copies are partial by design
    const actual: Record<string, number[]> = {}
    for (let idx = 0; idx < base.sites.length; idx++) {
      const element = bonding.get_majority_element(imaged.sites[idx]) ?? `?`
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
    [`Na`, `Cl`, 2.3], // ionic
    [`C`, `C`, 1.5], // covalent, same species
    [`C`, `O`, 1.5], // covalent, heteronuclear
  ] as [ElementSymbol, ElementSymbol, number][])(
    `%s-%s at %s A is a single bond of that length`,
    (elem_1, elem_2, dist) => {
      const structure = get_test_structure([
        { xyz: [0, 0, 0], element: elem_1 },
        { xyz: [dist, 0, 0], element: elem_2 },
      ])
      const bonds = bonding.electroneg_ratio(structure, { max_distance_ratio: 2.5 })
      expect(bonds).toHaveLength(1)
      expect(bonds[0].bond_length).toBeCloseTo(dist, 1)
    },
  )

  test(`parameter sensitivity`, () => {
    const structure = get_test_structure([
      { xyz: [0, 0, 0], element: `Fe` },
      { xyz: [2.5, 0, 0], element: `Fe` },
      { xyz: [1.25, 2.2, 0], element: `O` },
    ])
    // One bridging O leaves both Fe far short of an anion shell, so the cation gate stays
    // out of the way and the Fe-Fe contact is kept alongside the two Fe-O bonds
    expect(bonding.electroneg_ratio(structure)).toHaveLength(3)

    // Surround each Fe with enough O to saturate it and the same Fe-Fe contact is dropped:
    // now it really is a second shell behind a complete coordination environment
    const saturated = get_test_structure([
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
    const metal_only = get_test_structure([
      { xyz: [0, 0, 0], element: `Fe` },
      { xyz: [2.5, 0, 0], element: `Fe` },
    ])
    const lenient = bonding.electroneg_ratio(metal_only, { metal_metal_penalty: 0.8 })
    const strict = bonding.electroneg_ratio(metal_only, { metal_metal_penalty: 0.1 })
    expect(lenient).toHaveLength(1)
    expect(strict).toHaveLength(0)
  })

  test(`distance constraints`, () => {
    const structure = get_test_structure([
      { xyz: [0, 0, 0], element: `Na` },
      { xyz: [10, 0, 0], element: `Cl` },
    ])
    expect(bonding.electroneg_ratio(structure, { max_distance_ratio: 5 })).toHaveLength(0)
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

  const other_structure = get_test_structure([{ xyz: [0, 0, 0] }])
  test.each([
    [`different structure`, other_structure, `electroneg_ratio`, {}],
    [`different strategy`, structure, `explicit_only`, {}],
    [`different options`, structure, `electroneg_ratio`, { max_distance_ratio: 3 }],
  ] as const)(`recomputes on %s`, (_desc, struct, strategy, options) => {
    const base = bonding.compute_bonds(structure, `electroneg_ratio`, {})
    const next = bonding.compute_bonds(struct, strategy, options)
    expect(next).not.toBe(base)
  })

  test(`caches per-structure so interleaved distinct structures don't thrash`, () => {
    // Two Structure components on one page compute bonds for different structures in the same
    // flush (as do the 4 panes of the multi-side view). A single global memo slot would evict
    // each other every call; the per-structure WeakMap keeps both warm so repeat calls hit.
    const a1 = bonding.compute_bonds(structure, `electroneg_ratio`, {})
    const b1 = bonding.compute_bonds(other_structure, `electroneg_ratio`, {})
    expect(bonding.compute_bonds(structure, `electroneg_ratio`, {})).toBe(a1)
    expect(bonding.compute_bonds(other_structure, `electroneg_ratio`, {})).toBe(b1)
  })

  test(`alternating strategies/options on one structure reuse results (no slot thrash)`, () => {
    // A single { sig, bonds } slot per structure would evict the prior result on every
    // strategy/options switch; the per-signature map keeps each warm so switching back hits cache.
    const eneg = bonding.compute_bonds(structure, `electroneg_ratio`, {})
    const wide = bonding.compute_bonds(structure, `electroneg_ratio`, {
      max_distance_ratio: 3,
    })
    expect(bonding.compute_bonds(structure, `electroneg_ratio`, {})).toBe(eneg)
    expect(
      bonding.compute_bonds(structure, `electroneg_ratio`, { max_distance_ratio: 3 }),
    ).toBe(wide)
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

  test(`bonds are stable and duplicate-free across repeated + interleaved calls`, () => {
    // >50 sites forces the spatial-grid path, whose neighbor lookup fills a
    // REUSED module-level scratch array. Interleaving two structures then
    // recomputing the first would surface any state leaking between calls.
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

  // The grid scan visits only the 13 "forward" neighbor cells of each center, relying on
  // the other 13 pairs being found from the opposite end — a wrong offset set would
  // silently drop bonds in whole directions. The cell is one bond cutoff wide
  // (0.76 = C covalent radius), so a mid-cell center puts every partner just past a
  // face, and strength_threshold 0 keeps the distance model from dropping the diagonals.
  test(`grid scan finds partners in the own cell and all 26 neighbors`, () => {
    const center = (2 * 0.76 * 2) / 2
    const offset = center + 0.1
    const partner_sites = [-1, 0, 1].flatMap((dx) =>
      [-1, 0, 1].flatMap((dy) =>
        [-1, 0, 1]
          .filter((dz) => dx || dy || dz)
          .map((dz) => ({
            element: `C` as const,
            xyz: [center + dx * offset, center + dy * offset, center + dz * offset] as Vec3,
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
    expect(partners.toSorted((a, b) => a - b)).toEqual(
      Array.from({ length: 27 }, (_, idx) => idx + 1),
    )
  })
})

describe(`neighbor_query`, () => {
  // Reference: every (center, partner, integer image) over a generous ±3 image range on the
  // periodic axes, keyed so both lists can be compared as sets
  const brute_force = (structure: Crystal, cutoff: number, pbc: readonly boolean[]) => {
    const [vec_a, vec_b, vec_c] = structure.lattice.matrix
    const range = (axis: number) => (pbc[axis] ? [-3, -2, -1, 0, 1, 2, 3] : [0])
    const found = new Map<string, { dist: number; delta: Vec3 }>()
    for (const [center, site_a] of structure.sites.entries()) {
      for (const [partner, site_b] of structure.sites.entries()) {
        for (const sa of range(0)) {
          for (const sb of range(1)) {
            for (const sc of range(2)) {
              if (center === partner && sa === 0 && sb === 0 && sc === 0) continue
              const delta = [0, 1, 2].map(
                (ax) =>
                  site_b.xyz[ax] +
                  sa * vec_a[ax] +
                  sb * vec_b[ax] +
                  sc * vec_c[ax] -
                  site_a.xyz[ax],
              ) as Vec3
              const dist = Math.hypot(...delta)
              if (dist <= cutoff)
                found.set(`${center}|${partner}|${sa},${sb},${sc}`, { dist, delta })
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
  const triclinic: Crystal = make_crystal(
    [
      [4.1, 0, 0],
      [1.9, 3.6, 0],
      [-1.2, 1.4, 3.9],
    ],
    [
      { element: `Na`, abc: [0.02, 0.1, 0.95] },
      { element: `Cl`, abc: [0.5, 0.5, 0.5] },
      { element: `Na`, abc: [1.3, -0.4, 0.25] }, // unwrapped
      { element: `O`, abc: [0.8, 0.9, 0.1] },
      { element: `Cl`, abc: [0.25, 0.75, 0.6] },
    ],
  )

  test.each([
    [`triclinic, full pbc`, [true, true, true], 5.5],
    [`triclinic, slab (pbc z off)`, [true, true, false], 5.5],
    [`triclinic, wire (only pbc y)`, [false, true, false], 6.0],
    [`triclinic, no pbc`, [false, false, false], 6.0],
  ] as const)(`matches brute force over ±3 images: %s`, (_label, pbc, cutoff) => {
    const list = bonding.neighbor_query(triclinic, { cutoff, pbc })
    const actual = as_map(list)
    const expected = brute_force(triclinic, cutoff, pbc)
    expect([...actual.keys()].toSorted()).toEqual([...expected.keys()].toSorted())
    let max_dist_err = 0
    let max_delta_err = 0
    for (const [key, { dist, delta }] of expected) {
      const got = actual.get(key)
      if (!got) throw new Error(`missing ${key}`)
      max_dist_err = Math.max(max_dist_err, Math.abs(got.dist - dist))
      for (let ax = 0; ax < 3; ax++) {
        max_delta_err = Math.max(max_delta_err, Math.abs(got.delta[ax] - delta[ax]))
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
  })

  test(`1-atom cell: own images are neighbors; fcc k=12 shell exact`, () => {
    const bcc = make_crystal(3, [{ element: `Fe`, abc: [0, 0, 0] }])
    const list = bonding.neighbor_query(bcc, { cutoff: 3.01 })
    expect(list.neighbors).toHaveLength(6)
    expect(Array.from(list.neighbors)).toEqual([0, 0, 0, 0, 0, 0])
    expect(Array.from(list.distances).every((dist) => Math.abs(dist - 3) < 1e-12)).toBe(true)
    const fcc_cu = make_crystal(3.6, [
      { element: `Cu`, abc: [0, 0, 0] },
      { element: `Cu`, abc: [0.5, 0.5, 0] },
      { element: `Cu`, abc: [0.5, 0, 0.5] },
      { element: `Cu`, abc: [0, 0.5, 0.5] },
    ])
    const knn = bonding.neighbor_query(fcc_cu, { k: 12 })
    expect(Array.from(knn.offsets)).toEqual([0, 12, 24, 36, 48])
    const nn_dist = 3.6 / Math.SQRT2
    for (const dist of knn.distances) expect(Math.abs(dist - nn_dist)).toBeLessThan(1e-12)
    // distances = |deltas| and deltas = partner + image·L - center
    for (let slot = 0; slot < knn.distances.length; slot++) {
      const center = knn.offsets.findLastIndex((offset) => offset <= slot)
      const partner = fcc_cu.sites[knn.neighbors[slot]].xyz
      const img = knn.images.subarray(slot * 3, slot * 3 + 3)
      for (let ax = 0; ax < 3; ax++) {
        const expected = partner[ax] + img[ax] * 3.6 - fcc_cu.sites[center].xyz[ax]
        expect(knn.deltas[slot * 3 + ax]).toBeCloseTo(expected, 12)
      }
      expect(Math.hypot(...knn.deltas.subarray(slot * 3, slot * 3 + 3))).toBeCloseTo(
        knn.distances[slot],
        12,
      )
    }
  })

  test(`molecule: no images, k capped by system size, cutoff list sorted`, () => {
    const water = {
      sites: (
        [
          [`O`, [0, 0, 0]],
          [`H`, [0.96, 0, 0]],
          [`H`, [-0.24, 0.93, 0]],
        ] as const
      ).map(([element, xyz]) => ({
        species: [{ element, occu: 1, oxidation_state: 0 }],
        xyz: [...xyz] as Vec3,
        abc: [0, 0, 0] as Vec3,
        label: element,
        properties: {},
      })),
    }
    const knn = bonding.neighbor_query(water, { k: 5 })
    expect(Array.from(knn.offsets)).toEqual([0, 2, 4, 6])
    expect(Array.from(knn.images).every((shift) => shift === 0)).toBe(true)
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
  })

  test(`rejects a degenerate periodic lattice and an absurd cutoff`, () => {
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
    const big = make_random_structure(200)
    expect(() => bonding.neighbor_query(big, { cutoff: 400 })).toThrow(/refusing to build/)
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
    expect(() => bonding.neighbor_query(molecule, { cutoff: 3 })).toThrow(/non-finite/)
  })
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
