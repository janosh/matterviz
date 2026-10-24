import type { MeasureMode } from '#lib/structure/index.js'
import StructureEditToolbar from '#lib/structure/StructureEditToolbar.svelte'
import { flushSync } from 'svelte'
import { expect, test } from 'vitest'
import { doc_query, fire, keydown, mount_in_test, set_input } from '../setup'
import { make_session } from './session-harness.svelte'

const RESET = `button[aria-label="Reset selection and bond edits"]`

// A real session over plain $state, so toolbar clicks run the actual edit operations
function mount_toolbar(measure_mode: MeasureMode, selected_sites: number[]) {
  const measured_sites = [...selected_sites]
  const { host, session } = make_session({ measure_mode, selected_sites, measured_sites })
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

// The current mode is announced, not only styled: the toggle's label never names it
test(`measure mode options mark the active mode pressed`, async () => {
  mount_toolbar(`angle`, [])
  await fire(doc_query(`button[aria-label="Measure / Edit"]`))
  const pressed = [...document.querySelectorAll<HTMLButtonElement>(`.view-mode-option`)].map(
    (option) => [option.textContent?.trim(), option.getAttribute(`aria-pressed`)],
  )
  expect(pressed.filter(([, state]) => state === `true`)).toEqual([[`Angle`, `true`]])
  expect(pressed.every(([, state]) => state === `true` || state === `false`)).toBe(true)
})
