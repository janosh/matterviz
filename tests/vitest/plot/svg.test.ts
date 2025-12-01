import { bar_path } from '$lib/plot/svg'
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

  it(`returns vertical bar path with rounded top corners`, () => {
    const path = bar_path(10, 20, 40, 60, 5, true)
    // Path should: start bottom-left, go up, arc top-left, horizontal across, arc top-right, go down, close
    expect(path).toBe(
      `M10,80V25A5,5 0 0 1 15,20H45A5,5 0 0 1 50,25V80Z`,
    )
  })

  it(`returns horizontal bar path with rounded right corners`, () => {
    const path = bar_path(10, 20, 40, 60, 5, false)
    // Path should: start top-left, go right, arc top-right, go down, arc bottom-right, go left, close
    expect(path).toBe(
      `M10,20H45A5,5 0 0 1 50,25V75A5,5 0 0 1 45,80H10Z`,
    )
  })

  it(`defaults to vertical orientation when not specified`, () => {
    const explicit = bar_path(0, 0, 10, 20, 3, true)
    const implicit = bar_path(0, 0, 10, 20, 3)
    expect(implicit).toBe(explicit)
  })

  it.each([
    [0, 0, 10, 20, 5, true],
    [100, 200, 50, 100, 10, false],
  ])(
    `path is valid SVG (x=%d, y=%d, w=%d, h=%d, r=%d, vertical=%s)`,
    (x, y, w, h, r, vertical) => {
      const path = bar_path(x, y, w, h, r, vertical)
      // Basic SVG path validation: starts with M, ends with Z, contains expected commands
      expect(path).toMatch(/^M[\d.,-]+/)
      expect(path).toMatch(/Z$/)
      expect(path).toContain(`A${r},${r}`)
    },
  )
})
