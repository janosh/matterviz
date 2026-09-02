import { Dos, type Vec2 } from '$lib'
import type { PymatgenCompleteDos } from '$lib/spectral/helpers'
import {
  extract_pdos,
  extract_spin_channels,
  format_dos_tooltip,
  validate_sigma_range,
} from '$lib/spectral/helpers'
import type { ElectronicDos, FrequencyUnit, PhononDos, SpinMode } from '$lib/spectral/types'
import { mount, tick } from 'svelte'
import { describe, expect, it } from 'vitest'
import { bind_props, doc_query, expect_plot_controls, mount_sized, plot_svg } from '../setup'

// Test fixtures
const phonon_dos: PhononDos = {
  type: `phonon`,
  frequencies: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  densities: [0, 0.1, 0.3, 0.5, 0.8, 1.0, 0.8, 0.5, 0.3, 0.1, 0],
}

const electronic_dos: ElectronicDos = {
  type: `electronic`,
  energies: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5],
  densities: [0.1, 0.2, 0.4, 0.6, 0.8, 1.0, 0.8, 0.6, 0.4, 0.2, 0.1],
  efermi: 0,
}

const spin_polarized_dos: ElectronicDos = {
  type: `electronic`,
  energies: [-3, -2, -1, 0, 1, 2, 3],
  densities: [0.2, 0.4, 0.6, 1.0, 0.6, 0.4, 0.2],
  spin_down_densities: [0.15, 0.35, 0.55, 0.9, 0.55, 0.35, 0.15],
  spin_polarized: true,
  efermi: 0,
}

const pymatgen_complete_dos: PymatgenCompleteDos = {
  energies: [-5, -2.5, 0, 2.5, 5],
  densities: { '1': [0.1, 0.4, 1.0, 0.4, 0.1], '-1': [0.08, 0.35, 0.9, 0.35, 0.08] },
  efermi: 0,
  atom_dos: {
    Fe: {
      energies: [-5, -2.5, 0, 2.5, 5],
      densities: {
        '1': [0.05, 0.3, 0.8, 0.3, 0.05],
        '-1': [0.04, 0.25, 0.7, 0.25, 0.04],
      },
      efermi: 0,
    },
    O: {
      energies: [-5, -2.5, 0, 2.5, 5],
      densities: { '1': [0.05, 0.1, 0.2, 0.1, 0.05], '-1': [0.04, 0.1, 0.2, 0.1, 0.04] },
      efermi: 0,
    },
  },
  spd_dos: {
    s: {
      energies: [-5, -2.5, 0, 2.5, 5],
      densities: [0.02, 0.05, 0.1, 0.05, 0.02],
      efermi: 0,
    },
    p: {
      energies: [-5, -2.5, 0, 2.5, 5],
      densities: [0.03, 0.1, 0.3, 0.1, 0.03],
      efermi: 0,
    },
    d: {
      energies: [-5, -2.5, 0, 2.5, 5],
      densities: [0.05, 0.25, 0.6, 0.25, 0.05],
      efermi: 0,
    },
  },
}

