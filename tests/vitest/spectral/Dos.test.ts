import { Dos, type Vec2 } from '$lib'
import type { PymatgenCompleteDos } from '$lib/spectral/helpers'
import {
  extract_pdos,
  extract_spin_channels,
  format_dos_tooltip,
  format_sigma,
  normalize_dos,
  validate_sigma_range,
} from '$lib/spectral/helpers'
import type { ElectronicDos, PhononDos, SpinMode } from '$lib/spectral/types'
import { mount, tick } from 'svelte'
import { describe, expect, it } from 'vitest'

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
  // Combine all "renders successfully" tests into parameterized test
  it.each([
    [`phonon DOS`, { doses: phonon_dos }],
    [`electronic DOS`, { doses: electronic_dos }],
    [`multiple DOS dict`, { doses: { 'DOS 1': phonon_dos, 'DOS 2': phonon_dos } }],
    [`stacked DOS`, { doses: { 'DOS 1': phonon_dos, 'DOS 2': phonon_dos }, stack: true }],
    [`with sigma > 0`, { doses: phonon_dos, sigma: 0.5 }],
    [`vertical orientation`, { doses: phonon_dos, orientation: `vertical` as const }],
    [`horizontal orientation`, { doses: phonon_dos, orientation: `horizontal` as const }],
    [`atom pDOS`, { doses: pymatgen_complete_dos, pdos_type: `atom` as const }],
    [`orbital pDOS`, { doses: pymatgen_complete_dos, pdos_type: `orbital` as const }],
    [
      `filtered pDOS`,
      {
        doses: pymatgen_complete_dos,
        pdos_type: `atom` as const,
        pdos_filter: [`Fe`],
      },
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
    ],
  ])(`renders %s`, (_desc, props) => {
    mount(Dos, { target: document.body, props })
    expect(document.querySelector(`.scatter`)).toBeInstanceOf(HTMLElement)
  })

  // Unit conversion tests
  it.each([`THz`, `eV`, `meV`, `cm-1`, `Ha`] as const)(`converts to unit=%s`, (units) => {
    mount(Dos, { target: document.body, props: { doses: phonon_dos, units } })
    expect(document.querySelector(`.scatter`)).toBeInstanceOf(HTMLElement)
  })

  // Normalization tests
  it.each([null, `max`, `sum`, `integral`] as const)(
    `normalizes with mode=%s`,
    (normalize) => {
      mount(Dos, { target: document.body, props: { doses: phonon_dos, normalize } })
      expect(document.querySelector(`.scatter`)).toBeInstanceOf(HTMLElement)
    },
  )

  // Spin mode tests
  it.each([`mirror`, `overlay`, `up_only`, `down_only`, null] as const)(
    `spin_mode=%s`,
    (spin_mode) => {
      mount(Dos, {
        target: document.body,
        props: { doses: spin_polarized_dos, spin_mode },
      })
      expect(document.querySelector(`.scatter`)).toBeInstanceOf(HTMLElement)
    },
  )

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

    // Validate structural layering: spin-up and spin-down areas should have different colors
    // In overlay+stack mode, spin-up uses color at index dos_idx, spin-down at (dos_idx * 2 + 1)
    // This ensures spin channels are visually distinct and stacked independently
    const fill_colors = Array.from(area_paths).map((path) => path.getAttribute(`fill`))
    const unique_colors = new Set(fill_colors)
    // Should have at least 2 distinct colors (one for each spin channel type)
    // With 2 DOS entries: spin-up uses colors 0,1 and spin-down uses colors 1,3
    expect(unique_colors.size).toBeGreaterThanOrEqual(2)
    // Verify all paths have valid fill colors (not null/empty)
    fill_colors.forEach((color) => expect(color).not.toBe(``))
  })
})

