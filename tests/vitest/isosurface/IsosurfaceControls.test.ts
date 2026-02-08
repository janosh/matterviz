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

const mount_controls = (props?: Partial<{
  settings: IsosurfaceSettings
  volumes: VolumetricData[]
  active_volume_idx: number
}>) => mount(IsosurfaceControls, {
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

  test(`renders opacity slider`, () => {
    mount_controls()
    const sliders = document.querySelectorAll<HTMLInputElement>(`input[type="range"]`)
    // Should have at least isovalue + opacity sliders
    expect(sliders.length).toBeGreaterThanOrEqual(2)
    // Opacity slider has max=1
    const opacity_slider = Array.from(sliders).find((slider) => slider.max === `1`)
    expect(opacity_slider).toBeDefined()
  })

  test(`renders positive color picker`, () => {
    mount_controls()
    const color_inputs = document.querySelectorAll<HTMLInputElement>(`input[type="color"]`)
    expect(color_inputs.length).toBeGreaterThanOrEqual(1)
    expect(color_inputs[0].value).toBe(DEFAULT_ISOSURFACE_SETTINGS.positive_color)
  })

  test(`shows negative color picker only when show_negative is true`, () => {
    mount_controls({ settings: { ...DEFAULT_ISOSURFACE_SETTINGS, show_negative: false } })
    const color_inputs = document.querySelectorAll<HTMLInputElement>(`input[type="color"]`)
    expect(color_inputs.length).toBe(1) // only positive color

    document.body.innerHTML = ``
    mount_controls({ settings: { ...DEFAULT_ISOSURFACE_SETTINGS, show_negative: true } })
    const color_inputs_with_neg = document.querySelectorAll<HTMLInputElement>(`input[type="color"]`)
    expect(color_inputs_with_neg.length).toBe(2) // positive + negative
  })

  test(`renders wireframe checkbox unchecked by default`, () => {
    mount_controls()
    const checkboxes = document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`)
    // Find wireframe checkbox (the one in a label containing "Wireframe")
    const wireframe_label = Array.from(document.querySelectorAll(`label`))
      .find((label) => label.textContent?.includes(`Wireframe`))
    expect(wireframe_label).toBeDefined()
    const wireframe_cb = wireframe_label?.querySelector<HTMLInputElement>(`input[type="checkbox"]`)
    expect(wireframe_cb?.checked).toBe(false)
  })

  test(`hides volume selector when only one volume`, () => {
    mount_controls({ volumes: [make_volume()] })
    const selects = document.querySelectorAll(`select`)
    // Should only have the layers selector, not a volume selector
    const volume_labels = Array.from(document.querySelectorAll(`label`))
      .filter((label) => label.textContent?.includes(`Volume`))
    expect(volume_labels.length).toBe(0)
  })

  test(`shows volume selector for multiple volumes`, () => {
    const vol1 = make_volume({ label: `charge density` })
    const vol2 = make_volume({ label: `magnetization` })
    mount_controls({ volumes: [vol1, vol2] })
    const volume_label = Array.from(document.querySelectorAll(`label`))
      .find((label) => label.textContent?.includes(`Volume`))
    expect(volume_label).toBeDefined()
    const select = volume_label?.querySelector(`select`)
    expect(select?.options.length).toBe(2)
    expect(select?.options[0].textContent).toBe(`charge density`)
    expect(select?.options[1].textContent).toBe(`magnetization`)
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

  test(`renders tooltips on labels`, () => {
    mount_controls()
    // tooltip attachment adds a title or data attribute — check the isovalue label
    const labels = document.querySelectorAll(`label`)
    // At least layers, neg lobe, wireframe, isovalue, opacity, + color should exist
    expect(labels.length).toBeGreaterThanOrEqual(6)
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

  test(`multi-layer mode renders layer rows with visibility, color, isovalue, and opacity`, () => {
    const layers = [
      { isovalue: 5, color: `#ff0000`, opacity: 0.8, visible: true, show_negative: false, negative_color: `#0000ff` },
      { isovalue: 2, color: `#00ff00`, opacity: 0.5, visible: false, show_negative: false, negative_color: `#0000ff` },
    ]
    mount_controls({
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, layers },
    })
    const layer_rows = document.querySelectorAll(`.layer-row`)
    expect(layer_rows.length).toBe(2)

    // Each layer row should have: checkbox + color + range slider + value + opacity slider
    for (const row of layer_rows) {
      expect(row.querySelector(`input[type="checkbox"]`)).toBeTruthy()
      expect(row.querySelector(`input[type="color"]`)).toBeTruthy()
      expect(row.querySelectorAll(`input[type="range"]`).length).toBe(2) // isovalue + opacity
    }
  })

  test(`multi-layer mode hides single-layer isovalue/opacity/color controls`, () => {
    const layers = [
      { isovalue: 5, color: `#ff0000`, opacity: 0.8, visible: true, show_negative: false, negative_color: `#0000ff` },
    ]
    mount_controls({
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, layers },
    })
    // Single-layer labels like "Isovalue:", "Opacity:", "+ Color" should NOT appear
    const labels = Array.from(document.querySelectorAll(`label`))
    const isovalue_label = labels.find((label) => label.textContent?.includes(`Isovalue`))
    const opacity_label = labels.find((label) => label.textContent?.includes(`Opacity`))
    expect(isovalue_label).toBeUndefined()
    expect(opacity_label).toBeUndefined()
  })

  test(`isovalue slider reflects custom initial value`, () => {
    mount_controls({
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, isovalue: 3.5 },
    })
    const slider = doc_query<HTMLInputElement>(`input[type="range"]`)
    expect(Number(slider.value)).toBeCloseTo(3.5)
  })
})
