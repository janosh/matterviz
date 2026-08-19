// Unit tests for edit-atoms mode pure logic (runs in CI without WebGL)
import type { Vec3 } from '$lib'
import { create_cart_to_frac } from '$lib/math'
import type { AnyStructure } from '$lib/structure'
import { get_pbc_image_sites } from '$lib/structure'
import type { HistoryStacks } from '$lib/structure/edit-history'
import { push_edit, step_history } from '$lib/structure/edit-history'
import { describe, expect, test } from 'vitest'
import { get_dummy_structure, make_crystal } from '../setup'

// === Undo/Redo Stack Behavior ===
// Exercises the REAL history helpers used by Structure.svelte (push_edit /
// step_history from $lib/structure/edit-history), wrapped in the same
// reassignment pattern the component uses for its $state.raw stacks.

describe(`edit-atoms: undo/redo stack`, () => {
  const MAX_HISTORY = 20

  function create_stack_ops() {
    let stacks: HistoryStacks<AnyStructure> = [[], []]

    return {
      push_undo(structure: AnyStructure) {
        stacks = push_edit(stacks, structuredClone(structure), MAX_HISTORY)
      },
      undo(structure: AnyStructure): AnyStructure | null {
        const result = step_history(stacks, `undo`, structuredClone(structure))
        if (!result) return null
        stacks = result.stacks
        return result.restored
      },
      redo(structure: AnyStructure): AnyStructure | null {
        const result = step_history(stacks, `redo`, structuredClone(structure))
        if (!result) return null
        stacks = result.stacks
        return result.restored
      },
      get undo_count() {
        return stacks[0].length
      },
      get redo_count() {
        return stacks[1].length
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

    expect(restored?.sites).toHaveLength(3)
    expect(ops.undo_count).toBe(1)
    expect(ops.redo_count).toBe(0)
  })

  test.each([`undo`, `redo`] as const)(`%s on empty stack returns null`, (direction) => {
    const ops = create_stack_ops()
    expect(ops[direction](get_dummy_structure(`H`, 2))).toBeNull()
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
    ops.push_undo(get_dummy_structure(`H`, 2))
    ops.undo(get_dummy_structure(`H`, 3))
    expect(ops.redo_count).toBe(1)

    // New edit should clear redo
    ops.push_undo(get_dummy_structure(`H`, 4))
    expect(ops.redo_count).toBe(0)
  })

  test(`multiple undo/redo round-trips preserve order`, () => {
    const ops = create_stack_ops()
    const structs = Array.from({ length: 5 }, (_, idx) => get_dummy_structure(`H`, idx + 1))

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
    const lattice_matrix = [
      [5, 0, 0],
      [0, 5, 0],
      [0, 0, 5],
    ] as const
    const cart_to_frac = create_cart_to_frac(lattice_matrix as unknown as [Vec3, Vec3, Vec3])

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
