// Headless StructureSession: the display pipeline (supercell, image atoms, element map),
// selection validated against what is displayed, invalidation on topology/transform/mode
// changes, edit-atoms operations with undo/redo, the edit-bonds layer and pane bookkeeping.
import type { Vec3 } from '$lib/math'
import type {
  AnyStructure,
  BondEditMode,
  BondOrder,
  MeasureMode,
  StructureBond,
} from '$lib/structure'
import type { AtomColorConfig } from '$lib/structure/atom-properties'
import { DEFAULT_ATOM_COLOR_CONFIG } from '$lib/structure/atom-properties'
import { MAX_HISTORY, StructureSession } from '$lib/structure/session.svelte'
import { is_image_site } from '$lib/structure/site'
import { make_supercell } from '$lib/structure/supercell'
import type { CellType, SymmetryDataset } from '$lib/symmetry'
import { analyze_structure_symmetry } from '$lib/symmetry'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fcc_primitive_matrix,
  get_dummy_structure,
  init_moyo_for_tests,
  make_crystal,
} from '../setup'

type Host = {
  structure: AnyStructure | undefined
  bonds: StructureBond[] | undefined
  series_key: unknown
  selected_sites: number[]
  measured_sites: number[]
  highlighted_sites: number[]
  hovered_site_idx: number | null
  measure_mode: MeasureMode
  bond_edit_mode: BondEditMode
  bond_edit_order: BondOrder
  supercell_scaling: string
  apply_supercell_scaling: boolean
  show_image_atoms: boolean
  cell_type: CellType
  sym_data: SymmetryDataset | null
  atom_color_config: AtomColorConfig
}

const crystal = (atoms = 3): AnyStructure => get_dummy_structure(`H`, atoms, true)

function make_session(initial: Partial<Host> = {}) {
  const host = $state<Host>({
    structure: crystal(),
    bonds: undefined,
    series_key: undefined,
    selected_sites: [],
    measured_sites: [],
    highlighted_sites: [],
    hovered_site_idx: null,
    measure_mode: `distance`,
    bond_edit_mode: `add`,
    bond_edit_order: 1,
    supercell_scaling: `1x1x1`,
    apply_supercell_scaling: true,
    show_image_atoms: false,
    cell_type: `original`,
    sym_data: null,
    atom_color_config: DEFAULT_ATOM_COLOR_CONFIG,
    ...initial,
  })
  const notices: string[] = []
  let session!: StructureSession
  const destroy = $effect.root(() => {
    session = new StructureSession({
      structure: () => host.structure,
      set_structure: (value) => (host.structure = value),
      bonds: () => host.bonds,
      set_bonds: (value) => (host.bonds = value),
      series_key: () => host.series_key ?? host.structure,
      selected_sites: () => host.selected_sites,
      set_selected_sites: (value) => (host.selected_sites = value),
      measured_sites: () => host.measured_sites,
      set_measured_sites: (value) => (host.measured_sites = value),
      highlighted_sites: () => host.highlighted_sites,
      set_highlighted_sites: (value) => (host.highlighted_sites = value),
      hovered_site_idx: () => host.hovered_site_idx,
      set_hovered_site_idx: (value) => (host.hovered_site_idx = value),
      measure_mode: () => host.measure_mode,
      set_measure_mode: (value) => (host.measure_mode = value),
      bond_edit_mode: () => host.bond_edit_mode,
      set_bond_edit_mode: (value) => (host.bond_edit_mode = value),
      bond_edit_order: () => host.bond_edit_order,
      set_bond_edit_order: (value) => (host.bond_edit_order = value),
      supercell_scaling: () => host.supercell_scaling,
      apply_supercell_scaling: () => host.apply_supercell_scaling,
      show_image_atoms: () => host.show_image_atoms,
      cell_type: () => host.cell_type,
      set_cell_type: (value) => (host.cell_type = value),
      sym_data: () => host.sym_data,
      atom_color_config: () => host.atom_color_config,
      bonding_strategy: () => `electroneg_ratio`,
      on_notice: (message) => notices.push(message),
    })
  })
  flushSync()
  return { host, session, notices, destroy }
}

