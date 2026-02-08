// Tests for IsosurfaceControls component rendering and interactions
import IsosurfaceControls from '$lib/isosurface/IsosurfaceControls.svelte'
import {
  DEFAULT_ISOSURFACE_SETTINGS,
  type IsosurfaceSettings,
  type VolumetricData,
} from '$lib/isosurface/types'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

// Minimal VolumetricData fixture for testing controls
const make_volume = (overrides?: Partial<VolumetricData>): VolumetricData => ({
  grid: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]],
  grid_dims: [2, 2, 2],
  lattice: [[5, 0, 0], [0, 5, 0], [0, 0, 5]],
  origin: [0, 0, 0],
  data_range: { min: 1, max: 8, abs_max: 8, mean: 4.5 },
  periodic: true,
  ...overrides,
})

const mount_controls = (
  props?: Partial<{
    settings: IsosurfaceSettings
    volumes: VolumetricData[]
    active_volume_idx: number
  }>,
) =>
  mount(IsosurfaceControls, {
    target: document.body,
    props: {
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS },
      volumes: [make_volume()],
      active_volume_idx: 0,
      ...props,
    },
  })

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

    const color_inputs = document.querySelectorAll<HTMLInputElement>(
      `input[type="color"]`,
    )
    expect(color_inputs.length).toBeGreaterThanOrEqual(1)
    expect(color_inputs[0].value).toBe(DEFAULT_ISOSURFACE_SETTINGS.positive_color)
  })

  test(`shows negative color picker only when show_negative is true`, () => {
    mount_controls({ settings: { ...DEFAULT_ISOSURFACE_SETTINGS, show_negative: false } })
    const color_inputs = document.querySelectorAll<HTMLInputElement>(
      `input[type="color"]`,
    )
    expect(color_inputs.length).toBe(1) // only positive color

    document.body.innerHTML = ``
    mount_controls({ settings: { ...DEFAULT_ISOSURFACE_SETTINGS, show_negative: true } })
    const color_inputs_with_neg = document.querySelectorAll<HTMLInputElement>(
      `input[type="color"]`,
    )
    expect(color_inputs_with_neg.length).toBe(2) // positive + negative
  })

  test(`renders wireframe checkbox unchecked by default`, () => {
    mount_controls()
    const wireframe_label = Array.from(document.querySelectorAll(`label`))
      .find((label) => label.textContent?.includes(`Wireframe`))
    expect(wireframe_label).toBeDefined()
    const wireframe_cb = wireframe_label?.querySelector<HTMLInputElement>(
      `input[type="checkbox"]`,
    )
    expect(wireframe_cb?.checked).toBe(false)
  })

  test(`hides volume selector for single volume, shows for multiple`, () => {
    mount_controls({ volumes: [make_volume()] })
    const find_vol_label = () =>
      Array.from(document.querySelectorAll(`label`))
        .find((label) => label.textContent?.includes(`Volume`))
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
    const layers_label = Array.from(document.querySelectorAll(`label`))
      .find((label) => label.textContent?.includes(`Layers`))
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
    const neg_label = Array.from(document.querySelectorAll(`label`))
      .find((label) => label.textContent?.includes(`Neg. lobe`))
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
    expect(layer_rows.length).toBe(2)
    for (const row of Array.from(layer_rows)) {
      expect(row.querySelector(`input[type="checkbox"]`)).toBeTruthy()
      expect(row.querySelector(`input[type="color"]`)).toBeTruthy()
      expect(row.querySelectorAll(`input[type="range"]`).length).toBe(2)
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
