import { create_orthographic_zoom } from '$lib/scene'
import { flushSync } from 'svelte'
import { expect, test } from 'vitest'

// Shared by BrillouinZoneScene, FermiSurfaceScene and ScatterPlot3DScene, so a regression here
// hits three renderers at once — and both bugs this replaced lived in exactly this logic.
type ZoomInputs = { fit: number; measured: boolean; max: number }

const with_zoom = (
  run: (
    zoom: ReturnType<typeof create_orthographic_zoom>,
    set: (inputs: Partial<ZoomInputs>) => void,
  ) => void,
) => {
  const cleanup = $effect.root(() => {
    const inputs: ZoomInputs = $state({ fit: 100, measured: true, max: 500 })
    const zoom = create_orthographic_zoom({
      fit_zoom: () => inputs.fit,
      min_zoom: () => 10,
      max_zoom: () => inputs.max,
      measured: () => inputs.measured,
    })
    flushSync()
    run(zoom, (patch) => flushSync(() => Object.assign(inputs, patch)))
  })
  cleanup()
}

test(`zoom follows the fit, and a user zoom keeps its ratio across resizes`, () => {
  with_zoom((zoom, set) => {
    expect(zoom.zoom).toBe(100)
    // a resize with no user input just adopts the new fit
    set({ fit: 50 })
    expect(zoom.zoom).toBe(50)
    // the zoom the user landed on becomes the baseline the next resize rescales from
    zoom.zoom = 200
    set({ fit: 100 })
    expect(zoom.zoom).toBe(400)
    set({ fit: 50 })
    expect(zoom.zoom).toBe(200)
  })
})

test(`an unmeasured container freezes the zoom instead of rescaling against a placeholder`, () => {
  with_zoom((zoom, set) => {
    zoom.zoom = 300
    // a zero-size container reports a placeholder fit; rescaling then clamping would lose 300
    set({ measured: false, fit: 1 })
    expect(zoom.zoom).toBe(300)
    set({ measured: true, fit: 100 })
    expect(zoom.zoom).toBe(300)
  })
})

test(`bounds keep the fit reachable and re-clamp as soon as a limit moves`, () => {
  with_zoom((zoom, set) => {
    expect([zoom.min_zoom, zoom.max_zoom]).toEqual([10, 500])
    // a fit below the interaction floor lowers it, or the initial framing is unreachable
    set({ fit: 5 })
    expect(zoom.min_zoom).toBe(5)
    // lowering the ceiling clamps the live zoom now, not at the next gesture
    zoom.zoom = 400
    set({ max: 50 })
    expect(zoom.zoom).toBe(50)
  })
})
