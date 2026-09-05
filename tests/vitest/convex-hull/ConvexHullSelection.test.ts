import { ConvexHull, ConvexHull2D, ConvexHullCanvas } from '$lib/convex-hull'
import type { PhaseData } from '$lib/convex-hull/types'
import { type Component, type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { bind_props, create_drop_event, doc_query, make_phase, mount_sized } from '../setup'
import ConvexHullSelectionHarness from './ConvexHullSelectionHarness.svelte'

// Force the canvas hit-test to resolve to a real plot entry so hovering can be
// exercised deterministically in jsdom (synthetic events can't land on points).
vi.mock(`$lib/convex-hull/canvas-draw`, async (import_actual) => {
  const actual = await import_actual()
  return {
    ...(actual as Record<string, unknown>),
    find_hull_entry_at_mouse: (
      _canvas: unknown,
      _event: unknown,
      points: readonly { entry: unknown }[],
    ) => points[0]?.entry ?? null,
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
        if (prop === `createLinearGradient`) return () => ({ addColorStop: vi.fn() })
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
// Mounts a hull component into its own div so assertions can scope to that mount
const mount_hull = async (
  component: Component,
  props: Record<string, unknown>,
): Promise<HTMLDivElement> => {
  const target = document.createElement(`div`)
  document.body.append(target)
  track_component(mount(component, { target, props }))
  await tick()
  return target
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

  const hull_components = [
    [`automatic`, ConvexHull, {}],
    [`2D`, ConvexHull2D, {}],
    [`3D`, ConvexHullCanvas, { dim: 3 }],
    [`4D`, ConvexHullCanvas, { dim: 4 }],
  ] as [string, Component, Record<string, unknown>][]
  // Every empty-state branch (no entries, an empty array, the wrapper's own arity message)
  // keeps the consumer's DOM attributes; the five-element case goes through the branch that
  // used to cherry-pick id/class/style and dropped hidden, onclick, aria-* and data-*
  const missing_text = `Missing convex hull data`
  const five_elements = [`Li`, `Fe`, `Co`, `Ni`, `O`].map((el) => make_phase({ [el]: 1 }))
  test.each([
    ...hull_components.map(
      ([name, component, dim_props]) =>
        [name, component, dim_props, missing_text, `status`] as const,
    ),
    [`automatic (entries=[])`, ConvexHull, { entries: [] }, missing_text, `status`],
    [
      `automatic (5 elements)`,
      ConvexHull,
      { entries: five_elements, controls: { title: `not a DOM attribute` } },
      `Convex hulls require 2, 3 or 4 elements, found 5: Co, Fe, Li, Ni, O`,
      `alert`,
    ],
  ] as [string, Component, Record<string, unknown>, string, string][])(
    `renders a useful missing-entries error from the %s component`,
    async (_name, component, extra_props, text, role) => {
      for (const hidden of [false, true]) {
        const onclick = vi.fn()
        const target = await mount_hull(component, {
          ...extra_props,
          id: `missing-hull`,
          'aria-label': `Missing hull`,
          'data-testid': `hull-empty`,
          class: `consumer-class`,
          hidden,
          onclick,
          style: `--hull-height: 300px`,
        })

        expect(target.textContent).toContain(text)
        if (role === `status`) {
          expect(target.textContent).toContain(
            `Provide convex hull data through the entries prop.`,
          )
        }
        const empty_state = target.querySelector<HTMLElement>(`.empty-state`)
        expect(empty_state?.hidden).toBe(hidden)
        expect(empty_state?.getAttribute(`role`)).toBe(role)
        expect(empty_state?.id).toBe(`missing-hull`)
        expect(empty_state?.getAttribute(`aria-label`)).toBe(`Missing hull`)
        expect(empty_state?.dataset.testid).toBe(`hull-empty`)
        expect(empty_state?.hasAttribute(`controls`)).toBe(false)
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

  // An unparsable composition key in the entries PROP (not a dropped file) and a dataset whose
  // element count doesn't match the component's arity are both entries prop problems: same
  // empty state with the message instead of a throw out of a $derived mid-render, no console
  // noise, no half-drawn plot
  const compound_key_entries = [
    make_phase({ Li: 1 }),
    make_phase({ O: 1 }),
    make_phase({ Li2O: 1 }, -6),
  ]
  const ternary_entries = [`Li`, `Fe`, `O`].map((el) => make_phase({ [el]: 1 }))
  const bad_key = `Unrecognized composition key "Li2O"`
  test.each([
    ...hull_components.map(
      ([name, component, dim_props]) =>
        [name, component, dim_props, compound_key_entries, bad_key] as const,
    ),
    [
      `2D (arity)`,
      ConvexHull2D,
      {},
      ternary_entries,
      `Binary convex hull requires exactly 2 elements, found 3: Fe, Li, O`,
    ],
    [
      `3D (arity)`,
      ConvexHullCanvas,
      { dim: 3 },
      compound_key_entries.slice(0, 2),
      `Ternary convex hull requires exactly 3 elements, found 2: Li, O`,
    ],
    [
      `4D (arity)`,
      ConvexHullCanvas,
      { dim: 4 },
      ternary_entries,
      `Quaternary convex hull requires exactly 4 elements, found 3: Fe, Li, O`,
    ],
    [
      `automatic (arity)`,
      ConvexHull,
      {},
      [make_phase({ Li: 1 })],
      `Convex hulls require 2, 3 or 4 elements, found 1: Li`,
    ],
  ] as [string, Component, Record<string, unknown>, PhaseData[], string][])(
    `renders the error of an invalid entries prop from the %s component`,
    async (_name, component, dim_props, entries, message) => {
      const console_error = vi.spyOn(console, `error`).mockImplementation(() => {})
      const target = await mount_hull(component, { ...dim_props, entries, id: `bad-hull` })

      const empty_state = target.querySelector<HTMLElement>(`.empty-state`)
      expect(empty_state?.getAttribute(`role`)).toBe(`alert`)
      expect(empty_state?.id).toBe(`bad-hull`)
      expect(target.textContent).toContain(`Invalid convex hull data`)
      expect(target.textContent).toContain(message)
      expect(target.textContent).not.toContain(`Missing convex hull data`)
      expect(
        target.querySelector(`.convex-hull-2d, .convex-hull-3d, .convex-hull-4d, canvas`),
      ).toBeNull()
      expect(console_error).not.toHaveBeenCalled()
    },
  )

  // The arity check runs on the entries prop, not on what survives the temperature filter:
  // at 600 K the only O entry (tabulated at 300 K alone, no interpolation) is dropped, which
  // used to turn the dataset into a one-element-short "invalid data" panel and unmount the
  // temperature slider needed to pick a valid T again
  const with_temps = (
    composition: Record<string, number>,
    temperatures: number[],
    entry_id: string,
  ): PhaseData =>
    make_phase(composition, -1, {
      entry_id,
      temperatures,
      free_energies: temperatures.map((temp) => -1 - temp / 1000),
    })
  describe.each([
    [600, false],
    [450, true],
  ] as const)(`temperature=%s with interpolation=%s`, (temperature, interpolate) => {
    test.each([
      [`2D`, ConvexHull2D, {}, [`Li`], `.convex-hull-2d`],
      [`3D`, ConvexHullCanvas, { dim: 3 }, [`Li`, `Fe`], `.convex-hull-3d`],
      [`automatic`, ConvexHull, {}, [`Li`, `Fe`], `.convex-hull-3d`],
    ] as [string, Component, Record<string, unknown>, string[], string][])(
      `%s keeps its plot and temperature`,
      async (_name, component, dim_props, kept_elements, plot_selector) => {
        const console_error = vi.spyOn(console, `error`).mockImplementation(() => {})
        const entries = [
          ...kept_elements.map((el) => with_temps({ [el]: 1 }, [300, 600], el)),
          with_temps({ O: 1 }, [300], `O`),
        ]
        const state = { stable_entries: [] as PhaseData[], temperature }
        const target = await mount_hull(
          component,
          bind_props({ ...dim_props, entries, interpolate_temperature: interpolate }, state),
        )
        flushSync()

        expect(target.querySelector(`.empty-state`)).toBeNull()
        expect(target.querySelector(plot_selector)).not.toBeNull()
        expect(target.querySelector(`.temperature-slider`)).not.toBeNull()
        expect(state.temperature).toBe(temperature)
        expect(
          target.querySelector<HTMLInputElement>(`.temperature-slider input[type="number"]`)
            ?.value,
        ).toBe(String(temperature))
        expect(
          state.stable_entries.find((entry) => entry.entry_id === kept_elements[0])
            ?.energy_per_atom,
        ).toBeCloseTo(-1 - temperature / 1000, 12)
        // the dropped element is closed with a synthetic corner so the hull still spans it
        expect(state.stable_entries.map((entry) => entry.entry_id)).toContain(
          `synthetic-element:O`,
        )
        expect(console_error).not.toHaveBeenCalled()
      },
    )
  })

  test.each([
    [`spin + oxidation`, { 'Fe2+,spin=5': 1, 'Fe3+,spin=-5': 2, 'O2-': 4 }, [`Fe`, `O`]],
    [`fractional oxidation`, { 'Fe2.5+': 2, 'O2-': 5 }, [`Fe`, `O`]],
    [`isotopes`, { D: 2, 'O2-': 1 }, [`H`, `O`]],
  ] as const)(
    `pymatgen %s species keys in the entries prop render a binary hull`,
    async (_name, composition, elements) => {
      const entries = [
        ...elements.map((el) => make_phase({ [el]: 1 }, 0, { entry_id: el })),
        make_phase({ ...composition }, -10, { entry_id: `compound` }),
      ]
      const state = { stable_entries: [] as PhaseData[] }
      const target = await mount_hull(ConvexHull, bind_props({ entries }, state))
      flushSync()

      expect(target.querySelector(`.convex-hull-2d`)).not.toBeNull()
      expect(target.querySelector(`.empty-state`)).toBeNull()
      expect(state.stable_entries.map((entry) => entry.entry_id)).toContain(`compound`)
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
      expect(selected_text()).toBe(`none`)
      button(`select-entry`).click()
      await tick()
      expect(selected_text()).not.toBe(`none`)
    },
  )

  // Playwright reads the camera back through Number(attr): the default 4D rotation_x is -0.6,
  // and a formatter's U+2212 minus turned it into NaN
  test.each([
    [`3d`, `.convex-hull-3d`, [`elevation`, `azimuth`, `zoom`, `center-x`, `center-y`]],
    [`4d`, `.convex-hull-4d`, [`rotation-x`, `rotation-y`, `zoom`, `center-x`, `center-y`]],
  ] as const)(
    `%s camera data attributes are Number()-parseable`,
    async (dim, plot_selector, keys) => {
      await mount_harness({ dim })
      const plot = doc_query(plot_selector)
      const values = keys.map((key) => Number(plot.getAttribute(`data-${key}`)))
      expect(values.every(Number.isFinite)).toBe(true)
      if (dim === `4d`) expect(values[0]).toBeLessThan(0)
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

  test.each([`2d`, `3d`, `4d`] as const)(
    `loads dropped JSON entries in the %s viewer`,
    async (dim) => {
      await mount_harness({ dim })
      const elements = {
        '2d': [`Li`, `O`],
        '3d': [`Li`, `O`, `Na`],
        '4d': [`Li`, `O`, `Na`, `Cl`],
      }[dim]
      const dropped = elements.map((element) => make_phase({ [element]: 1 }))
      const json = JSON.stringify(dropped)
      doc_query(`.convex-hull-${dim}`).dispatchEvent(
        create_drop_event(new File([json], `hull.json`)),
      )
      await vi.waitFor(() => expect(test_text(`stable-count`)).toBe(`${dropped.length}`))
    },
  )

  // Composition keys are validated inside the drop handler, so a compound-like key ("Fe2O3")
  // reports through console.error instead of throwing from the hull pipeline's $derived
  // mid-render (and, via the auto-dimension wrapper, instead of being mis-counted as binary).
  test.each([false, true])(
    `invalid dropped entries report their filename without replacing the hull (wrapper=%s)`,
    async (use_wrapper) => {
      const dim = `2d`
      await mount_harness({ dim, use_wrapper })
      const console_error = vi.spyOn(console, `error`).mockImplementation(() => {})
      const stable_before = test_text(`stable-count`)
      const bad_entries = JSON.stringify([{ composition: { Fe2O3: 1 }, energy: -1 }])
      doc_query(`.convex-hull-${dim}`).dispatchEvent(
        create_drop_event(new File([bad_entries], `bad-hull.json`)),
      )
      await vi.waitFor(() => expect(console_error).toHaveBeenCalledOnce())
      expect(console_error.mock.calls[0][0]).toMatch(
        /bad-hull\.json: Unrecognized composition key "Fe2O3"/,
      )
      // the component kept its previous entries and is still mounted
      expect(document.body.querySelector(`.convex-hull-${dim}`)).not.toBeNull()
      expect(test_text(`stable-count`)).toBe(stable_before)
    },
  )

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

  // Enter selects the hovered entry, but the chord belongs to the browser (Cmd+Enter is
  // open-in-new-tab). The chord guard has to run before the Enter branch, not after it.
  test.each([
    [`Enter selects the hovered entry`, {}, `old-compound`],
    [`Cmd+Enter is left to the browser`, { metaKey: true }, `none`],
    [`Ctrl+Enter is left to the browser`, { ctrlKey: true }, `none`],
  ])(`%s`, async (_name, modifiers, expected) => {
    await mount_harness({ dim: `3d` })
    const canvas = doc_query<HTMLCanvasElement>(`canvas`)
    canvas.dispatchEvent(
      new MouseEvent(`mousemove`, { bubbles: true, clientX: 100, clientY: 100 }),
    )
    flushSync()

    canvas.dispatchEvent(
      new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true, ...modifiers }),
    )
    await tick()
    expect(doc_query(`[data-testid="selected-entry"]`).textContent).toBe(expected)
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

  test(`hull facets are straight segments, never splined`, async () => {
    const entries: PhaseData[] = [
      { ...compound({ Li: 1 }, `ref-li`, 0), e_form_per_atom: 0 },
      { ...compound({ O: 1 }, `ref-o`, 0), e_form_per_atom: 0 },
      { ...compound({ Li: 3, O: 1 }, `li3o`, 0), e_form_per_atom: -0.4 },
      { ...compound({ Li: 1, O: 1 }, `lio`, 0), e_form_per_atom: -0.6 },
      { ...compound({ Li: 1, O: 3 }, `lio3`, 0), e_form_per_atom: -0.4 },
    ]
    const plot = await mount_sized(
      ConvexHull2D,
      { entries },
      { selector: `.scatter`, on_mount: track_component },
    )
    // the hull polyline visits the three stable compounds between the two element corners
    const hull_path = [...plot.querySelectorAll<SVGPathElement>(`path`)]
      .map((path) => path.getAttribute(`d`) ?? ``)
      .find((d) => d.startsWith(`M`) && d.split(`L`).length === 5)
    expect(hull_path).toBeDefined()
    // a monotone spline would emit cubic (C) commands; facets must be M followed by L only
    expect(hull_path).toMatch(/^M[-\d.,]+(?:L[-\d.,]+){4}$/)
  })
})