describe(`normalize_dos`, () => {
  it(`preserves spin_down_densities from normalized input`, () => {
    const result = normalize_dos(spin_polarized_dos)
    if (result?.type === `electronic`) {
      expect(result.spin_polarized).toBe(true)
      expect(result.spin_down_densities).toEqual(spin_polarized_dos.spin_down_densities)
    }
  })

  it(`extracts spin channels from pymatgen format`, () => {
    const result = normalize_dos({
      energies: [-2, -1, 0, 1, 2],
      densities: { '1': [0.1, 0.3, 0.5, 0.3, 0.1], '-1': [0.08, 0.25, 0.4, 0.25, 0.08] },
    })
    if (result?.type === `electronic`) {
      expect(result.spin_polarized).toBe(true)
      expect(result.densities).toEqual([0.1, 0.3, 0.5, 0.3, 0.1])
      expect(result.spin_down_densities).toEqual([0.08, 0.25, 0.4, 0.25, 0.08])
    }
  })
})

describe(`extract_spin_channels`, () => {
  it(`extracts from pymatgen numeric keys {"1", "-1"}`, () => {
    const result = extract_spin_channels<number[]>({ '1': [1, 2], '-1': [0.5, 1] })
    expect(result).toEqual({ up: [1, 2], down: [0.5, 1] })
  })

  it(`extracts from Spin.up/down keys`, () => {
    const result = extract_spin_channels<number[]>({ 'Spin.up': [1], 'Spin.down': [2] })
    expect(result).toEqual({ up: [1], down: [2] })
  })

  it(`returns null for down when input is plain array`, () => {
    const result = extract_spin_channels<number[]>([1, 2, 3])
    expect(result).toEqual({ up: [1, 2, 3], down: null })
  })

  it.each([null, undefined])(`returns null for %s`, (input) => {
    expect(extract_spin_channels(input)).toBeNull()
  })
})

describe(`extract_pdos`, () => {
  it.each([
    [`atom`, [`Fe`, `O`]],
    [`orbital`, [`s`, `p`, `d`]],
  ] as const)(`extracts %s DOS with expected keys`, (pdos_type, expected_keys) => {
    const result = extract_pdos(pymatgen_complete_dos, pdos_type)
    expect(result).not.toBeNull()
    expected_keys.forEach((key) => expect(Object.keys(result ?? {})).toContain(key))
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
  it(`formats vertical phonon tooltip with label`, () => {
    const result = format_dos_tooltip(
      `5.00`,
      `0.50`,
      `DOS 1`,
      false,
      true,
      `THz`,
      `Frequency (THz)`,
      `Density`,
      2,
    )
    expect(result.title).toBe(`DOS 1`)
    expect(result.lines.join(` `)).toMatch(/Density.*THz/)
  })

  it(`formats horizontal electronic tooltip without label`, () => {
    const result = format_dos_tooltip(
      `0.50`,
      `-2.00`,
      null,
      true,
      false,
      `THz`,
      `Density`,
      `Energy (eV)`,
      1,
    )
    expect(result.title).toBeUndefined()
    expect(result.lines.join(` `)).toMatch(/Energy.*Density/)
  })

  it(`includes units in output`, () => {
    const result = format_dos_tooltip(
      `100`,
      `0.3`,
      null,
      false,
      true,
      `cm-1`,
      `Frequency (cm⁻¹)`,
      `DOS`,
      1,
    )
    expect(result.lines.join(` `)).toContain(`cm⁻¹`)
  })
})

describe(`format_sigma`, () => {
  // Tests adaptive precision: 0→"0", <0.01→exp, <1→3dec, ≥1→2dec
  it.each([
    [0, `0`], // zero
    [0.0001, `1.0e-4`], // very small → exponential
    [0.00999, `1.0e-2`], // boundary → exponential
    [0.01, `0.010`], // boundary → 3 decimals
    [0.5, `0.500`], // medium → 3 decimals
    [1, `1.00`], // boundary → 2 decimals
    [100, `100.00`], // large → 2 decimals
  ])(`format_sigma(%s) = %s`, (input, expected) => {
    expect(format_sigma(input)).toBe(expected)
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
    { input: [NaN, 1] }, // NaN
    { input: [0, Infinity] }, // infinite
  ])(`invalid range $input returns [0, 1]`, ({ input }) => {
    expect(validate_sigma_range(input)).toEqual([0, 1])
  })
})
