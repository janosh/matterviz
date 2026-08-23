// Tests for IsosurfaceControls component rendering and interactions
import IsosurfaceControls from '$lib/isosurface/IsosurfaceControls.svelte'
import { auto_isosurface_settings, DEFAULT_ISOSURFACE_SETTINGS } from '$lib/isosurface/types'
import type {
  IsosurfaceLayer,
  IsosurfaceSettings,
  VolumetricData,
} from '$lib/isosurface/types'
import { flushSync, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import {
  doc_query,
  expect_labelled_settings_grid,
  make_grid,
  make_volume as make_volume_fixture,
} from '../setup'

// Minimal VolumetricData fixture for testing controls (2x2x2 grid with values 1..8)
const make_volume = (overrides?: Partial<VolumetricData>): VolumetricData =>
  make_volume_fixture(
    make_grid(2, 2, 2, (ix, iy, iz) => ix * 4 + iy * 2 + iz + 1),
    {
      data_range: { min: 1, max: 8, abs_max: 8, mean: 4.5 },
      ...overrides,
    },
  )

const make_layer = (
  volume_idx = 0,
  overrides: Partial<IsosurfaceLayer> = {},
): IsosurfaceLayer => ({
  isovalue: 2,
  color: `#ff0000`,
  opacity: 0.8,
  visible: true,
  show_negative: false,
  negative_color: `#0000ff`,
  volume_idx,
  ...overrides,
})
const two_volumes = () => [
  make_volume({ label: `density.cube` }),
  make_volume({ label: `esp.cube` }),
]
const find_label = (text: string): HTMLLabelElement | undefined =>
  Array.from(document.querySelectorAll(`label`)).find((label) =>
    label.textContent?.includes(text),
  )
const option_texts = (select: HTMLSelectElement | null | undefined): string[] =>
  Array.from(select?.options ?? [], (opt) => opt.textContent ?? ``)

const mount_controls = (
  props?: Partial<{
    settings: IsosurfaceSettings
    volumes: VolumetricData[]
    active_volume_idx: number
  }>,
) => {
  // $state props so bindable mutations from button clicks re-render the component
  // and are observable on the returned object
  const state_props = $state({
    settings: { ...DEFAULT_ISOSURFACE_SETTINGS },
    volumes: [make_volume()],
    active_volume_idx: 0,
    ...props,
  })
  mount(IsosurfaceControls, { target: document.body, props: state_props })
  flushSync()
  return state_props
}

describe(`IsosurfaceControls`, () => {
  test.each([
    {
      desc: `single volume`,
      volumes: undefined as VolumetricData[] | undefined,
      color_by_options: [`None (solid)`, `Volume 1`],
    },
    {
      desc: `multi volume`,
      volumes: [
        make_volume({ label: `charge density` }),
        make_volume({ label: `magnetization` }),
      ],
      color_by_options: [`None (solid)`, `charge density`, `magnetization`],
    },
  ])(
    `$desc chrome: one layer row per layer, Color by lists every volume`,
    ({ volumes, color_by_options }) => {
      mount_controls({
        ...(volumes && { volumes }),
        settings: { ...DEFAULT_ISOSURFACE_SETTINGS, layers: [make_layer(0)] },
      })
      const slider = doc_query<HTMLInputElement>(`input[type="range"]`)
      expect(Number(slider.max)).toBeCloseTo(8)
      expect(document.querySelectorAll(`.layer-row input[type="range"]`)).toHaveLength(2)
      expect(document.querySelectorAll(`.volume-group`)).toHaveLength(volumes?.length ?? 1)
      if (!volumes) {
        expect_labelled_settings_grid(document, { section_selector: `.isosurface-settings` })
      }
      const color_by = find_label(`Color by`)?.querySelector<HTMLSelectElement>(`select`)
      expect(option_texts(color_by)).toEqual(color_by_options)
    },
  )

  test.each([
    { show_neg: false, color_count: 1 },
    { show_neg: true, color_count: 2 },
  ])(`show_negative=$show_neg updates lobe controls`, ({ show_neg, color_count }) => {
    mount_controls({
      settings: {
        ...DEFAULT_ISOSURFACE_SETTINGS,
        layers: [make_layer(0, { show_negative: show_neg })],
      },
    })
    const checkbox =
      find_label(`Neg. lobe`)?.querySelector<HTMLInputElement>(`input[type="checkbox"]`)
    expect(checkbox?.checked).toBe(show_neg)
    expect(document.querySelectorAll(`input[type="color"]`)).toHaveLength(color_count)
  })

  test(`Neg. lobe toggle sets show_negative on every layer`, () => {
    const props = mount_controls({
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, layers: [make_layer(0), make_layer(0)] },
    })
    const checkbox = find_label(`Neg. lobe`)?.querySelector<HTMLInputElement>(`input`)
    if (!checkbox) throw new Error(`checkbox not found`)
    checkbox.checked = true
    checkbox.dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
    expect(props.settings.layers.map((layer) => layer.show_negative)).toEqual([true, true])
  })

  // Reset mirrors a fresh file load (auto_isosurface_settings): one auto layer on volume 0,
  // further volumes stay available as colour sources or for manually added surfaces
  test(`reset restores the initial-load settings: one auto layer on volume 0`, () => {
    const volumes = two_volumes()
    const props = mount_controls({ volumes })
    // The section's reset button only shows once a value differs from the mount snapshot
    props.settings.wireframe = true
    flushSync()
    doc_query<HTMLButtonElement>(`button[aria-label="Reset isosurface to defaults"]`).click()
    flushSync()
    expect(props.settings).toEqual(auto_isosurface_settings(volumes[0]))
    expect(props.settings.layers.map((layer) => layer.volume_idx)).toEqual([0])
  })
})

