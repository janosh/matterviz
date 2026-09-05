import { NebPlot, NebViewer, path_spline } from '$lib/neb'
import { format_num } from '$lib/labels'
import { reaction_paths } from '$site/neb'
import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  mock_fullscreen,
  bind_props,
  create_drop_event,
  doc_query,
  flush_render,
  query,
  resize_element,
} from '../setup'

const direct_path = reaction_paths[`direct hop`]

// SVG annotations are split across text nodes and indented, so compare on squashed text
const squash = (text: string | null): string => (text ?? ``).replaceAll(/\s+/g, ` `)

// Svelte bind:value on <select> reads querySelector(':checked'); happy-dom does not match
// that on <option>, so the binding would stick on the first option.
const change_select = (select: HTMLSelectElement, value: string): void => {
  select.value = value
  vi.spyOn(select, `querySelector`).mockImplementation(() => select.selectedOptions[0])
  select.dispatchEvent(new Event(`change`, { bubbles: true }))
}

// jsdom lays everything out at 0x0, so the scatter plot needs an explicit size before
// any annotation it positions from the scales can be asserted on.
const sized = async (root: HTMLElement | null, label: string): Promise<HTMLElement> => {
  if (!root) throw new Error(`${label} root element not found`)
  const plot = root.matches(`.scatter`) ? root : root.querySelector<HTMLElement>(`.scatter`)
  if (plot) await resize_element(plot, 500, 340)
  return root
}

// Both mounters tear down what came before so a test can mount twice and still query the
// component it just made. Clearing innerHTML alone drops the nodes but leaves the previous
// component's effects, timers and window listeners running, which makes tests order-dependent.
const mounted_components: ReturnType<typeof mount>[] = []

const reset_mounts = async (): Promise<void> => {
  await Promise.all(mounted_components.splice(0).map((component) => unmount(component)))
  document.body.replaceChildren()
}

afterEach(async () => {
  await reset_mounts()
  vi.restoreAllMocks()
})

const mount_plot = async (props: ComponentProps<typeof NebPlot>): Promise<HTMLElement> => {
  await reset_mounts()
  const style = `width: 500px; height: 340px`
  mounted_components.push(
    mount(NebPlot, { target: document.body, props: { ...props, style } }),
  )
  return sized(document.querySelector<HTMLElement>(`.scatter`), `NebPlot`)
}

const mount_viewer = async (
  props: ComponentProps<typeof NebViewer> = {},
): Promise<HTMLElement> => {
  await reset_mounts()
  mounted_components.push(mount(NebViewer, { target: document.body, props }))
  await tick()
  return sized(document.querySelector<HTMLElement>(`.neb-viewer`), `NebViewer`)
}

describe(`NebPlot`, () => {
  test.each([
    [`a keyed record of paths`, reaction_paths],
    [`a single path object`, direct_path],
    [`a bare image array`, direct_path.images],
  ])(`renders %s`, async (_name, paths) => {
    const plot = await mount_plot({ paths })
    expect(plot.querySelector(`svg[role="application"]`)).toBeInstanceOf(SVGSVGElement)
    expect(plot.querySelector(`.y-axis .axis-label`)?.textContent).toContain(`eV`)
  })

  // oxfmt-ignore
  test.each(
    [[`arc_length`, `Reaction coordinate (Å)`], [`image_index`, `Image index`]] as const,
  )(`labels the x-axis for %s mode`, async (mode, expected) => {
    const plot = await mount_plot({ paths: reaction_paths, coord_mode: mode })
    expect(plot.querySelector(`.x-axis .axis-label`)?.textContent).toContain(expected)
    expect(plot.querySelector<HTMLSelectElement>(`#neb-coord-mode`)?.value).toBe(mode)
  })

  // oxfmt-ignore
  test.each(
    [[`initial`, `Energy relative to initial state (eV)`], [`absolute`, `Energy (eV)`]] as const,
  )(`labels the y-axis for the %s energy reference`, async (reference, expected) => {
    const plot = await mount_plot({ paths: reaction_paths, energy_reference: reference })
    expect(plot.querySelector(`.y-axis .axis-label`)?.textContent).toContain(expected)
  })

  test(`annotates the fitted saddle of the active path`, async () => {
    const plot = await mount_plot({ paths: reaction_paths, active_path_key: `direct hop` })
    const spline = path_spline(direct_path)
    const e_act = spline.fitted_max.energy - direct_path.images[0].energy
    expect(squash(plot.textContent)).toContain(`Eact = ${format_num(e_act, `.3~`)} eV`)
    expect(plot.querySelector(`tspan[baseline-shift="sub"]`)?.textContent).toBe(`act`)
    expect(plot.textContent).toMatch(/fit \+0\.00\d+/)
    const fit_cross = [...plot.querySelectorAll(`line`)].filter(
      (line) => line.getAttribute(`stroke-width`) === `1.5`,
    )
    const e_act_line = [...plot.querySelectorAll(`line`)].find(
      (line) =>
        line.getAttribute(`stroke-width`) === `1.25` &&
        line.getAttribute(`x1`) === line.getAttribute(`x2`) &&
        !line.getAttribute(`stroke-dasharray`),
    )
    expect(fit_cross.length).toBeGreaterThanOrEqual(2)
    expect(e_act_line).toBeDefined()
    const peak_x =
      (Number(fit_cross[0].getAttribute(`x1`)) + Number(fit_cross[0].getAttribute(`x2`))) / 2
    expect(Number(e_act_line?.getAttribute(`x1`))).toBeCloseTo(peak_x, 5)
  })

  test(`hides the barrier annotation when asked`, async () => {
    const plot = await mount_plot({ paths: reaction_paths, annotate_barrier: false })
    expect(squash(plot.textContent)).not.toContain(`Eact = `)
  })

  // oxfmt-ignore
  test.each(
    [[`with a spline`, true, 4], [`without a spline`, false, 2]],
  )(`draws one series per path %s`, async (_name, show_spline, expected_series) => {
    await mount_plot({ paths: reaction_paths, show_spline })
    expect(document.querySelectorAll(`.legend-item`)).toHaveLength(expected_series)
  })
})

