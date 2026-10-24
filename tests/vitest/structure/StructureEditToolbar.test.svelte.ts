import type {
  AnyStructure,
  BondEditMode,
  BondOrder,
  MeasureMode,
  StructureBond,
} from '#lib/structure/index.js'
import { DEFAULT_ATOM_COLOR_CONFIG } from '#lib/structure/atom-properties.js'
import { StructureSession } from '#lib/structure/session.svelte.js'
import StructureEditToolbar from '#lib/structure/StructureEditToolbar.svelte'
import { flushSync } from 'svelte'
import { expect, onTestFinished, test } from 'vitest'
import { doc_query, fire, keydown, mount_in_test, set_input } from '../setup'
import { get_dummy_structure } from '../test-fixtures'

const RESET = `button[aria-label="Reset selection and bond edits"]`

// A real session over plain $state, so toolbar clicks run the actual edit operations
function mount_toolbar(measure_mode: MeasureMode, selected_sites: number[]) {
  const host = $state<{
    structure: AnyStructure | undefined
    bonds: StructureBond[] | undefined
    selected_sites: number[]
    measured_sites: number[]
    measure_mode: MeasureMode
    bond_edit_mode: BondEditMode
    bond_edit_order: BondOrder
  }>({
    structure: get_dummy_structure(`H`, 3, true),
    bonds: undefined,
    selected_sites,
    measured_sites: [...selected_sites],
    measure_mode,
    bond_edit_mode: `add`,
    bond_edit_order: 1,
  })
  const created: { session?: StructureSession } = {}
  const destroy = $effect.root(() => {
    created.session = new StructureSession({
      structure: () => host.structure,
      set_structure: (value) => (host.structure = value),
      bonds: () => host.bonds,
      set_bonds: (value) => (host.bonds = value),
      series_key: () => null,
      selected_sites: () => host.selected_sites,
      set_selected_sites: (value) => (host.selected_sites = value),
      measured_sites: () => host.measured_sites,
      set_measured_sites: (value) => (host.measured_sites = value),
      highlighted_sites: () => [],
      set_highlighted_sites: () => {},
      hovered_site_idx: () => null,
      set_hovered_site_idx: () => {},
      measure_mode: () => host.measure_mode,
      set_measure_mode: (value) => (host.measure_mode = value),
      bond_edit_mode: () => host.bond_edit_mode,
      set_bond_edit_mode: (value) => (host.bond_edit_mode = value),
      bond_edit_order: () => host.bond_edit_order,
      set_bond_edit_order: (value) => (host.bond_edit_order = value),
      supercell_scaling: () => `1x1x1`,
      apply_supercell_scaling: () => true,
      show_image_atoms: () => false,
      image_atom_options: () => ({ completion: `none` }),
      cell_type: () => `original`,
      set_cell_type: () => {},
      sym_data: () => null,
      atom_color_config: () => DEFAULT_ATOM_COLOR_CONFIG,
      bonding_strategy: () => `electroneg_ratio`,
    })
  })
  onTestFinished(destroy)
  const { session } = created
  if (!session) throw new Error(`StructureSession was not created`)
  mount_in_test(StructureEditToolbar, { session, shortcut_style: () => `` })
  flushSync()
  return { host, session }
}

test(`reset clears selection, measurements and bond edits with their history`, async () => {
  const { host, session } = mount_toolbar(`edit-bonds`, [0, 1])
  session.push_bond_undo()
  session.added_bonds = [{ site_idx_1: 0, site_idx_2: 1, order: 1 }]
  flushSync()
  const undo = doc_query<HTMLButtonElement>(`button[aria-label^="Undo bond edit"]`)
  expect(undo.textContent?.trim()).toBe(`1`)
  expect(host.bonds).toHaveLength(1)

  await fire(doc_query(RESET))
  expect([host.selected_sites, host.measured_sites, session.added_bonds]).toEqual([[], [], []])
  // the bound bonds go back to the structure's own (none) once the edit layer is cleared
  expect(host.bonds).toBeUndefined()
  expect(undo.disabled).toBe(true)
  expect(document.querySelector(RESET)).toBeNull()
})

test(`change-element field keeps an unknown symbol, applies a valid one as one undo step`, async () => {
  const { host, session } = mount_toolbar(`edit-atoms`, [0])
  session.change_element_mode = true
  flushSync()
  const input = doc_query<HTMLInputElement>(`input[placeholder="Fe"]`)
  const undo = doc_query<HTMLButtonElement>(`button[aria-label="Undo (Cmd/Ctrl+Z)"]`)
  const element_of_site_0 = () => host.structure?.sites[0].species[0].element

  set_input(input, `Xx`)
  await fire(input, keydown(`Enter`))
  expect([input.value, input.isConnected, undo.disabled]).toEqual([`Xx`, true, true])
  expect(element_of_site_0()).toBe(`H`)

  set_input(input, `fe`)
  await fire(input, keydown(`Enter`))
  expect(element_of_site_0()).toBe(`Fe`)
  expect(input.isConnected).toBe(false)
  expect(undo.textContent?.trim()).toBe(`1`)

  await fire(undo)
  expect(element_of_site_0()).toBe(`H`)
  expect(undo.disabled).toBe(true)
  expect(doc_query(`button[aria-label^="Redo ("]`).textContent?.trim()).toBe(`1`)
})
