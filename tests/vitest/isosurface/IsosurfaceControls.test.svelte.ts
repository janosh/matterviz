// Tests for IsosurfaceControls component rendering and interactions
import IsosurfaceControls from '#lib/isosurface/IsosurfaceControls.svelte'
import VolumeSliceControls from '#lib/isosurface/VolumeSliceControls.svelte'
import { create_volume_slice_settings } from '#lib/isosurface/slice-settings.js'
import {
  auto_isosurface_settings,
  DEFAULT_ISOSURFACE_SETTINGS,
} from '#lib/isosurface/types.js'
import type {
  IsosurfaceLayer,
  IsosurfaceSettings,
  VolumetricData,
} from '#lib/isosurface/types.js'
import { flushSync, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query, bind_props, expect_labelled_settings_grid, set_input } from '../setup'
import { make_grid, make_volume as make_volume_fixture } from '../test-fixtures'

// Minimal VolumetricData fixture for testing controls (2x2x2 grid with values 1..8)
const make_volume = (overrides?: Partial<VolumetricData>): VolumetricData =>
  make_volume_fixture(
    make_grid(2, 2, 2, (idx_x, idx_y, idx_z) => idx_x * 4 + idx_y * 2 + idx_z + 1),
    {
      data_range: { min: 1, max: 8, abs_max: 8, mean: 4.5 },
      ...overrides,
    },
  )

const make_layer = (
  volume_id = `0`,
  overrides: Partial<IsosurfaceLayer> = {},
): IsosurfaceLayer => ({
  isovalue: 2,
  color: `#ff0000`,
  opacity: 0.8,
  visible: true,
  show_negative: false,
  negative_color: `#0000ff`,
  volume_id,
  ...overrides,
})
const two_volumes = () => [
  make_volume({ label: `density.cube` }),
  make_volume({ id: `1`, label: `esp.cube` }),
]
const find_label = (text: string): HTMLLabelElement | undefined =>
  Array.from(document.querySelectorAll(`label`)).find((label) =>
    label.textContent?.includes(text),
  )
const option_texts = (select: HTMLSelectElement | null | undefined): string[] =>
  Array.from(select?.options ?? [], (opt) => opt.textContent ?? ``)

const click_button = (label: string) => {
  doc_query<HTMLButtonElement>(`button[aria-label="${label}"]`).click()
  flushSync()
}
const change_value = (
  input: HTMLInputElement | HTMLSelectElement | null | undefined,
  value: string,
) => {
  if (!input) throw new Error(`input not found`)
  input.value = value
  input.dispatchEvent(new Event(`change`, { bubbles: true }))
  flushSync()
}

const mount_controls = (
  props?: Partial<{
    settings: IsosurfaceSettings
    volumes: VolumetricData[]
    active_volume_id: string
  }>,
) => {
  let settings = $state.raw(props?.settings ?? { ...DEFAULT_ISOSURFACE_SETTINGS })
  const state_props = $state({
    volumes: [make_volume()],
    active_volume_id: `0`,
    ...props,
    get settings() {
      return settings
    },
    set settings(value) {
      settings = value
    },
  })
  mount(IsosurfaceControls, { target: document.body, props: state_props })
  flushSync()
  return state_props
}

