import { create_canvas_colors } from '$lib/convex-hull/canvas-colors.svelte'
import { flushSync, tick } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'

const make_canvas = (edge: string): HTMLCanvasElement => {
  const canvas = document.createElement(`canvas`)
  canvas.style.setProperty(`--hull-edge-color`, edge)
  document.body.append(canvas)
  return canvas
}

afterEach(() => {
  document.body.innerHTML = ``
  delete document.documentElement.dataset.theme
})

describe(`create_canvas_colors`, () => {
  // `--hull-edge-color` can only be read off a live element, so a renderer remount (WebGPU
  // context loss, say) hands over a new canvas and the colour has to be resolved again.
  test(`re-resolves the edge colour when the canvas element is replaced`, () => {
    let canvas = $state<HTMLCanvasElement>()
    let colors: ReturnType<typeof create_canvas_colors> | undefined
    const dispose = $effect.root(() => {
      colors = create_canvas_colors(() => canvas)
    })
    flushSync()
    expect(colors?.edge).toBe(``) // nothing to read from before the canvas mounts

    canvas = make_canvas(`#374151`)
    flushSync()
    expect(colors?.edge).toBe(`#374151`)

    canvas = make_canvas(`#abcdef`)
    flushSync()
    expect(colors?.edge).toBe(`#abcdef`)
    dispose()
  })

  test(`follows dark mode for the text colour`, async () => {
    let colors: ReturnType<typeof create_canvas_colors> | undefined
    const dispose = $effect.root(() => {
      colors = create_canvas_colors(() => undefined)
    })
    flushSync()
    expect(colors?.text).toBe(`#212121`)

    document.documentElement.dataset.theme = `dark`
    await tick() // watch_dark_mode reports via MutationObserver, so not synchronously
    expect(colors?.text).toBe(`#ffffff`)
    dispose()
  })
})
