import NebPlot from '#lib/neb/NebPlot.svelte'
import { host } from '#lib/host.js'
import NebViewer from '#lib/neb/NebViewer.svelte'
import { path_spline } from '#lib/neb/reaction-path.js'
import { parse_reaction_path_json } from '#lib/neb/parse.js'
import { format_num } from '#lib/labels.js'
import { reaction_paths } from '#site/neb/index.js'
import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  assertHoverScopedShortcut,
  mock_fullscreen,
  bind_props,
  export_via_pane,
  create_drop_event,
  doc_query,
  expect_shortcuts_in_pane,
  flush_render,
  mouse,
  plot_svg,
  query,
  resize_element,
  set_input,
  set_select,
} from '../setup'

const direct_path = reaction_paths[`direct hop`]

// SVG annotations are split across text nodes and indented, so compare on squashed text
const squash = (text: string | null): string => (text ?? ``).replaceAll(/\s+/g, ` `)

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
  test.each([
    [`arc_length`, `initial`, `Reaction coordinate (Å)`, `Energy relative to initial state (eV)`],
    [`image_index`, `absolute`, `Image number`, `Energy (eV)`],
  ] as const)(`labels axes for %s mode and %s energy reference`, async (coord_mode, energy_reference, x_label, y_label) => {
    const plot = await mount_plot({
      paths: reaction_paths,
      coord_mode,
      energy_reference,
      controls_open: true,
    })
    expect(plot.querySelector(`.x-axis .axis-label`)?.textContent).toContain(x_label)
    expect(plot.querySelector(`.y-axis .axis-label`)?.textContent).toContain(y_label)
    expect(plot.querySelector<HTMLSelectElement>(`#neb-coord-mode`)?.value).toBe(coord_mode)
  })

  test(`profile reset clears authored overrides`, async () => {
    const plot = await mount_plot({
      paths: reaction_paths,
      coord_mode: `image_index`,
      energy_reference: `absolute`,
      show_spline: false,
      controls_open: true,
    })
    doc_query<HTMLButtonElement>(`button[title="Reset profile to defaults"]`).click()
    await tick()
    expect(query<HTMLSelectElement>(plot, `#neb-coord-mode`).value).toBe(`arc_length`)
    expect(query<HTMLSelectElement>(plot, `#neb-energy-reference`).value).toBe(`initial`)
    expect(query<HTMLInputElement>(plot, `#neb-show-spline`).checked).toBe(true)
    expect(plot.querySelector(`button[title="Reset profile to defaults"]`)).toBeNull()
  })

  test(`annotates the fitted saddle of the active path unless annotate_barrier=false`, async () => {
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

    const hidden = await mount_plot({ paths: reaction_paths, annotate_barrier: false })
    expect(squash(hidden.textContent)).not.toContain(`Eact = `)

    // without its spline the fitted-saddle cross marked a curve that is not drawn
    const no_spline = await mount_plot({ paths: reaction_paths, show_spline: false })
    expect(squash(no_spline.textContent)).toContain(`Eact = `)
    expect(no_spline.textContent).not.toMatch(/fit \+/)
  })

  // oxfmt-ignore
  test.each(
    [[`with a spline`, true, 4], [`without a spline`, false, 2]],
  )(`draws one series per path %s`, async (_name, show_spline, expected_series) => {
    await mount_plot({ paths: reaction_paths, show_spline })
    expect(document.querySelectorAll(`.legend-item`)).toHaveLength(expected_series)
  })
})

