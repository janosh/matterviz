import type { HullModel } from '#lib/convex-hull/index.js'
import ConvexHull from '#lib/convex-hull/ConvexHull.svelte'
import * as thermo from '#lib/convex-hull/thermodynamics.js'
import * as canvas_draw from '#lib/convex-hull/canvas-draw.js'
import type { PhaseData } from '#lib/convex-hull/types.js'
import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { interpolateReds } from 'd3-scale-chromatic'
import { SvelteMap } from 'svelte/reactivity'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  click_export,
  clip_rect,
  create_drop_event,
  export_via_pane,
  doc_query,
  expect_shortcuts_in_pane,
  marker_fill,
  mock_parse_worker,
  mount_sized,
} from '../setup'
import { make_phase } from '../test-fixtures'
import ConvexHullSelectionHarness from './ConvexHullSelectionHarness.svelte'

// canvas encoders write real PNGs, whose resolution the export declares (set_png_dpi)
const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    `iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==`,
  ),
  (char) => char.charCodeAt(0),
)

beforeEach(mock_parse_worker)

// Force the canvas hit-test to resolve to a real plot entry so hovering can be
// exercised deterministically in jsdom (synthetic events can't land on points).
vi.mock(`#lib/convex-hull/canvas-draw.js`, async (import_actual) => {
  const actual = await import_actual()
  return {
    ...(actual as Record<string, unknown>),
    find_hull_entry_at_mouse: (
      _canvas: unknown,
      _event: unknown,
      index: ReturnType<typeof canvas_draw.build_hull_pick_index>,
    ) => index.items[0]?.entry ?? null,
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
  vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    // function body, so `this` stays the canvas getContext was called on
    const layer = this.classList.contains(`pulse-overlay`) ? `overlay` : `base`
    return make_canvas_context(this, () => clears[layer]++)
  })
  return clears
}
const let_frames_run = () => new Promise((resolve) => setTimeout(resolve, 60))
const button = (test_id: string): HTMLButtonElement => doc_query(`[data-testid="${test_id}"]`)
const test_text = (test_id: string): string =>
  doc_query(`[data-testid="${test_id}"]`).textContent ?? ``
const selected_text = (): string => test_text(`selected-entry`)
const mounted_components: ReturnType<typeof mount>[] = []
const model_entries = () =>
  (mounted_components.at(-1) as { get_model: () => HullModel | undefined }).get_model()
    ?.entries
const track_component = (component: ReturnType<typeof mount>): void => {
  mounted_components.push(component)
}
const mount_harness = async (
  props: ComponentProps<typeof ConvexHullSelectionHarness>,
): Promise<void> => {
  track_component(mount(ConvexHullSelectionHarness, { target: document.body, props }))
  await tick()
}
// Each hull gets its own div so assertions can scope to that mount
const mount_hull = async (
  props: ComponentProps<typeof ConvexHull>,
): Promise<HTMLDivElement> => {
  const target = document.createElement(`div`)
  document.body.append(target)
  track_component(mount(ConvexHull, { target, props }))
  await tick()
  return target
}

afterEach(async () => {
  for (const component of mounted_components.splice(0)) await unmount(component)
  vi.restoreAllMocks()
})

