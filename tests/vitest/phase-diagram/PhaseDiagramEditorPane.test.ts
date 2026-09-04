import PhaseDiagramEditorPane from '$lib/phase-diagram/PhaseDiagramEditorPane.svelte'
import type { PhaseDiagramData } from '$lib/phase-diagram'
import { flushSync, mount, tick, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import al_cu_data from './fixtures/al-cu-sample.json' with { type: 'json' }

test.each([false, true])(
  `editor handles a leaf edit whose path becomes stale=%s`,
  async (stale) => {
    const data = structuredClone(al_cu_data) as unknown as PhaseDiagramData
    const on_data = vi.fn()
    const component = mount(PhaseDiagramEditorPane, {
      target: document.body,
      props: { data, editor_open: true, on_data },
    })
    onTestFinished(() => unmount(component))
    flushSync()
    const leaf = document.querySelector(`[data-path="diagram.temperature_unit"] .json-value`)
    if (!leaf) throw new Error(`Missing temperature unit leaf`)
    leaf.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    await tick()
    const input = document.querySelector<HTMLInputElement>(`.edit-input`)
    if (!input) throw new Error(`Missing edit input`)
    input.value = `edited-unit`
    input.dispatchEvent(new Event(`input`, { bubbles: true }))
    // The source can change while a leaf editor is open.
    if (stale) Reflect.deleteProperty(data, `temperature_unit`)
    input.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
    await tick()
    if (stale) {
      expect(on_data).not.toHaveBeenCalled()
      expect(document.querySelector(`.rejection-flash`)?.textContent).toContain(
        `Cannot edit missing path`,
      )
    } else {
      expect(on_data).toHaveBeenCalledWith({ ...data, temperature_unit: `edited-unit` })
      expect(data.temperature_unit).not.toBe(`edited-unit`)
      expect(on_data.mock.calls[0][0].boundaries).toBe(data.boundaries)
    }
  },
)