const mount_layers = (
  layers: IsosurfaceLayer[],
  options: { volumes?: VolumetricData[]; active_volume_id?: string } = {},
) =>
  mount_controls({
    volumes: two_volumes(),
    settings: { ...DEFAULT_ISOSURFACE_SETTINGS, layers },
    ...options,
  })

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
        make_volume({ id: `1`, label: `magnetization` }),
      ],
      color_by_options: [`None (solid)`, `charge density`, `magnetization`],
    },
  ])(
    `$desc chrome: one layer row per layer, Color by and Surface of list every volume`,
    ({ volumes, color_by_options }) => {
      mount_layers([make_layer(`0`)], { volumes: volumes ?? [make_volume()] })
      const slider = doc_query<HTMLInputElement>(`input[type="range"]`)
      expect(Number(slider.max)).toBeCloseTo(8)
      expect(document.querySelectorAll(`.layer-row input[type="range"]`)).toHaveLength(2)
      expect(document.querySelectorAll(`.volume-group`)).toHaveLength(volumes?.length ?? 1)
      if (!volumes) {
        expect_labelled_settings_grid(document, { section_selector: `.isosurface-settings` })
      }
      const color_by = find_label(`Color by`)?.querySelector<HTMLSelectElement>(`select`)
      expect(option_texts(color_by)).toEqual(color_by_options)
      // a lone volume has nothing to move its surface to
      const surface_of = find_label(`Surface of`)?.querySelector<HTMLSelectElement>(`select`)
      expect(option_texts(surface_of)).toEqual(volumes ? color_by_options.slice(1) : [])
    },
  )

  test.each([
    { show_negative: false, n_layers: 1 },
    { show_negative: true, n_layers: 1 },
    { show_negative: false, n_layers: 2 },
  ])(
    `negative lobe controls render and toggle $n_layers layers from $show_negative`,
    ({ show_negative, n_layers }) => {
      const props = mount_layers(
        Array.from({ length: n_layers }, () => make_layer(`0`, { show_negative })),
        { volumes: [make_volume()] },
      )
      const checkbox = find_label(`Neg. lobe`)?.querySelector<HTMLInputElement>(`input`)
      if (!checkbox) throw new Error(`Neg. lobe checkbox not found`)
      expect(checkbox.checked).toBe(show_negative)
      expect(document.querySelectorAll(`input[type="color"]`)).toHaveLength(
        n_layers * (show_negative ? 2 : 1),
      )
      checkbox.checked = !show_negative
      checkbox.dispatchEvent(new Event(`change`, { bubbles: true }))
      flushSync()
      expect(props.settings.layers.map((layer) => layer.show_negative)).toEqual(
        Array(n_layers).fill(!show_negative),
      )
      expect(document.querySelectorAll(`input[type="color"]`)).toHaveLength(
        n_layers * (show_negative ? 1 : 2),
      )
    },
  )

  test.each([`Wireframe`, `Halo`])(
    `%s edits notify a raw caller and preserve layers`,
    (label) => {
      const initial = { ...DEFAULT_ISOSURFACE_SETTINGS, layers: [make_layer()] }
      const props = mount_controls({ settings: initial })
      const input = find_label(label)?.querySelector<HTMLInputElement>(`input`)
      if (!input) throw new Error(`${label} input not found`)
      if (label === `Wireframe`) input.click()
      else {
        set_input(input, `0.25`)
      }
      flushSync()
      expect(props.settings).not.toBe(initial)
      expect(props.settings.layers).toBe(initial.layers)
      expect(props.settings[label === `Wireframe` ? `wireframe` : `halo`]).toBe(
        label === `Wireframe` ? true : 0.25,
      )
    },
  )

  // Reset mirrors a fresh file load (auto_isosurface_settings): one auto layer on volume 0,
  // further volumes stay available as colour sources or for manually added surfaces
  test.each([`initial`, `layer edit`, `new volume`])(
    `reset restores auto settings after %s`,
    (scenario) => {
      const volumes = two_volumes()
      const settings = auto_isosurface_settings(volumes[0])
      if (scenario === `initial`) settings.layers[0].opacity = 0.2
      const props = mount_controls({ volumes, settings })
      if (scenario === `new volume`) props.volumes = [make_volume({ id: `new` })]
      else if (scenario === `layer edit`)
        props.settings = { ...props.settings, layers: [make_layer(`0`, { opacity: 0.2 })] }
      flushSync()
      const selector = `button[aria-label="Reset isosurface to defaults"]`
      doc_query<HTMLButtonElement>(selector).click()
      flushSync()
      expect(props.settings).toEqual(auto_isosurface_settings(props.volumes[0]))
      expect(document.querySelector(selector)).toBeNull()
    },
  )

  test(`cross-section reset restores the first volume and authored nondefault settings`, () => {
    const props = $state({
      volumes: two_volumes(),
      active_volume_id: `1`,
      settings: create_volume_slice_settings({ position: 0.2, render_mode: `contours` }),
    })
    mount(VolumeSliceControls, { target: document.body, props: bind_props({}, props) })
    flushSync()
    const selector = `button[aria-label="Reset cross-section to defaults"]`
    doc_query<HTMLButtonElement>(selector).click()
    flushSync()
    expect(props.active_volume_id).toBe(`0`)
    expect(props.settings).toEqual(create_volume_slice_settings())
    expect(document.querySelector(selector)).toBeNull()
  })
})

