import type { GizmoOptions } from '$lib/scene'
import { gizmo_rect, responsive_gizmo_size } from '$lib/scene'
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

// The rect is both the WebGPU viewport the gizmo renders into and the hit-test box for
// pointer events, so the two can only agree if this one function is right.
describe(`gizmo_rect`, () => {
  // oxfmt-ignore
  test.each([
    // unsized: 18% of the short side clamped to [70, 100], 5 px off the anchored edges
    [`default bottom-left on a wide canvas`, {}, 800, 600, { x: 5, y: 495, width: 100, height: 100 }],
    [`small canvas floors the box at 70`, {}, 200, 200, { x: 5, y: 125, width: 70, height: 70 }],
    [`top-right with custom offsets`, { placement: `top-right`, size: 60, offset: { right: 10, top: 20 } }, 800, 600, { x: 730, y: 20, width: 60, height: 60 }],
    [`bottom-right defaults the unset edges to 5`, { placement: `bottom-right`, size: 40, offset: { bottom: 30 } }, 300, 200, { x: 255, y: 130, width: 40, height: 40 }],
    [`top-left ignores right/bottom offsets`, { placement: `top-left`, size: 40, offset: { right: 99, bottom: 99 } }, 300, 200, { x: 5, y: 5, width: 40, height: 40 }],
    [`fill covers the whole canvas, square or not`, { placement: `fill`, size: 40, offset: { left: 9 } }, 300, 200, { x: 0, y: 0, width: 300, height: 200 }],
    // a viewport past the attachment fails WebGPU validation, so clamp instead of overflowing
    [`oversized request shrinks to the short side and pins to the bottom edge`, { size: 500 }, 120, 90, { x: 5, y: 0, width: 90, height: 90 }],
    [`canvas narrower than box + gap pins the left edge`, { placement: `bottom-right` }, 72, 200, { x: 0, y: 125, width: 70, height: 70 }],
    [`pre-layout zero canvas yields an empty rect at the origin`, {}, 0, 0, { x: 0, y: 0, width: 0, height: 0 }],
  ] as [string, GizmoOptions, number, number, ReturnType<typeof gizmo_rect>][])(
    `%s`,
    (_name, options, width, height, expected) => {
      expect(gizmo_rect(options, width, height)).toEqual(expected)
    },
  )

  test(`always stays inside the canvas`, () => {
    const placements = [`top-left`, `top-right`, `bottom-left`, `bottom-right`] as const
    for (const width of [0, 1, 30, 75, 120, 640]) {
      for (const height of [0, 1, 30, 75, 120, 480]) {
        for (const placement of placements) {
          for (const size of [undefined, 10, 70, 1000]) {
            const rect = gizmo_rect({ placement, size }, width, height)
            expect(rect.x).toBeGreaterThanOrEqual(0)
            expect(rect.y).toBeGreaterThanOrEqual(0)
            expect(rect.x + rect.width).toBeLessThanOrEqual(width)
            expect(rect.y + rect.height).toBeLessThanOrEqual(height)
            expect(rect.width).toBe(rect.height)
          }
        }
      }
    }
  })
})
