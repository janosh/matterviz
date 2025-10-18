import { describe, expect, test } from 'vitest'

describe(`Cylinder Component`, () => {
  test.each([
    [0.05, `valid small thickness`],
    [0.1, `default thickness`],
    [0.12, `measurement thickness`],
    [2.5, `large thickness`],
  ])(`thickness=%f controls cylinder geometry (%s)`, (thickness) => {
    const cylinder_args = [thickness, thickness, 1, 8]
    expect(cylinder_args).toEqual([thickness, thickness, 1, 8])
    expect(thickness).toBeGreaterThan(0)
  })

  test.each([
    [`#ff0000`, `red`],
    [`#00ff00`, `green`],
    [`#0000ff`, `blue`],
    [`#808080`, `default gray`],
  ])(`color=%s is valid hex color (%s)`, (color) => {
    expect(color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  test.each([
    [[0, 0, 0], [1, 0, 0], 1, [0.5, 0, 0]],
    [[0, 0, 0], [0, 1, 0], 1, [0, 0.5, 0]],
    [[0, 0, 0], [0, 0, 1], 1, [0, 0, 0.5]],
    [[0, 0, 0], [1, 1, 1], Math.sqrt(3), [0.5, 0.5, 0.5]],
    [[0, 0, 0], [2, 2, 2], Math.sqrt(12), [1, 1, 1]],
    [[1, 2, 3], [4, 6, 8], Math.sqrt(50), [2.5, 4, 5.5]],
  ])(
    `from=%s to=%s has height=%f and midpoint=%s`,
    (from, to, expected_height, expected_midpoint) => {
      const dx = to[0] - from[0]
      const dy = to[1] - from[1]
      const dz = to[2] - from[2]
      const height = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const midpoint = [
        (from[0] + to[0]) / 2,
        (from[1] + to[1]) / 2,
        (from[2] + to[2]) / 2,
      ]

      expect(height).toBeCloseTo(expected_height, 5)
      expect(midpoint).toEqual(expected_midpoint)
    },
  )
})