describe(`IsosurfaceControls multi-volume`, () => {
  const find_select_with_option = (text: string) =>
    Array.from(document.querySelectorAll(`select`)).find((select) =>
      Array.from(select.options).some((opt) => opt.textContent?.includes(text)),
    )
  const mount_colored = (layer: Partial<IsosurfaceLayer> = {}, volumes = two_volumes()) =>
    mount_layers(
      [make_layer(`0`, { color_volume_id: `1`, colormap: `interpolateRdBu`, ...layer })],
      { volumes },
    )
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
    mount_layers([make_layer(`0`), make_layer(`0`), make_layer(`1`)])
    const groups = document.querySelectorAll(`.volume-group`)
    expect(groups).toHaveLength(2)
    expect(groups[0].querySelectorAll(`.layer-row`)).toHaveLength(2)
    expect(groups[1].querySelectorAll(`.layer-row`)).toHaveLength(1)
    expect(groups[0].querySelector(`.volume-label`)?.textContent).toBe(`density.cube`)
    expect(groups[0].querySelector(`.volume-dims`)?.textContent).toBe(`2×2×2`)
  })

  test.each([
    { min: 1, max: 8, text: `1–8` },
    // a density's vacuum sits at ~1e-125: zero at this volume's scale
    { min: 9.43e-125, max: 13.4, text: `0–13.4` },
    { min: -0.012345, max: 1234.5, text: `−0.0123–1.23e3` },
  ])(`volume header shows the [$min, $max] data range as $text`, ({ min, max, text }) => {
    const abs_max = Math.max(Math.abs(min), Math.abs(max))
    mount_layers([make_layer(`0`)], {
      volumes: [make_volume({ data_range: { min, max, abs_max, mean: 0 } })],
    })
    expect(doc_query(`.volume-group .volume-range`).textContent).toBe(text)
  })

  // A volume without surfaces offers a labelled add button in its body (the header's bare
  // "+" was easy to miss once the last surface was removed); with surfaces, the header "+"
  // adds another shell
  test(`an empty volume offers Add surface in its body, a filled one in its header`, () => {
    mount_layers([make_layer(`0`)])
    const group = (idx: number) => document.querySelectorAll(`.volume-group`)[idx]
    expect(group(0).querySelector(`.empty-volume`)).toBeNull()
    expect(group(0).querySelector(`.volume-header .icon-btn`)?.textContent).toBe(`+`)
    expect(group(1).querySelector(`.empty-volume .add-surface`)?.textContent).toBe(
      `+ Add surface`,
    )
    expect(group(1).querySelector(`.volume-note`)?.textContent).toBe(
      `still usable as a color source`,
    )

    click_button(`Add surface for esp.cube`)
    expect(group(1).querySelectorAll(`.layer-row`)).toHaveLength(1)
    expect(group(1).querySelector(`.empty-volume`)).toBeNull()
  })

  // Each "+" on the same volume used to add an identical 20%/0.6 surface on top of the last
  test(`repeated add-surface clicks on one volume add distinct shells`, () => {
    const props = mount_layers([])
    // the first click swaps the empty volume's body button for the header "+"
    for (let click = 0; click < 3; click++) click_button(`Add surface for esp.cube`)
    const esp_layers = props.settings.layers.filter((layer) => layer.volume_id === `1`)
    expect(esp_layers).toHaveLength(3)
    // abs_max = 8: shells at 20%, 80%, 50%
    expect(esp_layers.map((layer) => layer.isovalue)).toEqual([1.6, 6.4, 4])
    expect(esp_layers.map((layer) => layer.opacity)).toEqual([0.6, 0.8, 0.7])
    expect(new Set(esp_layers.map((layer) => layer.color)).size).toBe(3)
    // Shell count is per volume: the other volume's first surface is still the 20% envelope
    click_button(`Add surface for density.cube`)
    const density_layer = props.settings.layers.find((layer) => layer.volume_id === `0`)
    expect(density_layer).toMatchObject({ isovalue: 1.6, opacity: 0.6 })
    expect(props.active_volume_id).toBe(`0`)
  })

  // Issue #478: one select moves a surface between e.g. ELF spin up and spin down
  test.each([
    { desc: `keeps an isovalue the new volume reaches`, max: 8, isovalue: 2 },
    { desc: `re-fits an isovalue beyond the new volume`, max: 1, isovalue: 0.2 },
  ])(`Surface of select $desc`, ({ max, isovalue }) => {
    const volumes = [
      make_volume({ label: `ELF (spin up)` }),
      make_volume({
        id: `1`,
        label: `ELF (spin down)`,
        data_range: { min: 0, max, abs_max: max, mean: max / 2 },
      }),
    ]
    const props = mount_layers([make_layer(`0`, { opacity: 0.4 })], { volumes })
    change_value(find_label(`Surface of`)?.querySelector(`select`), `1`)
    expect(props.settings.layers).toEqual([
      make_layer(`1`, { opacity: 0.4, isovalue, show_negative: false }),
    ])
    expect(props.active_volume_id).toBe(`1`)
    expect(find_label(`Surface of`)?.querySelector(`select`)?.value).toBe(`1`)
  })

  // The fixture's values span [1, 8] while the slider starts at 8 / 200: below 1 nothing draws.
  // The track labels where surfaces exist and an input just short of it snaps to the first
  // step that still draws one
  test(`isovalue slider marks and snaps to the isovalues that draw a surface`, () => {
    const props = mount_layers([make_layer(`0`, { isovalue: 2 })])
    const track = doc_query(`.volume-group .isovalue-track`)
    expect([...track.querySelectorAll(`.band-tick`)].map((tick) => tick.textContent)).toEqual([
      `1`,
      `8`,
    ])
    expect(track.querySelectorAll(`.isovalue-histogram path.bars`)).toHaveLength(2)
    const slider = track.querySelector<HTMLInputElement>(`input[aria-label="Isovalue"]`)
    if (!slider) throw new Error(`isovalue slider not found`)
    set_input(slider, `0.92`)
    flushSync()
    // steps sit at 0.04 k: 1.04 is the first above the minimum
    expect(props.settings.layers[0].isovalue).toBeCloseTo(1.04, 12)
    expect(Number(slider.value)).toBeCloseTo(1.04, 12)
  })

  // A weak field (values 1e-6…8e-6) gets a slider over its own [abs_max / 200, abs_max]: a
  // 0.001 floor on abs_max made the track [5e-6, 1e-3], so the 2e-6 isovalue showed as 5e-6
  // and only 2 of 199 steps drew a surface
  test(`isovalue slider spans a weak field's own range`, () => {
    const weak = make_volume_fixture(
      make_grid(2, 2, 2, (idx_x, idx_y, idx_z) => (idx_x * 4 + idx_y * 2 + idx_z + 1) * 1e-6),
      { data_range: { min: 1e-6, max: 8e-6, abs_max: 8e-6, mean: 4.5e-6 } },
    )
    mount_layers([make_layer(`0`, { isovalue: 2e-6 })], { volumes: [weak] })
    const slider = doc_query<HTMLInputElement>(`.volume-group input[aria-label="Isovalue"]`)
    const [min, max, step, value] = [slider.min, slider.max, slider.step, slider.value]
    expect([min, max, step].map(Number)).toEqual([4e-8, 8e-6, 4e-8])
    expect(Number(value)).toBeCloseTo(2e-6, 15)
  })

  // A removed volume could only come back by reloading its file
  test(`a removed volume restores in place with its surfaces until volumes change`, () => {
    const props = mount_layers([make_layer(`0`), make_layer(`1`, { isovalue: 3 })])
    click_button(`Remove volume density.cube`)
    expect(props.volumes.map(({ id }) => id)).toEqual([`1`])
    expect(props.settings.layers).toEqual([make_layer(`1`, { isovalue: 3 })])
    const groups = document.querySelectorAll(`.volume-group`)
    expect(groups).toHaveLength(1)
    expect(groups[0].querySelector(`.volume-label`)?.textContent).toBe(`esp.cube`)
    expect(groups[0].querySelectorAll(`.layer-row`)).toHaveLength(1)
    click_button(`Restore volume density.cube`)
    expect(props.volumes.map(({ id }) => id)).toEqual([`0`, `1`])
    expect(props.settings.layers).toEqual([make_layer(`1`, { isovalue: 3 }), make_layer(`0`)])
    expect(document.querySelector(`.removed-volumes`)).toBeNull()

    // a volume set changed from outside (a new file) drops what could be restored
    click_button(`Remove volume esp.cube`)
    expect(
      document.querySelector(`button[aria-label="Restore volume esp.cube"]`),
    ).not.toBeNull()
    props.volumes = [make_volume({ id: `fresh`, label: `fresh.cube` })]
    flushSync()
    expect(document.querySelector(`.removed-volumes`)).toBeNull()
  })

  test(`removing the last surface leaves none, and Add surface brings one back`, () => {
    const props = mount_layers([make_layer(`0`)], { volumes: [make_volume()] })
    click_button(`Remove surface`)
    expect(document.querySelectorAll(`.layer-row`)).toHaveLength(0)
    expect(props.settings.layers).toEqual([]) // no implicit resurrection
    // a lone volume is nobody's color source, so no note
    expect(document.querySelector(`.volume-note`)).toBeNull()
    click_button(`Add surface for Volume 1`)
    expect(props.settings.layers).toHaveLength(1)
    expect(document.querySelectorAll(`.layer-row`)).toHaveLength(1)
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

    change_value(range_inputs[0], ``)
    expect(props.settings.layers[0].color_range).toBeUndefined()
    expect(
      [
        ...document.querySelectorAll<HTMLInputElement>(`input[aria-label^="Color range "]`),
      ].every((input) => input.value === ``),
    ).toBe(true)
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

    change_value(inputs[1], `2.15`) // a max
    expect(props.settings.display_range).toEqual([
      [0, 2.15],
      [0, 1],
      [0, 1],
    ])

    change_value(inputs[0], `-0.15`) // a min
    expect(props.settings.display_range?.[0]).toEqual([-0.15, 2.15])

    click_button(`Reset display range`)
    expect(props.settings.display_range).toBeUndefined()
  })

  test.each([
    { volumes: two_volumes(), warning: false },
    {
      volumes: [
        make_volume({ label: `geo` }),
        make_volume_fixture(make_grid(3, 3, 3, 1), { id: `1`, label: `color` }),
      ],
      warning: true,
    },
  ])(`compat warning=$warning for volume grids`, ({ volumes, warning }) => {
    mount_colored({}, volumes)
    expect(Boolean(document.querySelector(`.compat-warning`))).toBe(warning)
  })

  test(`remove-volume preserves the selected field ID across reordering`, () => {
    const props = mount_layers([make_layer(`0`), make_layer(`1`)], { active_volume_id: `1` })
    props.volumes = props.volumes.toReversed().map((volume) => ({ ...volume }))
    flushSync()
    expect(props.active_volume_id).toBe(`1`)
    expect(props.settings.layers.map(({ volume_id }) => volume_id)).toEqual([`0`, `1`])
    click_button(`Remove volume density.cube`)
    expect(props.active_volume_id).toBe(`1`) // still points at esp.cube
    expect(props.volumes.map((vol) => vol.label)).toEqual([`esp.cube`])
  })

  test.each([
    {
      desc: `colormap select updates the layer's colormap`,
      layer: { color_volume_id: `1`, colormap: `interpolateViridis` },
      act: () => change_color_scale(`Turbo`),
      expected: { colormap: `interpolateTurbo` },
      reset_visible: true,
    },
    {
      desc: `picking "None (solid)" clears color source, colormap, and range`,
      layer: { color_volume_id: `1`, colormap: `interpolateRdBu`, color_range: [-1, 1] },
      act: () => change_value(find_select_with_option(`None (solid)`), `-1`),
      expected: { color_volume_id: undefined, colormap: undefined, color_range: undefined },
      reset_visible: false,
    },
    {
      desc: `reset button restores auto colormap and clears explicit range`,
      layer: { color_volume_id: `1`, colormap: `interpolateTurbo`, color_range: [-9, 9] },
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
    {
      desc: `editing one bound of an auto range seeds the other from the color volume's data range`,
      layer: { color_volume_id: `1`, colormap: `interpolateViridis` },
      act: () =>
        change_value(
          doc_query<HTMLInputElement>(`input[aria-label="Color range minimum"]`),
          `2.5`,
        ),
      // color volume data_range is [1, 8] → the untouched max bound comes from there
      expected: { color_range: [2.5, 8] },
      reset_visible: true,
    },
    {
      desc: `visibility checkbox toggles layer.visible`,
      layer: {},
      act: () => {
        const checkbox = doc_query(`.layer-row input[type="checkbox"]`)
        checkbox.dispatchEvent(new Event(`change`, { bubbles: true }))
        flushSync()
      },
      expected: { visible: false },
      reset_visible: false,
    },
  ])(`$desc`, ({ layer, act, expected, reset_visible }) => {
    const props = mount_layers([make_layer(`0`, layer as Partial<IsosurfaceLayer>)])
    act()
    expect(props.settings.layers[0]).toMatchObject(expected)
    expect(
      Boolean(
        document.querySelector(`button[aria-label="Reset colormap + range to auto-fit"]`),
      ),
    ).toBe(reset_visible)
  })
})
