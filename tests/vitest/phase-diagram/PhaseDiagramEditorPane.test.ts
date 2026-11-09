import PhaseDiagramEditorPane from '#lib/phase-diagram/PhaseDiagramEditorPane.svelte'
import { flushSync, mount, tick, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import { eutectic } from './fixtures/test-data'
import { set_input } from '../setup'

test.each([`edit`, `stale edit`, `read-only`, `dangling id`])(
  `editor handles %s with callback availability, stale-path and phase-id protection`,
  async (mode) => {
    const data = structuredClone(eutectic)
    const on_data = vi.fn()
    const component = mount(PhaseDiagramEditorPane, {
      target: document.body,
      props: { data, editor_open: true, on_data: mode === `read-only` ? undefined : on_data },
    })
    onTestFinished(() => unmount(component))
    flushSync()
    const renaming = mode === `dangling id` // renames a phase that regions still reference
    if (renaming) {
      document
        .querySelector<HTMLElement>(`[data-path="diagram.phases[0]"] .collapse-toggle`)
        ?.click()
      await tick()
    }
    const path = renaming ? `diagram.phases[0].id` : `diagram.pressure_pa`
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
    set_input(input, renaming ? `GAS` : `2e5`)
    // The source can change while a leaf editor is open.
    if (mode === `stale edit`) Reflect.deleteProperty(data, `pressure_pa`)
    input.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
    await tick()
    if (mode !== `edit`) {
      expect(on_data).not.toHaveBeenCalled()
      expect(document.querySelector(`.rejection-flash`)?.textContent).toContain(
        renaming ? `regions[0] references unknown phase LIQUID` : `Cannot edit missing path`,
      )
    } else {
      expect(on_data).toHaveBeenCalledWith({ ...data, pressure_pa: 2e5 })
      expect(data.pressure_pa).toBe(101325)
      expect(on_data.mock.calls[0][0].boundaries).toBe(data.boundaries)
    }
  },
)
