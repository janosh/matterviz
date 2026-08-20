import { bar_path, violin_path } from '$lib/plot/core/svg'
import { describe, expect, it } from 'vitest'

describe(`bar_path`, () => {
  it.each([
    [0, 0, 10, 20, 0, true, `M0,0h10v20h-10Z`],
    [5, 10, 20, 30, 0, false, `M5,10h20v30h-20Z`],
    [0, 0, 10, 20, -5, true, `M0,0h10v20h-10Z`],
    [0, 0, 10, 20, NaN, true, `M0,0h10v20h-10Z`],
    // zero-extent bars never get arcs, whatever the radius
    [0, 0, 10, 0, 5, true, `M0,0h10v0h-10Z`],
  ])(
    `returns simple rect path when radius is 0, negative, NaN or the bar is flat (x=%d, y=%d, w=%d, h=%d, r=%d, vertical=%s)`,
    (x, y, w, h, r, vertical, expected) => {
      expect(bar_path(x, y, w, h, r, vertical)).toBe(expected)
    },
  )

  it.each([
    [`vertical default`, undefined, false, `M10,80V25A5,5 0 0 1 15,20H45A5,5 0 0 1 50,25V80Z`],
    [`vertical top`, true, false, `M10,80V25A5,5 0 0 1 15,20H45A5,5 0 0 1 50,25V80Z`],
    [`horizontal right`, false, false, `M10,20H45A5,5 0 0 1 50,25V75A5,5 0 0 1 45,80H10Z`],
    [`vertical bottom`, true, true, `M10,20V75A5,5 0 0 0 15,80H45A5,5 0 0 0 50,75V20Z`],
    [`horizontal left`, false, true, `M50,20H15A5,5 0 0 0 10,25V75A5,5 0 0 0 15,80H50Z`],
  ])(`rounds the %s corners`, (_name, vertical, flip, expected) => {
    expect(bar_path(10, 20, 40, 60, 5, vertical, flip)).toBe(expected)
  })

  // Callers pass the configured radius unclamped; the path clamps it to half the narrower side.
  it.each([
    [`width`, 4, 60, `M10,80V22A2,2 0 0 1 12,20H12A2,2 0 0 1 14,22V80Z`],
    [`height`, 40, 3, `M10,23V21.5A1.5,1.5 0 0 1 11.5,20H48.5A1.5,1.5 0 0 1 50,21.5V23Z`],
  ])(`clamps the radius to half the bar %s`, (_side, w, h, expected) => {
    expect(bar_path(10, 20, w, h, 5, true)).toBe(expected)
    expect(bar_path(10, 20, w, h, 5, true)).toBe(
      bar_path(10, 20, w, h, Math.min(w, h) / 2, true),
    )
  })
})

describe(`violin_path`, () => {
  const orient = (cross: number, val: number): [number, number] => [cross, val]
  it(`mirrors density around the center for both sides and closes the path`, () => {
    expect(violin_path([0, 10, 20], [0, 4, 0], 50, `both`, orient)).toBe(
      `M50,0L54,10L50,20L50,20L46,10L50,0Z`,
    )
  })
  it.each([
    [`positive`, `M50,0L54,10L50,20L50,20L50,0Z`],
    [`negative`, `M50,0L46,10L50,20L50,20L50,0Z`],
  ] as const)(`draws one half for side=%s with a straight inner edge`, (side, expected) => {
    expect(violin_path([0, 10, 20], [0, 4, 0], 50, side, orient)).toBe(expected)
  })
  it(`returns an empty path for an empty grid`, () => {
    expect(violin_path([], [], 0, `both`, orient)).toBe(``)
  })
})
