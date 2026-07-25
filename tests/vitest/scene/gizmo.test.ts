import { responsive_gizmo_size } from '$lib/scene'
import { describe, expect, test } from 'vitest'

// The multi-view grid shrinks each pane's gizmo with the pane. This used to be asserted in
// Playwright by measuring the gizmo's DOM box, but the WebGPU gizmo draws inside the canvas
// and has no DOM element, so the sizing rule is covered here instead.
describe(`responsive_gizmo_size`, () => {
  // One fifth of the pane's short side, clamped to [34, 72] — so the linear region spans
  // short sides 170..360, with the clamps taking over on either side.
  test.each([
    // [width, height, expected, why]
    [1200, 900, 72, `above the cap clamps to the single-view size`],
    [400, 300, 60, `inside the linear region`],
    [250, 400, 50, `the shorter side wins regardless of orientation`],
    [400, 178, 36, `35.6 rounds up`],
    [400, 177, 35, `35.4 rounds down`],
    [200, 150, 34, `below the floor clamps up to stay legible`],
    [0, 0, 34, `pre-layout zero size still yields a usable gizmo`],
  ])(`(%i, %i) -> %i (%s)`, (width, height, expected) => {
    expect(responsive_gizmo_size(width, height)).toBe(expected)
  })

  // Covers the grid's actual requirement: a pane is a fraction of the viewer, so its gizmo
  // must never come out larger than the viewer's, at any size.
  test(`stays within bounds and never grows as the pane shrinks`, () => {
    let previous = Number.POSITIVE_INFINITY
    for (let side = 2000; side >= 0; side -= 25) {
      const size = responsive_gizmo_size(side, side)
      expect(size).toBeGreaterThanOrEqual(34)
      expect(size).toBeLessThanOrEqual(72)
      expect(size).toBeLessThanOrEqual(previous)
      previous = size
    }
  })
})