describe(`Dos component`, () => {
  // One line series per DOS per drawn spin channel: spin-polarized inputs default to
  // `mirror`, `up_only`/`down_only` keep one channel, pDOS draws one per kept atom/orbital
  it.each([
    [`phonon DOS`, { doses: phonon_dos }, 1],
    [`electronic DOS`, { doses: electronic_dos }, 1],
    [`multiple DOS dict`, { doses: { 'DOS 1': phonon_dos, 'DOS 2': phonon_dos } }, 2],
    [`stacked DOS`, { doses: { 'DOS 1': phonon_dos, 'DOS 2': phonon_dos }, stack: true }, 2],
    [`horizontal orientation`, { doses: phonon_dos, orientation: `horizontal` as const }, 1],
    // conversion factors and per-mode normalization maths are pinned in helpers.test.ts
    [`cm^-1 units`, { doses: phonon_dos, units: `cm^-1` as const }, 1],
    [`normalized to max`, { doses: phonon_dos, normalize: `max` as const }, 1],
    [`mirror spin mode`, { doses: spin_polarized_dos, spin_mode: `mirror` as const }, 2],
    [`up_only spin mode`, { doses: spin_polarized_dos, spin_mode: `up_only` as const }, 1],
    [`down_only spin mode`, { doses: spin_polarized_dos, spin_mode: `down_only` as const }, 1],
    [`atom pDOS`, { doses: pymatgen_complete_dos, pdos_type: `atom` as const }, 4],
    [`orbital pDOS`, { doses: pymatgen_complete_dos, pdos_type: `orbital` as const }, 3],
    [
      `filtered pDOS`,
      {
        doses: pymatgen_complete_dos,
        pdos_type: `atom` as const,
        pdos_filter: [`Fe`],
      },
      2,
    ],
    [
      `all controls enabled`,
      {
        doses: phonon_dos,
        show_controls: true,
        show_normalize_control: true,
        show_units_control: true,
        sigma: 0.5,
        sigma_range: [0, 2] as Vec2,
      },
      1,
    ],
  ])(`renders %s`, async (_desc, props, n_lines) => {
    mount(Dos, { target: document.body, props })
    await tick()
    expect(document.querySelector(`.scatter`)).toBeInstanceOf(HTMLElement)
    expect(document.querySelectorAll(`svg path[fill="none"]`)).toHaveLength(n_lines)
  })

  // `cm-1`/`cm⁻¹` are the spellings found in the wild; they must map to cm^-1 at the prop
  // boundary instead of throwing inside convert_frequencies
  it.each([`cm^-1`, `cm-1`, `cm⁻¹`])(`labels the phonon axis in %s as cm⁻¹`, async (units) => {
    mount(Dos, {
      target: document.body,
      props: {
        doses: phonon_dos,
        units: units as FrequencyUnit,
        show_controls: true,
        show_units_control: true,
        controls_open: true,
      },
    })
    await tick()
    expect(document.body.textContent).toContain(`Frequency (cm⁻¹)`)
    const select = doc_query<HTMLSelectElement>(`#dos-units`)
    expect(select.value).toBe(`cm^-1`)
    // picking an option writes the canonical unit back to `units` (the handler is delegated, so
    // the synthetic change event must bubble like a real one)
    select.value = `meV`
    select.dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
    expect(document.body.textContent).toContain(`Frequency (meV)`)
  })

  // Dos forwards undefined to ScatterPlot's auto rule; explicit booleans still win.
  // oxfmt-ignore
  it.each([
    [`auto hides one`, false, undefined, false],
    [`auto shows two`, true, undefined, true],
    [`true shows one`, false, true, true],
    [`false hides two`, true, false, false],
  ] as const)(`legend visibility: %s`, async (_desc, multi, show_legend, expected) => {
    const plot = await mount_sized(
      Dos,
      {
        doses: multi ? { A: phonon_dos, B: electronic_dos } : phonon_dos,
        show_legend,
        show_controls: false,
      },
      { selector: `.scatter` },
    )
    expect(Boolean(plot.querySelector(`.legend`))).toBe(expected)
  })

  // both axes carry Dos' own ranges (density from zero, the padded frequency range), which
  // differ from ScatterPlot's nice()-rounded auto ranges a reset would otherwise fall back to
  it(`returns both axes to their pinned ranges after a double-click view reset`, async () => {
    // extents nice() would round (9.3 -> 10, 0.87 -> 0.9 or 1)
    const doses: PhononDos = {
      ...phonon_dos,
      frequencies: phonon_dos.frequencies.map((freq) => freq * 0.93),
      densities: phonon_dos.densities.map((density) => density * 0.87),
    }
    const plot = await mount_sized(Dos, { doses }, { selector: `.scatter` })
    const ticks = (axis: string) =>
      [...plot.querySelectorAll(`.${axis}-axis .tick text`)].map((el) => el.textContent)
    const [x_before, y_before] = [ticks(`x`), ticks(`y`)]
    expect(x_before.length + y_before.length).toBeGreaterThan(4)
    plot_svg(plot).dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    await tick()
    expect([ticks(`x`), ticks(`y`)]).toEqual([x_before, y_before])
  })

  it(`forwards flat control props and controls_open binding`, async () => {
    expect.hasAssertions()
    const controls_state = { controls_open: true }
    const target = document.createElement(`div`)
    mount(Dos, {
      target,
      props: bind_props(
        {
          doses: phonon_dos,
          controls_toggle_props: { 'data-testid': `dos-toggle` },
          controls_pane_props: { 'data-testid': `dos-pane`, style: `min-width: 20rem` },
        },
        controls_state,
      ),
    })
    await tick()
    expect(target.querySelector(`[data-testid="dos-pane"]`)?.getAttribute(`style`)).toContain(
      `min-width: 20rem`,
    )
    await expect_plot_controls(target, controls_state, `dos`)
  })

  // Empty state tests
  it.each([
    [`null`, null],
    [`empty object`, {}],
    [`invalid data`, { invalid: true }],
  ])(`shows EmptyState for %s`, (_desc, doses) => {
    mount(Dos, { target: document.body, props: { doses: doses as never } })
    expect(document.querySelector(`.empty-state`)).toBeInstanceOf(HTMLElement)
  })

  it(`stacks spin-up and spin-down independently in overlay mode`, async () => {
    // With 2 spin-polarized DOS entries, stack=true, overlay mode:
    // - Should have 4 stacked areas: 2 for spin-up + 2 for spin-down
    // - Each spin channel stacks on its own cumulative, not on the other
    const multi_spin_dos = {
      'DOS 1': spin_polarized_dos,
      'DOS 2': {
        ...spin_polarized_dos,
        densities: spin_polarized_dos.densities.map((density) => density * 0.5),
      },
    }
    mount(Dos, {
      target: document.body,
      props: { doses: multi_spin_dos, stack: true, spin_mode: `overlay` as SpinMode },
    })
    await tick()
    // Each spin-polarized DOS with overlay+stack should render 2 areas (up + down)
    // So 2 DOS entries = 4 area paths total
    const area_paths = document.querySelectorAll(`path[fill-opacity]`)
    expect(area_paths).toHaveLength(4)

    // Spin-up and spin-down channels are visually distinct (spin-up uses the color at
    // dos_idx, spin-down at dos_idx * 2 + 1), so at least two fills appear
    const fill_colors = Array.from(area_paths).map((path) => path.getAttribute(`fill`))
    expect(new Set(fill_colors).size).toBeGreaterThanOrEqual(2)
  })
})

