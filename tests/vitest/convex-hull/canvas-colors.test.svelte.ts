import { create_canvas_text_color } from '$lib/convex-hull/canvas-colors.svelte'
import { flushSync, tick } from 'svelte'
import { afterEach, expect, test } from 'vitest'

afterEach(() => {
  delete document.documentElement.dataset.theme
})

// Canvas takes a colour value, not a CSS variable, so the hull renderers have to repaint
// themselves on a theme flip rather than letting the cascade do it.
test(`create_canvas_text_color follows dark mode`, async () => {
  let text_color: { readonly current: string } | undefined
  const dispose = $effect.root(() => {
    text_color = create_canvas_text_color()
  })
  flushSync()
  expect(text_color?.current).toBe(`#212121`)

  document.documentElement.dataset.theme = `dark`
  await tick() // watch_dark_mode reports via MutationObserver, so not synchronously
  expect(text_color?.current).toBe(`#ffffff`)
  dispose()
})
