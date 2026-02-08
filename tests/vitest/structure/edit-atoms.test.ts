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
    } else if (site.properties?.orig_site_idx !== undefined) {
      // Image atom (PBC ghost) — map back to its original site index
      result.add(site.properties.orig_site_idx as number)
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

  test(`maps image atoms back to orig_site_idx when not skipped`, () => {
    const sites = [
      base_site(0),
      base_site(1, { orig_site_idx: 0 }),
      base_site(2),
    ]
    const result = scene_to_structure_indices(sites, [0, 1, 2], false, false)
    // Image atom at scene index 1 maps back to original site 0 (deduped with site 0)
    expect(result).toEqual(new Set([0, 2]))
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

// === Bond Toggle Logic ===
// Mirrors toggle_bond from StructureScene.svelte

type BondPair = {
  site_idx_1: number
  site_idx_2: number
}

function get_bond_key(idx1: number, idx2: number): string {
  return idx1 < idx2 ? `${idx1}-${idx2}` : `${idx2}-${idx1}`
}

function create_bond_state(calculated: BondPair[] = []) {
  let added: [number, number][] = []
  let removed: [number, number][] = []

  function toggle_bond(site_1: number, site_2: number) {
    const idx_i = Math.min(site_1, site_2)
    const idx_j = Math.max(site_1, site_2)
    const match = ([a, b]: [number, number]) => a === idx_i && b === idx_j

    const added_idx = added.findIndex(match)
    if (added_idx >= 0) {
      added = added.toSpliced(added_idx, 1)
      return
    }

    const removed_idx = removed.findIndex(match)
    if (removed_idx >= 0) {
      removed = removed.toSpliced(removed_idx, 1)
      return
    }

    const key = `${idx_i}-${idx_j}`
    if (
      calculated.some((bond) => get_bond_key(bond.site_idx_1, bond.site_idx_2) === key)
    ) {
      removed = [...removed, [idx_i, idx_j]]
    } else {
      added = [...added, [idx_i, idx_j]]
    }
  }

  return {
    toggle_bond,
    get added_bonds() {
      return added
    },
    get removed_bonds() {
      return removed
    },
  }
}

describe(`edit-bonds: toggle_bond`, () => {
  test(`adds bond between unconnected atoms, sorted regardless of input order`, () => {
    const state = create_bond_state()
    state.toggle_bond(5, 2)
    expect(state.added_bonds).toEqual([[2, 5]])
    expect(state.removed_bonds).toEqual([])
  })

  test(`removes manually added bond on second toggle`, () => {
    const state = create_bond_state()
    state.toggle_bond(0, 3)
    expect(state.added_bonds).toHaveLength(1)
    state.toggle_bond(0, 3)
    expect(state.added_bonds).toHaveLength(0)
  })

  test(`removes calculated bond (handles reversed indices in bond_pairs)`, () => {
    // bond_pairs may have site_idx_1 > site_idx_2
    const state = create_bond_state([{ site_idx_1: 5, site_idx_2: 2 }])
    state.toggle_bond(2, 5)
    expect(state.removed_bonds).toEqual([[2, 5]])
    expect(state.added_bonds).toEqual([])
  })

  test(`restores removed calculated bond on second toggle`, () => {
    const state = create_bond_state([{ site_idx_1: 0, site_idx_2: 1 }])
    state.toggle_bond(0, 1) // remove
    expect(state.removed_bonds).toHaveLength(1)
    state.toggle_bond(0, 1) // restore
    expect(state.removed_bonds).toHaveLength(0)
  })

  test(`full cycle: add → remove → re-add for non-calculated bond`, () => {
    const state = create_bond_state()
    state.toggle_bond(1, 4)
    expect(state.added_bonds).toEqual([[1, 4]])
    state.toggle_bond(1, 4)
    expect(state.added_bonds).toEqual([])
    state.toggle_bond(1, 4)
    expect(state.added_bonds).toEqual([[1, 4]])
  })

  test(`manages multiple bonds independently`, () => {
    const state = create_bond_state([{ site_idx_1: 0, site_idx_2: 1 }])
    state.toggle_bond(0, 1) // remove calculated
    state.toggle_bond(2, 3) // add new
    state.toggle_bond(4, 5) // add new
    expect(state.removed_bonds).toEqual([[0, 1]])
    expect(state.added_bonds).toEqual([[2, 3], [4, 5]])
  })
})

// === Change Element Logic ===
// Mirrors handle_change_element from Structure.svelte

function change_element_on_structure(
  structure: AnyStructure,
  selected_indices: Set<number>,
  new_element: string,
): AnyStructure | null {
  const normalized = (new_element.charAt(0).toUpperCase() +
    new_element.slice(1).toLowerCase()) as ElementSymbol
  if (!ELEM_SYMBOLS.includes(normalized)) return null
  return {
    ...structure,
    sites: structure.sites.map((site, idx) => {
      if (!selected_indices.has(idx)) return site
      return {
        ...site,
        species: [{ element: normalized, occu: 1, oxidation_state: 0 }],
        label: normalized,
      }
    }),
  }
}

describe(`edit-atoms: change element`, () => {
  test(`changes single atom element and label`, () => {
    const struct = get_dummy_structure(`H`, 3)
    const result = change_element_on_structure(struct, new Set([1]), `Fe`)
    expect(result?.sites[0].species[0].element).toBe(`H`)
    expect(result?.sites[1].species[0].element).toBe(`Fe`)
    expect(result?.sites[1].label).toBe(`Fe`)
    expect(result?.sites[2].species[0].element).toBe(`H`)
  })

  test(`changes multiple atoms and normalizes case`, () => {
    const struct = get_dummy_structure(`H`, 4)
    const result = change_element_on_structure(struct, new Set([0, 2, 3]), `o`)
    const elements = result?.sites.map((s) => s.species[0].element)
    expect(elements).toEqual([`O`, `H`, `O`, `O`])
  })

  test.each([`Xx`, ``, `123`])(`rejects invalid symbol "%s"`, (sym) => {
    expect(change_element_on_structure(get_dummy_structure(`H`, 1), new Set([0]), sym))
      .toBeNull()
  })

  test(`preserves unselected atoms by reference`, () => {
    const struct = get_dummy_structure(`Si`, 3)
    const original_site = struct.sites[1]
    const result = change_element_on_structure(struct, new Set([0]), `Ge`)
    expect(result?.sites[1]).toBe(original_site)
  })

  test(`resets oxidation state to 0`, () => {
    const struct: AnyStructure = {
      sites: [{
        species: [{ element: `Fe` as ElementSymbol, occu: 1, oxidation_state: 3 }],
        xyz: [0, 0, 0] as Vec3,
        abc: [0, 0, 0] as Vec3,
        label: `Fe`,
        properties: {},
      }],
    }
    const result = change_element_on_structure(struct, new Set([0]), `Mn`)
    expect(result?.sites[0].species[0].oxidation_state).toBe(0)
  })
})

// === Atom Duplication Logic ===
// Mirrors the Ctrl+D duplication from Structure.svelte

function duplicate_atoms(
  structure: AnyStructure,
  selected_indices: Set<number>,
  offset: Vec3 = [0.5, 0.5, 0.5],
): { structure: AnyStructure; new_indices: number[] } {
  const new_sites = structure.sites
    .filter((_, idx) => selected_indices.has(idx))
    .map((site) => ({
      ...site,
      xyz: [
        site.xyz[0] + offset[0],
        site.xyz[1] + offset[1],
        site.xyz[2] + offset[2],
      ] as Vec3,
      abc: [site.abc[0] + 0.05, site.abc[1] + 0.05, site.abc[2] + 0.05] as Vec3,
      properties: { ...site.properties },
    }))
  const base_idx = structure.sites.length
  return {
    structure: { ...structure, sites: [...structure.sites, ...new_sites] },
    new_indices: new_sites.map((_, idx) => base_idx + idx),
  }
}

describe(`edit-atoms: duplicate atoms`, () => {
  test(`duplicates single atom with offset and correct element`, () => {
    const struct = get_dummy_structure(`Si`, 2)
    const { structure: result, new_indices } = duplicate_atoms(struct, new Set([0]))
    expect(result.sites).toHaveLength(3)
    expect(new_indices).toEqual([2])
    expect(result.sites[2].xyz[0]).toBeCloseTo(struct.sites[0].xyz[0] + 0.5)
    expect(result.sites[2].species[0].element).toBe(`Si`)
  })

  test(`duplicates multiple atoms with correct indices`, () => {
    const struct = get_dummy_structure(`Fe`, 4)
    const { structure: result, new_indices } = duplicate_atoms(struct, new Set([1, 3]))
    expect(result.sites).toHaveLength(6)
    expect(new_indices).toEqual([4, 5])
  })

  test(`creates independent copies (no shared property references)`, () => {
    const struct = get_dummy_structure(`C`, 1)
    struct.sites[0].properties = { force: [1, 0, 0] }
    const { structure: result } = duplicate_atoms(struct, new Set([0]))
    ;(result.sites[1].properties as Record<string, unknown>).force = [0, 0, 0]
    expect(struct.sites[0].properties.force).toEqual([1, 0, 0])
  })

  test(`preserves original atoms unchanged`, () => {
    const struct = get_dummy_structure(`O`, 3)
    const { structure: result } = duplicate_atoms(struct, new Set([1]))
    for (let idx = 0; idx < 3; idx++) {
      expect(result.sites[idx].xyz).toEqual(struct.sites[idx].xyz)
    }
  })

  test(`handles empty selection`, () => {
    const struct = get_dummy_structure(`H`, 3)
    const { structure: result, new_indices } = duplicate_atoms(struct, new Set())
    expect(result.sites).toHaveLength(3)
    expect(new_indices).toEqual([])
  })

  test(`applies custom offset`, () => {
    const struct = get_dummy_structure(`Na`, 1)
    const offset: Vec3 = [1.0, 2.0, 3.0]
    const { structure: result } = duplicate_atoms(struct, new Set([0]), offset)
    expect(result.sites[1].xyz[0]).toBeCloseTo(struct.sites[0].xyz[0] + 1.0)
    expect(result.sites[1].xyz[1]).toBeCloseTo(struct.sites[0].xyz[1] + 2.0)
    expect(result.sites[1].xyz[2]).toBeCloseTo(struct.sites[0].xyz[2] + 3.0)
  })
})

// === Canvas Cursor Logic ===
// Mirrors the canvas_cursor derived from StructureScene.svelte

type CursorContext = {
  measure_mode: string
  add_atom_mode: boolean
  hovered_idx: number | null
  site_is_image: (idx: number) => boolean
}

function get_canvas_cursor(ctx: CursorContext): string {
  if (ctx.measure_mode === `edit-atoms` && ctx.add_atom_mode) return `crosshair`
  if (ctx.hovered_idx !== null) {
    if (ctx.measure_mode === `edit-atoms`) {
      if (ctx.site_is_image(ctx.hovered_idx)) return `not-allowed`
      return `pointer`
    }
    return `pointer`
  }
  return `default`
}

describe(`canvas cursor`, () => {
  const no_image = () => false
  const all_image = () => true

  test.each([
    {
      desc: `crosshair in add-atom mode (not hovering)`,
      mode: `edit-atoms`,
      add: true,
      hover: null,
      image: false,
      expected: `crosshair`,
    },
    {
      desc: `crosshair in add-atom mode (hovering)`,
      mode: `edit-atoms`,
      add: true,
      hover: 3,
      image: false,
      expected: `crosshair`,
    },
    {
      desc: `pointer on selectable atom`,
      mode: `edit-atoms`,
      add: false,
      hover: 0,
      image: false,
      expected: `pointer`,
    },
    {
      desc: `not-allowed on image atom`,
      mode: `edit-atoms`,
      add: false,
      hover: 2,
      image: true,
      expected: `not-allowed`,
    },
    {
      desc: `default when not hovering`,
      mode: `edit-atoms`,
      add: false,
      hover: null,
      image: false,
      expected: `default`,
    },
  ])(`$desc`, ({ mode, add, hover, image, expected }) => {
    expect(get_canvas_cursor({
      measure_mode: mode,
      add_atom_mode: add,
      hovered_idx: hover,
      site_is_image: image ? all_image : no_image,
    })).toBe(expected)
  })

  test.each([`distance`, `angle`, `edit-bonds`])(
    `shows pointer in %s mode when hovering`,
    (mode) => {
      expect(get_canvas_cursor({
        measure_mode: mode,
        add_atom_mode: false,
        hovered_idx: 0,
        site_is_image: no_image,
      })).toBe(`pointer`)
    },
  )
})

// === Edit-atoms Selection Logic ===
// Mirrors toggle_selection edit-atoms branch from StructureScene.svelte

function edit_atoms_toggle(
  site_index: number,
  selected: number[],
  is_shift: boolean,
  is_image: boolean,
): number[] {
  if (is_image) return selected // block image atoms
  const is_selected = selected.includes(site_index)
  if (is_shift) {
    return is_selected
      ? selected.filter((idx) => idx !== site_index)
      : [...selected, site_index]
  }
  return is_selected ? [] : [site_index]
}

describe(`edit-atoms: selection toggle`, () => {
  test.each([
    {
      desc: `single click selects atom`,
      idx: 3,
      sel: [],
      shift: false,
      img: false,
      expected: [3],
    },
    {
      desc: `single click deselects all`,
      idx: 1,
      sel: [1, 2],
      shift: false,
      img: false,
      expected: [],
    },
    {
      desc: `single click replaces selection`,
      idx: 3,
      sel: [1, 2],
      shift: false,
      img: false,
      expected: [3],
    },
    {
      desc: `shift+click adds to selection`,
      idx: 3,
      sel: [1],
      shift: true,
      img: false,
      expected: [1, 3],
    },
    {
      desc: `shift+click removes from selection`,
      idx: 1,
      sel: [1, 2, 3],
      shift: true,
      img: false,
      expected: [2, 3],
    },
    {
      desc: `blocks image atom click`,
      idx: 5,
      sel: [1],
      shift: false,
      img: true,
      expected: [1],
    },
    {
      desc: `blocks image atom shift+click`,
      idx: 5,
      sel: [1],
      shift: true,
      img: true,
      expected: [1],
    },
  ])(`$desc`, ({ idx, sel, shift, img, expected }) => {
    expect(edit_atoms_toggle(idx, sel, shift, img)).toEqual(expected)
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