// normalize_dos itself is covered in helpers.test.ts
describe(`extract_spin_channels`, () => {
  it.each([
    [`pymatgen numeric keys`, { '1': [1, 2], '-1': [0.5, 1] }, { up: [1, 2], down: [0.5, 1] }],
    [`Spin.up/down keys`, { 'Spin.up': [1], 'Spin.down': [2] }, { up: [1], down: [2] }],
    [`a plain array (no down channel)`, [1, 2, 3], { up: [1, 2, 3], down: null }],
  ])(`extracts from %s`, (_label, input, expected) => {
    expect(extract_spin_channels<number[]>(input)).toEqual(expected)
  })

  it.each([null, undefined, {}, { '-1': [1, 2] }, { 'Spin.down': [1] }])(
    `returns null for %j`,
    (input) => {
      expect(extract_spin_channels(input)).toBeNull()
    },
  )
})

describe(`extract_pdos`, () => {
  it.each([
    [`atom`, [`Fe`, `O`]],
    [`orbital`, [`s`, `p`, `d`]],
  ] as const)(`extracts %s DOS with expected keys`, (pdos_type, expected_keys) => {
    const result = extract_pdos(pymatgen_complete_dos, pdos_type)
    expect(Object.keys(result ?? {})).toEqual(expected_keys)
  })

  it(`filters by specified keys`, () => {
    const result = extract_pdos(pymatgen_complete_dos, `atom`, [`Fe`])
    expect(Object.keys(result ?? {})).toEqual([`Fe`])
  })

  it.each([{}, { atom_dos: {} }])(`returns null for missing pdos: %j`, (input) => {
    expect(extract_pdos(input, `atom`)).toBeNull()
  })
})

describe(`format_dos_tooltip`, () => {
  // The series label titles the tooltip only when several DOS are plotted; the axis that
  // carries frequency/energy is listed first whichever orientation it is on
  it.each([
    {
      opts: {
        x_formatted: `5.00`,
        y_formatted: `0.50`,
        label: `DOS 1`,
        is_horizontal: false,
        is_phonon: true,
        x_axis_label: `Frequency (THz)`,
        y_axis_label: `Density`,
        num_series: 2,
      },
      title: `DOS 1`,
      lines: [`Density: 0.50`, `Frequency: 5.00 THz`],
    },
    {
      opts: {
        x_formatted: `0.50`,
        y_formatted: `-2.00`,
        label: null,
        is_horizontal: true,
        is_phonon: false,
        x_axis_label: `Density`,
        y_axis_label: `Energy (eV)`,
        num_series: 1,
      },
      title: undefined,
      lines: [`Energy: -2.00 eV`, `Density: 0.50`],
    },
    // bare axis labels fall back to the quantity name and the display unit
    {
      opts: {
        x_formatted: `1`,
        y_formatted: `2`,
        label: `only`,
        is_horizontal: false,
        is_phonon: true,
        x_axis_label: ``,
        y_axis_label: ``,
        num_series: 1,
      },
      title: undefined,
      lines: [`Density: 2`, `Frequency: 1 cm^-1`],
    },
  ])(`$opts.label / horizontal=$opts.is_horizontal`, ({ opts, title, lines }) => {
    const result = format_dos_tooltip({ units: `cm^-1`, ...opts })
    expect(result.title).toBe(title)
    expect(result.lines).toEqual(lines)
  })
})

describe(`validate_sigma_range`, () => {
  it(`returns valid ranges unchanged`, () => {
    expect(validate_sigma_range([0, 1])).toEqual([0, 1])
    expect(validate_sigma_range([-5, 5])).toEqual([-5, 5])
  })

  it.each<{ input: Vec2 }>([
    { input: [1, 0] }, // min > max
    { input: [0, 0] }, // equal values
    { input: [NaN, 1] }, // non-finite
  ])(`invalid range $input returns [0, 1]`, ({ input }) => {
    expect(validate_sigma_range(input)).toEqual([0, 1])
  })
})