describe(`convex hull replacement state`, () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, `Path2D`, {
      configurable: true,
      value: MockPath2D,
    })
    vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue(canvas_context)
  })

  test.each([`3d`, `4d`] as const)(
    `empty %s canvas clicks clear selection without a popup`,
    async (dim) => {
      await mount_harness({ dim })
      button(`select-entry`).click()
      await tick()
      expect(selected_text()).not.toBe(`none`)
      vi.spyOn(canvas_draw, `find_hull_entry_at_mouse`).mockReturnValueOnce(null)
      doc_query<HTMLCanvasElement>(`canvas`).click()
      await tick()
      expect(selected_text()).toBe(`none`)
    },
  )
  // Every empty-state branch (no entries, an empty array, the wrapper's own arity message)
  // keeps the consumer's DOM attributes; the five-element case goes through the branch that
  // used to cherry-pick id/class/style and dropped hidden, onclick, aria-* and data-*
  const missing_text = `Missing convex hull data`
  const five_elements = [`Li`, `Fe`, `Co`, `Ni`, `O`].map((element) =>
    make_phase({ [element]: 1 }),
  )
  test.each([
    [`undefined entries`, {}, missing_text, `status`],
    [`empty entries`, { entries: [] }, missing_text, `status`],
    [
      `five elements`,
      { entries: five_elements, controls: { title: `not a DOM attribute` } },
      `Convex hulls require 2, 3 or 4 elements, found 5: Co, Fe, Li, Ni, O`,
      `alert`,
    ],
  ] satisfies [string, ComponentProps<typeof ConvexHull>, string, string][])(
    `renders a useful empty state for %s`,
    async (_name, extra_props, text, role) => {
      for (const hidden of [false, true]) {
        const onclick = vi.fn()
        const target = await mount_hull({
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
  const bad_key = `Unrecognized composition key "Li2O"`
  test.each([
    [`invalid composition`, compound_key_entries, bad_key],
    [
      `one element`,
      [make_phase({ Li: 1 })],
      `Convex hulls require 2, 3 or 4 elements, found 1: Li`,
    ],
  ] satisfies [string, PhaseData[], string][])(
    `renders the entries error for %s`,
    async (_name, entries, message) => {
      const console_error = vi.spyOn(console, `error`).mockImplementation(() => {})
      const target = await mount_hull({ entries, id: `bad-hull` })

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

  test(`warns when entries share an entry_id`, async () => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const entries = [
      make_phase({ Li: 1 }, 0, { entry_id: `dup` }),
      make_phase({ O: 1 }, 0, { entry_id: `dup` }),
    ]
    await mount_hull({ entries })
    expect(warn).toHaveBeenCalledWith(`ConvexHull: duplicate entry_id "dup"`)
  })

  // The face color bar draws what the faces use: color_scale over the faces' formation
  // energies in formation_energy mode (it used to keep the uniform mode's alpha ramp)
  test.each([
    [`formation_energy`, true],
    [`uniform`, false],
  ] as const)(`%s face mode color bar uses color_scale: %s`, async (mode, uses_scale) => {
    const entries = [
      ...[`Li`, `Fe`, `O`].map((element) => make_phase({ [element]: 1 })),
      make_phase({ Li: 2, O: 1 }, -1.2),
      make_phase({ Fe: 1, O: 1 }, -0.9),
      make_phase({ Li: 1, Fe: 1, O: 2 }, -1.5),
    ]
    const target = await mount_hull({
      entries,
      color_mode: `stability`,
      show_hull_faces: true,
      hull_face_color_mode: mode,
      color_scale: `interpolateReds`,
    })
    const bars = [...target.querySelectorAll<HTMLElement>(`.colorbar`)]
    const face_bar = bars.find((bar) => bar.textContent?.includes(`Formation energy`))
    const gradient = face_bar?.querySelector<HTMLElement>(`[style*="linear-gradient"]`)
    const style = gradient?.getAttribute(`style`) ?? ``
    expect(style).toContain(`linear-gradient`)
    for (const end of [0, 1]) expect(style.includes(interpolateReds(end))).toBe(uses_scale)
  })

  // The binary hull pins only its top padding: left (and bottom) follow the axes like any
  // plot's, so a y title gets its band beside the tick labels and dropping it narrows the side
  test(`binary hull sizes its left padding to its y axis`, async () => {
    const entries = [
      make_phase({ Li: 1 }, 0),
      make_phase({ O: 1 }, 0),
      make_phase({ Li: 2, O: 1 }, -2.1),
    ]
    const left_pad = async (y_axis: ComponentProps<typeof ConvexHull>[`y_axis`]) => {
      const plot = await mount_sized(
        ConvexHull,
        { entries, y_axis },
        { selector: `.convex-hull-2d`, width: 500, height: 400 },
      )
      return clip_rect(plot).x
    }
    const [titled, untitled] = [await left_pad({}), await left_pad({ label: `` })]
    expect(titled).toBeGreaterThan(untitled + 15)
  })

  // One export pane for every dimensionality: the 2D plot as SVG/PNG, 3D/4D as a PNG
  // redrawn at export resolution; entries as CSV (element amounts as columns) and JSON
  test.each([`Li O`, `Li Fe O`, `Li Fe P O`])(`%s hull export pane`, async (chem_sys) => {
    const elements = chem_sys.split(` `)
    const offered = [`PNG`, ...(elements.length === 2 ? [`SVG`] : []), `CSV`, `JSON`]
    const entries = [
      ...elements.map((el) => make_phase({ [el]: 1 }, 0, { entry_id: el })),
      make_phase({ [elements[0]]: 2, [elements.at(-1) ?? ``]: 1 }, -2, { entry_id: `mix` }),
    ]
    const on_export = vi.fn()
    // the title renders as HTML; the filename and canvas label get its plain text
    const title = `${chem_sys} &amp; E<sub>hull</sub>`
    const target = await mount_hull({ entries, on_export, controls: { title } })
    const result = await export_via_pane(on_export, `CSV`, target)
    expect(result.offered).toEqual(offered)
    expect(result.filename).toBe(`${elements.join(`-`)}-Ehull`) // slugged like every chart's
    const [header, ...rows] = String(result.data).split(`\n`)
    const energy_cols = `energy_per_atom,e_form_per_atom,e_above_hull,is_stable`
    const element_cols = elements.toSorted().join(`,`)
    expect(header).toBe(`entry_id,formula,${element_cols},${energy_cols}`)
    expect(rows.map((row) => row.split(`,`)[0]).toSorted()).toEqual(
      [...elements, `mix`].toSorted(),
    )
    on_export.mockClear()
    await click_export(`JSON`, target)
    await vi.waitFor(() => expect(on_export).toHaveBeenCalledOnce())
    const records = JSON.parse(on_export.mock.calls[0][1].data)
    expect(records.find((rec: { entry_id: string }) => rec.entry_id === `mix`)).toMatchObject({
      e_form_per_atom: expect.any(Number),
      e_above_hull: 0,
      is_stable: true,
    })
    if (elements.length === 2) return
    expect(target.querySelector(`canvas[tabindex="0"]`)?.getAttribute(`aria-label`)).toBe(
      `${chem_sys} & Ehull`,
    )
    // the canvas hull redraws into a fresh 2x canvas rather than upscaling the screen bitmap
    const sizes: number[][] = []
    vi.spyOn(HTMLCanvasElement.prototype, `toBlob`).mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      sizes.push([this.width, this.height])
      callback(new Blob([ONE_PIXEL_PNG], { type: `image/png` }))
    })
    on_export.mockClear()
    await click_export(`PNG`, target)
    await vi.waitFor(() => expect(on_export).toHaveBeenCalledOnce())
    expect(on_export.mock.calls[0][1].data).toBeInstanceOf(Blob)
    expect(sizes).toEqual([[1600, 1200]]) // 2x the unmeasured canvas's 800x600 CSS size
  })

  // synthetic corners close the hull but are no data entries, so the pane counts skip them
  test(`pane counts leave out synthetic corners`, async () => {
    // precomputed E_form: an excluded unary is no reference to compute it against
    const entries = [
      make_phase({ Li: 1 }, 0, { e_form_per_atom: 0 }),
      // drawn (above the hull), but the hull needs a synthetic O corner in its place
      make_phase({ O: 1 }, 0, { exclude_from_hull: true, e_form_per_atom: 0.1 }),
      make_phase({ Li: 2, O: 1 }, -6, { e_form_per_atom: -2 }),
    ]
    await mount_hull({ entries, info_pane_open: true })
    expect([`hull-visible-stable`, `hull-visible-unstable`].map(test_text)).toEqual([
      `Visible stable 2 / 2`,
      `Visible unstable 1 / 1`,
    ])
  })

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
      [`2D`, [`Li`], `.convex-hull-2d`],
      [`3D`, [`Li`, `Fe`], `.convex-hull-3d`],
      [`4D`, [`Li`, `Fe`, `Na`], `.convex-hull-4d`],
    ] satisfies [string, string[], string][])(
      `%s keeps its plot and temperature`,
      async (_name, kept_elements, plot_selector) => {
        const console_error = vi.spyOn(console, `error`).mockImplementation(() => {})
        const entries = [
          ...kept_elements.map((element) => with_temps({ [element]: 1 }, [300, 600], element)),
          with_temps({ O: 1 }, [300], `O`),
        ]
        const state = { temperature }
        const target = await mount_hull(
          bind_props({ entries, interpolate_temperature: interpolate }, state),
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
          model_entries()?.find((entry) => entry.entry_id === kept_elements[0])
            ?.energy_per_atom,
        ).toBeCloseTo(-1 - temperature / 1000, 12)
        // the dropped element is closed with a synthetic corner so the hull still spans it
        expect(model_entries()?.map((entry) => entry.entry_id)).toContain(
          `synthetic-element:O`,
        )
        expect(console_error).not.toHaveBeenCalled()
      },
    )
  })

  // Without interpolation an untabulated T snaps to the nearest tabulated one, while
  // interpolation keeps any in-range T
  test.each([
    [false, 600],
    [true, 500],
  ] as const)(`interpolate_temperature=%s turns T=500 into %s`, async (interpolate, want) => {
    const entries = [`Li`, `O`].map((element) =>
      with_temps({ [element]: 1 }, [300, 600, 900], element),
    )
    const state = { temperature: 500 }
    await mount_hull(bind_props({ entries, interpolate_temperature: interpolate }, state))
    flushSync()
    expect(state.temperature).toBe(want)
  })

  test(`source changes normalize once and switch renderer without losing bound controls`, async () => {
    const normalize = vi.spyOn(thermo, `process_hull_entries`)
    const state = new SvelteMap<string, PhaseData[]>([[`entries`, []]])
    const props = {
      get entries() {
        return state.get(`entries`)
      },
      show_stable: false,
      controls_open: true,
    }
    const target = await mount_hull(props)
    for (const dim of [2, 3, 4, 2]) {
      normalize.mockClear()
      state.set(
        `entries`,
        [`Li`, `Fe`, `O`, `Na`].slice(0, dim).map((element) => make_phase({ [element]: 1 })),
      )
      await tick()
      flushSync()
      const label = [
        `Binary convex hull visualization`,
        `Ternary convex hull visualization`,
        `Quaternary convex hull visualization`,
      ][dim - 2]
      expect(target.querySelector(`[aria-label="${label}"]`)).not.toBeNull()
      expect(model_entries()).toHaveLength(dim)
      expect(props.show_stable).toBe(false)
      const face_mode = target.querySelector(`.face-color-mode-buttons .active`)
      if (dim === 2) expect(face_mode).toBeNull()
      else expect(face_mode?.textContent?.trim()).toBe(dim === 3 ? `Uniform` : `Element`)
      expect(normalize).toHaveBeenCalledOnce()
    }
  })

  // 60 entries > label_threshold (50): unset label toggles get the large-dataset default
  // (hidden) and an unset threshold the auto value, but passed values are the caller's choice
  test.each([
    [`nothing passed`, {}, [false, false], false],
    [`only threshold passed`, { max_hull_dist_show_phases: 0.01 }, [false, false], true],
    [`only a label toggle passed`, { show_unstable_labels: true }, [true, true], false],
  ] as const)(`large datasets: %s`, async (_label, passed, labels, keeps_threshold) => {
    const entries = [
      make_phase({ Li: 1 }, 0),
      make_phase({ O: 1 }, 0),
      make_phase({ Li: 1, O: 1 }, -1),
      ...Array.from({ length: 57 }, (_, idx) => make_phase({ Li: idx + 1, O: 58 - idx }, 0)),
    ]
    const state: Record<string, unknown> = {
      show_stable_labels: undefined,
      show_unstable_labels: undefined,
      max_hull_dist_show_phases: undefined,
      ...passed,
    }
    await mount_hull(
      bind_props({ entries }, state as Partial<ComponentProps<typeof ConvexHull>>),
    )
    flushSync()
    expect([state.show_stable_labels, state.show_unstable_labels]).toEqual(labels)
    expect(state.max_hull_dist_show_phases === 0.01).toBe(keeps_threshold)
  })

  test.each([
    [`spin + oxidation`, { 'Fe2+,spin=5': 1, 'Fe3+,spin=-5': 2, 'O2-': 4 }, [`Fe`, `O`]],
    [`fractional oxidation`, { 'Fe2.5+': 2, 'O2-': 5 }, [`Fe`, `O`]],
    [`isotopes`, { D: 2, 'O2-': 1 }, [`H`, `O`]],
  ] as const)(
    `pymatgen %s species keys in the entries prop render a binary hull`,
    async (_name, composition, elements) => {
      const entries = [
        ...elements.map((element) => make_phase({ [element]: 1 }, 0, { entry_id: element })),
        make_phase({ ...composition }, -10, { entry_id: `compound` }),
      ]
      const target = await mount_hull({ entries })
      flushSync()

      expect(target.querySelector(`.convex-hull-2d`)).not.toBeNull()
      expect(target.querySelector(`.empty-state`)).toBeNull()
      expect(model_entries()?.map((entry) => entry.entry_id)).toContain(`compound`)
    },
  )

  // the info pane ends with the shortcuts of the hull's dimension
  test.each([
    [`2D`, `2d`, `.convex-hull-2d`, [`convex-hull-2d`]],
    [`3D`, `3d`, `.convex-hull-3d`, [`convex-hull-3d`, `camera`, `convex-hull-ternary`]],
    [`4D`, `4d`, `.convex-hull-4d`, [`convex-hull-3d`, `camera`]],
  ] as const)(
    `recovers the %s component when entries arrive`,
    async (_name, dim, plot_selector, dim_scopes) => {
      await mount_harness({ dim, start_missing: true })
      expect(document.body.textContent).toContain(`Missing convex hull data`)

      button(`refresh-convex-entries`).click()
      await tick()
      expect(document.body.textContent).not.toContain(`Missing convex hull data`)
      expect(document.body.querySelector(plot_selector)).not.toBeNull()
      expect_shortcuts_in_pane(document, `.convex-hull-info-pane`, [
        `viewer`,
        `convex-hull`,
        ...dim_scopes,
      ])
      // the keys live in the shortcuts list; only canvas hulls have a camera to drag
      const tips = [...document.querySelectorAll<HTMLElement>(`[data-testid^="tip-"]`)]
      const drag_tips = dim === `2d` ? `` : ` tip-drag tip-pan`
      expect(tips.map(({ dataset }) => dataset.testid).join(` `)).toBe(
        `tip-click tip-double-click${drag_tips}`,
      )
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
      // on_file_load reports the entries with their source
      expect(test_text(`loaded-file`)).toBe(`hull.json < hull.json`)
    },
  )

  // Composition keys are validated inside the drop handler, so a compound-like key ("Fe2O3")
  // reports through console.error instead of throwing from the hull pipeline's $derived
  // mid-render (and, via the auto-dimension wrapper, instead of being mis-counted as binary).
  test(`invalid dropped entries report their filename without replacing the hull`, async () => {
    const dim = `2d`
    await mount_harness({ dim })
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
  })

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

  // tooltip=false hides the 3D hover tooltip (2D defers to ScatterPlot's tooltip prop)
  test.each([undefined, false] as const)(`3d hover tooltip=%s`, async (tooltip) => {
    const entries = [`Li`, `O`, `Na`].map((element) => make_phase({ [element]: 1 }))
    const target = await mount_hull({ entries, tooltip })
    const canvas = target.querySelector(`canvas`)
    canvas?.dispatchEvent(
      new MouseEvent(`mousemove`, { bubbles: true, clientX: 100, clientY: 100 }),
    )
    flushSync()
    expect(target.querySelector(`[data-has-hover="true"]`)).not.toBeNull()
    expect(document.querySelector(`.tooltip-content`) !== null).toBe(tooltip === undefined)
    // leaving the canvas straight from a point (no empty-space mousemove) drops the tooltip
    canvas?.dispatchEvent(new MouseEvent(`mouseleave`))
    flushSync()
    expect(target.querySelector(`[data-has-hover="false"]`)).not.toBeNull()
    expect(document.querySelector(`.tooltip-content`)).toBeNull()
  })

  // A pulse tick used to rerun render_frame: every hull face, point and label rebuilt 60x/s
  // to animate one ring. The rings now live on a transparent canvas stacked over the hull.
  // Selecting (like hovering) re-projected and re-sorted every point while selected_entry and
  // the hover overlay rode in the renderer's prop spread (250 ms per hover at 50k entries).
  test.each([`3d`, `4d`] as const)(
    `pulse ticks repaint only the overlay canvas (%s)`,
    async (dim) => {
      const clears = count_canvas_clears()
      await mount_harness({ dim })
      await let_frames_run()
      const strategy = canvas_draw.HULL_CANVAS_STRATEGIES[dim === `3d` ? 3 : 4]
      const rotation = vi.spyOn(strategy, `rotation`)
      button(`select-entry`).click()
      await let_frames_run()
      expect(rotation).not.toHaveBeenCalled()
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
  test.each([`3d`, `4d`] as const)(
    `presentation changes repaint without recomputing hull geometry (%s)`,
    async (dim) => {
      const builds = vi.spyOn(thermo, `compute_lower_hull_nd`)
      const clears = count_canvas_clears()
      await mount_harness({ dim })
      await let_frames_run()
      expect(clears.base).toBeGreaterThan(0) // it painted at all to begin with

      const initial_builds = builds.mock.calls.length
      expect(initial_builds).toBeGreaterThan(0)
      for (const toggle of [
        `toggle-hull-labels`,
        `toggle-hull-category`,
        `toggle-hull-color-scale`,
      ]) {
        const before = clears.base
        button(toggle).click()
        await let_frames_run()
        expect(clears.base).toBeGreaterThan(before)
        expect(builds).toHaveBeenCalledTimes(initial_builds)
      }
      button(`replace-convex-entries`).click()
      await tick()
      expect(builds.mock.calls.length).toBeGreaterThan(initial_builds)
    },
  )

  // Enter selects the hovered entry, but the chord belongs to the browser (Cmd+Enter is
  // open-in-new-tab). The chord guard has to run before the Enter branch, not after it.
  // Like every viewer's keys, the hull's also reach it hovered without focus (window keydown)
  test.each([
    [`Enter selects the hovered entry`, {}, `old-compound`, false],
    [`Enter without focus selects it too`, {}, `old-compound`, true],
    [`Cmd+Enter is left to the browser`, { metaKey: true }, `none`, false],
    [`Ctrl+Enter is left to the browser`, { ctrlKey: true }, `none`, true],
  ])(`%s`, async (_name, modifiers, expected, hover_only) => {
    await mount_harness({ dim: `3d` })
    const canvas = doc_query<HTMLCanvasElement>(`canvas`)
    canvas.dispatchEvent(
      new MouseEvent(`mousemove`, { bubbles: true, clientX: 100, clientY: 100 }),
    )
    doc_query(`.convex-hull-3d`).dispatchEvent(new PointerEvent(`pointerenter`))
    flushSync()

    const event = new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true, ...modifiers })
    if (hover_only) globalThis.dispatchEvent(event)
    else canvas.dispatchEvent(event)
    await tick()
    expect(selected_text()).toBe(expected)
  })
})