test(`hovering another path's spline selects an image of that path`, async () => {
  // B is A with a 3x taller barrier, so its curve runs well above A's
  const [initial] = direct_path.images
  const taller = {
    images: direct_path.images.map((image) => ({
      ...image,
      energy: initial.energy + 3 * (image.energy - initial.energy),
    })),
  }
  const on_image_change = vi.fn()
  const plot = await mount_plot({
    paths: { A: direct_path, B: taller },
    active_path_key: `A`,
    point_tween: { duration: 0 },
    on_image_change,
  })
  const svg = plot_svg(plot)
  svg.getBoundingClientRect = () => DOMRect.fromRect({ width: 500, height: 340 })
  // B's spline is the second 1.5 px line; hover a sample between its first two images, where
  // the nearest plotted point is a spline sample rather than an image marker
  const splines = [...plot.querySelectorAll(`path[stroke-width="1.5"]`)]
  const samples = [
    ...(splines[1]?.getAttribute(`d`) ?? ``).matchAll(/(?<x>-?[\d.e-]+),(?<y>-?[\d.e-]+)/g),
  ]
  expect(samples.length).toBeGreaterThan(100)
  const { x = ``, y = `` } = samples[Math.round(samples.length * 0.1)].groups ?? {}
  svg.dispatchEvent(mouse(`mousemove`, { clientX: Number(x), clientY: Number(y) }))
  await vi.waitFor(() =>
    expect(on_image_change).toHaveBeenLastCalledWith(
      expect.objectContaining({ path_key: `B` }),
    ),
  )
})

