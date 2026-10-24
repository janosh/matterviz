import PhaseDiagramEditorPane from '#lib/phase-diagram/PhaseDiagramEditorPane.svelte'
import type { PhaseDiagramData } from '#lib/phase-diagram/index.js'
import { flushSync, mount, tick, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import al_cu_data from './fixtures/al-cu-sample.json' with { type: 'json' }
import { set_input } from '../setup'

test.each([`edit`, `stale edit`, `read-only`, `duplicate id`])(
  `editor handles %s with callback availability, stale-path and id protection`,
  async (mode) => {
    const data = structuredClone(al_cu_data) as unknown as PhaseDiagramData
    const on_data = vi.fn()
    const component = mount(PhaseDiagramEditorPane, {
      target: document.body,
      props: { data, editor_open: true, on_data: mode === `read-only` ? undefined : on_data },
    })
    onTestFinished(() => unmount(component))
    flushSync()
    const duplicating = mode === `duplicate id` // renames boundary 1 to boundary 0's id
    if (duplicating) {
      document
        .querySelector<HTMLElement>(`[data-path="diagram.boundaries[1]"] .collapse-toggle`)
        ?.click()
      await tick()
    }
    const path = duplicating ? `diagram.boundaries[1].id` : `diagram.temperature_unit`
    const leaf = document.querySelector(`[data-path="${path}"] .json-value`)
    if (!leaf) throw new Error(`Missing ${path} leaf`)
    leaf.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    await tick()
    const input = document.querySelector<HTMLInputElement>(`.edit-input`)
    if (mode === `read-only`) {
      expect(input).toBeNull()
      expect(on_data).not.toHaveBeenCalled()
      return
    }
    if (!input) throw new Error(`Missing edit input`)
    set_input(input, duplicating ? `boundary-0` : `edited-unit`)
    // The source can change while a leaf editor is open.
    if (mode === `stale edit`) Reflect.deleteProperty(data, `temperature_unit`)
    input.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
    await tick()
    if (mode !== `edit`) {
      expect(on_data).not.toHaveBeenCalled()
      expect(document.querySelector(`.rejection-flash`)?.textContent).toContain(
        duplicating ? `Duplicate boundary id "boundary-0"` : `Cannot edit missing path`,
      )
    } else {
      expect(on_data).toHaveBeenCalledWith({ ...data, temperature_unit: `edited-unit` })
      expect(data.temperature_unit).not.toBe(`edited-unit`)
      expect(on_data.mock.calls[0][0].boundaries).toBe(data.boundaries)
    }
  },
)
