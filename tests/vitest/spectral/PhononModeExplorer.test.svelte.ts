import type * as brillouin_module from '#lib/brillouin/index.js'
import { reciprocal_lattice, type Vec3 } from '#lib/math.js'
import { frac_k_to_cartesian } from '#lib/spectral/helpers.js'
import type { PhononModeDataset } from '#lib/spectral/index.js'
import { parse_born, parse_phonon_modes } from '#lib/spectral/parse-phonon-modes.js'
import PhononModeExplorer from '#lib/spectral/PhononModeExplorer.svelte'
import { spectrum_from_phonon_data } from '#lib/spectral/ir-raman.js'
import born_file from '#site/phonons/ir-raman/NaCl.BORN?raw'
import band_yaml from '#site/phonons/ir-raman/NaCl-Gamma-X-band.yaml?raw'
import { flushSync, tick, type ComponentProps } from 'svelte'
import { expect, test, vi } from 'vitest'
import {
  click_when_ready,
  fire,
  mount_in_test,
  mouse,
  plot_svg,
  query,
  resize_element,
  set_input,
  translate_of,
  trigger_resize_observer,
} from '../setup'

// Pass-through spy on the Brillouin zone inset recording its props (the WebGPU scene that
// draws them does not render here)
type BZProps = ComponentProps<typeof brillouin_module.BrillouinZone>
const bz_spy = vi.hoisted(() => ({ props: undefined as BZProps | undefined }))
vi.mock(`#lib/brillouin/index.js`, async (import_original) => {
  const original = await import_original<typeof brillouin_module>()
  const BrillouinZone = (...args: Parameters<typeof original.BrillouinZone>) => {
    bz_spy.props = args[1]
    return original.BrillouinZone(...args)
  }
  return { ...original, BrillouinZone }
})

type ExplorerProps = ComponentProps<typeof PhononModeExplorer>
const modes = parse_phonon_modes(band_yaml)
const spectrum = spectrum_from_phonon_data(modes, parse_born(born_file))
const dataset: PhononModeDataset = { modes, spectrum, filename: `NaCl-band.yaml` }
const gamma_modes = { ...modes, qpoints: modes.qpoints.slice(0, 1), path_segments: [] }
const explorer_defaults = {
  dataset,
  auto_play: false,
  n_frames: 4,
  supercell: [1, 1, 1],
} satisfies ExplorerProps

const mount_explorer = (props: ExplorerProps): HTMLElement =>
  mount_in_test(PhononModeExplorer, props)
const render = (props: Partial<ExplorerProps> = {}): HTMLElement =>
  mount_explorer({ ...explorer_defaults, ...props })

const open_menu = async (target: HTMLElement, label: string): Promise<void> => {
  await vi.waitFor(() =>
    expect(target.querySelector(`[aria-label="${label}"]`)).not.toBeNull(),
  )
  target.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click()
  await tick()
}

const summary_text = (target: HTMLElement) =>
  target.querySelector(`[data-testid="phonon-mode-summary"]`)?.textContent

// structure settings mount on first open of the viewer's controls pane
const open_structure_controls = (target: HTMLElement) =>
  click_when_ready(target, `button.structure-controls-toggle`)

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
    const summary = summary_text(target)
    expect(summary).toContain(`Mode 4`)
    expect(summary).toContain(`cm−1`)
    expect(target.querySelector(`[data-testid="phonon-mode-summary"] sup`)?.textContent).toBe(
      `−1`,
    )
    expect(summary).toMatch(/Na = \d+% · Cl = \d+%|Cl = \d+% · Na = \d+%/)
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
  // the Brillouin zone inset is a passive view: no file drop target, controls or fullscreen
  const inset = await vi.waitFor(() => query(target, `.trajectory-pane .bz-inset`))
  expect(inset.querySelector(`button`)).toBeNull()
  props.show_bz_inset = false
  await vi.waitFor(() => expect(target.querySelector(`.bz-inset`)).toBeNull())
  await open_structure_controls(target)
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
    expect(summary_text(target)).toContain(`Mode 1`)
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

