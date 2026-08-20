import { ConvexHull, ConvexHull2D, ConvexHull3D, ConvexHull4D } from '$lib/convex-hull'
import type { PhaseData } from '$lib/convex-hull/types'
import { type Component, type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query, mount_sized } from '../setup'
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
    ) => entries[0] ?? null,
  }
})

class MockPath2D {
  arc(): void {}
}

const make_canvas_context = (
  canvas: HTMLCanvasElement,
  on_clear = () => {},
): CanvasRenderingContext2D =>
  new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === `canvas`) return canvas
        if (prop === `measureText`) return () => ({ width: 20 })
        if (prop === `getLineDash`) return () => []
        if (prop === `clearRect`) return on_clear
        return vi.fn()
      },
    },
  ) as unknown as CanvasRenderingContext2D
const canvas_context = make_canvas_context(document.createElement(`canvas`))
// clearRect opens every repaint, so counting it per layer says which canvas actually redrew.
const count_canvas_clears = (): { base: number; overlay: number } => {
  const clears = { base: 0, overlay: 0 }
  vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockImplementation(
    function (this: HTMLCanvasElement) {
      // function body, so `this` stays the canvas getContext was called on
      const layer = this.classList.contains(`pulse-overlay`) ? `overlay` : `base`
      return make_canvas_context(this, () => clears[layer]++)
    },
  )
  return clears
}
const let_frames_run = () => new Promise((resolve) => setTimeout(resolve, 60))
const button = (test_id: string): HTMLButtonElement => doc_query(`[data-testid="${test_id}"]`)
const test_text = (test_id: string): string =>
  doc_query(`[data-testid="${test_id}"]`).textContent ?? ``
const selected_text = (): string => test_text(`selected-entry`)
const mounted_components: ReturnType<typeof mount>[] = []
const track_component = (component: ReturnType<typeof mount>): void => {
  mounted_components.push(component)
}
const mount_harness = async (
  props: ComponentProps<typeof ConvexHullSelectionHarness>,
): Promise<void> => {
  track_component(mount(ConvexHullSelectionHarness, { target: document.body, props }))
  await tick()
}

