// Unit tests for edit-atoms mode pure logic (runs in CI without WebGL)
import type { ElementSymbol, Vec3 } from '$lib'
import { ELEM_SYMBOLS } from '$lib/labels'
import { create_cart_to_frac } from '$lib/math'
import type { AnyStructure, Site } from '$lib/structure'
import { get_pbc_image_sites } from '$lib/structure'
import { describe, expect, test } from 'vitest'
import { get_dummy_structure, make_crystal } from '../setup'

// === Element Normalization ===
// Mirrors the normalization pattern from Structure.svelte handle_add_atom

function normalize_element(input: string): ElementSymbol | null {
  const normalized = (input.charAt(0).toUpperCase() +
    input.slice(1).toLowerCase()) as ElementSymbol
  return ELEM_SYMBOLS.includes(normalized) ? normalized : null
}

describe(`edit-atoms: element normalization`, () => {
  test.each([
    [`C`, `C`],
    [`c`, `C`],
    [`fe`, `Fe`],
    [`FE`, `Fe`],
    [`Fe`, `Fe`],
    [`he`, `He`],
    [`HE`, `He`],
    [`o`, `O`],
    [`NA`, `Na`],
    [`si`, `Si`],
    [`og`, `Og`],
  ])(`normalizes "%s" to "%s"`, (input, expected) => {
    expect(normalize_element(input)).toBe(expected)
  })

  test.each([`Xx`, `ZZ`, ``, `123`, `Abc`])(
    `rejects invalid symbol "%s"`,
    (input) => {
      expect(normalize_element(input)).toBeNull()
    },
  )
})

// === Scene-to-Structure Index Mapping ===
// Mirrors scene_to_structure_indices from Structure.svelte

type DisplayedSite = Site & { properties: Record<string, unknown> }

function scene_to_structure_indices(
  displayed_sites: DisplayedSite[],
  scene_indices: number[],
  has_supercell: boolean,
  skip_image_atoms = false,
): Set<number> {
  const result = new Set<number>()
  for (const scene_idx of scene_indices) {
    const site = displayed_sites[scene_idx]
    if (!site) continue
    if (skip_image_atoms && site.properties?.orig_site_idx !== undefined) continue

    if (has_supercell && site.properties?.orig_unit_cell_idx !== undefined) {
      result.add(site.properties.orig_unit_cell_idx as number)
    } else {
      result.add(scene_idx)
    }
  }
  return result
}

describe(`edit-atoms: scene-to-structure index mapping`, () => {
  const base_site = (
    idx: number,
    props: Record<string, unknown> = {},
  ): DisplayedSite => ({
    species: [{ element: `Si` as ElementSymbol, occu: 1, oxidation_state: 0 }],
    xyz: [idx, 0, 0] as Vec3,
    abc: [idx * 0.2, 0, 0] as Vec3,
    label: `Si${idx}`,
    properties: props,
  })

  test(`maps direct indices without supercell`, () => {
    const sites = [base_site(0), base_site(1), base_site(2)]
    const result = scene_to_structure_indices(sites, [0, 2], false)
    expect(result).toEqual(new Set([0, 2]))
  })

  test(`maps supercell atoms via orig_unit_cell_idx`, () => {
    const sites = [
      base_site(0),
      base_site(1, { orig_unit_cell_idx: 0 }),
      base_site(2, { orig_unit_cell_idx: 1 }),
    ]
    const result = scene_to_structure_indices(sites, [1, 2], true)
    expect(result).toEqual(new Set([0, 1]))
  })

  test(`skips image atoms when skip_image_atoms is true`, () => {
    const sites = [
      base_site(0),
      base_site(1, { orig_site_idx: 0 }),
      base_site(2),
    ]
    const result = scene_to_structure_indices(sites, [0, 1, 2], false, true)
    expect(result).toEqual(new Set([0, 2]))
  })

  test(`includes image atoms when skip_image_atoms is false`, () => {
    const sites = [
      base_site(0),
      base_site(1, { orig_site_idx: 0 }),
      base_site(2),
    ]
    const result = scene_to_structure_indices(sites, [0, 1, 2], false, false)
    expect(result).toEqual(new Set([0, 1, 2]))
  })

  test(`deduplicates supercell mappings to same original index`, () => {
    const sites = [
      base_site(0, { orig_unit_cell_idx: 0 }),
      base_site(1, { orig_unit_cell_idx: 0 }),
      base_site(2, { orig_unit_cell_idx: 1 }),
    ]
    const result = scene_to_structure_indices(sites, [0, 1, 2], true)
    expect(result).toEqual(new Set([0, 1]))
  })

  test(`skips out-of-bounds indices`, () => {
    const sites = [base_site(0)]
    const result = scene_to_structure_indices(sites, [0, 5, 10], false)
    expect(result).toEqual(new Set([0]))
  })

  test(`handles empty selection`, () => {
    const sites = [base_site(0), base_site(1)]
    const result = scene_to_structure_indices(sites, [], false)
    expect(result).toEqual(new Set())
  })
})

