// @vitest-environment happy-dom
// Tests for FillArea.svelte component
import { FillArea } from '$lib/plot'
import type { FillGradient, FillRegion } from '$lib/plot/types'
import { mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

// Mock scale functions
const mock_x_scale = Object.assign((val: number) => val * 10, {
  invert: (px: number) => px / 10,
})
const mock_y_scale = Object.assign((val: number) => 100 - val * 10, {
  invert: (py: number) => (100 - py) / 10,
})

const base_region: FillRegion = {
  id: `test-fill`,
  label: `Test Fill Region`,
  upper: { type: `constant`, value: 10 },
  lower: { type: `constant`, value: 0 },
  fill: `steelblue`,
  fill_opacity: 0.3,
}

const sample_path = `M0,100L100,100L100,0L0,0Z`

describe(`FillArea`, () => {
  test(`renders basic fill region`, () => {
    mount(FillArea, {
      target: document.body,
      props: {
        region: base_region,
        region_idx: 0,
        path: sample_path,
        clip_path_id: `clip-0`,
        x_scale_fn: mock_x_scale,
        y_scale_fn: mock_y_scale,
      },
    })

    const group = doc_query(`.fill-region`)
    expect(group).toBeTruthy()
    expect(group.getAttribute(`clip-path`)).toBe(`url(#clip-0)`)
    expect(group.getAttribute(`aria-label`)).toBe(`Test Fill Region`)

    const path = group.querySelector(`path`)
    expect(path).toBeTruthy()
    expect(path?.getAttribute(`fill`)).toBe(`steelblue`)
    expect(path?.getAttribute(`fill-opacity`)).toBe(`0.3`)
  })

  test(`uses default fill when not specified`, () => {
    mount(FillArea, {
      target: document.body,
      props: {
        region: { ...base_region, fill: undefined },
        region_idx: 0,
        path: sample_path,
        clip_path_id: `clip-0`,
        x_scale_fn: mock_x_scale,
        y_scale_fn: mock_y_scale,
      },
    })
    expect(doc_query(`.fill-region path`).getAttribute(`fill`)).toBe(`steelblue`)
  })

  test(`renders linear gradient`, () => {
    const gradient: FillGradient = {
      type: `linear`,
      angle: 45,
      stops: [[0, `red`], [1, `blue`]],
    }
    mount(FillArea, {
      target: document.body,
      props: {
        region: { ...base_region, fill: gradient },
        region_idx: 0,
        path: sample_path,
        clip_path_id: `clip-0`,
        x_scale_fn: mock_x_scale,
        y_scale_fn: mock_y_scale,
      },
    })
    const grad = doc_query(`linearGradient`)
    expect(grad.getAttribute(`gradientTransform`)).toBe(`rotate(45, 0.5, 0.5)`)
    expect(grad.querySelectorAll(`stop`).length).toBe(2)
  })

  test(`renders radial gradient`, () => {
    const gradient: FillGradient = {
      type: `radial`,
      center: { x: 0.3, y: 0.7 },
      stops: [[0, `white`], [0.5, `gray`], [1, `black`]],
    }
    mount(FillArea, {
      target: document.body,
      props: {
        region: { ...base_region, fill: gradient },
        region_idx: 0,
        path: sample_path,
        clip_path_id: `clip-0`,
        x_scale_fn: mock_x_scale,
        y_scale_fn: mock_y_scale,
      },
    })
    const grad = doc_query(`radialGradient`)
    expect(grad.getAttribute(`cx`)).toBe(`0.3`)
    expect(grad.querySelectorAll(`stop`).length).toBe(3)
  })

  test(`calls on_click with FillHandlerEvent`, async () => {
    const on_click = vi.fn()
    mount(FillArea, {
      target: document.body,
      props: {
        region: base_region,
        region_idx: 2,
        path: sample_path,
        clip_path_id: `clip-0`,
        x_scale_fn: mock_x_scale,
        y_scale_fn: mock_y_scale,
        on_click,
      },
    })

    const group = doc_query(`.fill-region`)
    group.dispatchEvent(
      new MouseEvent(`click`, { bubbles: true, clientX: 50, clientY: 50 }),
    )
    await tick()

    expect(on_click).toHaveBeenCalledTimes(1)
    const event = on_click.mock.calls[0][0]
    expect(event.region_idx).toBe(2)
    expect(event.region_id).toBe(`test-fill`)
    expect(event.label).toBe(`Test Fill Region`)
  })

  test(`calls on_hover on mouseenter and clears on mouseleave`, async () => {
    const on_hover = vi.fn()
    mount(FillArea, {
      target: document.body,
      props: {
        region: base_region,
        region_idx: 0,
        path: sample_path,
        clip_path_id: `clip-0`,
        x_scale_fn: mock_x_scale,
        y_scale_fn: mock_y_scale,
        on_hover,
      },
    })

    const group = doc_query(`.fill-region`)

    group.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))
    await tick()
    expect(on_hover).toHaveBeenCalledTimes(1)
    expect(on_hover.mock.calls[0][0]).not.toBeNull()

    group.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))
    await tick()
    expect(on_hover).toHaveBeenCalledTimes(2)
    expect(on_hover.mock.calls[1][0]).toBeNull()
  })

  test(`applies hover style when hovered`, () => {
    const region: FillRegion = {
      ...base_region,
      hover_style: { fill: `red`, fill_opacity: 0.8 },
    }
    mount(FillArea, {
      target: document.body,
      props: {
        region,
        region_idx: 0,
        path: sample_path,
        clip_path_id: `clip-0`,
        x_scale_fn: mock_x_scale,
        y_scale_fn: mock_y_scale,
        hovered_region: 0, // This region is hovered
      },
    })

    const path = doc_query(`.fill-region path`)
    expect(path.getAttribute(`fill`)).toBe(`red`)
    expect(path.getAttribute(`fill-opacity`)).toBe(`0.8`)
  })

  test.each([
    [`pointer when on_click provided`, base_region, { on_click: () => {} }, `pointer`],
    [
      `custom from hover_style`,
      { ...base_region, hover_style: { cursor: `crosshair` } },
      {},
      `crosshair`,
    ],
  ])(`cursor is %s`, (_, region, extra_props, expected) => {
    mount(FillArea, {
      target: document.body,
      props: {
        region,
        region_idx: 0,
        path: sample_path,
        clip_path_id: `clip-0`,
        x_scale_fn: mock_x_scale,
        y_scale_fn: mock_y_scale,
        ...extra_props,
      },
    })
    expect(doc_query(`.fill-region`).style.cursor).toBe(expected)
  })

  test(`keyboard Enter triggers click handler`, async () => {
    const on_click = vi.fn()
    mount(FillArea, {
      target: document.body,
      props: {
        region: base_region,
        region_idx: 0,
        path: sample_path,
        clip_path_id: `clip-0`,
        x_scale_fn: mock_x_scale,
        y_scale_fn: mock_y_scale,
        on_click,
      },
    })

    const group = doc_query(`.fill-region`)
    group.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
    await tick()

    expect(on_click).toHaveBeenCalled()
  })

  test(`tabindex set based on on_click presence`, () => {
    // Without on_click
    mount(FillArea, {
      target: document.body,
      props: {
        region: base_region,
        region_idx: 0,
        path: sample_path,
        clip_path_id: `clip-0`,
        x_scale_fn: mock_x_scale,
        y_scale_fn: mock_y_scale,
      },
    })
    expect(doc_query(`.fill-region`).getAttribute(`tabindex`)).toBe(`-1`)

    document.body.innerHTML = ``

    // With on_click
    mount(FillArea, {
      target: document.body,
      props: {
        region: base_region,
        region_idx: 0,
        path: sample_path,
        clip_path_id: `clip-0`,
        x_scale_fn: mock_x_scale,
        y_scale_fn: mock_y_scale,
        on_click: () => {},
      },
    })
    expect(doc_query(`.fill-region`).getAttribute(`tabindex`)).toBe(`0`)
  })

  test(`hovered class applied when region is hovered`, () => {
    mount(FillArea, {
      target: document.body,
      props: {
        region: base_region,
        region_idx: 1,
        path: sample_path,
        clip_path_id: `clip-0`,
        x_scale_fn: mock_x_scale,
        y_scale_fn: mock_y_scale,
        hovered_region: 1,
      },
    })

    expect(doc_query(`.fill-region`).classList.contains(`hovered`)).toBe(true)
  })

  test(`aria-label uses region label or falls back to index`, () => {
    // With label
    mount(FillArea, {
      target: document.body,
      props: {
        region: base_region,
        region_idx: 0,
        path: sample_path,
        clip_path_id: `clip-0`,
        x_scale_fn: mock_x_scale,
        y_scale_fn: mock_y_scale,
      },
    })
    expect(doc_query(`.fill-region`).getAttribute(`aria-label`)).toBe(`Test Fill Region`)

    document.body.innerHTML = ``

    // Without label
    const no_label_region: FillRegion = { ...base_region, label: undefined }
    mount(FillArea, {
      target: document.body,
      props: {
        region: no_label_region,
        region_idx: 5,
        path: sample_path,
        clip_path_id: `clip-0`,
        x_scale_fn: mock_x_scale,
        y_scale_fn: mock_y_scale,
      },
    })
    expect(doc_query(`.fill-region`).getAttribute(`aria-label`)).toBe(`Fill region 5`)
  })
})
