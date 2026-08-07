import { AXIS_LABEL_CONTAINER } from '$lib/plot/core/axis-utils'
import PlotAxis from '$lib/plot/core/components/PlotAxis.svelte'
import {
  AXIS_TITLE_OFFSET,
  AXIS_TITLE_WRAP_WIDTH,
  TICK_LABEL_HEIGHT,
} from '$lib/plot/core/layout'
import { get_text_metrics_revision } from '$lib/plot/core/text-metrics'
import { type ComponentProps, mount, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mock_text_measurement } from '../setup'

// Plot geometry shared across cases: plot area is x∈[40,180], y∈[10,70]
const pad = { t: 10, b: 30, l: 40, r: 20 }
const width = 200
const height = 100
const plot_w = width - pad.l - pad.r // 140
const plot_h = height - pad.t - pad.b // 60
const place = (value: number): number => value // identity: data value === pixel
const fonts_descriptor = Object.getOwnPropertyDescriptor(document, `fonts`)
const set_fonts_ready = (ready: Promise<unknown>): void => {
  Object.defineProperty(document, `fonts`, { configurable: true, value: { ready } })
}

type Side = `x` | `x2` | `y` | `y2`

const mount_axis = async (props: Record<string, unknown>): Promise<SVGElement> => {
  const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`)
  document.body.replaceChildren(svg)
  const all_props = { pad, width, height, place, ...props } as ComponentProps<typeof PlotAxis>
  mount(PlotAxis, { target: svg, props: all_props })
  await tick()
  return svg
}

const query = (root: Element, selector: string): Element => {
  const el = root.querySelector(selector)
  if (!el) throw new Error(`missing element: ${selector}`)
  return el
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  if (fonts_descriptor) Object.defineProperty(document, `fonts`, fonts_descriptor)
  else Reflect.deleteProperty(document, `fonts`)
})

describe(`PlotAxis`, () => {
  test(`invalidates text metrics for each font readiness cycle`, async () => {
    for (let cycle_idx = 0; cycle_idx < 2; cycle_idx++) {
      const cycle = Promise.withResolvers<undefined>()
      set_fonts_ready(cycle.promise)
      const revision = get_text_metrics_revision()
      await mount_axis({ side: `x`, ticks: [50] })
      expect(get_text_metrics_revision()).toBe(revision)
      cycle.resolve(undefined)
      await vi.waitFor(() => expect(get_text_metrics_revision()).toBeGreaterThan(revision))
    }
  })

  // Codifies the intentionally-normalized tick geometry shared by all plots (tick-mark coords +
  // label offset/anchor/baseline are identical across consumers now). Keyed by child selector;
  // `line` is the tick mark (grid is off by default, so it's the only <line> in the group).
  test.each([
    [
      `x`,
      {
        line: { y1: `0`, y2: `5` },
        text: { x: `0`, y: `12`, 'text-anchor': `middle`, 'dominant-baseline': `hanging` },
      },
    ],
    [
      `x2`,
      {
        line: { y1: `-5`, y2: `0` },
        text: { x: `0`, y: `-12`, 'text-anchor': `middle`, 'dominant-baseline': `auto` },
      },
    ],
    [
      `y`,
      {
        line: { x1: `-5`, x2: `0` },
        text: { x: `-8`, y: `0`, 'text-anchor': `end`, 'dominant-baseline': `central` },
      },
    ],
    [
      `y2`,
      {
        line: { x1: `0`, x2: `5` },
        text: { x: `8`, y: `0`, 'text-anchor': `start`, 'dominant-baseline': `central` },
      },
    ],
  ] as [Side, Record<string, Record<string, string>>][])(
    `%s axis: normalized tick mark + label geometry`,
    async (side, expected) => {
      const svg = await mount_axis({ side, ticks: [50, 100] })
      const ticks = query(svg, `g.${side}-axis`).querySelectorAll(`g.tick`)
      expect(ticks).toHaveLength(2)
      for (const [selector, attrs] of Object.entries(expected)) {
        const el = query(ticks[0], selector)
        for (const [attr, value] of Object.entries(attrs)) {
          expect(el.getAttribute(attr)).toBe(value)
        }
      }
    },
  )

  test.each([`x`, `x2`, `y`, `y2`] as Side[])(
    `%s axis: baseline spine toggles`,
    async (side) => {
      const with_spine = await mount_axis({ side, ticks: [50] })
      expect(query(with_spine, `g.${side}-axis`).querySelector(`:scope > line`)).not.toBeNull()

      const without = await mount_axis({ side, ticks: [50], show_baseline: false })
      expect(query(without, `g.${side}-axis`).querySelector(`:scope > line`)).toBeNull()
    },
  )

  test.each([
    [`x`, { y1: `-60`, y2: `0` }],
    [`x2`, { y1: `0`, y2: `${plot_h}` }],
    [`y`, { x1: `0`, x2: `${plot_w}` }],
    [`y2`, { x1: `${-plot_w}`, x2: `0` }],
  ])(`%s axis: grid line spans plot when show_grid`, async (side, expected) => {
    const svg = await mount_axis({ side, ticks: [50], show_grid: true })
    const lines = query(svg, `g.tick`).querySelectorAll(`line`)
    expect(lines).toHaveLength(2) // grid + tick mark
    const grid = lines[0] // grid rendered before the tick mark
    expect(grid.getAttribute(`stroke-dasharray`)).toBe(`4`) // from DEFAULT_GRID_STYLE
    expect(grid.getAttribute(`stroke-width`)).toBe(`0.5`) // thin grid lines by default
    for (const [attr, value] of Object.entries(expected)) {
      expect(grid.getAttribute(attr)).toBe(value)
    }
  })

  test(`inside labels flip anchor/baseline and tick-mark direction`, async () => {
    const svg = await mount_axis({
      side: `y`,
      ticks: [50],
      axis: { tick: { label: { inside: true } } },
    })
    const tick_group = query(svg, `g.tick`)
    const text = query(tick_group, `text`)
    const mark = query(tick_group, `line`)
    expect(text.getAttribute(`text-anchor`)).toBe(`start`)
    expect(text.getAttribute(`x`)).toBe(`8`)
    expect(mark.getAttribute(`x1`)).toBe(`0`)
    expect(mark.getAttribute(`x2`)).toBe(`5`)
  })

  // `domain` culls ticks whose pixel pos is off-plot and hides labels for in-plot ticks outside the
  // data domain (x pixel range is [40,180]: 250 is off-plot -> culled; 150 is on-plot but outside
  // [0,120] -> tick without label). Without `domain`, every finite tick renders with its label.
  test.each([
    [
      `domain culls off-plot ticks, hides out-of-domain labels`,
      { ticks: [50, 100, 150, 250], domain: [0, 120] },
      3,
      2,
    ],
    [`no domain -> all finite ticks render with labels`, { ticks: [50, 100, 250] }, 3, 3],
  ] as [string, Record<string, unknown>, number, number][])(
    `%s`,
    async (_desc, props, n_ticks, n_labels) => {
      const svg = await mount_axis({ side: `x`, ...props })
      expect(svg.querySelectorAll(`g.tick`)).toHaveLength(n_ticks)
      expect(svg.querySelectorAll(`g.tick text`)).toHaveLength(n_labels)
    },
  )

  test(`unit_on_first_tick appends unit to the first actually rendered label`, async () => {
    const svg = await mount_axis({
      side: `y`,
      ticks: [20, 50],
      axis: { unit: `eV` },
      unit_on_first_tick: true,
      domain: [30, 60],
    })
    const texts = svg.querySelectorAll(`g.tick text`)
    expect(texts).toHaveLength(1)
    expect(texts[0]?.textContent).toContain(`eV`)
    expect(texts[0]?.getAttribute(`aria-label`)).toBe(`50 eV`)
  })

  test(`non-finite projected ticks stay hidden with aligned accessible labels`, async () => {
    const svg = await mount_axis({
      side: `x`,
      ticks: [40, 60, 80, 100],
      place: (value: number) =>
        value === 60 ? Number.NaN : value === 80 ? Number.POSITIVE_INFINITY : value,
      tick_label: (value: number) => `tick-${value}`,
    })

    const tick_groups = svg.querySelectorAll(`g.tick`)
    const texts = svg.querySelectorAll(`g.tick text`)
    expect(tick_groups).toHaveLength(2)
    expect([...texts].map((text) => text.getAttribute(`aria-label`))).toEqual([
      `tick-40`,
      `tick-100`,
    ])
  })

  test(`tick_label overrides the formatted value`, async () => {
    const svg = await mount_axis({
      side: `x`,
      ticks: [0, 1],
      tick_label: (value: number) => [`α`, `β`][value] ?? null,
    })
    const texts = [...svg.querySelectorAll(`g.tick text`)].map((node) =>
      node.textContent?.trim(),
    )
    expect(texts).toEqual([`α`, `β`])
  })

  test(`AxisLabel renders only with a label and coordinates`, async () => {
    const with_label = await mount_axis({
      side: `x`,
      ticks: [50],
      axis: { label: `Energy` },
      label_x: 100,
      label_y: 50,
    })
    expect(with_label.querySelector(`.axis-label.x-label`)).not.toBeNull()

    const no_coords = await mount_axis({ side: `x`, ticks: [50], axis: { label: `Energy` } })
    expect(no_coords.querySelector(`.axis-label`)).toBeNull()
  })

  test(`renders static rotated y-axis label as SVG text`, async () => {
    const svg = await mount_axis({
      side: `y`,
      ticks: [50],
      axis: { label: `Energy\nper atom` },
      label_x: 20,
      label_y: 50,
    })
    const label = query(svg, `.axis-label.y-label`)
    expect(label.tagName.toLowerCase()).toBe(`text`)
    expect(label.closest(`foreignObject`)).toBeNull()
    expect(label.parentElement?.getAttribute(`transform`)).toBe(`rotate(-90, 20, 50)`)
    expect([...label.children].map(({ textContent }) => textContent?.trim())).toEqual([
      `Energy`,
      `per atom`,
    ])
  })

  // Spans the wrap budget and stays centered on label_x. Hugging the measured text instead
  // made the box narrower than the rendered glyphs, so the browser re-wrapped a title that
  // fits — "Model" rendered as "Mod"/"el".
  test.each([
    [`narrow plot`, 200],
    [`wide plot`, 600],
  ])(`x-axis label container stays centered on label_x (%s)`, async (_desc, plot_width) => {
    mock_text_measurement()
    const label_x = 123
    const svg = await mount_axis({
      side: `x`,
      ticks: [50],
      axis: { label: `Energy` },
      label_x,
      label_y: 50,
      width: plot_width,
    })
    const foreign_obj = query(svg, `.x-axis foreignObject`)
    const foreign_obj_x = Number(foreign_obj.getAttribute(`x`))
    const foreign_obj_w = Number(foreign_obj.getAttribute(`width`))
    expect(foreign_obj_w).toBe(Math.max(plot_width - pad.l - pad.r, AXIS_TITLE_WRAP_WIDTH))
    expect(foreign_obj_x + foreign_obj_w / 2).toBe(label_x)
  })

  test.each([
    [`x`, `foreignObject`],
    [`y`, `text`],
  ] as const)(`long %s axis title wraps in a measured block`, async (side, tag) => {
    mock_text_measurement()
    const svg = await mount_axis({
      side,
      ticks: [50],
      axis: {
        label: `Formation energy per atom with a deliberately descriptive scientific title`,
      },
      label_x: 100,
      label_y: 50,
    })
    const label = query(svg, `.axis-label.${side}-label`)
    expect(label.closest(tag)).not.toBeNull()
    if (side === `x`) {
      const lines = label.querySelectorAll(`.static-label > span`).length
      expect(lines).toBeGreaterThan(1)
      expect(Number(query(svg, `foreignObject`).getAttribute(`height`))).toBe(lines * 20)
    } else {
      expect(label.querySelectorAll(`tspan`).length).toBeGreaterThan(1)
    }
  })

  test(`interactive title foreignObject fits the closed selected trigger`, async () => {
    mock_text_measurement()
    const svg = await mount_axis({
      side: `x`,
      ticks: [50],
      axis: {
        options: [
          { key: `energy`, label: `Energy`, unit: `eV` },
          { key: `volume`, label: `Long volume property`, unit: `Å³` },
        ],
        selected_key: `volume`,
      },
      label_x: 100,
      label_y: 50,
    })
    const trigger = query(svg, `.axis-trigger`)
    const foreign_obj = query(svg, `foreignObject`)

    expect(trigger.textContent).toContain(`Long volume property (Å³)`)
    expect(Number(foreign_obj.getAttribute(`width`))).toBeGreaterThan(
      `Long volume property (Å³)`.length * 7,
    )
    expect(Number(foreign_obj.getAttribute(`height`))).toBe(AXIS_LABEL_CONTAINER.height)
  })

  // Regression guard: x and x2 rotate their tick labels to opposite anchors.
  test.each([
    [`x`, `start`],
    [`x2`, `end`],
  ])(`%s rotated tick label anchors to %s`, async (side, anchor) => {
    const svg = await mount_axis({
      side,
      ticks: [100],
      axis: { tick: { label: { rotation: 45 } } },
    })
    const text = query(svg, `g.tick text`)
    expect(text.getAttribute(`text-anchor`)).toBe(anchor)
    expect(text.getAttribute(`transform`)).toContain(`rotate(45`)
  })

  // Long names at 20px pitch, wide enough (once text is measurable) to always auto-rotate
  const cats = [`QUEUE_HOLD`, `PENDING`, `RUNNING`, `COMPLETED`, `CANCELLED`]
  const mount_measured_axis = (props: Record<string, unknown>): Promise<SVGElement> => {
    mock_text_measurement()
    return mount_axis({
      ticks: cats.map((_cat, idx) => 50 + idx * 20),
      tick_label: (value: number) => cats[(value - 50) / 20] ?? null,
      ...props,
    })
  }

  test.each([
    [`x`, false, -1],
    [`x`, true, 1],
    [`x2`, false, 1],
    [`x2`, true, -1],
  ] as const)(`auto-rotated %s labels (inside=%s) trail left`, async (side, inside, sign) => {
    const svg = await mount_measured_axis({
      side,
      axis: {
        tick: {
          label: { inside, auto_layout: { strategies: [`rotate`] } },
        },
      },
    })
    const text = query(svg, `g.tick:nth-of-type(3) text`)
    const transform = text.getAttribute(`transform`) ?? ``
    const degrees = Number(/rotate\((?<deg>[-\d.]+),/.exec(transform)?.groups?.deg)
    expect(Math.sign(degrees)).toBe(sign)
    expect(text.getAttribute(`text-anchor`)).toBe(`end`)
  })

  test.each([
    [`x`, [`0`, `${TICK_LABEL_HEIGHT}`]],
    [`x2`, [`${-TICK_LABEL_HEIGHT}`, `${TICK_LABEL_HEIGHT}`]],
  ] as const)(`%s axis wraps a long semantic label upright`, async (side, expected_dy) => {
    const labels = [`PENDING`, `CANCELLED by 2054`]
    const svg = await mount_measured_axis({
      side,
      ticks: [50, 150],
      tick_label: (value: number) => labels[value === 50 ? 0 : 1],
      axis: { tick: { label: { auto_layout: { strategies: [`wrap`] } } } },
    })
    const texts = svg.querySelectorAll(`g.tick text`)
    expect(texts).toHaveLength(2)
    expect(svg.querySelectorAll(`g.tick > line`)).toHaveLength(2)
    expect(texts[1].getAttribute(`transform`)).toBeNull()
    expect(texts[1].getAttribute(`text-anchor`)).toBe(`middle`)
    expect(texts[1].getAttribute(`aria-label`)).toBe(`CANCELLED by 2054`)
    const lines = texts[1].querySelectorAll(`tspan`)
    expect([...lines].map((line) => line.textContent?.trim())).toEqual([
      `CANCELLED`,
      `by 2054`,
    ])
    expect([...lines].map((line) => line.getAttribute(`dy`))).toEqual(expected_dy)
    expect([...lines].map((line) => line.getAttribute(`x`))).toEqual([`0`, `0`])
    expect([...lines].map((line) => line.getAttribute(`aria-hidden`))).toEqual([
      `true`,
      `true`,
    ])
  })

  test(`adaptive thinning hides crowded labels but keeps their full text`, async () => {
    mock_text_measurement()
    const labels = [`Alpha label`, `Beta label`, `Gamma label`, `Delta label`]
    const svg = await mount_axis({
      side: `x`,
      ticks: [40, 75, 80, 180],
      tick_label: (value: number) => labels[[40, 75, 80, 180].indexOf(value)],
      axis: {
        tick: {
          label: {
            auto_layout: {
              strategies: [`thin`],
              min_visible_ticks: 2,
              endpoint_policy: `preserve`,
            },
          },
        },
      },
    })
    const texts = svg.querySelectorAll(`g.tick text`)
    expect(texts).toHaveLength(2)
    expect([...texts].map((text) => text.getAttribute(`aria-label`))).toEqual([
      `Alpha label`,
      `Delta label`,
    ])
  })

  test(`y-axis labels use the shared multiline layout`, async () => {
    mock_text_measurement()
    const svg = await mount_axis({
      side: `y`,
      ticks: [50],
      tick_label: () => `Formation Energy`,
      axis: {
        tick: {
          label: {
            max_lines: 2,
            auto_layout: { strategies: [`wrap`], max_band: 70 },
          },
        },
      },
    })
    const text = query(svg, `g.tick text`)
    expect(text.getAttribute(`aria-label`)).toBe(`Formation Energy`)
    expect([...text.querySelectorAll(`tspan`)].map((line) => line.textContent)).toEqual([
      `Formation`,
      `Energy`,
    ])
    expect([...text.querySelectorAll(`tspan`)].map((line) => line.getAttribute(`dy`))).toEqual(
      [`-8`, `16`],
    )
  })

  test(`edge labels anchor inward`, async () => {
    mock_text_measurement()
    const svg = await mount_axis({
      side: `x`,
      ticks: [0, width],
      tick_label: (value: number) => (value === 0 ? `Leading` : `Trailing`),
      axis: {
        tick: { label: { auto_layout: { strategies: [`upright`] } } },
      },
    })
    expect(
      [...svg.querySelectorAll(`g.tick text`)].map((text) => text.getAttribute(`text-anchor`)),
    ).toEqual([`start`, `end`])
  })

  test.each([
    [`x`, -1, `0`],
    [`x2`, 1, `${-2 * TICK_LABEL_HEIGHT}`],
  ] as const)(
    `%s axis stacks rotated wrapped lines away from its baseline`,
    async (side, rotation_sign, first_dy) => {
      const label = `ABCDEFGHIJK\nLMNOPQRSTUV\nWXYZABCDEFG`
      const svg = await mount_measured_axis({
        side,
        ticks: [40, 120, 200, 280],
        width: 380,
        tick_label: () => label,
        axis: {
          tick: { label: { rotation: rotation_sign * 45 } },
        },
      })
      const text = query(svg, `g.tick text`)
      const transform = text.getAttribute(`transform`) ?? ``
      expect(transform).toMatch(/^rotate\(/)
      const rotation = Number(/rotate\((?<degrees>[-\d.]+)/.exec(transform)?.groups?.degrees)
      expect(Math.sign(rotation)).toBe(rotation_sign)
      expect(Math.abs(rotation)).toBe(45)
      expect(text.querySelector(`tspan`)?.getAttribute(`dy`)).toBe(first_dy)
    },
  )

  test(`only outside tick labels push the x-axis title down`, async () => {
    const label_y = height - pad.b + AXIS_TITLE_OFFSET
    const title_y = async (inside: boolean): Promise<number> => {
      const svg = await mount_measured_axis({
        side: `x`,
        axis: {
          label: `state`,
          tick: {
            label: { inside, auto_layout: { strategies: [`rotate`] } },
          },
        },
        label_x: 100,
        label_y,
      })
      return (
        Number(query(svg, `foreignObject`).getAttribute(`y`)) +
        Number(query(svg, `foreignObject`).getAttribute(`height`)) / 2
      )
    }
    const [outside_title, inside_title] = [await title_y(false), await title_y(true)]
    expect(inside_title).toBe(label_y)
    expect(outside_title).toBeGreaterThan(label_y)
  })
})
