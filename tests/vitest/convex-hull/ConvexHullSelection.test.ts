import { flushSync, mount, tick } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import ConvexHullSelectionHarness from './ConvexHullSelectionHarness.svelte'

class MockPath2D {
  arc(): void {}
}

const canvas_context = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === `canvas`) return document.createElement(`canvas`)
      if (prop === `measureText`) return () => ({ width: 20 })
      if (prop === `getLineDash`) return () => []
      return vi.fn()
    },
  },
) as unknown as CanvasRenderingContext2D
const button = (test_id: string): HTMLButtonElement | null =>
  document.querySelector(`[data-testid="${test_id}"]`)
const selected_text = (): string | null =>
  document.querySelector(`[data-testid="selected-entry"]`)?.textContent ?? null

describe(`convex hull replacement state`, () => {
  beforeEach(() => {
    document.body.innerHTML = ``
    Object.defineProperty(globalThis, `Path2D`, {
      configurable: true,
      value: MockPath2D,
    })
    vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue(canvas_context)
  })

  test.each([
    [{ dim: `2d` }, `none`],
    [{ dim: `3d` }, `none`],
    [{ dim: `4d` }, `none`],
    [{ dim: `2d`, include_element_refs: false }, `synthetic-element:Li`],
  ] as const)(
    `keeps refreshed selected entries and handles replacements`,
    async (props, replaced) => {
      mount(ConvexHullSelectionHarness, { target: document.body, props })
      await tick()

      button(`select-entry`)?.click()
      flushSync()
      await tick()

      if (replaced === `none`) expect(selected_text()).not.toBe(`none`)
      else expect(selected_text()).toBe(replaced)
      const selected_before_refresh = selected_text()

      button(`refresh-convex-entries`)?.click()
      flushSync()
      await tick()

      expect(selected_text()).toBe(selected_before_refresh)

      button(`replace-convex-entries`)?.click()
      flushSync()
      await tick()

      expect(selected_text()).toBe(replaced)
    },
  )
})
