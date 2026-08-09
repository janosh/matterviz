import { resolve_backdrop, resolve_css_color } from '$lib/colors'
import { THEME_STORAGE_KEY } from '$lib/theme'
import { flushSync } from 'svelte'
import { afterEach, expect, test } from 'vitest'

let roots: (() => void)[] = []

afterEach(() => {
  roots.forEach((cleanup) => cleanup())
  roots = []
  document.body.innerHTML = ``
  delete document.documentElement.dataset.theme
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const make_node = (css_var?: string, value = ``): HTMLElement => {
  const node = document.createElement(`div`)
  if (css_var) node.style.setProperty(css_var, value)
  document.body.append(node)
  return node
}

const observe = (resolve: () => { readonly current: string }) => {
  let current = ``
  roots.push(
    $effect.root(() => {
      const color = resolve()
      $effect(() => {
        current = color.current
      })
    }),
  )
  flushSync()
  return {
    get current() {
      return current
    },
  }
}

// The old one-shot DOM read left text at its previous contrast after a theme change.
test(`resolve_backdrop re-reads its token when the theme changes`, async () => {
  const node = make_node(`--page-bg`, `#000000`)
  const backdrop = observe(() => resolve_backdrop(() => node))
  expect(backdrop.current).toBe(`#000000`)

  node.style.setProperty(`--page-bg`, `#ffffff`)
  document.documentElement.dataset.theme = `light`
  await settle()
  flushSync()

  expect(backdrop.current).toBe(`#ffffff`)
})

// The ancestor observer only sees attribute mutations. Watching the theme separately is
// what catches a preference written by another tab or an OS-level dark mode flip, and a
// function fallback is how PeriodicTable's tooltip re-resolves its light-dark() default.
test(`theme-dependent fallback re-resolves without any attribute mutation`, async () => {
  const node = make_node() // no token, so the fallback supplies the color
  let theme_color = `#000000`
  const backdrop = observe(() => resolve_backdrop(() => node, { fallback: () => theme_color }))
  expect(backdrop.current).toBe(`#000000`)

  theme_color = `#ffffff`
  globalThis.dispatchEvent(new StorageEvent(`storage`, { key: THEME_STORAGE_KEY }))
  await settle()
  flushSync()

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
  const node = make_node(`--tooltip-bg`, `rgba(0, 0, 0, 0.85)`)
  const fill = observe(() =>
    resolve_css_color(() => node, { css_var: `--tooltip-bg`, fallback: `white` }),
  )
  expect(fill.current).toBe(`rgba(0, 0, 0, 0.85)`)
})
