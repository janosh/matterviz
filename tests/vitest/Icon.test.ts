import { Icon, ICON_DATA } from '$lib'
import type { IconName } from '$lib/icons'
import { mount } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import { svg_query } from './setup'

describe(`Icon`, () => {
  it.each([`Check`, `Cross`, `GitHub`] as const)(`renders %s icon from ICON_DATA`, (icon) => {
    mount(Icon, { target: document.body, props: { icon } })

    const svg = svg_query(`svg[role="img"]`)
    expect(svg.getAttribute(`viewBox`)).toBe(ICON_DATA[icon].viewBox)
    expect(svg.getAttribute(`fill`)).toBe(`currentColor`)
    expect(svg_query(`svg path`).getAttribute(`d`)).toBe(ICON_DATA[icon].path)
  })

  it(`renders custom path as d attribute`, () => {
    const custom_path = `M0 0 L10 10 L20 0 Z`
    mount(Icon, { target: document.body, props: { path: custom_path } })
    expect(svg_query(`svg path`).getAttribute(`d`)).toBe(custom_path)
  })

  it(`treats the path prop as an escaped d attribute, never injecting markup`, () => {
    // the user-facing `path` prop is a path `d` string, never rendered via {@html}. SVG/HTML in it
    // can't inject nodes (no XSS, even during SSR) — it lands escaped inside <path d="…">.
    const injection = `<circle cx="12" r="10" /><script>alert(1)</script>`
    mount(Icon, { target: document.body, props: { path: injection } })
    expect(document.querySelector(`svg circle`)).toBeNull()
    expect(document.querySelector(`script`)).toBeNull()
    expect(svg_query(`svg path`).getAttribute(`d`)).toBe(injection)
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
    const [icon_name] = Object.entries(ICON_DATA).find(([, data]) => `stroke` in data) ?? []
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
    // @ts-expect-error intentionally testing invalid icon fallback
    const props: { icon: IconName } = { icon: `InvalidIcon` }
    mount(Icon, { target: document.body, props })

    expect(svg_query(`svg`).getAttribute(`viewBox`)).toBe(ICON_DATA.Alert.viewBox)
    expect(console_error).toHaveBeenCalledWith(`Icon 'InvalidIcon' not found`)
    console_error.mockRestore()
  })

  it(`falls back to Alert when no props provided`, () => {
    mount(Icon, { target: document.body, props: {} })
    expect(svg_query(`svg`).getAttribute(`viewBox`)).toBe(ICON_DATA.Alert.viewBox)
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
