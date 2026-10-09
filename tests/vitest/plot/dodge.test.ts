import { dodge, type DodgeSide } from '#lib/plot/core/dodge.js'
import { describe, expect, test } from 'vitest'
import { make_rng } from '../numeric-helpers'

// Seeded normal positions (Box-Muller)
const normal_positions = (count: number, seed: number, center = 200, sigma = 40) => {
  const rand = make_rng(seed)
  return Array.from(
    { length: count },
    () =>
      center + sigma * Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand()),
  )
}

describe(`dodge`, () => {
  // Ported from layerchart's interval-tree dodge: on sorted input that original gives
  // bit-identical offsets for `both` and agrees to 1 ulp one-sided (it stores offset + base
  // and subtracts base again). The packing guarantee is what's checked here: no two circles
  // closer than 2r + padding, up to a few ulps of the sqrt round-trip (measured >= -3e-14).
  test.each([
    [300, 3, 1, `both`],
    [300, 3, 1, `positive`],
    [300, 3, 1, `negative`],
    [800, 2, 0, `both`],
    [500, 4, 0.5, `positive`],
  ] as const)(`n=%i r=%f pad=%f side=%s never overlaps`, (count, radius, padding, side) => {
    const positions = normal_positions(count, count + radius)
    const offsets = dodge(positions, radius, { padding, side })
    const reach = 2 * radius + padding
    let min_slack = Infinity
    for (let left = 0; left < count; left++) {
      for (let right = left + 1; right < count; right++) {
        const dist = Math.hypot(
          positions[left] - positions[right],
          offsets[left] - offsets[right],
        )
        min_slack = Math.min(min_slack, dist - reach)
      }
    }
    expect(min_slack).toBeGreaterThan(-1e-9)
    if (side === `positive`) expect(Math.min(...offsets)).toBeCloseTo(radius + padding, 12)
    if (side === `negative`) expect(Math.max(...offsets)).toBeCloseTo(-radius - padding, 12)
  })

  test.each([
    [`both`, [0, -2, 2, -4, 4]],
    [`positive`, [1, 3, 5, 7, 9]],
    [`negative`, [-1, -3, -5, -7, -9]],
  ] satisfies [DodgeSide, number[]][])(`tied positions stack %s`, (side, expected) => {
    expect([...dodge([7, 7, 7, 7, 7], 1, { padding: 0, side })]).toEqual(expected)
  })

  // Exact circle geometry: centers 1 apart touch at reach 2 when the second sits sqrt(3) off
  test.each([
    [`both`, [0, -Math.sqrt(3)]],
    [`positive`, [1, 1 + Math.sqrt(3)]],
    [`negative`, [-1, -1 - Math.sqrt(3)]],
  ] satisfies [DodgeSide, number[]][])(`two close circles, %s`, (side, expected) => {
    const offsets = dodge([0, 1], 1, { padding: 0, side })
    for (const [idx, offset] of offsets.entries())
      expect(offset).toBeCloseTo(expected[idx], 12)
  })

  // A neighbor exactly `reach` away by the window's test can round to a gap just above it,
  // which used to put a negative under the sqrt and NaN offsets on finite samples
  test(`a neighbor at the rounding edge of reach yields no NaN`, () => {
    const pos = 117.80707859481413
    expect([
      ...dodge([112.90707859481412, pos, pos, pos, pos], 2.2, { padding: 0.5 }),
    ]).toEqual([0, 0, -4.9, 4.9, -9.8])
  })

  test.each([`both`, `positive`] satisfies DodgeSide[])(
    `%s: circles past max_offset pile at the edge without blocking later ones`,
    (side) => {
      // 2000 tied values: unbounded this is O(n^3) (4 s); bounded it must stay instant
      const start = performance.now()
      const offsets = dodge(new Float64Array(2000).fill(5), 2, {
        padding: 0.5,
        side,
        max_offset: 20,
      })
      expect(performance.now() - start).toBeLessThan(500)
      expect(Math.max(...offsets.map(Math.abs))).toBe(20)
      const placed = [...offsets].filter((offset) => Math.abs(offset) < 20)
      // In-slot circles keep their unbounded positions: spaced by reach 4.5 from the line
      const unbounded = [
        ...dodge(new Float64Array(placed.length).fill(5), 2, { padding: 0.5, side }),
      ]
      expect(placed).toEqual(unbounded)
      const pile = offsets.length - placed.length
      if (side === `both`) {
        // Overflow alternates edges, so the pile is balanced
        const left = [...offsets].filter((offset) => offset === -20).length
        expect(Math.abs(2 * left - pile)).toBeLessThanOrEqual(1)
      } else expect(Math.min(...offsets)).toBeGreaterThan(0)
    },
  )

  test(`returns offsets in input order, packing in position order`, () => {
    // Sorted: idx 1 (0), idx 0 (5), idx 2 (5, ties keep input order) -> idx 2 dodges idx 0
    expect([...dodge([5, 0, 5], 1, { padding: 0 })]).toEqual([0, 0, -2])
  })

  test(`isolated circles stay on the center line`, () => {
    expect([...dodge([0, 10, 20, 30], 2, { padding: 1 })]).toEqual([0, 0, 0, 0])
  })

  test(`non-finite positions get NaN and block nothing`, () => {
    const offsets = dodge([3, NaN, 3, Infinity], 1, { padding: 0 })
    expect([...offsets]).toEqual([0, NaN, -2, NaN])
  })

  test.each([
    [-1, {}, /invalid radius -1/],
    [Number.NaN, {}, /invalid radius NaN/],
    [1, { padding: -0.5 }, /invalid padding -0.5/],
  ])(`rejects radius %f with %o`, (radius, opts, message) => {
    expect(() => dodge([1, 2], radius, opts)).toThrow(message)
  })
})
