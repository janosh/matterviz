import PlotAxis from '$lib/plot/core/components/PlotAxis.svelte'
import { type ComponentProps, mount, tick } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'

// Plot geometry shared across cases: plot area is x∈[40,180], y∈[10,70]
const pad = { t: 10, b: 30, l: 40, r: 20 }
const width = 200
const height = 100
const plot_w = width - pad.l - pad.r // 140
const plot_h = height - pad.t - pad.b // 60
const place = (value: number): number => value // identity: data value === pixel

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

afterEach(() => document.body.replaceChildren())

describe(`PlotAxis`, () => {
  // Codifies the intentionally-normalized tick geometry shared by all plots (tick-mark coords +
  // label offset/anchor/baseline are identical across consumers now). Keyed by child selector;
  // `line` is the tick mark (grid is off by default, so it's the only <line> in the group).
  test.each([
    [
      `x`,
      {
        line: { y1: `0`, y2: `5` },
        text: { x: `0`, y: `8`, 'text-anchor': `middle`, 'dominant-baseline': `hanging` },
      },
    ],
    [
      `x2`,
      {
        line: { y1: `-5`, y2: `0` },
        text: { x: `0`, y: `-8`, 'text-anchor': `middle`, 'dominant-baseline': `auto` },
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

  test(`unit_on_first_tick appends unit only to the first tick`, async () => {
    const svg = await mount_axis({
      side: `y`,
      ticks: [50, 100],
      axis: { unit: `eV` },
      unit_on_first_tick: true,
    })
    const texts = svg.querySelectorAll(`g.tick text`)
    expect(texts[0]?.textContent).toContain(`eV`)
    expect(texts[1]?.textContent).not.toContain(`eV`)
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
      axis: { label: `Energy` },
      label_x: 20,
      label_y: 50,
    })
    const label = query(svg, `.axis-label.y-label`)
    expect(label.tagName.toLowerCase()).toBe(`text`)
    expect(label.closest(`foreignObject`)).toBeNull()
    expect(label.parentElement?.getAttribute(`transform`)).toBe(`rotate(-90, 20, 50)`)
  })

  // Regression guard: AxisLabel offsets its foreignObject by `-width/2` and sets its width to the
  // same value, so the (CSS-centered) label content always lands on label_x — even when PlotAxis
  // grows the container to plot_w (> the 200px default). A wider plot must NOT push the label
  // off-center; only label_x controls horizontal placement.
  test.each([
    [`narrow plot clamps container to the 200px default`, 200, 200],
    [`wide plot grows container to plot_w`, 600, 540], // plot_w = 600 - pad.l(40) - pad.r(20)
  ])(
    `x-axis label container stays centered on label_x (%s)`,
    async (_desc, plot_width, exp_w) => {
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
      expect(foreign_obj_w).toBe(exp_w)
      // container centered on label_x regardless of its width
      expect(foreign_obj_x + foreign_obj_w / 2).toBe(label_x)
    },
  )

  // Regression guard: x and x2 rotate their tick labels to opposite anchors.
  test.each([
    [`x`, `start`],
    [`x2`, `end`],
  ])(`%s rotated tick label anchors to %s`, async (side, anchor) => {
    const svg = await mount_axis({
      side,
      ticks: [50],
      axis: { tick: { label: { rotation: 45 } } },
    })
    const text = query(svg, `g.tick text`)
    expect(text.getAttribute(`text-anchor`)).toBe(anchor)
    expect(text.getAttribute(`transform`)).toContain(`rotate(45`)
  })
})