// === Undo/Redo Stack Behavior ===
// Tests the push/pop invariants used by the edit-atoms undo/redo system

describe(`edit-atoms: undo/redo stack`, () => {
  const MAX_HISTORY = 20

  function create_stack_ops() {
    let undo_stack: AnyStructure[] = []
    let redo_stack: AnyStructure[] = []

    function push_undo(structure: AnyStructure) {
      undo_stack = [...undo_stack.slice(-(MAX_HISTORY - 1)), structuredClone(structure)]
      redo_stack = []
    }

    function undo(structure: AnyStructure): AnyStructure | null {
      if (undo_stack.length === 0) return null
      redo_stack = [...redo_stack, structuredClone(structure)]
      const restored = undo_stack.at(-1) ?? null
      undo_stack = undo_stack.slice(0, -1)
      return restored
    }

    function redo(structure: AnyStructure): AnyStructure | null {
      if (redo_stack.length === 0) return null
      undo_stack = [...undo_stack, structuredClone(structure)]
      const restored = redo_stack.at(-1) ?? null
      redo_stack = redo_stack.slice(0, -1)
      return restored
    }

    return {
      push_undo,
      undo,
      redo,
      get undo_count() {
        return undo_stack.length
      },
      get redo_count() {
        return redo_stack.length
      },
    }
  }

  test(`push_undo adds entry and clears redo`, () => {
    const ops = create_stack_ops()
    const struct = get_dummy_structure(`H`, 2)
    ops.push_undo(struct)
    expect(ops.undo_count).toBe(1)
    expect(ops.redo_count).toBe(0)
  })

  test(`undo moves entry from undo to redo stack`, () => {
    const ops = create_stack_ops()
    const struct_v1 = get_dummy_structure(`H`, 2)
    const struct_v2 = get_dummy_structure(`H`, 3)

    ops.push_undo(struct_v1)
    const restored = ops.undo(struct_v2)

    expect(restored).toBeTruthy()
    expect(restored?.sites).toHaveLength(2)
    expect(ops.undo_count).toBe(0)
    expect(ops.redo_count).toBe(1)
  })

  test(`redo moves entry from redo to undo stack`, () => {
    const ops = create_stack_ops()
    const struct_v1 = get_dummy_structure(`H`, 2)
    const struct_v2 = get_dummy_structure(`H`, 3)

    ops.push_undo(struct_v1)
    ops.undo(struct_v2)
    const restored = ops.redo(struct_v1)

    expect(restored).toBeTruthy()
    expect(restored?.sites).toHaveLength(3)
    expect(ops.undo_count).toBe(1)
    expect(ops.redo_count).toBe(0)
  })

  test(`undo on empty stack returns null`, () => {
    const ops = create_stack_ops()
    const struct = get_dummy_structure(`H`, 2)
    expect(ops.undo(struct)).toBeNull()
  })

  test(`redo on empty stack returns null`, () => {
    const ops = create_stack_ops()
    const struct = get_dummy_structure(`H`, 2)
    expect(ops.redo(struct)).toBeNull()
  })

  test(`push_undo caps at MAX_HISTORY`, () => {
    const ops = create_stack_ops()
    for (let idx = 0; idx < MAX_HISTORY + 5; idx++) {
      ops.push_undo(get_dummy_structure(`H`, idx + 1))
    }
    expect(ops.undo_count).toBe(MAX_HISTORY)
  })

  test(`push_undo clears redo stack`, () => {
    const ops = create_stack_ops()
    const struct_v1 = get_dummy_structure(`H`, 2)
    const struct_v2 = get_dummy_structure(`H`, 3)
    const struct_v3 = get_dummy_structure(`H`, 4)

    ops.push_undo(struct_v1)
    ops.undo(struct_v2)
    expect(ops.redo_count).toBe(1)

    // New edit should clear redo
    ops.push_undo(struct_v3)
    expect(ops.redo_count).toBe(0)
  })

  test(`multiple undo/redo round-trips preserve order`, () => {
    const ops = create_stack_ops()
    const structs = Array.from(
      { length: 5 },
      (_, idx) => get_dummy_structure(`H`, idx + 1),
    )

    // Push v0..v3 to undo stack (editing forward)
    for (const struct of structs.slice(0, 4)) ops.push_undo(struct)
    expect(ops.undo_count).toBe(4)

    // Undo twice: v4 → v3 → v2
    let current: AnyStructure | null = structs[4]
    current = ops.undo(current)
    expect(current?.sites).toHaveLength(4)
    current = ops.undo(current ?? structs[4])
    expect(current?.sites).toHaveLength(3)
    expect(ops.redo_count).toBe(2)

    // Redo once: v2 → v3
    current = ops.redo(current ?? structs[2])
    expect(current?.sites).toHaveLength(4)
    expect(ops.redo_count).toBe(1)
  })
})