describe(`IsosurfaceControls multi-volume`, () => {
  const find_select_with_option = (text: string) =>
    Array.from(document.querySelectorAll(`select`)).find((select) =>
      Array.from(select.options).some((opt) => opt.textContent?.includes(text)),
    )
  const mount_layers = (
    layers: IsosurfaceLayer[],
    options: { volumes?: VolumetricData[]; active_volume_idx?: number } = {},
  ) =>
    mount_controls({
      volumes: two_volumes(),
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, layers },
      ...options,
    })
  const mount_colored = (layer: Partial<IsosurfaceLayer> = {}, volumes = two_volumes()) =>
    mount_layers(
      [make_layer(0, { color_volume_idx: 1, colormap: `interpolateRdBu`, ...layer })],
      { volumes },
    )
  const change_select = (select: HTMLSelectElement | null, value: string) => {
    if (!select) throw new Error(`select not found`)
    select.value = value
    select.dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
  }
  const change_color_scale = (label: string) => {
    const input = doc_query<HTMLInputElement>(
      `input[aria-label="Colormap for sampled values"]`,
    )
    input.dispatchEvent(new MouseEvent(`mouseup`, { bubbles: true }))
    flushSync()
    const option = Array.from(document.querySelectorAll<HTMLElement>(`[role="option"]`)).find(
      (element) => element.textContent?.includes(label),
    )
    if (!option) throw new Error(`color scale ${label} not found`)
    option.click()
    flushSync()
  }

  test(`groups surfaces under their geometry volume`, () => {
    mount_layers([make_layer(0), make_layer(0), make_layer(1)])
    const groups = document.querySelectorAll(`.volume-group`)
    expect(groups).toHaveLength(2)
    expect(groups[0].querySelectorAll(`.layer-row`)).toHaveLength(2)
    expect(groups[1].querySelectorAll(`.layer-row`)).toHaveLength(1)
    expect(groups[0].querySelector(`.volume-label`)?.textContent).toBe(`density.cube`)
    expect(groups[0].querySelector(`.volume-dims`)?.textContent).toBe(`2×2×2`)
  })

  test.each([
    { min: 1, max: 8, text: `1–8` },
    { min: -0.012345, max: 1234.5, text: `−0.0123–1.23e+3` },
  ])(`volume header shows the [$min, $max] data range as $text`, ({ min, max, text }) => {
    const abs_max = Math.max(Math.abs(min), Math.abs(max))
    mount_controls({
      volumes: [make_volume({ data_range: { min, max, abs_max, mean: 0 } })],
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, layers: [make_layer(0)] },
    })
    expect(doc_query(`.volume-group .volume-range`).textContent).toBe(text)
  })

  test(`add-surface appends a layer; empty volume shows color-source-only note`, () => {
    mount_layers([make_layer(0)])
    const groups = document.querySelectorAll(`.volume-group`)
    expect(groups[0].querySelector(`.volume-note`)).toBeNull()
    expect(groups[1].querySelector(`.volume-note`)?.textContent).toBe(`color source only`)

    document
      .querySelector<HTMLButtonElement>(`button[aria-label="Add surface for esp.cube"]`)
      ?.click()
    flushSync()
    expect(
      document.querySelectorAll(`.volume-group`)[1].querySelectorAll(`.layer-row`),
    ).toHaveLength(1)
  })

  // Each "+" on the same volume used to add an identical 20%/0.6 surface on top of the last
  test(`repeated add-surface clicks on one volume add distinct shells`, () => {
    const props = mount_controls({
      volumes: two_volumes(),
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, layers: [] },
    })
    const add = doc_query<HTMLButtonElement>(`button[aria-label="Add surface for esp.cube"]`)
    for (let click = 0; click < 3; click++) {
      add.click()
      flushSync()
    }
    const esp_layers = props.settings.layers.filter((layer) => layer.volume_idx === 1)
    expect(esp_layers).toHaveLength(3)
    // abs_max = 8: shells at 20%, 80%, 50%
    expect(esp_layers.map((layer) => layer.isovalue)).toEqual([1.6, 6.4, 4])
    expect(esp_layers.map((layer) => layer.opacity)).toEqual([0.6, 0.8, 0.7])
    expect(new Set(esp_layers.map((layer) => layer.color)).size).toBe(3)
    // Shell count is per volume: the other volume's first surface is still the 20% envelope
    doc_query<HTMLButtonElement>(`button[aria-label="Add surface for density.cube"]`).click()
    flushSync()
    const density_layer = props.settings.layers.find((layer) => layer.volume_idx === 0)
    expect(density_layer).toMatchObject({ isovalue: 1.6, opacity: 0.6 })
    expect(props.active_volume_idx).toBe(0)
  })

  test(`removing the last layer leaves zero surfaces (no implicit resurrection)`, () => {
    const props = mount_layers([make_layer(0)])
    document.querySelector<HTMLButtonElement>(`button[aria-label="Remove surface"]`)?.click()
    flushSync()
    expect(document.querySelectorAll(`.layer-row`)).toHaveLength(0)
    expect(props.settings.layers).toEqual([])
    // Volume groups remain with their add-surface buttons
    expect(document.querySelectorAll(`.volume-group`)).toHaveLength(2)
  })

  test(`color-source UI shows colormap + range; clearing a bound resets to auto`, () => {
    const props = mount_colored({ color_range: [-1, 1] })
    const color_scale = doc_query<HTMLInputElement>(
      `input[aria-label="Colormap for sampled values"]`,
    ).closest(`.multiselect`)
    expect(color_scale?.querySelector(`.selected`)?.textContent).toContain(`RdBu`)
    const range_inputs = document.querySelectorAll<HTMLInputElement>(
      `input[aria-label^="Color range "]`,
    )
    expect(Array.from(range_inputs, (input) => input.getAttribute(`aria-label`))).toEqual([
      `Color range minimum`,
      `Color range maximum`,
    ])
    expect(document.querySelector(`.color-range`)?.textContent).toContain(`Range`)
    expect(Number(range_inputs[0].value)).toBe(-1)
    expect(Number(range_inputs[1].value)).toBe(1)

    range_inputs[0].value = ``
    // bubbles: true — Svelte 5 delegates change events to the root
    range_inputs[0].dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
    expect(props.settings.layers[0].color_range).toBeUndefined()
    expect(
      [
        ...document.querySelectorAll<HTMLInputElement>(`input[aria-label^="Color range "]`),
      ].every((input) => input.value === ``),
    ).toBe(true)
  })

  test(`editing one bound of an auto range materializes an explicit range`, () => {
    const props = mount_colored({ colormap: `interpolateViridis` })
    const range_input = doc_query<HTMLInputElement>(`input[aria-label="Color range minimum"]`)
    range_input.value = `2.5`
    range_input.dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
    expect(props.settings.layers[0].color_range?.[0]).toBe(2.5)
    expect(props.settings.layers[0].color_range?.[1]).toBeTypeOf(`number`)
  })

  test(`display range inputs materialize, update, and reset; hidden when non-periodic`, () => {
    mount_controls({ volumes: [make_volume({ periodic: false })] })
    expect(document.querySelector(`.display-range`)).toBeNull()

    document.body.innerHTML = ``
    const props = mount_controls({ volumes: two_volumes() })
    const inputs = document.querySelectorAll<HTMLInputElement>(
      `.display-range .range-axis input`,
    )
    expect(inputs).toHaveLength(6) // min/max for each of a, b, c

    inputs[1].value = `2.15` // a max
    inputs[1].dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
    expect(props.settings.display_range).toEqual([
      [0, 2.15],
      [0, 1],
      [0, 1],
    ])

    inputs[0].value = `-0.15` // a min
    inputs[0].dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
    expect(props.settings.display_range?.[0]).toEqual([-0.15, 2.15])

    document
      .querySelector<HTMLButtonElement>(`button[aria-label="Reset display range"]`)
      ?.click()
    flushSync()
    expect(props.settings.display_range).toBeUndefined()
  })

  test.each([
    { volumes: two_volumes(), warning: false },
    {
      volumes: [
        make_volume({ label: `geo` }),
        make_volume_fixture(make_grid(3, 3, 3, 1), { label: `color` }),
      ],
      warning: true,
    },
  ])(`compat warning=$warning for volume grids`, ({ volumes, warning }) => {
    mount_colored({}, volumes)
    expect(Boolean(document.querySelector(`.compat-warning`))).toBe(warning)
  })

  test(`remove-volume drops layers; removing below active shifts active_volume_idx`, () => {
    mount_layers([make_layer(0), make_layer(1)])
    document
      .querySelector<HTMLButtonElement>(`button[aria-label="Remove volume esp.cube"]`)
      ?.click()
    flushSync()
    const groups = document.querySelectorAll(`.volume-group`)
    expect(groups).toHaveLength(1)
    expect(groups[0].querySelector(`.volume-label`)?.textContent).toBe(`density.cube`)
    expect(groups[0].querySelectorAll(`.layer-row`)).toHaveLength(1)

    document.body.innerHTML = ``
    const props = mount_layers([make_layer(0), make_layer(1)], { active_volume_idx: 1 })
    document
      .querySelector<HTMLButtonElement>(`button[aria-label="Remove volume density.cube"]`)
      ?.click()
    flushSync()
    expect(props.active_volume_idx).toBe(0) // still points at esp.cube
    expect(props.volumes.map((vol) => vol.label)).toEqual([`esp.cube`])
  })

  test.each([
    {
      desc: `colormap select updates the layer's colormap`,
      layer: { color_volume_idx: 1, colormap: `interpolateViridis` },
      act: () => change_color_scale(`Turbo`),
      expected: { colormap: `interpolateTurbo` },
      reset_visible: true,
    },
    {
      desc: `picking "None (solid)" clears color source, colormap, and range`,
      layer: { color_volume_idx: 1, colormap: `interpolateRdBu`, color_range: [-1, 1] },
      act: () => change_select(find_select_with_option(`None (solid)`) ?? null, `-1`),
      expected: { color_volume_idx: undefined, colormap: undefined, color_range: undefined },
      reset_visible: false,
    },
    {
      desc: `reset button restores auto colormap and clears explicit range`,
      layer: { color_volume_idx: 1, colormap: `interpolateTurbo`, color_range: [-9, 9] },
      act: () => {
        const reset_button = document.querySelector<HTMLButtonElement>(
          `button[aria-label="Reset colormap + range to auto-fit"]`,
        )
        expect(reset_button?.querySelector(`svg`)).not.toBeNull()
        reset_button?.click()
        flushSync()
      },
      // colormap auto-resets to Viridis for all-positive data
      expected: { color_range: undefined, colormap: `interpolateViridis` },
      reset_visible: false,
    },
  ])(`$desc`, ({ layer, act, expected, reset_visible }) => {
    const props = mount_layers([make_layer(0, layer as Partial<IsosurfaceLayer>)])
    act()
    expect(props.settings.layers[0]).toMatchObject(expected)
    expect(
      Boolean(
        document.querySelector(`button[aria-label="Reset colormap + range to auto-fit"]`),
      ),
    ).toBe(reset_visible)
  })

  test(`visibility checkbox toggles layer.visible`, () => {
    const props = mount_layers([make_layer(0)])
    document
      .querySelector<HTMLInputElement>(`.layer-row input[type="checkbox"]`)
      ?.dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
    expect(props.settings.layers[0].visible).toBe(false)
  })
})
