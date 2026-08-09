import { pick_contrast_color, resolve_backdrop, resolve_css_color } from '$lib/colors'
import { flushSync } from 'svelte'
import { afterEach, expect, test } from 'vitest'

afterEach(() => {
  document.body.innerHTML = ``
  delete document.documentElement.dataset.theme
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const make_node = (css_var: string, value: string): HTMLElement => {
  const node = document.createElement(`div`)
  node.style.setProperty(css_var, value)
  document.body.append(node)
  return node
}

const observe = (resolve: () => { readonly current: string }) => {
  let current = ``
  const cleanup = $effect.root(() => {
    const color = resolve()
    $effect(() => {
      current = color.current
    })
  })
  flushSync()
  return {
    cleanup,
    get current() {
      return current
    },
  }
}

// The old one-shot DOM read left text at its previous contrast after a theme change.
test(`resolve_backdrop re-reads its token when the theme changes`, async () => {
  const node = make_node(`--page-bg`, `#000000`)
  const backdrop = observe(() => resolve_backdrop(() => node))
  const text_color = () =>
    pick_contrast_color({
      background: `transparent`,
      backdrop: backdrop.current,
    })
  expect(text_color()).toBe(`white`)

  node.style.setProperty(`--page-bg`, `#ffffff`)
  document.documentElement.dataset.theme = `light`
  await settle()
  flushSync()

  expect(text_color()).toBe(`black`)
  backdrop.cleanup()
})

test.each([
  [`unset token falls back`, `--page-bg`, ``, `white`],
  // a translucent token cannot serve as the opaque base for compositing
  [`translucent token falls back`, `--page-bg`, `rgba(0, 0, 0, 0.5)`, `white`],
  [`opaque token is used`, `--page-bg`, `#123456`, `#123456`],
])(`resolve_backdrop: %s`, (_desc, css_var, value, expected) => {
  const node = make_node(css_var, value)
  const backdrop = observe(() => resolve_backdrop(() => node))
  expect(backdrop.current).toBe(expected)
  backdrop.cleanup()
})

test.each([
  [`#123456`, `#123456`],
  [`rgba(255, 255, 255, 0.5)`, `#000000`],
  [`not-a-color`, `#000000`],
])(`resolve_backdrop override %s resolves to %s`, (override, expected) => {
  const node = make_node(`--page-bg`, `#000000`)
  const backdrop = observe(() => resolve_backdrop(() => node, { override: () => override }))
  expect(backdrop.current).toBe(expected)
  backdrop.cleanup()
})

// Fill tokens may be translucent even though backdrop tokens may not.
test(`resolve_css_color keeps translucent tokens`, () => {
  const node = make_node(`--tooltip-bg`, `rgba(0, 0, 0, 0.85)`)
  const fill = observe(() =>
    resolve_css_color(() => node, { css_var: `--tooltip-bg`, fallback: `white` }),
  )
  expect(fill.current).toBe(`rgba(0, 0, 0, 0.85)`)
  fill.cleanup()
})
