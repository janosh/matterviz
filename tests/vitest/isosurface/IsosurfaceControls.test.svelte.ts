// Tests for IsosurfaceControls component rendering and interactions
import IsosurfaceControls from '$lib/isosurface/IsosurfaceControls.svelte'
import { DEFAULT_ISOSURFACE_SETTINGS } from '$lib/isosurface/types'
import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface/types'
import { flushSync, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query, make_grid, make_volume as make_volume_fixture } from '../setup'

// Minimal VolumetricData fixture for testing controls (2x2x2 grid with values 1..8)
const make_volume = (overrides?: Partial<VolumetricData>): VolumetricData =>
  make_volume_fixture(
    make_grid(2, 2, 2, (ix, iy, iz) => ix * 4 + iy * 2 + iz + 1),
    {
      data_range: { min: 1, max: 8, abs_max: 8, mean: 4.5 },
      ...overrides,
    },
  )

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
  test(`renders isovalue slider with correct range from data`, () => {
    mount_controls()
    const slider = doc_query<HTMLInputElement>(`input[type="range"]`)
    expect(Number(slider.max)).toBeCloseTo(8) // abs_max of test data
    expect(Number(slider.min)).toBeGreaterThan(0)
  })

  test(`renders opacity slider (max=1) and positive color picker`, () => {
    mount_controls()
    const sliders = document.querySelectorAll<HTMLInputElement>(`input[type="range"]`)
    expect(sliders.length).toBeGreaterThanOrEqual(2)
    expect(Array.from(sliders).some((slider) => slider.max === `1`)).toBe(true)

    const color_inputs = document.querySelectorAll<HTMLInputElement>(`input[type="color"]`)
    expect(color_inputs.length).toBeGreaterThanOrEqual(1)
    expect(color_inputs[0].value).toBe(DEFAULT_ISOSURFACE_SETTINGS.positive_color)
  })

  test(`shows negative color picker only when show_negative is true`, () => {
    mount_controls({ settings: { ...DEFAULT_ISOSURFACE_SETTINGS, show_negative: false } })
    const color_inputs = document.querySelectorAll<HTMLInputElement>(`input[type="color"]`)
    expect(color_inputs).toHaveLength(1) // only positive color

    document.body.innerHTML = ``
    mount_controls({ settings: { ...DEFAULT_ISOSURFACE_SETTINGS, show_negative: true } })
    const color_inputs_with_neg =
      document.querySelectorAll<HTMLInputElement>(`input[type="color"]`)
    expect(color_inputs_with_neg).toHaveLength(2) // positive + negative
  })

  test(`renders wireframe checkbox unchecked by default`, () => {
    mount_controls()
    const wireframe_label = Array.from(document.querySelectorAll(`label`)).find((label) =>
      label.textContent?.includes(`Wireframe`),
    )
    expect(wireframe_label).toBeDefined()
    const wireframe_cb =
      wireframe_label?.querySelector<HTMLInputElement>(`input[type="checkbox"]`)
    expect(wireframe_cb?.checked).toBe(false)
  })

  test(`hides volume selector for single volume, shows for multiple`, () => {
    mount_controls({ volumes: [make_volume()] })
    const find_vol_label = () =>
      Array.from(document.querySelectorAll(`label`)).find((label) =>
        label.textContent?.includes(`Volume`),
      )
    expect(find_vol_label()).toBeUndefined()

    document.body.innerHTML = ``
    mount_controls({
      volumes: [
        make_volume({ label: `charge density` }),
        make_volume({ label: `magnetization` }),
      ],
    })
    const vol_select = find_vol_label()?.querySelector<HTMLSelectElement>(`select`)
    expect(vol_select?.options.length).toBe(2)
    expect(vol_select?.options[0].textContent).toBe(`charge density`)
    expect(vol_select?.options[1].textContent).toBe(`magnetization`)
  })

  test(`layers selector defaults to 1`, () => {
    mount_controls()
    const layers_label = Array.from(document.querySelectorAll(`label`)).find((label) =>
      label.textContent?.includes(`Layers`),
    )
    const select = layers_label?.querySelector<HTMLSelectElement>(`select`)
    expect(select?.value).toBe(`1`)
  })

  test(`displays grid info with dimensions and range`, () => {
    mount_controls()
    const grid_info = doc_query(`.grid-info`)
    expect(grid_info.textContent).toContain(`2 × 2 × 2`)
    expect(grid_info.textContent).toContain(`1`) // min
    expect(grid_info.textContent).toContain(`8`) // max
  })

  test.each([
    { show_neg: false, label: `negative lobe disabled` },
    { show_neg: true, label: `negative lobe enabled` },
  ])(`neg. lobe checkbox reflects settings ($label)`, ({ show_neg }) => {
    mount_controls({
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, show_negative: show_neg },
    })
    const neg_label = Array.from(document.querySelectorAll(`label`)).find((label) =>
      label.textContent?.includes(`Neg. lobe`),
    )
    const checkbox = neg_label?.querySelector<HTMLInputElement>(`input[type="checkbox"]`)
    expect(checkbox?.checked).toBe(show_neg)
  })

  test(`multi-layer mode renders layer rows and hides single-layer controls`, () => {
    const make_layer = (isovalue: number, color: string) => ({
      isovalue,
      color,
      opacity: 0.8,
      visible: true,
      show_negative: false,
      negative_color: `#0000ff`,
    })
    mount_controls({
      settings: {
        ...DEFAULT_ISOSURFACE_SETTINGS,
        layers: [make_layer(5, `#ff0000`), make_layer(2, `#00ff00`)],
      },
    })

    // Layer rows with correct controls
    const layer_rows = document.querySelectorAll(`.layer-row`)
    expect(layer_rows).toHaveLength(2)
    for (const row of Array.from(layer_rows)) {
      expect(row.querySelector(`input[type="checkbox"]`)).toBeInstanceOf(HTMLElement)
      expect(row.querySelector(`input[type="color"]`)).toBeInstanceOf(HTMLElement)
      expect(row.querySelectorAll(`input[type="range"]`)).toHaveLength(2)
    }

    // Single-layer controls should be hidden
    const labels = Array.from(document.querySelectorAll(`label`))
    expect(labels.find((lbl) => lbl.textContent?.includes(`Isovalue`))).toBeUndefined()
    expect(labels.find((lbl) => lbl.textContent?.includes(`Opacity`))).toBeUndefined()
  })

  test(`isovalue slider reflects custom initial value`, () => {
    mount_controls({
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, isovalue: 3.5 },
    })
    const slider = doc_query<HTMLInputElement>(`input[type="range"]`)
    expect(Number(slider.value)).toBeCloseTo(3.5)
  })
})

