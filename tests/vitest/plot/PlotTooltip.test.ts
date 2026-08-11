import { PlotTooltip } from '$lib/plot'
import { color as d3_color } from 'd3-color'
import { createRawSnippet, flushSync, mount, type ComponentProps } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

const make_children = (text: string = `Test`) =>
  createRawSnippet(() => ({
    render: () => `<span>${text}</span>`,
  }))

const mount_tooltip = (
  props: Partial<ComponentProps<typeof PlotTooltip>> & {
    children?: ReturnType<typeof make_children>
  } = {},
): HTMLElement => {
  mount(PlotTooltip, {
    target: document.body,
    props: { x: 0, y: 0, children: make_children(), ...props },
  })
  flushSync()
  return doc_query(`.plot-tooltip`)
}

describe(`PlotTooltip`, () => {
  test(`renders with default offset, absolute position, and nowrap chips`, () => {
    const tooltip = mount_tooltip({ x: 100, y: 200, children: make_children(`Test content`) })
    expect(tooltip.style.left).toBe(`106px`) // 100 + default offset 6
    expect(tooltip.style.top).toBe(`200px`)
    expect(tooltip.style.position).toBe(`absolute`)
    expect(tooltip.style.pointerEvents).toBe(`none`)
    expect(tooltip.textContent).toBe(`Test content`)
    expect(tooltip.classList.contains(`plot-tooltip-wrap`)).toBe(false)
    expect(getComputedStyle(tooltip).whiteSpace).toBe(`nowrap`)
  })

  test(`applies custom offset`, () => {
    const tooltip = mount_tooltip({ x: 50, y: 75, offset: { x: 10, y: -10 } })
    expect(tooltip.style.left).toBe(`60px`)
    expect(tooltip.style.top).toBe(`65px`)
  })

  // Contrast ratios are covered in colors.test.ts; here only the wiring + null skip.
  test.each([
    [`#000000`, `white`, `rgb(0, 0, 0)`, `rgb(255, 255, 255)`],
    [`#4fc3f7`, `black`, `rgb(79, 195, 247)`, `rgb(0, 0, 0)`],
    [null, ``, ``, ``],
  ])(`sets background %s and contrasting text %s`, (bg, _text, expected_bg, expected_text) => {
    const tooltip = mount_tooltip({ bg_color: bg })
    expect(d3_color(tooltip.style.backgroundColor)?.formatRgb() ?? ``).toBe(expected_bg)
    expect(d3_color(tooltip.style.color)?.formatRgb() ?? ``).toBe(expected_text)
  })

  test(`resolves CSS-variable backgrounds and reacts to token changes`, async () => {
    const tooltip = mount_tooltip({
      bg_color: `var(--series-color)`,
      style: `--series-color: white`,
    })
    await vi.waitFor(() => expect(tooltip.style.color).toBe(`black`))

    tooltip.style.setProperty(`--series-color`, `black`)
    await vi.waitFor(() => expect(tooltip.style.color).toBe(`white`))
  })

  test(`passes through class and style`, () => {
    const tooltip = mount_tooltip({
      class: `custom-tooltip my-class`,
      style: `z-index: 9999; backdrop-filter: blur(4px);`,
    })
    expect(tooltip.className).toContain(`plot-tooltip`)
    expect(tooltip.className).toContain(`custom-tooltip`)
    expect(tooltip.className).toContain(`my-class`)
    expect(tooltip.style.zIndex).toBe(`9999`)
  })

  // Position clamping is covered in layout.test.ts; this only checks wrap width = box - 16.
  test(`wraps inside a constrained width`, () => {
    const tooltip = mount_tooltip({
      constrain_to: { width: 100, height: 300 },
      children: make_children(`a`.repeat(80)),
    })
    expect(tooltip.classList.contains(`plot-tooltip-wrap`)).toBe(true)
    expect(tooltip.style.maxWidth).toBe(`84px`)
    expect(getComputedStyle(tooltip).whiteSpace).toBe(`normal`)
  })

  test.each([
    { fixed: false, position: `absolute` },
    { fixed: true, position: `fixed` },
  ])(`preserves $position placement without exclusions`, ({ fixed, position }) => {
    const tooltip = mount_tooltip({
      x: 50,
      y: 40,
      fixed,
      offset: { x: -10, y: -5 },
    })
    expect(tooltip.style.position).toBe(position)
    expect(tooltip.style.left).toBe(`40px`)
    expect(tooltip.style.top).toBe(`35px`)
  })

  test(`uses fallback size for decoration-aware placement before measurement`, () => {
    const tooltip = mount_tooltip({
      x: 50,
      y: 50,
      offset: { x: 0, y: 0 },
      constrain_to: { width: 100, height: 100 },
      fallback_size: { width: 20, height: 10 },
      exclusion_rects: [{ x: 50, y: 50, width: 20, height: 10 }],
    })
    expect(tooltip.style.position).toBe(`absolute`)
    expect(tooltip.style.left).toBe(`50px`)
    expect(tooltip.style.top).toBe(`40px`)
  })

  test(`uses fallback size for constrained placement before measurement`, () => {
    const tooltip = mount_tooltip({
      x: 95,
      y: 50,
      constrain_to: { width: 100, height: 100 },
      fallback_size: { width: 30, height: 20 },
    })
    expect(tooltip.style.left).toBe(`59px`)
    expect(tooltip.style.top).toBe(`50px`)
  })

  test(`prefers measured size over fallback size`, () => {
    const width_spy = vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(40)
    const height_spy = vi
      .spyOn(HTMLElement.prototype, `offsetHeight`, `get`)
      .mockReturnValue(20)
    try {
      const tooltip = mount_tooltip({
        x: 75,
        y: 50,
        offset: { x: 0, y: 0 },
        constrain_to: { width: 100, height: 100 },
        fallback_size: { width: 10, height: 10 },
        exclusion_rects: [],
      })
      flushSync()
      expect(tooltip.style.left).toBe(`35px`)
      expect(tooltip.style.top).toBe(`50px`)
    } finally {
      width_spy.mockRestore()
      height_spy.mockRestore()
    }
  })

  test(`keeps decoration-aware placement fixed when requested`, () => {
    const tooltip = mount_tooltip({
      x: 95,
      y: 50,
      fixed: true,
      offset: { x: 5, y: 5 },
      constrain_to: { width: 100, height: 100 },
      fallback_size: { width: 20, height: 10 },
      exclusion_rects: [],
    })
    expect(tooltip.style.position).toBe(`fixed`)
    expect(tooltip.style.left).toBe(`70px`)
    expect(tooltip.style.top).toBe(`55px`)
  })
})
