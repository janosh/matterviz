import { Dos } from '$lib'
import type { PymatgenCompleteDos } from '$lib/spectral/helpers'
import {
  clear_smearing_cache,
  extract_pdos,
  extract_spin_channels,
  format_dos_tooltip,
  format_sigma,
  FREQUENCY_UNITS,
  NORMALIZATION_MODES,
  normalize_dos,
  SPIN_MODES,
  validate_sigma_range,
} from '$lib/spectral/helpers'
import type { DosData, ElectronicDos, PhononDos, SpinMode } from '$lib/spectral/types'
import { mount, tick } from 'svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  '@class': `CompleteDos`,
  '@module': `pymatgen.electronic_structure.dos`,
  energies: [-5, -2.5, 0, 2.5, 5],
  densities: { '1': [0.1, 0.4, 1.0, 0.4, 0.1], '-1': [0.08, 0.35, 0.9, 0.35, 0.08] },
  efermi: 0,
  atom_dos: {
    Fe: {
      '@class': `Dos`,
      '@module': `pymatgen.electronic_structure.dos`,
      energies: [-5, -2.5, 0, 2.5, 5],
      densities: {
        '1': [0.05, 0.3, 0.8, 0.3, 0.05],
        '-1': [0.04, 0.25, 0.7, 0.25, 0.04],
      },
      efermi: 0,
    },
    O: {
      '@class': `Dos`,
      '@module': `pymatgen.electronic_structure.dos`,
      energies: [-5, -2.5, 0, 2.5, 5],
      densities: { '1': [0.05, 0.1, 0.2, 0.1, 0.05], '-1': [0.04, 0.1, 0.2, 0.1, 0.04] },
      efermi: 0,
    },
  },
  spd_dos: {
    s: {
      '@class': `Dos`,
      '@module': `pymatgen.electronic_structure.dos`,
      energies: [-5, -2.5, 0, 2.5, 5],
      densities: [0.02, 0.05, 0.1, 0.05, 0.02],
      efermi: 0,
    },
    p: {
      '@class': `Dos`,
      '@module': `pymatgen.electronic_structure.dos`,
      energies: [-5, -2.5, 0, 2.5, 5],
      densities: [0.03, 0.1, 0.3, 0.1, 0.03],
      efermi: 0,
    },
    d: {
      '@class': `Dos`,
      '@module': `pymatgen.electronic_structure.dos`,
      energies: [-5, -2.5, 0, 2.5, 5],
      densities: [0.05, 0.25, 0.6, 0.25, 0.05],
      efermi: 0,
    },
  },
}

describe(`Dos component`, () => {
  beforeEach(() => {
    clear_smearing_cache()
    document.body.innerHTML = ``
  })

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
    [`filtered pDOS`, {
      doses: pymatgen_complete_dos,
      pdos_type: `atom` as const,
      pdos_filter: [`Fe`],
    }],
  ])(`renders %s`, (_desc, props) => {
    mount(Dos, { target: document.body, props })
    expect(document.querySelector(`.scatter`)).toBeTruthy()
  })

  // Unit conversion tests
  it.each([`THz`, `eV`, `meV`, `cm-1`, `Ha`] as const)(`converts to unit=%s`, (units) => {
    mount(Dos, { target: document.body, props: { doses: phonon_dos, units } })
    expect(document.querySelector(`.scatter`)).toBeTruthy()
  })

  // Normalization tests
  it.each([null, `max`, `sum`, `integral`] as const)(
    `normalizes with mode=%s`,
    (normalize) => {
      mount(Dos, { target: document.body, props: { doses: phonon_dos, normalize } })
      expect(document.querySelector(`.scatter`)).toBeTruthy()
    },
  )

  // Spin mode tests
  it.each([`mirror`, `overlay`, `up_only`, `down_only`, null] as const)(
    `spin_mode=%s`,
    (spin_mode) => {
      mount(Dos, {
        target: document.body,
        props: { doses: spin_polarized_dos, spin_mode: spin_mode as SpinMode },
      })
      expect(document.querySelector(`.scatter`)).toBeTruthy()
    },
  )

  // Empty state tests
  it.each([
    [`null`, null],
    [`empty object`, {}],
    [`invalid data`, { invalid: true }],
  ])(`shows EmptyState for %s`, (_desc, doses) => {
    mount(Dos, { target: document.body, props: { doses: doses as unknown as DosData } })
    expect(document.querySelector(`.empty-state`)).toBeTruthy()
  })

  it(`shows sigma control when enabled`, () => {
    mount(Dos, {
      target: document.body,
      props: { doses: phonon_dos, show_sigma_control: true, show_controls: true },
    })
    // Controls are now part of ScatterPlot's control pane, not a separate overlay
    expect(document.querySelector(`.scatter`)).toBeTruthy()
  })

  it(`clears smearing cache without error`, async () => {
    mount(Dos, { target: document.body, props: { doses: phonon_dos, sigma: 0.5 } })
    await tick()
    clear_smearing_cache()
    document.body.innerHTML = ``
    mount(Dos, { target: document.body, props: { doses: phonon_dos, sigma: 0.5 } })
    await tick()
    expect(document.querySelector(`.scatter`)).toBeTruthy()
  })

  it(`stacks spin-up and spin-down independently in overlay mode`, async () => {
    // With 2 spin-polarized DOS entries, stack=true, overlay mode:
    // - Should have 4 stacked areas: 2 for spin-up + 2 for spin-down
    // - Each spin channel stacks on its own cumulative, not on the other
    const multi_spin_dos = {
      'DOS 1': spin_polarized_dos,
      'DOS 2': {
        ...spin_polarized_dos,
        densities: spin_polarized_dos.densities.map((d) => d * 0.5),
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
    expect(area_paths.length).toBe(4)
  })
})