// Γ→X stretched to Γ→1.5·X leaves the zone: its branch (midpoint inside) is not folded,
// while the end point folded alone jumps elsewhere. The inset marks the drawn path's point.
test(`marks the selected q-point on the drawn k-path in the inset`, async () => {
  const stretched = {
    ...modes,
    qpoints: modes.qpoints.map((qpoint) => ({
      ...qpoint,
      q_position: qpoint.q_position.map((coord) => coord * 1.5) as Vec3,
    })),
  }
  const qpoint_idx = stretched.qpoints.length - 1
  render({ dataset: { ...dataset, modes: stretched }, selection: { qpoint_idx, mode_idx: 3 } })
  if (!modes.lattice) throw new Error(`NaCl fixture lacks a lattice`)
  const k_lattice = reciprocal_lattice(modes.lattice, { two_pi: true })
  const folded_alone = frac_k_to_cartesian(stretched.qpoints[qpoint_idx].q_position, k_lattice)
  await vi.waitFor(() => {
    const on_path = bz_spy.props?.k_path?.points[qpoint_idx]
    expect(on_path).toBeDefined()
    expect(bz_spy.props?.highlighted_k_points).toEqual([on_path])
    expect(on_path).not.toEqual(folded_alone)
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

  await open_structure_controls(target)
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
  props.dataset = { modes: gamma_modes, filename: `modes-only.yaml` }
  await vi.waitFor(() => {
    expect(kind_states()).toEqual([])
    expect(target.querySelector(`.bz-inset`)).toBeNull() // needs more than one q-point
    expect(target.querySelector(`.plot-pane`)).toBeNull()
    expect(target.querySelector(`.phonon-modes-toggle`)?.getAttribute(`aria-expanded`)).toBe(
      `true`,
    )
    expect(summary_text(target)).toContain(`modes-only.yaml`)
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
  const prev_button = () =>
    target.querySelector<HTMLButtonElement>(`[aria-label="Previous mode"]`)
  const next_button = () => target.querySelector<HTMLButtonElement>(`[aria-label="Next mode"]`)
  await vi.waitFor(() => {
    expect(props.selection).toEqual({ qpoint_idx: 0, mode_idx: 3 })
    expect(summary_text(target)).toContain(`eigenvectors at 3/5 q-points`)
    // path endpoint labels are shown next to the q-point coordinates
    expect(summary_text(target)).toMatch(/Γ\s*q = \[0, 0, 0\]/)
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
  { name: `beside the bands when wide`, width: 800, layout: `side_by_side`, modes },
  { name: `below the bands when narrow`, width: 300, layout: `spectrum_stacked`, modes },
  { name: `alone for a Γ-only file`, width: 800, layout: null, modes: gamma_modes },
])(`draws the spectrum $name`, async ({ width, layout, modes: dataset_modes }) => {
  const target = render({ dataset: { ...dataset, modes: dataset_modes } })
  const plot_pane = await vi.waitFor(() => query(target, `.plot-pane`))
  await resize_element(plot_pane, width, 400)
  trigger_resize_observer(plot_pane)
  await vi.waitFor(() => {
    const classes = [`side_by_side`, `spectrum_stacked`]
    const active = classes.filter((name) => plot_pane.classList.contains(name))
    expect(active).toEqual(layout ? [layout] : [])
    expect(plot_pane.querySelectorAll(`line.mode-stick`).length).toBeGreaterThan(0)
  })
  // bands beside or above the spectrum make a second plot
  expect(plot_pane.querySelectorAll(`.scatter`)).toHaveLength(layout ? 2 : 1)
})

test(`links spectrum peaks and Γ-point bands on hover`, async () => {
  // an acoustic selection keeps the resting reference line at 0 THz, away from every peak
  const target = render({ selection: { qpoint_idx: 0, mode_idx: 0 } })
  const plot_pane = await vi.waitFor(() => query(target, `.plot-pane`))
  await vi.waitFor(() =>
    expect(plot_pane.querySelectorAll(`.scatter line.mode-stick`).length).toBeGreaterThan(0),
  )
  const [bands_plot, spectrum_plot] = [...plot_pane.querySelectorAll(`.scatter`)]
  // pointer coordinates below are plot pixels, so put each plot at the viewport origin
  for (const svg of [plot_svg(bands_plot), plot_svg(spectrum_plot)])
    svg.getBoundingClientRect = () => DOMRect.fromRect({ width: 800, height: 600 })
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
  // stick labels read `Select mode <n> at <frequency> THz`
  const label_num = (stick: Element, pattern: RegExp) =>
    Number(pattern.exec(stick.getAttribute(`aria-label`) ?? ``)?.groups?.num)
  const highlighted = [...spectrum_plot.querySelectorAll(`line.mode-stick.highlighted`)]
  expect(highlighted).toContain(peak_stick)
  const peak_modes = highlighted.map((stick) => label_num(stick, /mode (?<num>\d+)/) - 1)
  // rotated, the tooltip still reads the frequency off the y axis, not the intensity
  const tooltip_text = query(spectrum_plot, `.plot-tooltip`).textContent ?? ``
  const tooltip_freq = Number(/Frequency\D*?(?<freq>[\d.]+)/.exec(tooltip_text)?.groups?.freq)
  expect(tooltip_freq).toBeCloseTo(label_num(peak_stick, /at (?<num>[\d.]+)/), 1)
  // NaCl's Γ–X path visits Γ once: one ring per mode behind the peak
  expect(bands_plot.querySelectorAll(`.peak-band-marker`)).toHaveLength(peak_modes.length)
  const bands_ref = bands_plot.querySelector(`line[stroke*="--bands-reference-line-color"]`)
  // the peak's frequency lands on the same pixel row in both panels (shared y scale)
  expect(Number(bands_ref?.getAttribute(`y1`))).toBeCloseTo(peak_y, 0)

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
