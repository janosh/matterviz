import { Icon, ICON_DATA } from '$lib'
import { mount } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import { svg_query } from './setup'

describe(`Icon`, () => {
  it.each([`Check`, `Cross`, `GitHub`] as const)(
    `renders %s icon from ICON_DATA`,
    (icon) => {
      mount(Icon, { target: document.body, props: { icon } })

      const svg = svg_query(`svg[role="img"]`)
      expect(svg.getAttribute(`viewBox`)).toBe(ICON_DATA[icon].viewBox)
      expect(svg.getAttribute(`fill`)).toBe(`currentColor`)
      expect(svg_query(`svg path`).getAttribute(`d`)).toBe(
        ICON_DATA[icon].path,
      )
    },
  )

  it(`renders custom path as d attribute`, () => {
    const custom_path = `M0 0 L10 10 L20 0 Z`
    mount(Icon, { target: document.body, props: { path: custom_path } })
    expect(svg_query(`svg path`).getAttribute(`d`)).toBe(custom_path)
  })

  it(`renders raw SVG markup when path starts with <`, () => {
    mount(Icon, { target: document.body, props: { path: `<circle cx="12" r="10" />` } })
    expect(svg_query(`svg circle`).getAttribute(`r`)).toBe(`10`)
  })

  it.each([
    [undefined, `0 0 24 24`],
    [`0 0 100 100`, `0 0 100 100`],
  ])(`viewBox=%s defaults to %s for custom paths`, (viewBox, expected) => {
    mount(Icon, { target: document.body, props: { path: `M0 0`, viewBox } })
    expect(svg_query(`svg`).getAttribute(`viewBox`)).toBe(expected)
  })

  it(`stroke prop sets fill=none`, () => {
    mount(Icon, { target: document.body, props: { path: `M0 0`, stroke: `red` } })

    const svg = svg_query(`svg`)
    expect(svg.getAttribute(`stroke`)).toBe(`red`)
    expect(svg.getAttribute(`fill`)).toBe(`none`)
  })

  it(`stroke icons from ICON_DATA render with fill=none`, () => {
    const [icon_name] = Object.entries(ICON_DATA).find(([, data]) => `stroke` in data) ??
      []
    if (!icon_name) return

    mount(Icon, {
      target: document.body,
      props: { icon: icon_name as keyof typeof ICON_DATA },
    })

    const svg = svg_query(`svg`)
    expect(svg.getAttribute(`fill`)).toBe(`none`)
    expect(svg.getAttribute(`stroke`)).toBe(`currentColor`)
  })

  it(`falls back to Alert for invalid icon`, () => {
    const console_error = vi.spyOn(console, `error`).mockImplementation(() => {})
    // @ts-expect-error testing invalid icon name
    mount(Icon, { target: document.body, props: { icon: `InvalidIcon` } })

    expect(svg_query(`svg`).getAttribute(`viewBox`)).toBe(
      ICON_DATA.Alert.viewBox,
    )
    expect(console_error).toHaveBeenCalledWith(`Icon 'InvalidIcon' not found`)
    console_error.mockRestore()
  })

  it(`falls back to Alert when no props provided`, () => {
    mount(Icon, { target: document.body, props: {} })
    expect(svg_query(`svg`).getAttribute(`viewBox`)).toBe(
      ICON_DATA.Alert.viewBox,
    )
  })

  it(`custom path takes precedence over icon`, () => {
    mount(Icon, { target: document.body, props: { icon: `Check`, path: `M5 5` } })
    expect(svg_query(`svg path`).getAttribute(`d`)).toBe(`M5 5`)
  })

  it(`passes through SVG attributes`, () => {
    mount(Icon, {
      target: document.body,
      props: { icon: `Check`, class: `custom`, 'data-testid': `icon` },
    })

    const svg = svg_query(`svg`)
    expect(svg.classList.contains(`custom`)).toBe(true)
    expect(svg.getAttribute(`data-testid`)).toBe(`icon`)
  })
})
