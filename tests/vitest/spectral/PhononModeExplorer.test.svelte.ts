import type { PhononModeDataset } from '$lib/spectral'
import {
  parse_born,
  PhononModeExplorer,
  parse_phonon_modes,
  spectrum_from_phonon_data,
} from '$lib/spectral'
import born_file from '$site/phonons/ir-raman/NaCl.BORN?raw'
import band_yaml from '$site/phonons/ir-raman/NaCl-Gamma-X-band.yaml?raw'
import { mount, tick, type ComponentProps, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'

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
    expect(target.querySelector(`[aria-label="Phonon explorer plot"]`)?.textContent).toContain(
      `IR`,
    )
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
  const eigenvectors = target.querySelector<HTMLInputElement>(`.checkbox input`)
  eigenvectors?.click()
  await vi.waitFor(() =>
    expect(
      target.querySelector<HTMLInputElement>(
        `[data-key="vector_config:phonon_displacement"] input`,
      )?.checked,
    ).toBe(true),
  )
  const thickness = target.querySelector<HTMLInputElement>(
    `[aria-label="Eigenvector thickness"]`,
  )
  const color = target.querySelector<HTMLInputElement>(`[aria-label="Eigenvector color"]`)
  expect(thickness).not.toBeNull()
  expect(color).not.toBeNull()
  if (!thickness || !color) throw new Error(`Eigenvector style controls missing`)
  thickness.value = `2.5`
  thickness.dispatchEvent(new Event(`input`, { bubbles: true }))
  color.value = `#123abc`
  color.dispatchEvent(new Event(`input`, { bubbles: true }))
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
    expect(target.querySelector(`.tabs [aria-pressed="true"]`)?.textContent).toBe(`Bands`)
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

test(`updates views atomically with the dataset`, async () => {
  const props = $state<ExplorerProps>({ ...explorer_defaults, view: `ir` })
  const target = mount_explorer(props)
  await open_menu(target, `Modes`)
  await open_menu(target, `Phonon settings`)
  const view_states = () =>
    [...target.querySelectorAll<HTMLButtonElement>(`.tabs button`)].map((button) => [
      button.textContent,
      button.getAttribute(`aria-pressed`),
    ])
  await vi.waitFor(() =>
    expect(view_states()).toEqual([
      [`Bands`, `false`],
      [`IR`, `true`],
    ]),
  )

  expect(target.querySelector(`[aria-label="q-point"]`)).not.toBeNull()

  // a Γ-only file has nothing to pick between, so the q-point chooser disappears
  props.dataset = {
    modes: { ...modes, qpoints: modes.qpoints.slice(0, 1), path_segments: [] },
    filename: `modes-only.yaml`,
  }
  await vi.waitFor(() => {
    expect(props.view).toBeUndefined()
    expect(view_states()).toEqual([])
    expect(target.querySelector(`.plot-pane`)).toBeNull()
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
