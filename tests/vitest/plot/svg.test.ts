import { bar_path } from '$lib/plot/core/svg'
import { describe, expect, it } from 'vitest'

describe(`bar_path`, () => {
  it.each([
    [0, 0, 10, 20, 0, true, `M0,0h10v20h-10Z`],
    [5, 10, 20, 30, 0, false, `M5,10h20v30h-20Z`],
    [0, 0, 10, 20, -5, true, `M0,0h10v20h-10Z`],
  ])(
    `returns simple rect path when radius is 0 or negative (x=%d, y=%d, w=%d, h=%d, r=%d, vertical=%s)`,
    (x, y, w, h, r, vertical, expected) => {
      expect(bar_path(x, y, w, h, r, vertical)).toBe(expected)
    },
  )

  it.each([
    [`vertical top`, true, false, `M10,80V25A5,5 0 0 1 15,20H45A5,5 0 0 1 50,25V80Z`],
    [`horizontal right`, false, false, `M10,20H45A5,5 0 0 1 50,25V75A5,5 0 0 1 45,80H10Z`],
    [`vertical bottom`, true, true, `M10,20V75A5,5 0 0 0 15,80H45A5,5 0 0 0 50,75V20Z`],
    [`horizontal left`, false, true, `M50,20H15A5,5 0 0 0 10,25V75A5,5 0 0 0 15,80H50Z`],
  ])(`rounds the %s corners`, (_name, vertical, flip, expected) => {
    expect(bar_path(10, 20, 40, 60, 5, vertical, flip)).toBe(expected)
  })

  it(`defaults to vertical orientation when not specified`, () => {
    const explicit = bar_path(0, 0, 10, 20, 3, true)
    const implicit = bar_path(0, 0, 10, 20, 3)
    expect(implicit).toBe(explicit)
  })
})
