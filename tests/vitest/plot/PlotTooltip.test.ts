import { PlotTooltip } from '$lib/plot'
import { createRawSnippet, mount, type ComponentProps } from 'svelte'
import { describe, expect, test } from 'vitest'
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

  test(`uses fixed positioning when fixed`, () => {
    expect(mount_tooltip({ fixed: true }).style.position).toBe(`fixed`)
  })

  // luminance() itself is covered in colors.test.ts; here only the wiring + null skip.
  test.each([
    { bg: `#000000`, text: `#ffffff` },
    { bg: `#ffff00`, text: `#000000` },
  ])(`sets background $bg and contrasting text $text`, ({ bg, text }) => {
    const tooltip = mount_tooltip({ bg_color: bg })
    expect(tooltip.style.backgroundColor).toBe(bg)
    expect(tooltip.style.color).toBe(text)
  })

  test(`does not set text color without bg_color`, () => {
    expect(mount_tooltip({ bg_color: null }).style.color).toBe(``)
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
})
