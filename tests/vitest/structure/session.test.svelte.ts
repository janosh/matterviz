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
import { MAX_HISTORY, StructureSession } from '$lib/structure/session.svelte'
import type { CellType } from '$lib/symmetry'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get_dummy_structure } from '../setup'

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
      sym_data: () => null,
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
    host.structure = {
      ...base,
      sites: base.sites.map((site) => ({ ...site, xyz: [...site.xyz] as Vec3 })),
    }
    flushSync()
    expect(host.selected_sites).toEqual([0])
    expect(session.site_radius_overrides.get(0)).toBe(2)
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