// Every site with image atoms: the dummy crystal puts all atoms on cell boundaries
const pick_all = (host: Host, session: StructureSession): void => {
  const count = session.displayed_structure?.sites.length ?? 0
  host.selected_sites = [0, count - 1]
  host.measured_sites = [0, count - 1]
  flushSync()
}

beforeEach(() => vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`] }))
afterEach(() => vi.useRealTimers())

describe(`display pipeline`, () => {
  it(`adds image atoms, tiles supercells synchronously below the async threshold and maps elements`, () => {
    const { host, session, destroy } = make_session()
    expect(session.displayed_structure?.sites).toHaveLength(3)
    host.show_image_atoms = true
    flushSync()
    const with_images = session.displayed_structure?.sites.length ?? 0
    expect(with_images).toBeGreaterThan(3)
    host.supercell_scaling = `2x1x1`
    flushSync()
    expect(session.supercell_loading).toBe(false)
    expect(session.supercell_structure?.sites).toHaveLength(6)
    expect(session.scaled_cell_displayed).toBe(true)
    expect(session.volume_scaling).toEqual([2, 1, 1])
    expect(session.bond_edits_enabled).toBe(false)
    session.element_mapping = { H: `Na` }
    flushSync()
    expect(
      session.displayed_structure?.sites.every((site) => site.species[0].element === `Na`),
    ).toBe(true)
    destroy()
  })

  it(`builds large supercells off the main task and keeps the previous build while loading`, () => {
    const { host, session, destroy } = make_session({ structure: crystal(200) })
    host.supercell_scaling = `2x2x2`
    flushSync()
    expect(session.supercell_loading).toBe(true)
    expect(session.displayed_structure?.sites).toHaveLength(200)
    expect(session.volume_scaling).toEqual([1, 1, 1])
    vi.runAllTimers()
    flushSync()
    expect(session.supercell_loading).toBe(false)
    expect(session.displayed_structure?.sites).toHaveLength(1600)
    expect(session.volume_scaling).toEqual([2, 2, 2])
    destroy()
  })

  // A caller-supplied supercell (phonon mode explorer) carries orig_unit_cell_idx into a cell
  // that is not displayed; edits and coordination colors must index the displayed sites, not
  // follow those indices. Only the session's own supercell and image-atom provenance are followed.
  it(`ignores foreign orig_unit_cell_idx on the input structure`, () => {
    const base = make_crystal(4, [
      { element: `Na`, abc: [0, 0, 0] },
      { element: `Cl`, abc: [0.5, 0.5, 0.5] },
    ])
    const foreign = make_supercell(base, [2, 1, 1])
    expect(foreign.sites.map((site) => site.properties.orig_unit_cell_idx)).toEqual([
      0, 1, 0, 1,
    ])
    const coordination_config: AtomColorConfig = {
      ...DEFAULT_ATOM_COLOR_CONFIG,
      mode: `coordination`,
    }
    const { host, session, destroy } = make_session({
      structure: foreign,
      show_image_atoms: true,
      atom_color_config: coordination_config,
    })
    const displayed = session.displayed_structure?.sites ?? []
    expect(displayed.length).toBeGreaterThan(4)
    // the third displayed site is the second Na copy; deleting it must not resolve to site 0
    // (its unit-cell ancestor), and image atoms map to the displayed site they mirror
    expect([...session.scene_to_structure_indices([2])]).toEqual([2])
    const image_idx = displayed.findIndex((site) => site.properties.orig_site_idx === 2)
    expect(image_idx).toBeGreaterThan(3)
    expect([...session.scene_to_structure_indices([image_idx])]).toEqual([2])
    // coordination colors follow the same mapping: every displayed site gets its own value
    const values = session.property_colors?.values ?? []
    expect(values).toHaveLength(displayed.length)
    expect(values.slice(0, 4)).toEqual(Array(4).fill(values[0]))
    expect(values[image_idx]).toBe(values[2])

    // once the session tiles a supercell itself, its orig_unit_cell_idx is followed
    host.supercell_scaling = `1x2x1`
    flushSync()
    expect(session.supercell_structure?.sites).toHaveLength(8)
    const site_idx = session.displayed_structure?.sites.findIndex(
      (site) => site.properties.orig_unit_cell_idx === 3 && !is_image_site(site),
    )
    expect([...session.scene_to_structure_indices([site_idx ?? -1])]).toEqual([3])
    destroy()
  })

  it(`shows an already-materialized supercell as-is and falls back on invalid scaling`, () => {
    const { host, session, destroy } = make_session({
      supercell_scaling: `3x3x3`,
      apply_supercell_scaling: false,
    })
    expect(session.displayed_structure?.sites).toHaveLength(3)
    expect(session.scaled_cell_displayed).toBe(true)
    host.apply_supercell_scaling = true
    host.supercell_scaling = `invalid`
    flushSync()
    expect(session.has_supercell).toBe(false)
    expect(session.displayed_structure?.sites).toHaveLength(3)
    expect(session.bond_edits_enabled).toBe(true)
    destroy()
  })
})

describe(`symmetry-aware display`, () => {
  // Primitive fcc Cu: the 1-atom input cell expands to a 4-atom conventional cell, so every
  // site-indexed consumer must be re-expressed onto the displayed cell
  const prim_fcc_cu = () =>
    make_crystal(fcc_primitive_matrix(3.61), [{ element: `Cu`, abc: [0, 0, 0] }])

  it(`maps Wyckoff rows and Wyckoff colors onto the displayed conventional cell`, async () => {
    await init_moyo_for_tests()
    const structure = prim_fcc_cu()
    const sym_data = await analyze_structure_symmetry(structure)
    const wyckoff_config: AtomColorConfig = {
      ...DEFAULT_ATOM_COLOR_CONFIG,
      mode: `wyckoff`,
      scale_type: `categorical`,
    }
    const { host, session, destroy } = make_session({
      structure,
      sym_data,
      atom_color_config: wyckoff_config,
    })
    expect(session.shows_input_frame).toBe(true)
    expect(session.wyckoff_rows).toEqual([
      expect.objectContaining({ wyckoff: `4a`, elem: `Cu`, site_indices: [0] }),
    ])
    expect(session.property_colors?.values).toEqual([`4a|Cu`])

    host.cell_type = `conventional`
    flushSync()
    expect(session.displayed_structure?.sites).toHaveLength(4)
    expect(session.shows_input_frame).toBe(false)
    // all four conventional-cell copies belong to the single 4a row ...
    expect(session.wyckoff_rows[0].site_indices).toEqual([0, 1, 2, 3])
    // ... and are colored by it (indexing the analyzed cell would leave three `unknown`)
    expect(session.property_colors?.values).toEqual(Array(4).fill(`4a|Cu`))
    expect(new Set(session.property_colors?.colors).size).toBe(1)

    // a supercell of the input cell stays in the input frame; image atoms join their row
    host.cell_type = `original`
    host.supercell_scaling = `2x1x1`
    host.show_image_atoms = true
    flushSync()
    expect(session.shows_input_frame).toBe(true)
    const n_displayed = session.displayed_structure?.sites.length ?? 0
    expect(n_displayed).toBeGreaterThan(2)
    expect(session.wyckoff_rows[0].site_indices).toHaveLength(n_displayed)
    expect(session.property_colors?.colors).toHaveLength(n_displayed)

    host.atom_color_config = DEFAULT_ATOM_COLOR_CONFIG
    flushSync()
    expect(session.property_colors).toBeNull()
    destroy()
  })
})

describe(`selection validity`, () => {
  it(`never exposes a site index the displayed structure does not have`, () => {
    const { host, session, destroy } = make_session({ show_image_atoms: true })
    pick_all(host, session)
    const count = session.displayed_structure?.sites.length ?? 0
    expect(session.measured_sites).toEqual([0, count - 1])
    host.show_image_atoms = false
    flushSync()
    // The pre-effect cleared the host picks before any consumer could read them
    expect(host.measured_sites).toEqual([])
    expect(host.selected_sites).toEqual([])
    // Even a stale write from a host is filtered against the displayed count
    host.measured_sites = [0, 99]
    host.hovered_site_idx = 99
    flushSync()
    expect(session.measured_sites).toEqual([0])
    expect(session.hovered_site_idx).toBeNull()
    destroy()
  })

  it(`keeps selection across coordinate-only frames and clears it on topology or series change`, () => {
    const base = crystal()
    const { host, session, destroy } = make_session({ structure: base, series_key: {} })
    host.selected_sites = [0]
    host.highlighted_sites = [1]
    host.hovered_site_idx = 1
    session.site_radius_overrides.set(0, 2)
    flushSync()
    // Parsers allocate fresh species arrays per frame: equal content is the same topology
    host.structure = {
      ...base,
      sites: base.sites.map((site) => ({
        ...site,
        xyz: [...site.xyz] as Vec3,
        species: site.species.map((entry) => ({ ...entry })),
      })),
    }
    flushSync()
    expect(host.selected_sites).toEqual([0])
    expect(session.site_radius_overrides.get(0)).toBe(2)
    // Same site count and labels, one element swapped: a different topology
    host.structure = {
      ...base,
      sites: base.sites.map((site, idx) =>
        idx === 0 ? { ...site, species: [{ ...site.species[0], element: `Xe` }] } : site,
      ),
    }
    flushSync()
    expect(host.selected_sites).toEqual([])
    host.selected_sites = [0]
    flushSync()
    host.structure = { ...base, sites: base.sites.slice(1) }
    flushSync()
    expect(host.selected_sites).toEqual([])
    expect(host.highlighted_sites).toEqual([])
    expect(host.hovered_site_idx).toBeNull()
    expect(session.site_radius_overrides.size).toBe(0)
    host.selected_sites = [0]
    flushSync()
    host.series_key = {}
    flushSync()
    expect(host.selected_sites).toEqual([])
    destroy()
  })

  it(`preserves the selection through transforms in edit-atoms mode only`, () => {
    const { host, destroy } = make_session({ measure_mode: `edit-atoms` })
    host.selected_sites = [0]
    flushSync()
    host.supercell_scaling = `2x1x1`
    flushSync()
    expect(host.selected_sites).toEqual([0])
    host.measure_mode = `distance`
    flushSync()
    expect(host.selected_sites, `mode switch clears`).toEqual([])
    host.measured_sites = [0]
    flushSync()
    host.show_image_atoms = true
    flushSync()
    expect(host.measured_sites).toEqual([])
    destroy()
  })

  it(`leaves edit-bonds mode with a notice when bond edits become unavailable`, () => {
    const { host, notices, destroy } = make_session({ measure_mode: `edit-bonds` })
    host.supercell_scaling = `2x2x2`
    flushSync()
    expect(host.measure_mode).toBe(`distance`)
    expect(notices).toContain(`Bond editing is only available for the original 1x1x1 cell`)
    destroy()
  })
})

describe(`edit-atoms`, () => {
  it(`deletes selected atoms (never images), remaps bonds and restores both on undo/redo`, () => {
    const bonds: StructureBond[] = [
      { site_idx_1: 0, site_idx_2: 1, order: 1 },
      { site_idx_1: 1, site_idx_2: 2, order: 2 },
    ]
    const { host, session, notices, destroy } = make_session({
      measure_mode: `edit-atoms`,
      bonds: structuredClone(bonds),
      show_image_atoms: true,
    })
    const image_idx = (session.displayed_structure?.sites.length ?? 0) - 1
    host.selected_sites = [0, image_idx]
    flushSync()
    expect(session.delete_selected()).toBe(true)
    flushSync()
    expect(host.structure?.sites).toHaveLength(2)
    expect(host.bonds).toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
    expect(host.selected_sites).toEqual([])
    expect(notices.at(-1)).toBe(`Deleted 1 site`)
    expect(session.history.undo_stack).toHaveLength(1)
    expect(session.undo()).toBe(true)
    flushSync()
    expect(host.structure?.sites).toHaveLength(3)
    expect(host.bonds).toEqual(bonds)
    expect(session.history.redo_stack).toHaveLength(1)
    expect(session.redo()).toBe(true)
    flushSync()
    expect(host.structure?.sites).toHaveLength(2)
    expect(session.undo()).toBe(true)
    expect(session.undo(), `nothing left`).toBe(false)
    expect(session.history.redo_stack).toHaveLength(1)
    session.push_undo()
    expect(session.history.redo_stack, `a new edit invalidates redo`).toHaveLength(0)
    destroy()
  })

  it(`duplicates into a new selection, changes elements and adds atoms with fractional coords`, () => {
    const { host, session, notices, destroy } = make_session({ measure_mode: `edit-atoms` })
    host.selected_sites = [1]
    flushSync()
    expect(session.duplicate_selected()).toBe(true)
    flushSync()
    expect(host.structure?.sites).toHaveLength(4)
    expect(host.selected_sites).toEqual([3])
    expect(host.measured_sites).toEqual([3])
    expect(host.structure?.sites[3].xyz).toEqual([1.5, 0.5, 0.5])
    expect(session.change_element(`fe`)).toBe(true)
    flushSync()
    expect(host.structure?.sites[3].species[0].element).toBe(`Fe`)
    expect(host.structure?.sites[3].label).toBe(`Fe`)
    expect(session.change_element(`Xx`), `unknown symbol`).toBe(false)
    session.add_atom([0.5, 0.5, 0.5], `O`)
    flushSync()
    const added = host.structure?.sites[4]
    expect(added?.species[0].element).toBe(`O`)
    expect(added?.abc.every((coord) => Math.abs(coord - 0.5 / 5) < 1e-12)).toBe(true)
    expect(notices.at(-1)).toBe(`Added O at (0.50, 0.50, 0.50)`)
    expect(session.history.undo_stack).toHaveLength(3)
    destroy()
  })

  it(`moves sites with wrapped fractional coordinates and caps history at MAX_HISTORY`, () => {
    const { host, session, destroy } = make_session({ measure_mode: `edit-atoms` })
    session.push_undo()
    session.move_sites([0], [5.5, 0, 0])
    flushSync()
    expect(host.structure?.sites[0].abc[0]).toBeCloseTo(0.1, 12)
    expect(host.structure?.sites[0].xyz[0]).toBeCloseTo(0.5, 12)
    for (let step = 0; step < MAX_HISTORY + 5; step++) session.push_undo()
    expect(session.history.undo_stack).toHaveLength(MAX_HISTORY)
    destroy()
  })

  // a slab's vacuum axis is aperiodic: a dragged atom stays where dropped, not folded back in
  it(`wraps only the periodic axes when moving sites of a slab`, () => {
    const slab = make_crystal(5, [{ element: `H`, abc: [0.5, 0.5, 0.9] }], {
      pbc: [true, true, false],
    })
    const { host, session, destroy } = make_session({
      structure: slab,
      measure_mode: `edit-atoms`,
    })
    session.move_sites([0], [5.5, 0, 2])
    flushSync()
    const moved = host.structure?.sites[0]
    expect(moved?.abc[0], `periodic a axis wraps`).toBeCloseTo(0.6, 12)
    expect(moved?.abc[2], `aperiodic c keeps its out-of-cell coord`).toBeCloseTo(1.3, 12)
    expect(moved?.xyz[2]).toBeCloseTo(6.5, 12)
    destroy()
  })

  // A zero c-vector (extXYZ `Lattice="... 0 0 0"`) parses fine but has no cart->frac inverse;
  // the pointer handlers must surface that as a notice instead of throwing, and keep editing
  // xyz while leaving abc alone. A drag fires move_sites on every pointer move, so the notice
  // is shown once per loaded structure (not once per edit) and again after an external load
  it(`edits a singular-lattice crystal with a single notice instead of throwing`, () => {
    const make_singular = () =>
      make_crystal(
        [
          [5, 0, 0],
          [0, 5, 0],
          [0, 0, 0],
        ],
        [
          { element: `Na`, abc: [0.1, 0.2, 0] },
          { element: `Cl`, abc: [0.6, 0.7, 0] },
        ],
      )
    const { host, session, notices, destroy } = make_session({
      measure_mode: `edit-atoms`,
      structure: make_singular(),
    })
    const notice = `Cannot edit fractional coordinates: lattice is singular`
    const notice_count = () => notices.filter((msg) => msg === notice).length
    for (let step = 0; step < 10; step++) {
      expect(() => session.move_sites([0], [0.1, 0, 0])).not.toThrow()
      flushSync()
    }
    expect(host.structure?.sites[0].xyz).toEqual([expect.closeTo(1.5, 9), 1, 0])
    expect(host.structure?.sites[0].abc).toEqual([0.1, 0.2, 0])
    expect(notice_count(), `10 drag moves -> 1 notice`).toBe(1)

    expect(() => session.add_atom([2, 2, 0], `O`)).not.toThrow()
    flushSync()
    const added = host.structure?.sites[2]
    expect(added?.species[0].element).toBe(`O`)
    expect(added?.abc, `a new site mirrors xyz`).toEqual([2, 2, 0])
    expect(notice_count()).toBe(1)

    host.selected_sites = [1]
    flushSync()
    expect(session.duplicate_selected()).toBe(true)
    flushSync()
    expect(host.structure?.sites[3].xyz).toEqual([3.5, 4, 0.5])
    expect(host.structure?.sites[3].abc).toEqual([0.6, 0.7, 0])
    expect(notice_count()).toBe(1)

    // an external load of another singular lattice notifies once more
    host.structure = make_singular()
    flushSync()
    session.move_sites([0], [1, 0, 0])
    flushSync()
    expect(notice_count()).toBe(2)
    destroy()
  })

  it(`clears history on an external structure change but not on its own edits`, () => {
    const { host, session, destroy } = make_session({ measure_mode: `edit-atoms` })
    host.selected_sites = [0]
    flushSync()
    session.delete_selected()
    flushSync()
    expect(session.history.undo_stack).toHaveLength(1)
    host.structure = crystal(4)
    flushSync()
    expect(session.history.undo_stack).toHaveLength(0)
    destroy()
  })
})

describe(`edit-bonds`, () => {
  it(`deletes a source bond when the bonds prop is unbound: the structure's own bonds are the base`, () => {
    // The binding stays undefined until the first edit (source bonds live on the structure);
    // a delete must merge against structure.properties.bonds, publish [], and undo to the source
    const source: StructureBond[] = [{ site_idx_1: 0, site_idx_2: 1, order: 1 }]
    const structure = { ...crystal(), properties: { bonds: structuredClone(source) } }
    const { host, session, destroy } = make_session({ measure_mode: `edit-bonds`, structure })
    flushSync()
    expect(host.bonds).toBeUndefined()
    session.push_bond_undo()
    session.removed_bonds = [{ site_idx_1: 0, site_idx_2: 1, order: 1 }]
    flushSync()
    expect(host.bonds).toEqual([])
    expect(session.undo_bond_edit()).toBe(true)
    flushSync()
    expect(host.bonds).toEqual(source)
    expect(session.bond_history.redo_stack).toHaveLength(1)
    // Redo after the edit layer forgot its base must recapture the (now published) source
    expect(session.redo_bond_edit()).toBe(true)
    flushSync()
    expect(host.bonds).toEqual([])
    expect(session.undo_bond_edit()).toBe(true)
    flushSync()
    expect(host.bonds).toEqual(source)
    destroy()
  })

  it(`a caller swapping the source bonds after an undo clears the redo history too`, () => {
    // undo leaves has_bond_edits false and the undo stack empty, with the undone edit on the
    // redo stack; redoing it onto a different source set would corrupt the new bonds
    const source: StructureBond[] = [{ site_idx_1: 0, site_idx_2: 1, order: 1 }]
    const { host, session, destroy } = make_session({
      measure_mode: `edit-bonds`,
      bonds: structuredClone(source),
    })
    session.push_bond_undo()
    session.removed_bonds = [{ site_idx_1: 0, site_idx_2: 1, order: 1 }]
    flushSync()
    expect(host.bonds).toEqual([])
    expect(session.undo_bond_edit()).toBe(true)
    flushSync()
    expect(session.bond_history.redo_stack).toHaveLength(1)
    host.bonds = [{ site_idx_1: 0, site_idx_2: 1, order: 2 }]
    flushSync()
    expect(session.bond_history.redo_stack).toHaveLength(0)
    expect(session.redo_bond_edit()).toBe(false)
    expect(host.bonds).toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
    destroy()
  })

  it(`publishes merged bonds, undoes through snapshots and restores the source when edits end`, () => {
    const source: StructureBond[] = [{ site_idx_1: 0, site_idx_2: 1, order: 1 }]
    const { host, session, destroy } = make_session({
      measure_mode: `edit-bonds`,
      bonds: structuredClone(source),
    })
    session.push_bond_undo()
    session.added_bonds = [{ site_idx_1: 1, site_idx_2: 2, order: 2 }]
    flushSync()
    expect(host.bonds).toHaveLength(2)
    session.push_bond_undo()
    session.removed_bonds = [{ site_idx_1: 0, site_idx_2: 1, order: 1 }]
    flushSync()
    expect(host.bonds).toEqual([{ site_idx_1: 1, site_idx_2: 2, order: 2 }])
    expect(session.undo_bond_edit()).toBe(true)
    flushSync()
    expect(host.bonds).toHaveLength(2)
    expect(session.bond_history.redo_stack).toHaveLength(1)
    expect(session.undo_bond_edit()).toBe(true)
    flushSync()
    expect(session.has_bond_edits).toBe(false)
    expect(host.bonds, `source bonds restored`).toEqual(source)
    expect(session.undo_bond_edit()).toBe(false)
    destroy()
  })

  it(`drops the edit layer when the structure, a transform or the source bonds change`, () => {
    const { host, session, destroy } = make_session({ measure_mode: `edit-bonds` })
    const edit = (): void => {
      session.push_bond_undo()
      session.added_bonds = [{ site_idx_1: 0, site_idx_2: 2, order: 1 }]
      flushSync()
      expect(host.bonds).toHaveLength(1)
    }
    edit()
    host.show_image_atoms = true
    flushSync()
    expect(session.has_bond_edits).toBe(false)
    expect(host.bonds, `transform restores the (empty) source`).toBeUndefined()
    host.show_image_atoms = false
    flushSync()
    edit()
    host.bonds = [{ site_idx_1: 1, site_idx_2: 2, order: 3 }]
    flushSync()
    expect(session.has_bond_edits, `caller replaced the source`).toBe(false)
    expect(session.bond_history.undo_stack).toHaveLength(0)
    destroy()
  })
})

describe(`panes`, () => {
  it(`tracks moved panes, resets all cameras and collapses side-pane state`, () => {
    const { session, destroy } = make_session()
    session.report_pane_moved(0, true)
    session.report_pane_moved(2, true)
    expect(session.any_camera_moved).toBe(true)
    session.active_pane_idx = 2
    session.collapse_to_primary_pane()
    expect(session.active_pane_idx).toBe(0)
    expect(session.any_camera_moved, `primary still moved`).toBe(true)
    session.reset_all_cameras()
    expect(session.reset_token).toBe(1)
    expect(session.any_camera_moved).toBe(false)
    destroy()
  })
})