describe(`NebViewer`, () => {
  test(`shows a drop prompt when no path is supplied`, async () => {
    const viewer = await mount_viewer()
    expect(viewer.querySelector(`.empty-state[role="status"]`)?.textContent).toContain(
      `Drop a matterviz-reaction-path JSON`,
    )
    expect(viewer.querySelector(`.scatter`)).toBeNull()
  })

  // CSV: one row per image of every profiled path; JSON: the native format, re-loadable
  const n_images = Object.values(reaction_paths).reduce(
    (sum, path) => sum + path.images.length,
    0,
  )
  const energies = (path: { images: { energy: number }[] }) =>
    path.images.map((img) => img.energy)
  test.each([
    [
      `CSV`,
      (data: string) => {
        const [header, first, ...rest] = data.split(`\n`)
        // 1-based image, coordinate 0 and energy 0 relative to the initial image
        const [, image, coord, , rel_energy] = first.split(`,`)
        return [header, rest.length + 1, image, Number(coord), Number(rel_energy)]
      },
      [`path,image,reaction_coordinate,energy,energy_rel_initial`, n_images, `1`, 0, 0],
    ],
    [
      `JSON`,
      (data: string) => {
        const parsed = parse_reaction_path_json(data)
        return [Object.keys(parsed), energies(parsed[`direct hop`])]
      },
      [Object.keys(reaction_paths), energies(direct_path)],
    ],
  ] as const)(`exports the reaction paths as %s`, async (format, pick, expected) => {
    const on_export = vi.fn()
    const viewer = await mount_viewer({ paths: reaction_paths, on_export })
    const result = await export_via_pane(on_export, format, query(viewer, `.neb-controls`))
    expect(result.offered).toEqual([`PNG`, `CSV`, `JSON`])
    expect([result.format, result.filename]).toEqual([format.toLowerCase(), `reaction-path`])
    expect(pick(String(result.data))).toEqual(expected)
  })

  test(`renders the plot, the structure and the barrier summary together`, async () => {
    // a path it cannot profile is reported beside those that render
    const [first, second] = direct_path.images
    const dup = { images: [first, first, second] }
    const viewer = await mount_viewer({ paths: { ...reaction_paths, dup } })
    expect(viewer.textContent).toMatch(/dup: .*zero-length path tangent/)
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

  test.each([
    { show_controls: `never`, shown: false },
    { show_controls: { mode: `never` }, shown: false },
    { show_controls: { mode: `hover`, style: `opacity: 0.5` }, shown: true },
    { show_controls: { hidden: [`controls`] }, shown: false },
  ] as const)(
    `preserves nested plot controls: $show_controls`,
    async ({ show_controls, shown }) => {
      const viewer = await mount_viewer({
        paths: reaction_paths,
        plot_props: { show_controls },
      })
      const toggle = viewer.querySelector<HTMLElement>(`.scatter .plot-controls-toggle`)
      expect(Boolean(toggle)).toBe(shown)
      if (shown) {
        const header = viewer.querySelector<HTMLElement>(`.scatter .header-controls`)
        expect(header?.classList.contains(`hover-visible`)).toBe(true)
        expect(header?.style.opacity).toBe(`0.5`)
        expect(toggle?.classList.contains(`always-visible`)).toBe(true)
        expect(toggle?.style.opacity).toBe(``)
      }
    },
  )

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
    viewer.querySelector<HTMLButtonElement>(`.plot-controls-toggle`)?.click()
    await flush_render()
    const coord_select = viewer.querySelector<HTMLSelectElement>(`#neb-coord-mode`)
    const energy_select = viewer.querySelector<HTMLSelectElement>(`#neb-energy-reference`)
    const spline = viewer.querySelector<HTMLInputElement>(`#neb-show-spline`)
    if (!coord_select || !energy_select || !spline)
      throw new Error(`profile pane controls missing`)
    expect(coord_select.closest(`.plot-controls-pane`)).not.toBeNull()

    set_select(coord_select, `image_index`)
    await flush_render()
    expect(state.coord_mode).toBe(`image_index`)
    expect(viewer.querySelector(`.x-axis .axis-label`)?.textContent).toContain(`Image number`)

    set_select(energy_select, `absolute`)
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
    [`the next button`, `[aria-label="Next image"]`, 0, 2, false],
    [`the previous button`, `[aria-label="Previous image"]`, 2, 2, false],
    [`the previous button at the first image`, `[aria-label="Previous image"]`, 0, 1, true],
  ])(
    `stepping with %s moves to image %i -> %i`,
    async (_name, selector, start_idx, label, disabled) => {
      const viewer = await mount_viewer({ paths: reaction_paths, active_image_idx: start_idx })
      const button = viewer.querySelector<HTMLButtonElement>(selector)
      expect(button?.disabled).toBe(disabled)
      button?.click()
      await tick()
      expect(viewer.querySelector(`.image-status`)?.textContent).toContain(
        `image ${label} of 7`,
      )
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
    expect(slider?.getAttribute(`aria-valuetext`)).toBe(`image 1 of 7`)
    // the demo file labels its beads `image 0` ... `image 6`, which restate the index
    expect(viewer.querySelector(`.image-status`)?.textContent).toMatch(/^\s*image 1 of 7/)
    // a generic 0-based `image k` label would contradict the position, so it is not shown
    const images = direct_path.images.map((image, idx) => ({
      ...image,
      label: `image ${idx}`,
    }))
    const generic = await mount_viewer({ paths: { ...direct_path, images } })
    expect(generic.querySelector(`.image-status`)?.textContent).toMatch(/^\s*image 1 of 7/)
    // ...but a bead number from a larger path (a sub-path's image 3, 4, ...) is kept
    const sub_path = direct_path.images.map((image, idx) => ({
      ...image,
      label: `image ${idx + 3}`,
    }))
    const kept = await mount_viewer({ paths: { ...direct_path, images: sub_path } })
    expect(kept.querySelector(`.image-status`)?.textContent).toMatch(
      /^\s*image 3: image 1 of 7/,
    )
    expect(
      viewer.querySelector(`.step-section > span[aria-label]`)?.getAttribute(`aria-label`),
    ).toBe(`7 total images`)
  })

  test(`applies shared control visibility names; export_formats=[] drops the export pane`, async () => {
    const viewer = await mount_viewer({
      paths: direct_path,
      export_formats: [],
      show_controls: { mode: `always`, hidden: [`fps`, `energy`, `fullscreen`] },
    })
    const hidden = [
      `.fps-section`,
      `.image-status`,
      `.fullscreen-button`,
      `.neb-export-toggle`,
    ]
    for (const selector of hidden) {
      expect(viewer.querySelector(selector)).toBeNull()
    }
    expect(viewer.querySelector(`.step-section`)).not.toBeNull()
  })

  // A host that cannot fullscreen an element turns the toggle, its `f` shortcut and a bound
  // fullscreen flag off for every viewer at once.
  test.each([true, false])(
    `a host with fullscreen=%s gets the toggle, its f shortcut and the flag only if true`,
    async (fullscreen) => {
      mock_fullscreen()
      const orig_fullscreen = host.fullscreen
      host.fullscreen = fullscreen
      try {
        const state = $state({ fullscreen: false })
        const viewer = await mount_viewer(bind_props({ paths: direct_path }, state))
        expect(viewer.querySelector(`.fullscreen-btn`) !== null).toBe(fullscreen)
        viewer.dispatchEvent(new PointerEvent(`pointerenter`, { bubbles: true }))
        viewer.dispatchEvent(new PointerEvent(`pointermove`, { bubbles: true }))
        globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `f` }))
        await tick()
        expect(state.fullscreen).toBe(fullscreen)
        state.fullscreen = true
        await tick()
        expect(state.fullscreen).toBe(fullscreen)
      } finally {
        host.fullscreen = orig_fullscreen
      }
    },
  )

  test(`updates path and image bindings through shared navigation`, async () => {
    const state = $state({ active_path_key: `direct hop`, active_image_idx: 0 })
    const viewer = await mount_viewer(bind_props({ paths: reaction_paths }, state))
    const slider = query<HTMLInputElement>(viewer, `.step-slider`)
    set_input(slider, `2`)
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
    // NebViewer forwards its keys to playback, so the play button names its shortcut and the
    // plot's settings pane lists them all at its bottom
    expect(viewer.querySelector(`.play-button`)?.getAttribute(`aria-keyshortcuts`)).toBe(
      `Space`,
    )
    expect_shortcuts_in_pane(viewer, `.plot-controls-pane`, [`viewer`, `sequence`])

    set_select(query<HTMLSelectElement>(viewer, `.path-control select`), `curved hop`)
    await flush_render()
    expect([state.active_path_key, state.active_image_idx]).toEqual([`curved hop`, 0])
  })

  // Like Trajectory, playback keys belong to the hovered or focused viewer, not just the slider
  test(`playback keys work from the hovered or focused root, not from its form fields`, async () => {
    const state = $state({ active_image_idx: 0 })
    const viewer = await mount_viewer(bind_props({ paths: reaction_paths }, state))
    expect([viewer.getAttribute(`role`), viewer.tabIndex]).toEqual([`application`, 0])
    await assertHoverScopedShortcut({
      viewer,
      trigger: () =>
        globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `ArrowRight` })),
      read_state: () => state.active_image_idx,
    })
    const press = async (target: HTMLElement, key: string) => {
      const event = new KeyboardEvent(`keydown`, { key, bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      await flush_render()
      return event.defaultPrevented
    }
    expect([await press(viewer, `End`), state.active_image_idx]).toEqual([true, 6])
    expect([await press(viewer, `Home`), state.active_image_idx]).toEqual([true, 0])
    const path_select = query<HTMLSelectElement>(viewer, `.path-control select`)
    expect([await press(path_select, `End`), state.active_image_idx]).toEqual([false, 0])
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
      set_input(fps_input, String(input))
      fps_input.dispatchEvent(new Event(`change`, { bubbles: true }))
      await flush_render()
      expect([state.fps, fps_input.value]).toEqual([expected, String(expected)])
    }
  })

  test(`loads valid drops, loose image batches, and reports invalid ones`, async () => {
    const state = $state({
      active_path_key: ``,
      active_image_idx: 1,
      error_msg: undefined as string | undefined,
    })
    const viewer = await mount_viewer(bind_props({}, state))
    // without paths there is nothing to clamp against, so the bound index is left alone
    expect(state.active_image_idx).toBe(1)
    const drop = (files: File | File[]) => viewer.dispatchEvent(create_drop_event(files))
    const [first, second] = direct_path.images
    const path_file = (label: string, images: unknown[]) =>
      new File(
        [JSON.stringify({ format: `matterviz-reaction-path`, label, images })],
        `${label}.json`,
      )
    drop(path_file(`dropped`, direct_path.images))
    await vi.waitFor(() => expect(state.active_path_key).toBe(`dropped`))
    expect(state.active_image_idx).toBe(0)
    expect(viewer.querySelector(`.scatter`)).not.toBeNull()

    // pymatgen-style structure JSONs carrying their energy: only the batch forms a path
    drop(
      direct_path.images.slice(0, 3).map(
        ({ structure, energy }, idx) =>
          new File(
            [
              JSON.stringify({
                ...structure,
                properties: { ...structure.properties, energy },
              }),
            ],
            `img-${idx}.json`,
          ),
      ),
    )
    await vi.waitFor(() => expect(state.active_path_key).toBe(`dropped images`))
    expect(state.error_msg).toBeUndefined()
    // a file's own image label leads the 1-based position
    expect(viewer.querySelector(`.image-status`)?.textContent).toContain(
      `img-0.json: image 1 of 3`,
    )

    // recoverable parse issues of a batch show as one dismissible notice, cleared next drop
    const xyz = (energy: number, x_coord: number) =>
      `2\nenergy=${energy} pbc="bogus"\nH 0 0 0\nH ${x_coord} 0 0`
    drop([new File([xyz(-10, 0.7)], `a.xyz`), new File([xyz(-9, 0.9)], `b.xyz`)])
    await vi.waitFor(() =>
      expect(viewer.querySelector(`.status-message.warning`)?.textContent).toMatch(
        /2 parse warnings: Invalid EXTXYZ pbc/,
      ),
    )

    // identical consecutive images give no path tangent: refused with its reason
    drop(path_file(`dup`, [first, first, second]))
    await vi.waitFor(() =>
      expect(state.error_msg).toMatch(/dup\.json: .*zero-length path tangent/),
    )
    expect(viewer.querySelector(`.status-message.warning`)).toBeNull()
    expect(state.active_path_key).toBe(`dropped images`)

    vi.spyOn(console, `error`).mockImplementation(() => undefined)
    drop(new File([`{`], `bad.json`))
    await vi.waitFor(() =>
      expect(state.error_msg).toMatch(/bad\.json.*Failed to parse structure/),
    )
    const plot = query(viewer, `.scatter`)
    expect(query(viewer, `.viewer-error [role="alert"]`).textContent).toContain(
      state.error_msg,
    )
    query<HTMLButtonElement>(viewer, `.viewer-error button`).click()
    await tick()
    expect(state.error_msg).toBeUndefined()
    expect(viewer.querySelector(`.viewer-error`)).toBeNull()
    expect(query(viewer, `.scatter`)).toBe(plot)
  })

  // a rejected request leaving the flag false is FullscreenButton's own (Structure tests it)
  test(`fullscreen toggling syncs the bound flag and on_fullscreen_change`, async () => {
    mock_fullscreen()
    const state = $state({ fullscreen: false, show_controls: true })
    const on_fullscreen_change = vi.fn()
    const viewer = await mount_viewer(
      bind_props({ paths: direct_path, on_fullscreen_change }, state),
    )
    const button = query<HTMLButtonElement>(viewer, `.fullscreen-button`)
    button.click()
    await vi.waitFor(() => expect(state.fullscreen).toBe(true))
    expect(on_fullscreen_change).toHaveBeenCalledExactlyOnceWith(true)
    state.show_controls = false
    await tick()
    expect(button.style.display).toBe(`none`)
    await document.exitFullscreen()
    await tick()
    expect(state.fullscreen).toBe(false)
    expect(viewer.querySelector(`.sequence-control-bar`)).toBeNull()
    expect(on_fullscreen_change).toHaveBeenLastCalledWith(false)
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

  // Image numbers count from 1 like the stepper; the image-number axis repeats no coordinate
  test.each([
    [`arc_length`, /Highest image #5 at [\d.]+ Å/],
    [`image_index`, /Highest image #5\s+Fitted/],
  ] as const)(
    `the summary follows the selected path in %s mode`,
    async (coord_mode, highest) => {
      const viewer = await mount_viewer({
        paths: reaction_paths,
        active_path_key: `curved hop`,
        coord_mode,
      })
      const summary = viewer.querySelector(`.barrier-summary`)?.textContent ?? ``
      for (const text of [`1.14 eV`, `Fitted saddle (natural-cubic)`, `above image #5`])
        expect(summary).toContain(text)
      expect(summary).toMatch(highest)
    },
  )
})
