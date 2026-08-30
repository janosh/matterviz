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
  // not the component default (steelblue) so the explicit-fill test can tell them apart
  fill: `tomato`,
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
  // region, so N segments must not become N identical tab stops or N identical pattern tiles:
  // only the first emits the <defs>, the rest reference them through the shared defs_id.
  test.each([
    [`first segment`, true, `0`, null, 1],
    [`later segment`, false, `-1`, `true`, 0],
  ])(`a %s carries tabindex %s`, (_name, is_first_segment, tabindex, hidden, n_defs) => {
    document.body.innerHTML = ``
    mount(FillArea, {
      target: document.body,
      props: make_props({
        on_hover: () => {},
        is_first_segment,
        defs_id: `plot-fill-3`,
        region: { ...base_region, pattern: `/` },
      }),
    })
    const region = doc_query(`g.fill-region`)
    expect(region.getAttribute(`tabindex`)).toBe(tabindex)
    expect(region.getAttribute(`aria-hidden`)).toBe(hidden)
    expect(region.querySelectorAll(`defs pattern`)).toHaveLength(n_defs)
    expect(doc_query(`.fill-region > path`).getAttribute(`fill`)).toMatch(
      /^url\(#plot-fill-3-pat-[0-9a-z]+\)$/,
    )
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
    expect(path?.getAttribute(`fill`)).toBe(`tomato`)
    expect(path?.getAttribute(`fill-opacity`)).toBe(`0.3`)
  })

  test(`uses default fill when not specified`, () => {
    mount(FillArea, {
      target: document.body,
      props: make_props({ region: { ...base_region, fill: undefined } }),
    })
    expect(doc_query(`.fill-region path`).getAttribute(`fill`)).toBe(`steelblue`)
  })

  test(`pattern bakes the fill opacity into the tile so the texture stays legible`, () => {
    mount(FillArea, {
      target: document.body,
      props: make_props({
        region: {
          ...base_region,
          fill: `rgb(70, 130, 180)`,
          pattern: { shape: `x`, size: 6 },
        },
      }),
    })
    const group = doc_query(`.fill-region`)
    const def = group.querySelector(`defs pattern`)
    expect(def?.id).toMatch(/^fill-[0-9a-f-]+-pat-[0-9a-z]+$/)
    // the tile backdrop is the region color at the region's fill opacity and the mark is
    // painted at full opacity; the texture inherits currentColor over the translucent tint
    expect(def?.querySelector(`rect`)?.getAttribute(`fill`)).toBe(`rgba(70, 130, 180, 0.3)`)
    expect(def?.querySelector(`path`)?.getAttribute(`stroke`)).toBe(`currentColor`)
    expect(def?.getAttribute(`patternTransform`)).toBe(`rotate(45)`)
    const path = group.querySelector(`:scope > path`)
    expect(path?.getAttribute(`fill`)).toBe(`url(#${def?.id})`)
    expect(path?.getAttribute(`fill-opacity`)).toBe(`1`)
  })

  const gradient_fill: FillGradient = {
    type: `linear`,
    stops: [
      [0, `red`],
      [1, `blue`],
    ],
  }
  test.each([
    // a gradient has no single color to texture
    [gradient_fill, /^url\(#fill-[0-9a-f-]+-gradient\)$/, false],
    // a CSS variable cannot carry the opacity in the tile, so the mark keeps its 0.3
    [`var(--accent)`, /^url\(#fill-[0-9a-f-]+-pat-/, true],
  ])(`pattern with fill %j`, (fill, fill_attr, has_pattern) => {
    mount(FillArea, {
      target: document.body,
      props: make_props({ region: { ...base_region, fill, pattern: `/` } }),
    })
    const path = doc_query(`.fill-region > path`)
    expect(path.getAttribute(`fill`)).toMatch(fill_attr)
    expect(path.getAttribute(`fill-opacity`)).toBe(`0.3`)
    expect(document.querySelector(`pattern`) !== null).toBe(has_pattern)
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

  // Enter and Space activate like a button; any other key must not fire a click
  test.each([
    [`Enter`, 1],
    [` `, 1],
    [`a`, 0],
  ])(`keydown %j fires the click handler %i times`, async (key, n_calls) => {
    const on_click = vi.fn()
    document.body.innerHTML = ``
    mount(FillArea, { target: document.body, props: make_props({ on_click }) })

    doc_query(`.fill-region`).dispatchEvent(
      new KeyboardEvent(`keydown`, { key, bubbles: true }),
    )
    await tick()

    expect(on_click).toHaveBeenCalledTimes(n_calls)
    if (n_calls > 0) {
      expect(on_click).toHaveBeenCalledWith(
        expect.objectContaining({ region_idx: 0, region_id: `test-fill` }),
      )
    }
  })

  test.each<[string, FillRegion, number, string]>([
    [`uses label when provided`, base_region, 0, `Test Fill Region`],
    [`falls back to index`, { ...base_region, label: undefined }, 5, `Fill region 5`],
  ])(`aria-label %s`, (_, region, region_idx, expected) => {
    mount(FillArea, { target: document.body, props: make_props({ region, region_idx }) })
    expect(doc_query(`.fill-region`).getAttribute(`aria-label`)).toBe(expected)
  })
})
