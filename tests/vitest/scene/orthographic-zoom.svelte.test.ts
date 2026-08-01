import { create_orthographic_zoom } from '$lib/scene'
import { flushSync } from 'svelte'
import { expect, test } from 'vitest'

// Shared by BrillouinZoneScene, FermiSurfaceScene and ScatterPlot3DScene, so a regression here
// hits three renderers at once — and both bugs this replaced lived in exactly this logic.
const with_zoom = (
  run: (ctx: {
    zoom: ReturnType<typeof create_orthographic_zoom>
    set_fit: (value: number) => void
    set_measured: (value: boolean) => void
    set_max: (value: number) => void
  }) => void,
) => {
  const cleanup = $effect.root(() => {
    let fit = $state(100)
    let measured = $state(true)
    let max = $state(500)
    const zoom = create_orthographic_zoom({
      fit_zoom: () => fit,
      min_zoom: () => 10,
      max_zoom: () => max,
      measured: () => measured,
    })
    flushSync()
    run({
      zoom,
      set_fit: (value) => flushSync(() => (fit = value)),
      set_measured: (value) => flushSync(() => (measured = value)),
      set_max: (value) => flushSync(() => (max = value)),
    })
  })
  cleanup()
}

test(`zoom follows the fit, and a user zoom keeps its ratio across resizes`, () => {
  with_zoom(({ zoom, set_fit }) => {
    expect(zoom.zoom).toBe(100)
    // a resize with no user input just adopts the new fit
    set_fit(50)
    expect(zoom.zoom).toBe(50)
    // the zoom the user landed on becomes the baseline the next resize rescales from
    zoom.zoom = 200
    set_fit(100)
    expect(zoom.zoom).toBe(400)
    set_fit(50)
    expect(zoom.zoom).toBe(200)
  })
})

test(`an unmeasured container freezes the zoom instead of rescaling against a placeholder`, () => {
  with_zoom(({ zoom, set_fit, set_measured }) => {
    zoom.zoom = 300
    set_measured(false)
    // a zero-size container reports a placeholder fit; rescaling then clamping would lose 300
    set_fit(1)
    expect(zoom.zoom).toBe(300)
    set_measured(true)
    set_fit(100)
    expect(zoom.zoom).toBe(300)
  })
})

test(`bounds keep the fit reachable and re-clamp as soon as a limit moves`, () => {
  with_zoom(({ zoom, set_fit, set_max }) => {
    expect([zoom.min_zoom, zoom.max_zoom]).toEqual([10, 500])
    // a fit below the interaction floor lowers it, or the initial framing is unreachable
    set_fit(5)
    expect(zoom.min_zoom).toBe(5)
    // lowering the ceiling clamps the live zoom now, not at the next gesture
    zoom.zoom = 400
    set_max(50)
    expect(zoom.zoom).toBe(50)
  })
})
