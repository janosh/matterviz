import type { PhononModeDataset } from '#lib/spectral/index.js'
import { parse_born, parse_phonon_modes } from '#lib/spectral/parse-phonon-modes.js'
import PhononModeExplorer from '#lib/spectral/PhononModeExplorer.svelte'
import { convert_frequencies } from '#lib/spectral/frequency-units.js'
import {
  peak_mode_indices,
  spectrum_from_phonon_data,
  spectrum_sticks,
} from '#lib/spectral/ir-raman.js'
import born_file from '#site/phonons/ir-raman/NaCl.BORN?raw'
import band_yaml from '#site/phonons/ir-raman/NaCl-Gamma-X-band.yaml?raw'
import { flushSync, mount, tick, type ComponentProps, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import {
  fire,
  mouse,
  plot_svg,
  query,
  resize_element,
  set_input,
  translate_of,
  trigger_resize_observer,
} from '../setup'

type ExplorerProps = ComponentProps<typeof PhononModeExplorer>
const modes = parse_phonon_modes(band_yaml)
const spectrum = spectrum_from_phonon_data(modes, parse_born(born_file))
const dataset: PhononModeDataset = { modes, spectrum, filename: `NaCl-band.yaml` }
const explorer_defaults = {
  dataset,
  auto_play: false,
  n_frames: 4,
  supercell: [1, 1, 1],
} satisfies ExplorerProps

const mount_explorer = (props: ExplorerProps): HTMLElement => {
  const target = document.createElement(`div`)
  document.body.append(target)
  const component = mount(PhononModeExplorer, { target, props })
  onTestFinished(() => unmount(component).finally(() => target.remove()))
  return target
}
const render = (props: Partial<ExplorerProps> = {}): HTMLElement =>
  mount_explorer({ ...explorer_defaults, ...props })

const open_menu = async (target: HTMLElement, label: string): Promise<void> => {
  await vi.waitFor(() =>
    expect(target.querySelector(`[aria-label="${label}"]`)).not.toBeNull(),
  )
  target.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click()
  await tick()
}

test(`renders a typed phonon dataset`, async () => {
  const props = $state<ExplorerProps>({
    ...explorer_defaults,
    vector_thickness: 1,
    vector_color: null,
  })
  const target = mount_explorer(props)
  expect(target.querySelector(`.toolbar`)).toBeNull()
  await open_menu(target, `Modes`)
  await open_menu(target, `Phonon settings`)
  await vi.waitFor(() => {
    const summary = target.querySelector(`[data-testid="phonon-mode-summary"]`)?.textContent
    expect(summary).toContain(`Mode 4`)
    expect(summary).toContain(`cm⁻¹`)
    expect(summary).toMatch(/Na \d+% · Cl \d+%|Cl \d+% · Na \d+%/)
    expect(summary).toContain(`NaCl-band.yaml`)
    // NaCl has no polarizability data, so there is no IR/Raman choice to offer
    expect(target.querySelector(`[aria-label="Spectrum type"]`)).toBeNull()
    expect(target.querySelector<HTMLInputElement>(`.checkbox input`)?.checked).toBe(false)
    expect(
      target.querySelector(`[aria-label="Resize atomic motion and phonon plot panes"]`),
    ).not.toBeNull()
    expect(
      target.querySelector<HTMLElement>(`.panes`)?.style.getPropertyValue(`--split-pane-size`),
    ).toBe(`${(1.15 / 2.1) * 100}%`)
  })
  expect(target.querySelector(`.explorer-header .tabs`)).toBeNull()
  expect(target.querySelector(`.structure .mode-picker .phonon-modes-toggle`)).not.toBeNull()
  expect(target.querySelector(`.phonon-modes-pane .control-tab`)).toBeNull()
  expect(target.querySelector(`.phonon-modes-pane .resize-handle`)).toBeNull()
  expect(target.querySelector(`.trajectory-controls .toolbar`)).not.toBeNull()
  // structure settings mount on first open of the viewer's controls pane
  const controls_toggle = await vi.waitFor(() =>
    query<HTMLButtonElement>(target, `button.structure-controls-toggle`),
  )
  controls_toggle.click()
  await tick()
  const eigenvectors = target.querySelector<HTMLInputElement>(`.checkbox input`)
  eigenvectors?.click()
  await vi.waitFor(() =>
    expect(
      target.querySelector<HTMLInputElement>(
        `[data-key="vector_config:phonon_displacement"] input`,
      )?.checked,
    ).toBe(true),
  )
  const thickness = query<HTMLInputElement>(target, `[aria-label="Eigenvector thickness"]`)
  const color = query<HTMLInputElement>(target, `[aria-label="Eigenvector color hex"]`)
  set_input(thickness, `2.5`)
  set_input(color, `#123abc`)
  await vi.waitFor(() => {
    expect(props.vector_thickness).toBe(2.5)
    expect(props.vector_color).toBe(`#123abc`)
    expect(target.querySelector(`.vector-thickness-control output`)?.textContent).toBe(`2.5×`)
    expect(
      target.querySelector<HTMLInputElement>(
        `[data-key="vector_config:phonon_displacement"] input[type="color"]`,
      )?.value,
    ).toBe(`#123abc`)
  })
  target.querySelector<HTMLButtonElement>(`.vector-color-control button`)?.click()
  await tick()
  expect(props.vector_color).toBeNull()
  expect(target.querySelector(`.phonon-modes-toggle`)?.getAttribute(`aria-expanded`)).toBe(
    `true`,
  )
  target.querySelector<HTMLButtonElement>(`.phonon-modes-pane .mode-list button`)?.click()
  await vi.waitFor(() => {
    expect(target.querySelector(`[data-testid="phonon-mode-summary"]`)?.textContent).toContain(
      `Mode 1`,
    )
    expect(target.querySelector(`.plot-pane`)).not.toBeNull()
  })
  target.querySelector<HTMLButtonElement>(`[aria-label="Phonon settings"]`)?.click()
  await tick()
  expect(target.querySelector(`.toolbar`)).toBeNull()
  const symmetry_label = [...target.querySelectorAll(`.plot-pane .x-axis .tick text`)].find(
    (label) => label.textContent === `X`,
  )
  expect(symmetry_label?.getAttribute(`role`)).toBe(`button`)
  symmetry_label?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
  await vi.waitFor(() => {
    expect(target.querySelector(`.bz-popup-stats strong`)?.textContent).toBe(`X`)
    expect(target.querySelector(`.bz-popup .brillouin-zone`)).not.toBeNull()
  })
})

test(`uses the structure viewer selector to regenerate the displayed supercell`, async () => {
  const target = render({ supercell: [3, 3, 3] })
  const cell_toggle = () =>
    target.querySelector<HTMLButtonElement>(`.trajectory-pane .cell-select .toggle-btn`)
  const normalize_label = () => cell_toggle()?.textContent?.replaceAll(/\s/g, ``)
  const displayed_site_count = () =>
    [...target.querySelectorAll(`.element-legend .legend-item sub`)].reduce(
      (total, count) => total + Number(count.textContent),
      0,
    )

  // structure settings mount on first open of the viewer's controls pane
  const controls_toggle = await vi.waitFor(() =>
    query<HTMLButtonElement>(target, `button.structure-controls-toggle`),
  )
  controls_toggle.click()
  await tick()
  await vi.waitFor(() => {
    expect(
      target.querySelector<HTMLSelectElement>(`[data-key="show_polyhedra"] select`)?.value,
    ).toBe(`never`)
    expect(
      target.querySelector<HTMLSelectElement>(`[data-key="bonding_strategy"] select`)?.value,
    ).toBe(`explicit_only`)
    // Phonon frames already include boundary coordination shells and are aperiodic,
    // so the viewer's image toggle has nothing to add and is gone.
    expect(target.querySelector(`[data-key="show_image_atoms"]`)).toBeNull()
    expect(
      target.querySelector<HTMLInputElement>(
        `[data-key="vector_config:phonon_displacement"] input`,
      )?.checked,
    ).toBe(false)
    expect(normalize_label()).toBe(`3x3x3`)
    expect(displayed_site_count()).toBe(54)
  })
  expect(target.querySelector(`[aria-label="Supercell axis 1"]`)).toBeNull()
  cell_toggle()?.click()
  await tick()
  const two_by_two = [...target.querySelectorAll<HTMLButtonElement>(`.preset-btn`)].find(
    (button) => button.textContent?.replaceAll(/\s/g, ``) === `2x2x2`,
  )
  two_by_two?.click()

  await vi.waitFor(() => {
    expect(normalize_label()).toBe(`2x2x2`)
    expect(displayed_site_count()).toBe(16)
  })
})

test(`offers the spectrum type only with Raman data and follows the dataset`, async () => {
  const props = $state<ExplorerProps>({
    ...explorer_defaults,
    dataset: { ...dataset, spectrum: { ...spectrum, has_raman: true } },
    spectrum_kind: `raman`,
  })
  const target = mount_explorer(props)
  await open_menu(target, `Modes`)
  await open_menu(target, `Phonon settings`)
  const kind_states = () =>
    [...target.querySelectorAll<HTMLButtonElement>(`.tabs button`)].map((button) => [
      button.textContent,
      button.getAttribute(`aria-pressed`),
    ])
  await vi.waitFor(() =>
    expect(kind_states()).toEqual([
      [`IR`, `false`],
      [`Raman`, `true`],
    ]),
  )
  target.querySelector<HTMLButtonElement>(`.tabs button`)?.click()
  await vi.waitFor(() => expect(props.spectrum_kind).toBe(`ir`))

  expect(target.querySelector(`[aria-label="q-point"]`)).not.toBeNull()

  // a Γ-only file has nothing to pick between, so the q-point chooser disappears
  props.dataset = {
    modes: { ...modes, qpoints: modes.qpoints.slice(0, 1), path_segments: [] },
    filename: `modes-only.yaml`,
  }
  await vi.waitFor(() => {
    expect(kind_states()).toEqual([])
    expect(target.querySelector(`.plot-pane`)).toBeNull()
    expect(target.querySelector(`.panes`)?.classList.contains(`structure_only`)).toBe(true)
    expect(target.querySelector(`.phonon-modes-toggle`)?.getAttribute(`aria-expanded`)).toBe(
      `true`,
    )
    expect(target.querySelector(`[data-testid="phonon-mode-summary"]`)?.textContent).toContain(
      `modes-only.yaml`,
    )
    expect(target.querySelector(`[aria-label="q-point"]`)).toBeNull()
  })
})

test(`reinitializes an invalid selection when the dataset changes`, async () => {
  const props = $state<ExplorerProps>({
    ...explorer_defaults,
    selection: { qpoint_idx: 99, mode_idx: 99 },
  })
  mount_explorer(props)
  await vi.waitFor(() => expect(props.selection).toEqual({ qpoint_idx: 0, mode_idx: 3 }))

  props.selection = { qpoint_idx: 99, mode_idx: 99 }
  props.dataset = { ...dataset, modes: { ...modes } }
  await vi.waitFor(() => expect(props.selection).toEqual({ qpoint_idx: 0, mode_idx: 3 }))
})

test(`steps through animatable modes and disables eigenvector-less q-points`, async () => {
  // eigenvectors only at every other q-point, as the larger bundled fixtures store them
  const sparse_modes = {
    ...modes,
    qpoints: modes.qpoints.map((qpoint, qpoint_idx) =>
      qpoint_idx % 2 === 0
        ? qpoint
        : { ...qpoint, modes: qpoint.modes.map((mode) => ({ ...mode, eigenvector: null })) },
    ),
  }
  const props = $state<ExplorerProps>({
    ...explorer_defaults,
    dataset: { modes: sparse_modes, filename: `sparse.yaml` },
    // bindable props only write back when passed, so seed with an out-of-range selection
    selection: { qpoint_idx: 99, mode_idx: 99 },
  })
  const target = mount_explorer(props)
  await open_menu(target, `Phonon settings`)
  const summary = () =>
    target.querySelector(`[data-testid="phonon-mode-summary"]`)?.textContent
  const prev_button = () =>
    target.querySelector<HTMLButtonElement>(`[aria-label="Previous mode"]`)
  const next_button = () => target.querySelector<HTMLButtonElement>(`[aria-label="Next mode"]`)
  await vi.waitFor(() => {
    expect(props.selection).toEqual({ qpoint_idx: 0, mode_idx: 3 })
    expect(summary()).toContain(`eigenvectors at 3/5 q-points`)
    // path endpoint labels are shown next to the q-point coordinates
    expect(summary()).toMatch(/Γ\s*q = \[0, 0, 0\]/)
  })
  const qpoint_options = [
    ...target.querySelectorAll<HTMLOptionElement>(`[aria-label="q-point"] option`),
  ]
  expect(qpoint_options.map(({ disabled }) => disabled)).toEqual([0, 1, 0, 1, 0].map(Boolean))
  expect(qpoint_options[0].textContent).toContain(`1: Γ [0, 0, 0]`)
  expect(qpoint_options[4].textContent).toContain(`5: X [`)

  next_button()?.click()
  await vi.waitFor(() => expect(props.selection).toEqual({ qpoint_idx: 0, mode_idx: 4 }))
  next_button()?.click()
  await vi.waitFor(() => {
    expect(props.selection).toEqual({ qpoint_idx: 0, mode_idx: 5 })
    expect(next_button()?.disabled).toBe(true)
    expect(prev_button()?.disabled).toBe(false)
  })
  for (let step = 0; step < 5; step++) prev_button()?.click()
  await vi.waitFor(() => {
    expect(props.selection).toEqual({ qpoint_idx: 0, mode_idx: 0 })
    expect(prev_button()?.disabled).toBe(true)
  })
})

test.each([
  [
    `missing lattice`,
    { dataset: { modes: { ...modes, lattice: null } } },
    `animation needs a real-space lattice`,
  ],
  [`oversized supercell`, { supercell: [400, 400, 1] }, `exceeding the 200000 limit`],
] as [string, Partial<ExplorerProps>, string][])(
  `reports %s errors in the UI`,
  async (_name, props, message) => {
    const target = render(props)
    await vi.waitFor(() =>
      expect(target.querySelector(`[role="alert"]`)?.textContent).toContain(message),
    )
  },
)

test.each([
  [`by default`, {}, true],
  [`unless disabled`, { show_bz_inset: false }, false],
  [
    `only with more than one q-point`,
    {
      dataset: { modes: { ...modes, qpoints: modes.qpoints.slice(0, 1), path_segments: [] } },
    },
    false,
  ],
] as [string, Partial<ExplorerProps>, boolean][])(
  `shows the Brillouin zone inset %s`,
  async (_name, props, shown) => {
    const target = render(props)
    await vi.waitFor(() => expect(target.querySelector(`.trajectory-pane`)).not.toBeNull())
    const inset = target.querySelector(
      `.trajectory-pane .bz-inset[aria-label="Selected q-point in the Brillouin zone"]`,
    )
    expect(inset !== null).toBe(shown)
    // the inset is a passive view: no file drop target, controls or fullscreen button
    if (inset) expect(inset.querySelector(`button`)).toBeNull()
  },
)

test.each([
  [`beside the bands on a wide plot pane`, {}, 800, [`side_by_side`]],
  [`below the bands on a narrow plot pane`, {}, 300, [`spectrum_stacked`]],
  [
    `alone for a Γ-only file`,
    { dataset: { ...dataset, modes: { ...modes, path_segments: [] } } },
    800,
    [],
  ],
] as [string, Partial<ExplorerProps>, number, string[]][])(
  `draws the spectrum %s`,
  async (_name, props, width, layout_classes) => {
    const target = render(props)
    const plot_pane = await vi.waitFor(() => query(target, `.plot-pane`))
    await resize_element(plot_pane, width, 400)
    trigger_resize_observer(plot_pane)
    await vi.waitFor(() => {
      const classes = [`side_by_side`, `spectrum_stacked`]
      expect(classes.filter((name) => plot_pane.classList.contains(name))).toEqual(
        layout_classes,
      )
      expect(plot_pane.querySelectorAll(`line.mode-stick`).length).toBeGreaterThan(0)
    })
    const has_bands = !layout_classes.length ? 0 : 1
    expect(plot_pane.querySelectorAll(`.scatter`)).toHaveLength(1 + has_bands)
    // rotated beside the bands, sticks run along the intensity (x) axis at their frequency
    const stick = query(plot_pane, `line.mode-stick`)
    const [x1, x2, y1, y2] = [`x1`, `x2`, `y1`, `y2`].map((attr) =>
      Number(stick.getAttribute(attr)),
    )
    const side_by_side = layout_classes.includes(`side_by_side`)
    expect(side_by_side ? y1 === y2 && x1 !== x2 : x1 === x2 && y1 !== y2).toBe(true)
  },
)

test(`links spectrum peaks and Γ-point bands on hover`, async () => {
  // an acoustic selection keeps the resting reference line at 0 THz, away from every peak
  const target = render({ selection: { qpoint_idx: 0, mode_idx: 0 } })
  const plot_pane = await vi.waitFor(() => query(target, `.plot-pane`))
  await vi.waitFor(() =>
    expect(plot_pane.querySelectorAll(`.scatter line.mode-stick`).length).toBeGreaterThan(0),
  )
  const [bands_plot, spectrum_plot] = [...plot_pane.querySelectorAll(`.scatter`)]
  // pointer coordinates below are plot pixels, so put each plot at the viewport origin
  for (const svg of [plot_svg(bands_plot), plot_svg(spectrum_plot)]) {
    svg.getBoundingClientRect = () => DOMRect.fromRect({ width: 800, height: 600 })
  }
  const settle = async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    flushSync()
  }

  // pointer on the tip of the strongest stick, i.e. on top of its broadened peak
  const sticks = [...spectrum_plot.querySelectorAll(`line.mode-stick`)]
  const coord = (stick: Element, attr: string) => Number(stick.getAttribute(attr))
  const peak_stick = sticks.reduce((best, stick) =>
    coord(stick, `x2`) > coord(best, `x2`) ? stick : best,
  )
  const peak_y = coord(peak_stick, `y1`)
  plot_svg(spectrum_plot).dispatchEvent(
    mouse(`mousemove`, { clientX: coord(peak_stick, `x2`), clientY: peak_y }),
  )
  await settle()
  const thz_sticks = spectrum_sticks(spectrum, `ir`, { unit: `THz` })
  const peak_idx = sticks.indexOf(peak_stick)
  const peak_modes = peak_mode_indices(
    thz_sticks,
    thz_sticks.x[peak_idx],
    convert_frequencies([10], `THz`, `cm^-1`)[0],
  )
  expect(peak_modes.length).toBeGreaterThan(0)
  // rotated, the tooltip still reads the frequency off the y axis, not the intensity
  const tooltip_text = query(spectrum_plot, `.plot-tooltip`).textContent ?? ``
  const tooltip_freq = Number(/Frequency\D*?(?<freq>[\d.]+)/.exec(tooltip_text)?.groups?.freq)
  expect(tooltip_freq).toBeCloseTo(thz_sticks.x[peak_idx], 1)
  // NaCl's Γ–X path visits Γ once: one ring per mode behind the peak
  expect(bands_plot.querySelectorAll(`.peak-band-marker`)).toHaveLength(peak_modes.length)
  const bands_ref = bands_plot.querySelector(`line[stroke*="--bands-reference-line-color"]`)
  // the peak's frequency lands on the same pixel row in both panels (shared y scale)
  expect(Number(bands_ref?.getAttribute(`y1`))).toBeCloseTo(peak_y, 0)
  expect(spectrum_plot.querySelectorAll(`line.mode-stick.highlighted`)).toHaveLength(
    peak_modes.length,
  )

  await fire(plot_svg(spectrum_plot), mouse(`mouseleave`))
  expect(bands_plot.querySelector(`.peak-band-marker`)).toBeNull()
  expect(spectrum_plot.querySelector(`line.mode-stick.highlighted`)).toBeNull()

  // the reverse direction: a band hovered at Γ lights up its stick and marks its frequency
  const band_idx = peak_modes[0]
  const band_point = query(bands_plot, `[aria-label="Select band ${band_idx + 1}, q-point 1"]`)
  const { x, y } = translate_of(band_point.closest(`[transform]`))
  plot_svg(bands_plot).dispatchEvent(mouse(`mousemove`, { clientX: x, clientY: y }))
  await settle()
  expect(
    [...spectrum_plot.querySelectorAll(`line.mode-stick.highlighted`)].map((stick) =>
      stick.getAttribute(`aria-label`),
    ),
  ).toEqual([expect.stringContaining(`Select mode ${band_idx + 1} at`)])
  const spectrum_ref = query(spectrum_plot, `line.reference-line`)
  expect(Number(spectrum_ref.getAttribute(`y1`))).toBeCloseTo(y, 0)

  await fire(plot_svg(bands_plot), mouse(`mouseleave`))
  expect(spectrum_plot.querySelector(`line.reference-line`)).toBeNull()
  expect(spectrum_plot.querySelector(`line.mode-stick.highlighted`)).toBeNull()
})
