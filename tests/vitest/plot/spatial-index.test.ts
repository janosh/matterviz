import type { Point2D } from '$lib/math'
import {
  build_spatial_index,
  type Positioned,
  query_nearest,
} from '$lib/plot/core/spatial-index'
import { describe, expect, test } from 'vitest'

const linear_nearest = <T extends Positioned>(
  items: readonly T[],
  pointer: Point2D,
  radius_px: number,
): T | null => {
  let best: T | null = null
  let best_dist_sq = Infinity
  const max_dist_sq = radius_px * radius_px
  for (const item of items) {
    if (!Number.isFinite(item.cx) || !Number.isFinite(item.cy)) continue
    const dist_sq = (pointer.x - item.cx) ** 2 + (pointer.y - item.cy) ** 2
    if (dist_sq > max_dist_sq || dist_sq >= best_dist_sq) continue
    best_dist_sq = dist_sq
    best = item
  }
  return best
}

describe(`spatial index`, () => {
  test(`nearest, ties, drops, clustering, invalid radius`, () => {
    for (const radius_px of [-1, NaN, Infinity]) {
      expect(() => build_spatial_index([], radius_px)).toThrow(
        `radius_px must be a non-negative finite number, got ${radius_px}`,
      )
    }
    expect(query_nearest(build_spatial_index<Positioned>([], 10), { x: 0, y: 0 })).toBeNull()

    const items = [
      { cx: 10, cy: 10, id: `near` },
      { cx: 14, cy: 10, id: `nearer-to-15` },
      { cx: 500, cy: 500, id: `far` },
    ]
    const index = build_spatial_index(items, 20)
    expect(index.count).toBe(3)
    expect(query_nearest(index, { x: 15, y: 10 })?.id).toBe(`nearer-to-15`)
    expect(query_nearest(index, { x: 9, y: 10 })?.id).toBe(`near`)
    expect(query_nearest(index, { x: 250, y: 250 })).toBeNull()
    for (const pointer of [
      { x: NaN, y: 0 },
      { x: Infinity, y: 0 },
      { x: 0, y: -Infinity },
      { x: Number.MAX_VALUE, y: Number.MAX_VALUE },
      { x: -Number.MAX_VALUE, y: -Number.MAX_VALUE },
    ]) {
      expect(query_nearest(index, pointer)).toBeNull()
    }

    const edge = build_spatial_index([{ cx: 0, cy: 0, id: `edge` }], 10)
    expect(query_nearest(edge, { x: 10, y: 0 })?.id).toBe(`edge`)
    expect(query_nearest(edge, { x: 10.0001, y: 0 })).toBeNull()

    for (const [first_cx, second_cx] of [
      [1, 9],
      [15, 5],
    ]) {
      expect(
        query_nearest(
          build_spatial_index(
            [
              { cx: first_cx, cy: 0, id: `first` },
              { cx: second_cx, cy: 0, id: `second` },
            ],
            10,
          ),
          { x: (first_cx + second_cx) / 2, y: 0 },
        )?.id,
      ).toBe(`first`)
    }

    for (const [cx, cy] of [
      [NaN, 5],
      [5, Infinity],
      [(1 << 15) * 20 + 100, 0],
    ]) {
      expect(build_spatial_index([{ cx, cy }], 20).count).toBe(0)
    }

    const clustered = Array.from({ length: 100 }, (_, idx) => ({
      cx: idx / 100,
      cy: 0,
      idx,
    }))
    const cluster_index = build_spatial_index(clustered, 20)
    expect(cluster_index.cells.size).toBe(1)
    expect(query_nearest(cluster_index, { x: 0.99, y: 0 })?.idx).toBe(99)
  })

  test.each([5, 20, 60])(`matches a linear scan for radius %s px`, (radius_px) => {
    let seed = 12345
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const items = Array.from({ length: 800 }, (_, idx) => ({
      cx: random() * 900 - 50,
      cy: random() * 600 - 50,
      idx,
    }))
    const index = build_spatial_index(items, radius_px)
    for (let query = 0; query < 200; query++) {
      const pointer = { x: random() * 900 - 50, y: random() * 600 - 50 }
      expect(query_nearest(index, pointer)).toBe(linear_nearest(items, pointer, radius_px))
    }
  })
})