beforeEach(() => document.body.replaceChildren())
afterEach(async () => {
  for (const component of mounted_components.splice(0)) await unmount(component)
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe(`convex hull replacement state`, () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, `Path2D`, {
      configurable: true,
      value: MockPath2D,
    })
    vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue(canvas_context)
  })

  test.each([
    [`automatic`, ConvexHull],
    [`2D`, ConvexHull2D],
    [`3D`, ConvexHull3D],
    [`4D`, ConvexHull4D],
  ] as [string, Component][])(
    `renders a useful missing-entries error from the %s component`,
    async (_name, component) => {
      for (const hidden of [false, true]) {
        const target = document.createElement(`div`)
        const onclick = vi.fn()
        document.body.append(target)
        track_component(
          mount(component, {
            target,
            props: {
              id: `missing-hull`,
              'aria-label': `Missing hull`,
              class: `consumer-class`,
              hidden,
              onclick,
              style: `--hull-height: 300px`,
            },
          }),
        )
        await tick()

        expect(target.textContent).toContain(`Missing convex hull data`)
        expect(target.textContent).toContain(
          `Provide convex hull data through the entries prop.`,
        )
        const empty_state = target.querySelector<HTMLElement>(`.empty-state`)
        expect(empty_state?.hidden).toBe(hidden)
        expect(empty_state?.getAttribute(`role`)).toBe(`status`)
        expect(empty_state?.id).toBe(`missing-hull`)
        expect(empty_state?.getAttribute(`aria-label`)).toBe(`Missing hull`)
        expect(empty_state?.classList.contains(`consumer-class`)).toBe(true)
        expect(empty_state?.style.getPropertyValue(`--hull-height`)).toBe(`300px`)
        empty_state?.click()
        expect(onclick).toHaveBeenCalledOnce()
        expect(
          target.querySelector(`.convex-hull-2d, .convex-hull-3d, .convex-hull-4d, canvas`),
        ).toBeNull()
      }
    },
  )

  test.each([
    [`automatic`, `2d`, true, `.convex-hull-2d`],
    [`2D`, `2d`, false, `.convex-hull-2d`],
    [`3D`, `3d`, false, `.convex-hull-3d`],
    [`4D`, `4d`, false, `.convex-hull-4d`],
  ] as const)(
    `recovers the %s component when entries arrive`,
    async (_name, dim, use_wrapper, plot_selector) => {
      await mount_harness({ dim, start_missing: true, use_wrapper })
      expect(document.body.textContent).toContain(`Missing convex hull data`)

      button(`refresh-convex-entries`).click()
      await tick()
      expect(document.body.textContent).not.toContain(`Missing convex hull data`)
      expect(document.body.querySelector(plot_selector)).not.toBeNull()
      button(`select-entry`).click()
      await tick()
      expect(selected_text()).not.toBe(`none`)
      expect(
        Number(test_text(`stable-count`)) + Number(test_text(`unstable-count`)),
      ).toBeGreaterThan(0)

      button(`clear-convex-entries`).click()
      await tick()
      expect(document.body.textContent).toContain(`Missing convex hull data`)
      expect(document.body.querySelector(plot_selector)).toBeNull()
      expect(selected_text()).toBe(`none`)
      expect(test_text(`stable-count`)).toBe(`0`)
      expect(test_text(`unstable-count`)).toBe(`0`)

      button(`refresh-convex-entries`).click()
      await tick()
      expect(document.body.querySelector(plot_selector)).not.toBeNull()
    },
  )

  test.each([
    [{ dim: `2d` }, `none`],
    [{ dim: `3d` }, `none`],
    [{ dim: `4d` }, `none`],
    [{ dim: `2d`, include_element_refs: false }, `synthetic-element:Li`],
  ] as const)(
    `keeps refreshed selected entries and handles replacements`,
    async (props, replaced) => {
      await mount_harness(props)

      button(`select-entry`).click()
      await tick()

      if (replaced === `none`) expect(selected_text()).not.toBe(`none`)
      else expect(selected_text()).toBe(replaced)
      const selected_before_refresh = selected_text()

      button(`refresh-convex-entries`).click()
      await tick()

      expect(selected_text()).toBe(selected_before_refresh)

      button(`replace-convex-entries`).click()
      await tick()

      expect(selected_text()).toBe(replaced)
    },
  )

  test(`fullscreen button requests browser fullscreen`, async () => {
    await mount_harness({ dim: `3d` })
    const wrapper = doc_query<HTMLDivElement>(`.convex-hull-3d`)
    wrapper.requestFullscreen = vi.fn(() => Promise.withResolvers<undefined>().promise)
    const fullscreen_button = wrapper.querySelector<HTMLButtonElement>(
      `:scope > .control-buttons > .fullscreen-btn`,
    )
    if (!fullscreen_button) throw new Error(`Convex hull fullscreen button not found`)

    fullscreen_button.click()
    expect(fullscreen_button.getAttribute(`aria-pressed`)).toBe(`false`)
    await vi.waitFor(() => expect(wrapper.requestFullscreen).toHaveBeenCalledOnce())
  })

  test.each([`2d`, `3d`, `4d`] as const)(
    `disabled %s drops still prevent browser navigation`,
    async (dim) => {
      await mount_harness({ dim, allow_file_drop: false })
      const event = new DragEvent(`drop`, { bubbles: true, cancelable: true })
      doc_query(`.convex-hull-${dim}`).dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    },
  )

  // Regression: hovering a point stored hover_data in a deeply-proxied $state, so
  // current_entry() returned the raw plot entry while hover_data.entry was its proxy.
  // The identity comparison was always unequal -> reassign -> effect_update_depth_exceeded.
  test.each([`3d`, `4d`] as const)(
    `hovering a point does not trigger an infinite effect loop (%s)`,
    async (dim) => {
      await mount_harness({ dim })

      const canvas = doc_query<HTMLCanvasElement>(`canvas`)

      // Dispatching a mousemove sets hover_data via the (mocked) hit-test; flushSync
      // would throw effect_update_depth_exceeded if the proxy-identity loop regressed.
      canvas.dispatchEvent(
        new MouseEvent(`mousemove`, { bubbles: true, clientX: 100, clientY: 100 }),
      )
      expect(() => flushSync()).not.toThrow()

      expect(document.querySelector(`[data-has-hover="true"]`)).not.toBeNull()
    },
  )

  // A pulse tick used to rerun render_frame: every hull face, point and label rebuilt 60x/s
  // to animate one ring. The rings now live on a transparent canvas stacked over the hull.
  test.each([`3d`, `4d`] as const)(
    `pulse ticks repaint only the overlay canvas (%s)`,
    async (dim) => {
      const clears = count_canvas_clears()
      await mount_harness({ dim })
      button(`select-entry`).click()
      await let_frames_run()
      expect(clears.overlay).toBeGreaterThan(0) // the pulse is actually running

      const settled = { ...clears }
      await let_frames_run()
      expect(clears.overlay).toBeGreaterThan(settled.overlay)
      expect(clears.base).toBe(settled.base)
    },
  )

  // render_frame runs inside a requestAnimationFrame callback, so its reads don't register as
  // dependencies and every one has to be declared in `repaint_deps`. `config` reaches the draw
  // code only through merged_config, so the individual label toggles don't cover it: leaving it
  // out left the hull showing labels the config had already turned off.
  test.each([`3d`, `4d`] as const)(`a config change repaints the hull (%s)`, async (dim) => {
    const clears = count_canvas_clears()
    await mount_harness({ dim })
    await let_frames_run()
    const before = clears.base
    expect(before).toBeGreaterThan(0) // it painted at all to begin with

    button(`toggle-hull-labels`).click()
    await let_frames_run()
    expect(clears.base).toBeGreaterThan(before)
  })
})

// End-to-end: magnetic_ordering -> pipeline marker assignment -> 2D SVG symbol rendering,
// and hidden_categories -> pipeline visible_entries -> fewer rendered points
describe(`magnetic ordering rendering (ConvexHull2D)`, () => {
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

  // ordering-less entries are unaffected by category filters. Hiding one category is the
  // case that pins down *which* entries go: a filter that dropped every categorized entry
  // once the list was non-empty still renders 3 for [FM, AFM] and 5 for [].
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
        { selector: `.scatter`, on_mount: track_component },
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
