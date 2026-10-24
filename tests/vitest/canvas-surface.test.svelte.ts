import { create_canvas_surface } from '#lib/canvas-surface.svelte.js'
import { flushSync } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

// A minimal matchMedia that reports whether the queried ratio still matches the live one, and
// notifies its listeners when the live ratio changes. happy-dom has no implementation at all.
const install_match_media = () => {
  const listeners = new Set<{ ratio: number; fire: () => void }>()
  vi.stubGlobal(`matchMedia`, (query: string) => {
    const ratio = Number(/(?<dppx>[\d.]+)dppx/.exec(query)?.groups?.dppx)
    return {
      matches: ratio === globalThis.devicePixelRatio,
      addEventListener: (
        _type: string,
        handler: () => void,
        opts?: AddEventListenerOptions,
      ) => {
        const entry = { ratio, fire: handler }
        listeners.add(entry)
        opts?.signal?.addEventListener(`abort`, () => listeners.delete(entry))
      },
      removeEventListener: () => {},
    }
  })
  // every listener whose remembered ratio no longer matches gets notified, once
  return () => {
    for (const entry of listeners) {
      // deleting the current entry mid-iteration is safe on a Set
      if (entry.ratio === globalThis.devicePixelRatio) continue
      listeners.delete(entry)
      entry.fire()
    }
    return listeners.size
  }
}

const set_dpr = (value: number) =>
  Object.defineProperty(globalThis, `devicePixelRatio`, { value, configurable: true })

describe(`create_canvas_surface`, () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    set_dpr(1)
  })

  // Nothing reports a devicePixelRatio change: moving the window to a display of a different
  // DPI, or zooming the browser, leaves the CSS size identical, so the ResizeObserver never
  // fires. The canvas kept its old backing store and transform, rendering at half resolution
  // until an unrelated resize happened along.
  test(`resizes the backing store when the device pixel ratio changes`, () => {
    const change_dpr = install_match_media()
    set_dpr(1)
    const parent = document.createElement(`div`)
    Object.defineProperties(parent, {
      clientWidth: { value: 400, configurable: true },
      clientHeight: { value: 300, configurable: true },
    })
    const canvas = document.createElement(`canvas`)
    parent.append(canvas)
    document.body.append(parent)

    const cleanup = $effect.root(() => {
      create_canvas_surface({ canvas: () => canvas, draw: () => {}, repaint_deps: () => {} })
    })
    flushSync()
    expect(canvas.width).toBe(400) // dpr 1

    set_dpr(2)
    change_dpr()
    flushSync()
    expect(canvas.width).toBe(800) // followed the new ratio

    // and again, proving the watch re-arms rather than firing only once
    set_dpr(3)
    change_dpr()
    flushSync()
    expect(canvas.width).toBe(1200)

    cleanup()
    // teardown aborts the watch, so no listener survives to fire against a dead surface
    set_dpr(1)
    expect(change_dpr()).toBe(0)
    parent.remove()
  })

  // light -> white keeps the light scheme but darkens --text-color, so a text colour derived
  // from dark_mode alone kept drawing labels in the previous theme's ink
  test(`re-reads the text colour on a theme change that keeps the color scheme`, async () => {
    install_match_media()
    const canvas = document.createElement(`canvas`)
    canvas.style.color = `rgb(55, 65, 81)`
    document.body.append(canvas)
    let surface: ReturnType<typeof create_canvas_surface> | undefined
    const cleanup = $effect.root(() => {
      surface = create_canvas_surface({
        canvas: () => canvas,
        draw: () => {},
        repaint_deps: () => {},
      })
    })
    flushSync()
    expect(surface?.text_color).toBe(`rgb(55, 65, 81)`)

    canvas.style.color = `rgb(0, 0, 0)`
    document.documentElement.dataset.theme = `white`
    await new Promise((resolve) => setTimeout(resolve, 0)) // MutationObserver delivery
    flushSync()
    expect(surface?.text_color).toBe(`rgb(0, 0, 0)`)

    cleanup()
    canvas.remove()
    delete document.documentElement.dataset.theme
  })
})
