import { responsive_gizmo_size } from '$lib/scene'
import { describe, expect, test } from 'vitest'

// Multi-view panes shrink their gizmo with the pane. Playwright used to assert this off the
// gizmo's DOM box, but the WebGPU gizmo draws inside the canvas and has no element.
describe(`responsive_gizmo_size`, () => {
  // one fifth of the short side, clamped to [34, 72]
  test.each([
    [1200, 900, 72, `above the cap clamps to the single-view size`],
    [400, 300, 60, `inside the linear region`],
    [250, 400, 50, `the shorter side wins regardless of orientation`],
    [400, 178, 36, `rounds to whole px`],
    [200, 150, 34, `below the floor clamps up to stay legible`],
    [0, 0, 34, `pre-layout zero size still yields a usable gizmo`],
  ])(`(%i, %i) -> %i (%s)`, (width, height, expected) => {
    expect(responsive_gizmo_size(width, height)).toBe(expected)
  })

  test(`never grows as the pane shrinks`, () => {
    const sizes = Array.from({ length: 80 }, (_, idx) =>
      responsive_gizmo_size(idx * 25, idx * 25),
    )
    expect(sizes.every((size, idx) => idx === 0 || size >= sizes[idx - 1])).toBe(true)
  })
})