describe(`IsosurfaceControls multi-volume`, () => {
  const two_volumes = () => [
    make_volume({ label: `density.cube` }),
    make_volume({ label: `esp.cube` }),
  ]
  const make_layer = (volume_idx: number, overrides = {}) => ({
    isovalue: 2,
    color: `#ff0000`,
    opacity: 0.8,
    visible: true,
    show_negative: false,
    negative_color: `#0000ff`,
    volume_idx,
    ...overrides,
  })
  const find_select_with_option = (text: string) =>
    Array.from(document.querySelectorAll(`select`)).find((select) =>
      Array.from(select.options).some((opt) => opt.textContent?.includes(text)),
    )

  test(`single-isovalue mode with multiple volumes offers a Color by select`, () => {
    mount_controls({ volumes: two_volumes() })
    const color_by = Array.from(document.querySelectorAll(`label`)).find((label) =>
      label.textContent?.includes(`Color by`),
    )
    expect(color_by).toBeDefined()
    const select = color_by?.querySelector<HTMLSelectElement>(`select`)
    expect(Array.from(select?.options ?? []).map((opt) => opt.textContent)).toEqual([
      `None (solid)`,
      `density.cube`,
      `esp.cube`,
    ])
  })

  test(`single-isovalue mode with one volume hides Color by`, () => {
    mount_controls({ volumes: [make_volume()] })
    const color_by = Array.from(document.querySelectorAll(`label`)).find((label) =>
      label.textContent?.includes(`Color by`),
    )
    expect(color_by).toBeUndefined()
  })

  test(`multi-layer mode groups surfaces under their geometry volume`, () => {
    mount_controls({
      volumes: two_volumes(),
      settings: {
        ...DEFAULT_ISOSURFACE_SETTINGS,
        layers: [make_layer(0), make_layer(0), make_layer(1)],
      },
    })
    const groups = document.querySelectorAll(`.volume-group`)
    expect(groups).toHaveLength(2)
    expect(groups[0].querySelectorAll(`.layer-row`)).toHaveLength(2)
    expect(groups[1].querySelectorAll(`.layer-row`)).toHaveLength(1)
    expect(groups[0].querySelector(`.volume-label`)?.textContent).toBe(`density.cube`)
    expect(groups[0].querySelector(`.volume-dims`)?.textContent).toBe(`2×2×2`)
  })

  test(`volume with no surfaces shows color-source-only note`, () => {
    mount_controls({
      volumes: two_volumes(),
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, layers: [make_layer(0)] },
    })
    const groups = document.querySelectorAll(`.volume-group`)
    expect(groups[0].querySelector(`.volume-note`)).toBeNull()
    expect(groups[1].querySelector(`.volume-note`)?.textContent).toBe(`color source only`)
  })

  test(`add-surface button appends a layer bound to that volume`, () => {
    const settings = { ...DEFAULT_ISOSURFACE_SETTINGS, layers: [make_layer(0)] }
    mount_controls({ volumes: two_volumes(), settings })
    const add_btn = document.querySelector<HTMLButtonElement>(
      `button[aria-label="Add surface for esp.cube"]`,
    )
    add_btn?.click()
    flushSync()
    const groups = document.querySelectorAll(`.volume-group`)
    expect(groups[1].querySelectorAll(`.layer-row`)).toHaveLength(1)
  })

  test(`removing the last layer keeps zero-surface layers mode (no implicit resurrection)`, () => {
    mount_controls({
      volumes: two_volumes(),
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, layers: [make_layer(0)] },
    })
    const remove_btn = document.querySelector<HTMLButtonElement>(
      `button[aria-label="Remove surface"]`,
    )
    remove_btn?.click()
    flushSync()
    expect(document.querySelectorAll(`.layer-row`)).toHaveLength(0)
    // Volume groups remain (with add-surface buttons) instead of falling back to
    // the single-isovalue UI, which would resurrect a surface the user removed
    expect(document.querySelectorAll(`.volume-group`)).toHaveLength(2)
    const labels = Array.from(document.querySelectorAll(`label`))
    expect(labels.find((lbl) => lbl.textContent?.includes(`Isovalue`))).toBeUndefined()
  })

  test(`clearing a range input resets the color range to auto`, () => {
    const settings = $state<IsosurfaceSettings>({
      ...DEFAULT_ISOSURFACE_SETTINGS,
      layers: [
        make_layer(0, {
          color_volume_idx: 1,
          colormap: `interpolateRdBu`,
          color_range: [-1, 1],
        }),
      ],
    })
    mount(IsosurfaceControls, {
      target: document.body,
      props: { settings, volumes: two_volumes(), active_volume_idx: 0 },
    })
    flushSync()
    const range_input = doc_query<HTMLInputElement>(`input[type="number"].range-input`)
    range_input.value = ``
    // bubbles: true — Svelte 5 delegates change events to the root
    range_input.dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
    expect(settings.layers?.[0].color_range).toBeUndefined()
    // Inputs now show the auto placeholder state (empty values)
    const inputs = document.querySelectorAll<HTMLInputElement>(
      `input[type="number"].range-input`,
    )
    expect([...inputs].every((input) => input.value === ``)).toBe(true)
  })

  test(`display range inputs materialize, update, and reset display_range`, () => {
    const settings = $state<IsosurfaceSettings>({ ...DEFAULT_ISOSURFACE_SETTINGS })
    mount(IsosurfaceControls, {
      target: document.body,
      props: { settings, volumes: two_volumes(), active_volume_idx: 0 },
    })
    flushSync()
    const inputs = document.querySelectorAll<HTMLInputElement>(
      `.display-range .range-axis input`,
    )
    expect(inputs).toHaveLength(6) // min/max for each of a, b, c

    // Editing one bound materializes the full range with defaults elsewhere
    inputs[1].value = `2.15` // a max
    inputs[1].dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
    expect(settings.display_range).toEqual([
      [0, 2.15],
      [0, 1],
      [0, 1],
    ])

    inputs[0].value = `-0.15` // a min
    inputs[0].dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
    expect(settings.display_range?.[0]).toEqual([-0.15, 2.15])

    // Reset button restores follow-the-supercell behavior
    const reset_btn = document.querySelector<HTMLButtonElement>(
      `button[aria-label="Reset display range"]`,
    )
    reset_btn?.click()
    flushSync()
    expect(settings.display_range).toBeUndefined()
  })

  test(`display range hidden when no rendered volume is periodic`, () => {
    mount_controls({
      volumes: [make_volume({ periodic: false })],
    })
    expect(document.querySelector(`.display-range`)).toBeNull()
  })

  test(`editing one bound of an auto range materializes an explicit range`, () => {
    const settings = $state<IsosurfaceSettings>({
      ...DEFAULT_ISOSURFACE_SETTINGS,
      layers: [make_layer(0, { color_volume_idx: 1, colormap: `interpolateViridis` })],
    })
    mount(IsosurfaceControls, {
      target: document.body,
      props: { settings, volumes: two_volumes(), active_volume_idx: 0 },
    })
    flushSync()
    const range_input = doc_query<HTMLInputElement>(`input[type="number"].range-input`)
    range_input.value = `2.5`
    range_input.dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
    expect(settings.layers?.[0].color_range?.[0]).toBe(2.5)
    expect(settings.layers?.[0].color_range?.[1]).toBeTypeOf(`number`)
  })

  test(`selecting a color source reveals colormap select and range inputs`, () => {
    mount_controls({
      volumes: two_volumes(),
      settings: {
        ...DEFAULT_ISOSURFACE_SETTINGS,
        layers: [
          make_layer(0, {
            color_volume_idx: 1,
            colormap: `interpolateRdBu`,
            color_range: [-1, 1],
          }),
        ],
      },
    })
    const cmap_select = find_select_with_option(`RdBu`)
    expect(cmap_select?.value).toBe(`interpolateRdBu`)
    const range_inputs = document.querySelectorAll<HTMLInputElement>(
      `input[type="number"].range-input`,
    )
    expect(range_inputs).toHaveLength(2)
    expect(Number(range_inputs[0].value)).toBe(-1)
    expect(Number(range_inputs[1].value)).toBe(1)
  })

  test(`compat warning appears for mismatched grids`, () => {
    const mismatched = [
      make_volume({ label: `geo` }),
      make_volume_fixture(make_grid(3, 3, 3, 1), { label: `color` }),
    ]
    mount_controls({
      volumes: mismatched,
      settings: {
        ...DEFAULT_ISOSURFACE_SETTINGS,
        layers: [make_layer(0, { color_volume_idx: 1 })],
      },
    })
    expect(doc_query(`.compat-warning`)).toBeDefined()
  })

  test(`no compat warning for strictly matching grids`, () => {
    mount_controls({
      volumes: two_volumes(),
      settings: {
        ...DEFAULT_ISOSURFACE_SETTINGS,
        layers: [make_layer(0, { color_volume_idx: 1 })],
      },
    })
    expect(document.querySelector(`.compat-warning`)).toBeNull()
  })

  test(`remove-volume button drops the volume and its layers`, () => {
    mount_controls({
      volumes: two_volumes(),
      settings: {
        ...DEFAULT_ISOSURFACE_SETTINGS,
        layers: [make_layer(0), make_layer(1)],
      },
    })
    const remove_btn = document.querySelector<HTMLButtonElement>(
      `button[aria-label="Remove volume esp.cube"]`,
    )
    remove_btn?.click()
    flushSync()
    const groups = document.querySelectorAll(`.volume-group`)
    expect(groups).toHaveLength(1)
    expect(groups[0].querySelector(`.volume-label`)?.textContent).toBe(`density.cube`)
    expect(groups[0].querySelectorAll(`.layer-row`)).toHaveLength(1)
  })

  test(`removing a volume below the active one shifts active_volume_idx down`, () => {
    const props = mount_controls({
      volumes: two_volumes(),
      active_volume_idx: 1,
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, layers: [make_layer(0), make_layer(1)] },
    })
    document
      .querySelector<HTMLButtonElement>(`button[aria-label="Remove volume density.cube"]`)
      ?.click()
    flushSync()
    expect(props.active_volume_idx).toBe(0) // still points at esp.cube
    expect(props.volumes.map((vol) => vol.label)).toEqual([`esp.cube`])
  })

  const change_select = (select: HTMLSelectElement | null, value: string) => {
    if (!select) throw new Error(`select not found`)
    select.value = value
    select.dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
  }

  test.each([
    {
      desc: `colormap select updates the layer's colormap`,
      layer: { color_volume_idx: 1, colormap: `interpolateViridis` },
      act: () => change_select(find_select_with_option(`Turbo`) ?? null, `interpolateTurbo`),
      expected: { colormap: `interpolateTurbo` },
    },
    {
      desc: `picking "None (solid)" clears color source, colormap, and range`,
      layer: { color_volume_idx: 1, colormap: `interpolateRdBu`, color_range: [-1, 1] },
      act: () => change_select(find_select_with_option(`None (solid)`) ?? null, `-1`),
      expected: { color_volume_idx: undefined, colormap: undefined, color_range: undefined },
    },
    {
      desc: `reset button restores auto colormap and clears explicit range`,
      layer: { color_volume_idx: 1, colormap: `interpolateTurbo`, color_range: [-9, 9] },
      act: () => {
        document
          .querySelector<HTMLButtonElement>(`button[aria-label="Reset color range"]`)
          ?.click()
        flushSync()
      },
      // colormap auto-resets to Viridis for all-positive data
      expected: { color_range: undefined, colormap: `interpolateViridis` },
    },
  ])(`$desc`, ({ layer, act, expected }) => {
    const props = mount_controls({
      volumes: two_volumes(),
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, layers: [make_layer(0, layer)] },
    })
    act()
    expect(props.settings.layers?.[0]).toMatchObject(expected)
  })

  test(`visibility checkbox toggles layer.visible`, () => {
    const props = mount_controls({
      volumes: two_volumes(),
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, layers: [make_layer(0)] },
    })
    const checkbox = document.querySelector<HTMLInputElement>(
      `.layer-row input[type="checkbox"]`,
    )
    checkbox?.dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
    expect(props.settings.layers?.[0].visible).toBe(false)
  })

  test(`single-isovalue Color by pick materializes layers with that color source`, () => {
    const props = mount_controls({ volumes: two_volumes() })
    const color_by = Array.from(document.querySelectorAll(`label`)).find((label) =>
      label.textContent?.includes(`Color by`),
    )
    change_select(color_by?.querySelector(`select`) ?? null, `1`)
    expect(props.settings.layers).toHaveLength(1)
    expect(props.settings.layers?.[0]).toMatchObject({ volume_idx: 0, color_volume_idx: 1 })
  })
})
