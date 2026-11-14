import {
  resolve_backdrop,
  resolve_color_token,
  resolve_css_color,
} from '#lib/colors/backdrop.svelte.js'
import { flushSync } from 'svelte'
import { afterEach, expect, test, vi } from 'vite-plus/test'

let roots: (() => void)[] = []

afterEach(() => {
  roots.forEach((cleanup) => cleanup())
  roots = []
  document.body.innerHTML = ``
  delete document.documentElement.dataset.theme
  document.documentElement.removeAttribute(`style`)
  vi.restoreAllMocks() // even when an assertion threw mid-test
})

// Let the observer/storage callback land, then flush the effect it invalidated
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  flushSync()
}

const make_node = (css_var?: string, value = ``): HTMLElement => {
  const node = document.createElement(`div`)
  if (css_var) node.style.setProperty(css_var, value)
  document.body.append(node)
  return node
}

// An effect root, so the resolver's internal $effect runs and stays subscribed until cleanup.
// The resolver object itself is returned, so assertions read the live value rather than a copy.
const observe = <Color extends { readonly current: string }>(resolve: () => Color): Color => {
  let color: Color | undefined
  roots.push($effect.root(() => void (color = resolve())))
  flushSync()
  if (!color) throw new Error(`resolver did not run`)
  return color
}

// The old one-shot DOM read left text at its previous contrast after a theme change.
test(`resolve_backdrop re-reads its token when the theme changes`, async () => {
  const node = make_node(`--page-bg`, `#000000`)
  const backdrop = observe(() => resolve_backdrop(() => node))
  expect(backdrop.current).toBe(`#000000`)

  node.style.setProperty(`--page-bg`, `#ffffff`)
  document.documentElement.dataset.theme = `light`
  await settle()

  expect(backdrop.current).toBe(`#ffffff`)
})

// Layout writes on an ancestor (a sidebar width, a toolbar's inline size) must not make every
// color read below re-run getComputedStyle; a real theme change re-reads each once
test(`ancestor layout writes trigger no color re-reads, a theme change one per resolver`, async () => {
  const child_of = (parent: HTMLElement): HTMLElement => {
    const child = document.createElement(`div`)
    parent.append(child)
    return child
  }
  let parent: HTMLElement = document.body
  for (let depth = 0; depth < 8; depth++) parent = child_of(parent)
  const nodes = Array.from({ length: 20 }, () => child_of(parent))
  for (const node of nodes) observe(() => resolve_backdrop(() => node))
  const reads = vi.spyOn(globalThis, `getComputedStyle`)
  const ancestor = parent.parentElement ?? parent
  for (let step = 0; step < 50; step++) {
    ancestor.style.setProperty(`--docked-sidebar-width`, `${step}px`)
    ancestor.style.left = `${step}px`
  }
  await settle()
  expect(reads).not.toHaveBeenCalled()
  document.documentElement.dataset.theme = `dark`
  await settle()
  expect(reads.mock.calls.length).toBeGreaterThanOrEqual(nodes.length)
  expect(reads.mock.calls.length).toBeLessThanOrEqual(2 * nodes.length) // token + probe each
})

// The ancestor observer only sees the node's own attribute mutations. Watching the theme
// separately is what catches the root's color-scheme flipping (apply_theme_to_dom, another tab's
// saved preference, an OS dark-mode change), and a function fallback is how PeriodicTable's
// tooltip re-resolves its light-dark() default.
test(`theme-dependent fallback re-resolves when the root scheme changes`, async () => {
  const node = make_node() // no token, so the fallback supplies the color
  let theme_color = `#000000`
  const backdrop = observe(() => resolve_backdrop(() => node, { fallback: () => theme_color }))
  expect(backdrop.current).toBe(`#000000`)

  theme_color = `#ffffff`
  document.documentElement.style.colorScheme = `dark`
  await settle()

  expect(backdrop.current).toBe(`#ffffff`)
})

test.each([
  [`unset token falls back`, ``, `white`],
  // a translucent token cannot serve as the opaque base for compositing
  [`translucent token falls back`, `rgba(0, 0, 0, 0.5)`, `white`],
  [`opaque token is used`, `#123456`, `#123456`],
])(`resolve_backdrop: %s`, (_desc, value, expected) => {
  const node = make_node(`--page-bg`, value)
  const backdrop = observe(() => resolve_backdrop(() => node))
  expect(backdrop.current).toBe(expected)
})

// Color-function tokens like light-dark() compute to that literal string, which only the browser
// resolves. happy-dom can't, so a var() value and a stubbed probe style stand in for it.
test(`resolve_color_token resolves color functions on a removed probe and passes colors through`, () => {
  const node = make_node()
  const real = globalThis.getComputedStyle
  vi.spyOn(globalThis, `getComputedStyle`).mockImplementation((element) =>
    element.tagName === `SPAN`
      ? ({ color: `rgb(24, 23, 28)` } as CSSStyleDeclaration)
      : real(element),
  )
  expect(resolve_color_token(node, `var(--surface)`)).toBe(`rgb(24, 23, 28)`)
  expect(node.querySelector(`span`)).toBeNull()
  expect(resolve_color_token(node, `#123456`)).toBe(`#123456`)
  expect(resolve_color_token(node, `light-dark(#fff, #000)`)).toBe(`light-dark(#fff, #000)`)
})

test.each([
  [`#123456`, `#123456`],
  [`rgba(255, 255, 255, 0.5)`, `#000000`],
  [`not-a-color`, `#000000`],
])(`resolve_backdrop override %s resolves to %s`, (override, expected) => {
  const node = make_node(`--page-bg`, `#000000`)
  const backdrop = observe(() => resolve_backdrop(() => node, { override: () => override }))
  expect(backdrop.current).toBe(expected)
})

// Fill tokens may be translucent even though backdrop tokens may not.
test(`resolve_css_color keeps translucent tokens`, () => {
  const node = make_node(`--plot-tooltip-bg`, `rgba(0, 0, 0, 0.85)`)
  const fill = observe(() =>
    resolve_css_color(() => node, { css_var: `--plot-tooltip-bg`, fallback: `white` }),
  )
  expect(fill.current).toBe(`rgba(0, 0, 0, 0.85)`)
})