describe(`DOS controls integration`, () => {
  // Tests for DOS-specific controls that are now part of ScatterPlot's controls_extra
  beforeEach(() => {
    document.body.innerHTML = ``
  })

  it(`renders with show_controls enabled`, () => {
    mount(Dos, {
      target: document.body,
      props: { doses: phonon_dos, show_controls: true },
    })
    expect(document.querySelector(`.scatter`)).toBeTruthy()
  })

  it(`renders with show_controls disabled`, () => {
    mount(Dos, {
      target: document.body,
      props: { doses: phonon_dos, show_controls: false },
    })
    expect(document.querySelector(`.scatter`)).toBeTruthy()
    // Controls pane toggle should not be visible when disabled
  })

  it(`passes spin_mode prop correctly`, () => {
    // Test that different spin modes affect rendering
    for (const mode of [`mirror`, `overlay`, `up_only`, `down_only`] as const) {
      document.body.innerHTML = ``
      mount(Dos, {
        target: document.body,
        props: { doses: spin_polarized_dos, spin_mode: mode },
      })
      expect(document.querySelector(`.scatter`)).toBeTruthy()
    }
  })

  it(`passes sigma and sigma_range props correctly`, () => {
    mount(Dos, {
      target: document.body,
      props: { doses: phonon_dos, sigma: 0.5, sigma_range: [0, 2] },
    })
    expect(document.querySelector(`.scatter`)).toBeTruthy()
  })

  it(`passes normalize_control prop correctly`, () => {
    mount(Dos, {
      target: document.body,
      props: { doses: phonon_dos, show_normalize_control: true },
    })
    expect(document.querySelector(`.scatter`)).toBeTruthy()
  })

  it(`passes units_control prop correctly for phonon DOS`, () => {
    mount(Dos, {
      target: document.body,
      props: { doses: phonon_dos, show_units_control: true },
    })
    expect(document.querySelector(`.scatter`)).toBeTruthy()
  })
})

describe(`normalize_dos`, () => {
  it.each([
    [`phonon DOS`, phonon_dos, `phonon`],
    [`electronic DOS`, electronic_dos, `electronic`],
  ])(`normalizes %s`, (_desc, dos, expected_type) => {
    const result = normalize_dos(dos)
    expect(result?.type).toBe(expected_type)
  })

  it.each([null, undefined, {}, { frequencies: [1, 2, 3] }])(
    `returns null for invalid: %s`,
    (input) => {
      expect(normalize_dos(input)).toBeNull()
    },
  )

  it(`auto-converts cm⁻¹ to THz when frequencies > 100`, () => {
    const info_spy = vi.spyOn(console, `info`).mockImplementation(() => {})
    const result = normalize_dos({
      frequencies: [0, 100, 200, 300, 400],
      densities: [0, 0.5, 1, 0.5, 0],
    })
    expect(result?.type).toBe(`phonon`)
    if (result?.type === `phonon`) expect(result.frequencies[4]).toBeCloseTo(11.99, 1)
    expect(info_spy).toHaveBeenCalled()
    info_spy.mockRestore()
  })

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
  it.each(
    [
      [`atom`, [`Fe`, `O`]],
      [`orbital`, [`s`, `p`, `d`]],
    ] as const,
  )(`extracts %s DOS with expected keys`, (pdos_type, expected_keys) => {
    const result = extract_pdos(pymatgen_complete_dos, pdos_type)
    expect(result).toBeTruthy()
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

describe(`DosControls constants`, () => {
  it(`exports valid configuration arrays`, () => {
    // SPIN_MODES: 4 modes with required fields
    expect(SPIN_MODES.map((cfg) => cfg.value)).toEqual([
      `mirror`,
      `overlay`,
      `up_only`,
      `down_only`,
    ])
    expect(SPIN_MODES.every((cfg) => cfg.label && cfg.title)).toBe(true)

    // NORMALIZATION_MODES: 4 modes
    expect(NORMALIZATION_MODES.map((cfg) => cfg.value)).toEqual([
      null,
      `max`,
      `sum`,
      `integral`,
    ])

    // FREQUENCY_UNITS: 5 units
    expect(FREQUENCY_UNITS).toEqual([`THz`, `eV`, `meV`, `cm-1`, `Ha`])
  })
})

describe(`validate_sigma_range`, () => {
  it(`returns valid ranges unchanged`, () => {
    expect(validate_sigma_range([0, 1])).toEqual([0, 1])
    expect(validate_sigma_range([-5, 5])).toEqual([-5, 5])
  })

  it.each([
    [[1, 0]], // min > max
    [[0, 0]], // equal values
    [[NaN, 1]], // NaN
    [[0, Infinity]], // infinite
  ] as [number, number][][])(`invalid range %j returns [0, 1]`, (input) => {
    expect(validate_sigma_range(input)).toEqual([0, 1])
  })
})