describe(`NebViewer`, () => {
  test(`shows a drop prompt when no path is supplied`, async () => {
    const viewer = await mount_viewer()
    expect(viewer.textContent).toContain(`Drop a matterviz-reaction-path JSON`)
    expect(viewer.querySelector(`.scatter`)).toBeNull()
  })

  test(`renders the plot, the structure and the barrier summary together`, async () => {
    const viewer = await mount_viewer({ paths: reaction_paths })
    expect(viewer.querySelector(`.scatter`)).toBeInstanceOf(HTMLElement)
    expect(viewer.querySelector(`.structure-pane`)).toBeInstanceOf(HTMLElement)
    expect(
      viewer.querySelector(`[aria-label="Resize reaction plot and structure panes"]`),
    ).not.toBeNull()
    expect(
      viewer.querySelector<HTMLElement>(`.panes`)?.style.getPropertyValue(`--split-pane-size`),
    ).toBe(`60%`)
    expect(viewer.querySelector(`.neb-controls`)).not.toBeNull()
    const summary = viewer.querySelector(`.barrier-summary`)?.textContent ?? ``
    expect(summary).toContain(`Forward barrier`)
    expect(summary).toContain(`0.8339 eV`)
    expect(summary).toContain(`0.6539 eV`)
    expect(summary).toContain(`Fitted saddle (force-hermite)`)
    expect(
      viewer.querySelectorAll(`[aria-label="Reaction barriers"] [role="listitem"]`),
    ).toHaveLength(5)
  })

  test(`aligns plot controls with the hover sequence bar`, async () => {
    await mount_viewer({ paths: reaction_paths, show_controls: `hover` })
    const panes = doc_query(`.panes`)
    expect(panes.style.getPropertyValue(`--viewer-buttons-top`)).toMatch(/^calc\(.+\)$/)
  })

  test(`path picker stays on the bar; profile settings bind from the plot pane`, async () => {
    const state = $state({
      coord_mode: `arc_length` as const,
      energy_reference: `initial` as const,
      show_spline: true,
    })
    const viewer = await mount_viewer(bind_props({ paths: reaction_paths }, state))
    expect(viewer.querySelectorAll(`.neb-controls select`)).toHaveLength(1)
    const coord_select = viewer.querySelector<HTMLSelectElement>(`#neb-coord-mode`)
    const energy_select = viewer.querySelector<HTMLSelectElement>(`#neb-energy-reference`)
    const spline = viewer.querySelector<HTMLInputElement>(`#neb-show-spline`)
    if (!coord_select || !energy_select || !spline)
      throw new Error(`profile pane controls missing`)
    expect(coord_select.closest(`.plot-controls-pane`)).not.toBeNull()

    change_select(coord_select, `image_index`)
    await flush_render()
    expect(state.coord_mode).toBe(`image_index`)
    expect(viewer.querySelector(`.x-axis .axis-label`)?.textContent).toContain(`Image index`)

    change_select(energy_select, `absolute`)
    await flush_render()
    expect(state.energy_reference).toBe(`absolute`)
    expect(viewer.querySelector(`.y-axis .axis-label`)?.textContent).toContain(`Energy (eV)`)

    spline.click()
    await flush_render()
    expect(state.show_spline).toBe(false)

    const single = await mount_viewer({ paths: direct_path })
    expect(single.querySelectorAll(`.neb-controls select`)).toHaveLength(0)
  })

  test.each([
    [`the next button`, `[title="Next image"]`, 0, 2, false],
    [`the previous button`, `[title="Previous image"]`, 2, 2, false],
    [`the previous button at the first image`, `[title="Previous image"]`, 0, 1, true],
  ])(
    `stepping with %s moves to image %i -> %i`,
    async (_name, selector, start_idx, label, disabled) => {
      const viewer = await mount_viewer({ paths: reaction_paths, active_image_idx: start_idx })
      const button = viewer.querySelector<HTMLButtonElement>(selector)
      expect(button?.disabled).toBe(disabled)
      button?.click()
      await tick()
      expect(viewer.querySelector(`.image-status`)?.textContent).toContain(`(${label}/7)`)
    },
  )

  // The stepper's range input has no visible <label>. The name omits "slider" (role=slider
  // already announces that) and valuetext carries the label a bare index would not convey.
  test(`the image slider is reachable by its accessible name`, async () => {
    const viewer = await mount_viewer({ paths: reaction_paths })
    const slider = viewer.querySelector<HTMLInputElement>(`input[aria-label="NEB image"]`)
    expect(slider?.type).toBe(`range`)
    expect(slider?.max).toBe(`6`)
    // mirrors the visible stepper caption so both convey the same position
    expect(slider?.getAttribute(`aria-valuetext`)).toBe(`image 0 (1 of 7)`)
    expect(
      viewer.querySelector(`.step-section > span[aria-label]`)?.getAttribute(`aria-label`),
    ).toBe(`7 total images`)
  })

  test(`applies shared control visibility names`, async () => {
    const viewer = await mount_viewer({
      paths: direct_path,
      show_controls: {
        mode: `always`,
        hidden: [`fps`, `energy`, `fullscreen`],
      },
    })

    for (const selector of [`.fps-section`, `.image-status`, `.fullscreen-button`]) {
      expect(viewer.querySelector(selector)).toBeNull()
    }
    expect(viewer.querySelector(`.step-section`)).not.toBeNull()
  })

  test(`updates path and image bindings through shared navigation`, async () => {
    const state = $state({ active_path_key: `direct hop`, active_image_idx: 0 })
    const viewer = await mount_viewer(bind_props({ paths: reaction_paths }, state))
    const slider = query<HTMLInputElement>(viewer, `.step-slider`)
    slider.value = `2`
    slider.dispatchEvent(new Event(`input`, { bubbles: true }))
    await flush_render()
    expect(state.active_image_idx).toBe(2)

    for (const [key, expected_idx, expected_label] of [
      [` `, 2, `Pause`],
      [`ArrowRight`, 3, `Pause`],
      [` `, 3, `Play`],
    ] as const) {
      const event = new KeyboardEvent(`keydown`, { key, bubbles: true, cancelable: true })
      slider.dispatchEvent(event)
      await flush_render()
      expect(event.defaultPrevented).toBe(true)
      expect(state.active_image_idx).toBe(expected_idx)
      expect(viewer.querySelector(`.play-button`)?.getAttribute(`aria-label`)).toBe(
        expected_label,
      )
    }

    const path_select = query<HTMLSelectElement>(viewer, `.path-control select`)
    path_select.value = `curved hop`
    path_select.dispatchEvent(new Event(`change`, { bubbles: true }))
    await flush_render()
    expect([state.active_path_key, state.active_image_idx]).toEqual([`curved hop`, 0])
  })

  test(`auto-plays images and can be paused`, async () => {
    vi.useFakeTimers()
    try {
      const state = $state({ active_image_idx: 0, fps: 2, auto_play: true })
      const viewer = await mount_viewer(bind_props({ paths: direct_path }, state))
      vi.advanceTimersByTime(550)
      flushSync()
      expect(state.active_image_idx).toBe(1)

      viewer.querySelector<HTMLButtonElement>(`.play-button`)?.click()
      flushSync()
      vi.advanceTimersByTime(1000)
      flushSync()
      expect(state.active_image_idx).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test(`normalizes bound FPS values to 0.1 increments`, async () => {
    const state = $state({ fps: 0.73 })
    await mount_viewer(bind_props({ paths: direct_path }, state))
    const fps_input = doc_query<HTMLInputElement>(`.fps-section input[type="number"]`)
    expect(state.fps).toBe(0.7)
    expect(fps_input.step).toBe(`0.1`)

    for (const [input, expected] of [
      [12.36, 12.4],
      [301, 300],
    ]) {
      fps_input.value = String(input)
      fps_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      fps_input.dispatchEvent(new Event(`change`, { bubbles: true }))
      await flush_render()
      expect([state.fps, fps_input.value]).toEqual([expected, String(expected)])
    }
  })

  test(`loads valid drops and reports invalid ones`, async () => {
    const state = $state({
      active_path_key: ``,
      active_image_idx: 1,
      error_msg: undefined as string | undefined,
    })
    const viewer = await mount_viewer(bind_props({}, state))
    const content = JSON.stringify({
      format: `matterviz-reaction-path`,
      label: `dropped`,
      images: direct_path.images,
    })
    viewer.dispatchEvent(create_drop_event(new File([content], `path.json`)))
    await vi.waitFor(() => expect(state.active_path_key).toBe(`dropped`))
    expect(state.active_image_idx).toBe(0)
    expect(viewer.querySelector(`.scatter`)).not.toBeNull()

    vi.spyOn(console, `error`).mockImplementation(() => undefined)
    viewer.dispatchEvent(create_drop_event(new File([`{`], `bad.json`)))
    await vi.waitFor(() =>
      expect(state.error_msg).toMatch(/bad\.json.*Failed to parse structure/),
    )
  })

  test(`keeps fullscreen state synchronized after rejected and successful entry`, async () => {
    mock_fullscreen()
    const rejected_state = $state({ fullscreen: false })
    const rejected_callback = vi.fn()
    const rejected_viewer = await mount_viewer(
      bind_props(
        {
          paths: direct_path,
          on_fullscreen_change: rejected_callback,
        },
        rejected_state,
      ),
    )
    rejected_viewer.requestFullscreen = vi
      .fn()
      .mockRejectedValue(new Error(`fullscreen denied`))
    const console_error = vi.spyOn(console, `error`).mockImplementation(() => undefined)
    rejected_viewer.querySelector<HTMLButtonElement>(`.fullscreen-button`)?.click()
    await vi.waitFor(() => expect(console_error).toHaveBeenCalledOnce())
    expect(rejected_state.fullscreen).toBe(false)
    expect(rejected_callback).not.toHaveBeenCalled()

    let fullscreen_element: Element | null = null
    Object.defineProperty(document, `fullscreenElement`, {
      configurable: true,
      get: () => fullscreen_element,
    })
    const state = $state({ fullscreen: false })
    const on_fullscreen_change = vi.fn()
    const viewer = await mount_viewer(
      bind_props({ paths: direct_path, on_fullscreen_change }, state),
    )
    const button = query<HTMLButtonElement>(viewer, `.fullscreen-button`)
    viewer.requestFullscreen = vi.fn(async () => {
      fullscreen_element = viewer
      document.dispatchEvent(new Event(`fullscreenchange`))
    })
    button.click()
    await vi.waitFor(() => expect(state.fullscreen).toBe(true))
    expect(on_fullscreen_change).toHaveBeenCalledExactlyOnceWith(true)
  })

  test(`the fitted saddle is a physical energy, not an artefact of the x-axis`, async () => {
    const fitted_excess = async (coord_mode: `arc_length` | `image_index`) => {
      const viewer = await mount_viewer({
        paths: reaction_paths,
        active_path_key: `direct hop`,
        coord_mode,
      })
      const summary = squash(viewer.querySelector(`.barrier-summary`)?.textContent ?? ``)
      const excess = /\+(?<excess>[\d.]+) eV above image/.exec(summary)?.groups?.excess
      if (!excess) throw new Error(`no fitted saddle row in "${summary}"`)
      return Number(excess)
    }
    const arc = await fitted_excess(`arc_length`)
    const index = await fitted_excess(`image_index`)
    // dE/ds comes out of the forces in eV/Å. Grafting it unchanged onto the unitless bead
    // number reported 0.0818 eV here — 12x the truth. Reparametrising 7 knots does move
    // the interpolant a little, so allow 2 meV rather than demanding f64 agreement.
    expect(arc).toBeCloseTo(0.0069, 4)
    expect(Math.abs(index - arc)).toBeLessThan(2e-3)
  })

  test(`the summary follows the selected path`, async () => {
    const viewer = await mount_viewer({ paths: reaction_paths, active_path_key: `curved hop` })
    const summary = viewer.querySelector(`.barrier-summary`)?.textContent ?? ``
    expect(summary).toContain(`1.14 eV`)
    expect(summary).toContain(`Fitted saddle (natural-cubic)`)
  })
})