// === Image Atom Detection ===
// Tests that get_pbc_image_sites marks image atoms with orig_site_idx

describe(`edit-atoms: image atom detection`, () => {
  test(`image atoms have orig_site_idx property`, () => {
    const crystal = make_crystal(5, [
      [`Si`, [0.1, 0.1, 0.1]],
      [`Si`, [0.5, 0.5, 0.5]],
    ])

    const with_images = get_pbc_image_sites(crystal)
    const image_sites = with_images.sites.filter(
      (site) => site.properties?.orig_site_idx !== undefined,
    )
    const base_sites = with_images.sites.filter(
      (site) => site.properties?.orig_site_idx === undefined,
    )

    // Base sites should equal original count
    expect(base_sites).toHaveLength(2)
    // Image atoms should have orig_site_idx pointing back to original
    for (const img of image_sites) {
      const orig_idx = img.properties?.orig_site_idx as number
      expect(orig_idx).toBeGreaterThanOrEqual(0)
      expect(orig_idx).toBeLessThan(2)
    }
  })
})

// === Coordinate Conversion for Added Atoms ===

describe(`edit-atoms: coordinate conversion`, () => {
  test(`cart_to_frac produces correct fractional coords for cubic lattice`, () => {
    const lattice_matrix = [[5, 0, 0], [0, 5, 0], [0, 0, 5]] as const
    const cart_to_frac = create_cart_to_frac(
      lattice_matrix as unknown as [Vec3, Vec3, Vec3],
    )

    const xyz: Vec3 = [2.5, 2.5, 2.5]
    const abc = cart_to_frac(xyz)

    expect(abc[0]).toBeCloseTo(0.5)
    expect(abc[1]).toBeCloseTo(0.5)
    expect(abc[2]).toBeCloseTo(0.5)
  })

  test(`cart_to_frac handles non-orthogonal lattice`, () => {
    // Hexagonal-like lattice
    const lattice_matrix: [Vec3, Vec3, Vec3] = [
      [5, 0, 0],
      [2.5, 4.33, 0],
      [0, 0, 8],
    ]
    const cart_to_frac = create_cart_to_frac(lattice_matrix)

    // Origin should map to [0,0,0]
    const abc_origin = cart_to_frac([0, 0, 0])
    expect(abc_origin[0]).toBeCloseTo(0)
    expect(abc_origin[1]).toBeCloseTo(0)
    expect(abc_origin[2]).toBeCloseTo(0)

    // First lattice vector endpoint should map to [1,0,0]
    const abc_a = cart_to_frac([5, 0, 0])
    expect(abc_a[0]).toBeCloseTo(1)
    expect(abc_a[1]).toBeCloseTo(0)
    expect(abc_a[2]).toBeCloseTo(0)
  })
})