// End-to-end: magnetic_ordering -> pipeline marker assignment -> 2D SVG symbol rendering,
// and hidden_categories -> pipeline visible_entries -> fewer rendered points
describe(`magnetic ordering rendering (ConvexHull)`, () => {
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
    `hidden=%s renders %i markers in color_scale colors`,
    async (hidden, expected_markers) => {
      const plot = await mount_sized(
        ConvexHull,
        {
          entries: magnetic_entries,
          hidden_categories: hidden,
          color_scale: `interpolateReds`,
        },
        { selector: `.scatter`, on_mount: track_component },
      )
      const marker_paths = [...plot.querySelectorAll<SVGPathElement>(`path.marker`)]
      expect(marker_paths).toHaveLength(expected_markers)
      if (hidden.length === 0) {
        // FM triangle, AFM square, and default circles must yield distinct path shapes
        const distinct_shapes = new Set(marker_paths.map((path) => path.getAttribute(`d`)))
        expect(distinct_shapes.size).toBeGreaterThanOrEqual(3)
      }
      // the uncategorized furthest entry (0.1 eV/atom) tops the [0, 0.1] hull-distance
      // domain: darkest red
      const colors = marker_paths.map(marker_fill)
      expect(colors).toEqual(expect.arrayContaining([interpolateReds(0), interpolateReds(1)]))
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
      ConvexHull,
      { entries },
      { selector: `.scatter`, on_mount: track_component },
    )
    // the hull polyline visits the three stable compounds between the two element corners
    const hull_path = [...plot.querySelectorAll<SVGPathElement>(`path`)]
      .map((path) => path.getAttribute(`d`) ?? ``)
      .find((datum) => datum.startsWith(`M`) && datum.split(`L`).length === 5)
    // a monotone spline would emit cubic (C) commands; facets must be M followed by L only
    expect(hull_path).toMatch(/^M[-\d.,]+(?:L[-\d.,]+){4}$/)
  })

  // Linked views: a selected entry above the hull is tied by dashed lines to the stable phases
  // it decomposes into (LiO2 = 2/3 LiO + 1/3 O by atoms); annotations add solid lines and rings
  test(`binary hull draws the decomposition and host annotations`, async () => {
    const lio2 = { ...compound({ Li: 1, O: 2 }, `lio2`, 0.2), e_form_per_atom: -0.2 }
    const entries: PhaseData[] = [
      { ...compound({ Li: 1 }, `ref-li`, 0), e_form_per_atom: 0 },
      { ...compound({ O: 1 }, `ref-o`, 0), e_form_per_atom: 0 },
      { ...compound({ Li: 1, O: 1 }, `lio`, 0), e_form_per_atom: -0.6 },
      lio2,
    ]
    const annotations = {
      lines: [
        {
          from: { composition: { Li: 1 }, e_form: 0 },
          to: { composition: { O: 1 }, e_form: 0 },
        },
      ],
      marks: [
        { composition: { Li: 1, O: 3 }, e_form: -0.1, label: `mixing point` },
        { composition: { Na: 1 }, e_form: 0, label: `outside` }, // skipped with a warning
      ],
    }
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const plot = await mount_sized(
      ConvexHull,
      { entries, selected_entry: lio2, annotations },
      { selector: `.scatter`, on_mount: track_component },
    )
    const count = (selector: string) =>
      plot.querySelectorAll(`.hull-overlay ${selector}`).length
    expect([count(`line[stroke-dasharray]`), count(`line:not([stroke-dasharray])`)]).toEqual([
      2, 1,
    ])
    expect(
      [...plot.querySelectorAll(`.hull-overlay text`)].map((node) => node.textContent),
    ).toEqual([`67%`, `33%`, `mixing point`])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`{"Na":1} is outside the Li-O`))
  })
})
