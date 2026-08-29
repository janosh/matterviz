// @vitest-environment happy-dom
// Tests for FillArea.svelte component
import FillArea from '$lib/plot/core/components/FillArea.svelte'
import type { FillGradient, FillRegion } from '$lib/plot/core/types'
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

// Helper to reduce boilerplate - creates base props with optional overrides
const make_props = (overrides: Record<string, unknown> = {}) => ({
  region: base_region,
  region_idx: 0,
  path: sample_path,
  clip_path_id: `clip-0`,
  x_scale_fn: mock_x_scale,
  y_scale_fn: mock_y_scale,
  ...overrides,
})

describe(`FillArea`, () => {
  // A region with only a hover handler was in the DOM but out of the tab order, so a
  // keyboard user could never reach it - the same shape as BarPlot's line points
  test.each([
    [`click handler`, { on_click: () => {} }, `0`],
    [`hover handler only`, { on_hover: () => {} }, `0`],
    [`no handlers`, {}, `-1`],
  ])(`a region with a %s has tabindex %s`, (_name, handlers, expected) => {
    document.body.innerHTML = ``
    mount(FillArea, { target: document.body, props: make_props(handlers) })
    expect(doc_query(`g.fill-region`).getAttribute(`tabindex`)).toBe(expected)
  })

  // A region split by gaps renders one FillArea per segment. They are one logical
  // region, so N segments must not become N identical tab stops.
  test.each([
    [`first segment`, true, `0`, null],
    [`later segment`, false, `-1`, `true`],
  ])(`a %s carries tabindex %s`, (_name, is_first_segment, tabindex, hidden) => {
    document.body.innerHTML = ``
    mount(FillArea, {
      target: document.body,
      props: make_props({ on_hover: () => {}, is_first_segment }),
    })
    const region = doc_query(`g.fill-region`)
    expect(region.getAttribute(`tabindex`)).toBe(tabindex)
    expect(region.getAttribute(`aria-hidden`)).toBe(hidden)
  })

  // Every hover payload comes from a pointer event, so without this a keyboard user
  // reaches the region and sees nothing
  test(`focus reports a hover at the region center, blur clears it`, async () => {
    const on_hover = vi.fn()
    document.body.innerHTML = ``
    mount(FillArea, { target: document.body, props: make_props({ on_hover }) })
    const region = doc_query(`g.fill-region`)

    region.dispatchEvent(new FocusEvent(`focus`))
    await tick()
    expect(on_hover).toHaveBeenCalledOnce()
    expect(on_hover.mock.calls[0][0]).toMatchObject({ region_idx: 0 })

    region.dispatchEvent(new FocusEvent(`blur`))
    await tick()
    expect(on_hover).toHaveBeenLastCalledWith(null)
  })

  test(`renders basic fill region with correct attributes`, () => {
    mount(FillArea, { target: document.body, props: make_props() })

    const group = doc_query(`.fill-region`)
    expect(group.getAttribute(`clip-path`)).toBe(`url(#clip-0)`)
    expect(group.getAttribute(`aria-label`)).toBe(`Test Fill Region`)

    const path = group.querySelector(`path`)
    expect(path?.getAttribute(`fill`)).toBe(`steelblue`)
    expect(path?.getAttribute(`fill-opacity`)).toBe(`0.3`)
  })

  test(`uses default fill when not specified`, () => {
    mount(FillArea, {
      target: document.body,
      props: make_props({ region: { ...base_region, fill: undefined } }),
    })
    expect(doc_query(`.fill-region path`).getAttribute(`fill`)).toBe(`steelblue`)
  })

  test(`renders linear gradient with correct transform and stops`, () => {
    const gradient: FillGradient = {
      type: `linear`,
      angle: 45,
      stops: [
        [0, `red`],
        [1, `blue`],
      ],
    }
    mount(FillArea, {
      target: document.body,
      props: make_props({ region: { ...base_region, fill: gradient } }),
    })
    const grad = doc_query(`linearGradient`)
    expect(grad.getAttribute(`gradientTransform`)).toBe(`rotate(45, 0.5, 0.5)`)
    expect(grad.querySelectorAll(`stop`)).toHaveLength(2)
  })

  test(`renders radial gradient with correct center and stops`, () => {
    const gradient: FillGradient = {
      type: `radial`,
      center: { x: 0.3, y: 0.7 },
      stops: [
        [0, `white`],
        [0.5, `gray`],
        [1, `black`],
      ],
    }
    mount(FillArea, {
      target: document.body,
      props: make_props({ region: { ...base_region, fill: gradient } }),
    })
    const grad = doc_query(`radialGradient`)
    expect(grad.getAttribute(`cx`)).toBe(`0.3`)
    expect(grad.querySelectorAll(`stop`)).toHaveLength(3)
  })

  test(`on_click handler receives correct FillHandlerEvent`, async () => {
    const on_click = vi.fn()
    mount(FillArea, {
      target: document.body,
      props: make_props({ region_idx: 2, on_click }),
    })

    doc_query(`.fill-region`).dispatchEvent(
      new MouseEvent(`click`, { bubbles: true, clientX: 50, clientY: 50 }),
    )
    await tick()

    expect(on_click).toHaveBeenCalledTimes(1)
    const event = on_click.mock.calls[0][0]
    // the host <svg> sits at the origin in happy-dom, so client coords are svg pixels
    expect(event).toMatchObject({
      region_idx: 2,
      region_id: `test-fill`,
      label: `Test Fill Region`,
      px: 50,
      py: 50,
      x: 5,
      y: 5,
    })
  })

  test.each([`click`, `hover`] as const)(
    `region.on_%s called alongside prop`,
    async (type) => {
      const region_handler = vi.fn()
      const prop_handler = vi.fn()
      const region = { ...base_region, [`on_${type}`]: region_handler }
      const props = make_props({ region, [`on_${type}`]: prop_handler })
      mount(FillArea, { target: document.body, props })

      const group = doc_query(`.fill-region`)
      const mouse_event =
        type === `click`
          ? new MouseEvent(`click`, { bubbles: true, clientX: 50, clientY: 50 })
          : new MouseEvent(`mouseenter`, { bubbles: true })
      group.dispatchEvent(mouse_event)
      await tick()

      expect(region_handler).toHaveBeenCalledWith(expect.objectContaining({ region_idx: 0 }))
      expect(prop_handler).toHaveBeenCalledWith(expect.objectContaining({ region_idx: 0 }))

      // Hover also tests mouseleave → null
      if (type === `hover`) {
        group.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))
        await tick()
        expect(region_handler).toHaveBeenLastCalledWith(null)
        expect(prop_handler).toHaveBeenLastCalledWith(null)
      }
    },
  )

  test(`applies hover style when region is hovered`, () => {
    const region: FillRegion = {
      ...base_region,
      hover_style: { fill: `red`, fill_opacity: 0.8 },
    }
    mount(FillArea, {
      target: document.body,
      props: make_props({ region, is_hovered: true }),
    })

    const path = doc_query(`.fill-region path`)
    expect(path.getAttribute(`fill`)).toBe(`red`)
    expect(path.getAttribute(`fill-opacity`)).toBe(`0.8`)
  })

  test.each([
    [`pointer`, base_region, { on_click: () => {} }], // on_click prop
    [`pointer`, { ...base_region, on_click: () => {} }, {}], // region.on_click
    [`grab`, { ...base_region, hover_style: { cursor: `grab` } }, { on_click: () => {} }], // override
    [`crosshair`, { ...base_region, hover_style: { cursor: `crosshair` } }, {}],
    [`move`, { ...base_region, hover_style: { cursor: `move` } }, {}],
    [`not-allowed`, { ...base_region, hover_style: { cursor: `not-allowed` } }, {}],
    [`default`, base_region, {}], // no click, no hover_style
  ])(`cursor is '%s'`, (expected, region, extra) => {
    mount(FillArea, { target: document.body, props: make_props({ region, ...extra }) })
    expect(doc_query(`.fill-region`).style.cursor).toBe(expected)
  })

  test(`keyboard Enter triggers click handler`, async () => {
    const on_click = vi.fn()
    mount(FillArea, { target: document.body, props: make_props({ on_click }) })

    doc_query(`.fill-region`).dispatchEvent(
      new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }),
    )
    await tick()

    expect(on_click).toHaveBeenCalled()
  })

  test.each<[string, Record<string, unknown>, string]>([
    [`-1 without on_click`, {}, `-1`],
    [`0 with on_click`, { on_click: () => {} }, `0`],
  ])(`tabindex is %s`, (_, extra, expected) => {
    mount(FillArea, { target: document.body, props: make_props(extra) })
    expect(doc_query(`.fill-region`).getAttribute(`tabindex`)).toBe(expected)
  })

  test.each<[string, FillRegion, number, string]>([
    [`uses label when provided`, base_region, 0, `Test Fill Region`],
    [`falls back to index`, { ...base_region, label: undefined }, 5, `Fill region 5`],
  ])(`aria-label %s`, (_, region, region_idx, expected) => {
    mount(FillArea, { target: document.body, props: make_props({ region, region_idx }) })
    expect(doc_query(`.fill-region`).getAttribute(`aria-label`)).toBe(expected)
  })
})
