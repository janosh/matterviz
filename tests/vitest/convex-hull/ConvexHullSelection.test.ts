import { ConvexHull2D } from '$lib/convex-hull'
import type { PhaseData } from '$lib/convex-hull/types'
import { flushSync, mount, tick } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { mount_sized } from '../setup'
import ConvexHullSelectionHarness from './ConvexHullSelectionHarness.svelte'

// Force the canvas hit-test to resolve to a real plot entry so hovering can be
// exercised deterministically in jsdom (synthetic events can't land on points).
vi.mock(`$lib/convex-hull/helpers`, async (import_actual) => {
  const actual = await import_actual()
  return {
    ...(actual as Record<string, unknown>),
    find_hull_entry_at_mouse: (
      _canvas: unknown,
      _event: unknown,
      entries: readonly unknown[],
    ) => entries?.[0] ?? null,
  }
})

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

  // Regression: hovering a point stored hover_data in a deeply-proxied $state, so
  // current_entry() returned the raw plot entry while hover_data.entry was its proxy.
  // The identity comparison was always unequal -> reassign -> effect_update_depth_exceeded.
  test.each([`3d`, `4d`] as const)(
    `hovering a point does not trigger an infinite effect loop (%s)`,
    async (dim) => {
      mount(ConvexHullSelectionHarness, { target: document.body, props: { dim } })
      flushSync()
      await tick()

      const canvas = document.querySelector(`canvas`)
      expect(canvas instanceof HTMLCanvasElement).toBe(true)

      // Dispatching a mousemove sets hover_data via the (mocked) hit-test; flushSync
      // would throw effect_update_depth_exceeded if the proxy-identity loop regressed.
      canvas?.dispatchEvent(
        new MouseEvent(`mousemove`, { bubbles: true, clientX: 100, clientY: 100 }),
      )
      expect(() => flushSync()).not.toThrow()
      await tick()

      expect(document.querySelector(`[data-has-hover="true"]`)).not.toBeNull()
    },
  )
})

// End-to-end: magnetic_ordering -> pipeline marker assignment -> 2D SVG symbol rendering,
// and hidden_categories -> pipeline visible_entries -> fewer rendered points
describe(`magnetic ordering rendering (ConvexHull2D)`, () => {
  beforeEach(() => {
    document.body.innerHTML = ``
  })

  const compound = (
    composition: Record<string, number>,
    entry_id: string,
    e_above_hull: number,
    magnetic_ordering?: string,
  ): PhaseData => ({
    composition,
    energy: -1,
    e_form_per_atom: -0.5,
    e_above_hull,
    is_stable: e_above_hull === 0,
    entry_id,
    magnetic_ordering,
  })
  const magnetic_entries: PhaseData[] = [
    compound({ Li: 1 }, `ref-li`, 0),
    compound({ O: 1 }, `ref-o`, 0),
    compound({ Li: 1, O: 1 }, `fm-1`, 0, `FM`),
    compound({ Li: 2, O: 1 }, `afm-1`, 0.05, `AFM`),
    compound({ Li: 1, O: 2 }, `plain-1`, 0.1),
  ]

  // ordering-less entries are unaffected by category filters
  test.each([
    [[], 5],
    [[`FM`], 4],
    [[`FM`, `AFM`], 3],
  ] as [string[], number][])(
    `hidden=%s renders %i markers`,
    async (hidden, expected_markers) => {
      const plot = await mount_sized(
        ConvexHull2D,
        { entries: magnetic_entries, hidden_categories: hidden },
        { selector: `.scatter` },
      )
      const marker_paths = [...plot.querySelectorAll<SVGPathElement>(`path.marker`)]
      expect(marker_paths).toHaveLength(expected_markers)
      if (hidden.length === 0) {
        // FM triangle, AFM square, and default circles must yield distinct path shapes
        const distinct_shapes = new Set(marker_paths.map((path) => path.getAttribute(`d`)))
        expect(distinct_shapes.size).toBeGreaterThanOrEqual(3)
      }
    },
  )
})
