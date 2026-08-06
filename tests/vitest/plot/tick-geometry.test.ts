import {
  analyze_tick_label_geometry,
  calculate_rotated_tick_label_aabb,
  calculate_tick_label_geometry,
  choose_tick_label_anchor,
  default_tick_label_anchor,
  detect_axis_edge_overflow,
  detect_tick_label_collisions_sweep,
  is_tick_label_anchor,
  type TickLabelDimensions,
  type TickLabelItem,
  validate_tick_label_anchor,
} from '$lib/plot/core/tick-geometry'
import { describe, expect, it, test, vi } from 'vitest'

const dimensions = (width: number, line_height = 10, line_count = 1): TickLabelDimensions => ({
  line_widths: Array.from({ length: line_count }, () => width),
  line_height,
})

const tick_item = (
  id: string,
  axis: number,
  width = 20,
  overrides: Partial<TickLabelItem> = {},
): TickLabelItem => ({
  id,
  lines: [`${id}-label`],
  position: { axis, cross_axis: 0 },
  anchor: `middle`,
  dimensions: dimensions(width),
  ...overrides,
})

describe(`rotated multiline AABBs`, () => {
  test.each([
    [`x below its origin`, `x`, `start`, [10, 20, 30, 30, 20, 10]],
    [`x2 above its origin`, `x2`, `start`, [10, 10, 30, 20, 20, 10]],
    [`y ending at its origin`, `y`, `end`, [0, 5, 20, 15, 20, 10]],
    [`y2 starting at its origin`, `y2`, `start`, [20, 5, 40, 15, 20, 10]],
  ] as const)(`places multiline blocks on %s`, (_name, side, anchor, expected) => {
    const aabb = calculate_rotated_tick_label_aabb({
      position: { axis: 10, cross_axis: 20 },
      side,
      anchor,
      rotation: 0,
      dimensions: { line_widths: [10, 20], line_height: 5 },
    })
    expect([aabb.min_x, aabb.min_y, aabb.max_x, aabb.max_y, aabb.width, aabb.height]).toEqual(
      expected,
    )
  })

  it.each([
    [0, 20, 10],
    [
      30,
      20 * Math.cos(Math.PI / 6) + 10 * Math.sin(Math.PI / 6),
      20 * 0.5 + 10 * Math.cos(Math.PI / 6),
    ],
    [-45, 15 * Math.SQRT2, 15 * Math.SQRT2],
    [90, 10, 20],
    [-90, 10, 20],
  ])(`rotation %d° produces the expected AABB dimensions`, (rotation, width, height) => {
    const aabb = calculate_rotated_tick_label_aabb({
      position: { axis: 30, cross_axis: 40 },
      side: `x`,
      anchor: `middle`,
      rotation,
      dimensions: { line_widths: [20, 12], line_height: 5 },
    })
    expect(aabb.width).toBeCloseTo(width, 12)
    expect(aabb.height).toBeCloseTo(height, 12)
  })

  it(`rotates the block around the actual label position`, () => {
    const aabb = calculate_rotated_tick_label_aabb({
      position: { axis: 10, cross_axis: 20 },
      side: `x`,
      anchor: `start`,
      rotation: 90,
      dimensions: { line_widths: [10, 20], line_height: 5 },
    })
    expect([aabb.min_x, aabb.min_y, aabb.max_x, aabb.max_y, aabb.width, aabb.height]).toEqual([
      0, 20, 10, 40, 10, 20,
    ])
  })
})

describe(`anchor selection and validation`, () => {
  test.each([
    [`x`, 0, `middle`],
    [`x`, -30, `end`],
    [`x`, 330, `end`],
    [`x`, 30, `start`],
    [`x2`, -30, `start`],
    [`x2`, 30, `end`],
    [`y`, 0, `end`],
    [`y2`, 0, `start`],
  ] as const)(`defaults %s at %d° to %s`, (side, rotation, expected) => {
    expect(default_tick_label_anchor(side, rotation)).toBe(expected)
  })

  test.each([
    [`x`, 0, `start`],
    [`x`, 50, `middle`],
    [`x`, 100, `end`],
    [`x2`, 0, `start`],
    [`x2`, 100, `end`],
  ] as const)(`chooses %s endpoint anchor at position %d`, (side, axis, expected) => {
    expect(
      choose_tick_label_anchor({
        side,
        position: { axis, cross_axis: 0 },
        rotation: 0,
        dimensions: dimensions(20),
        axis_extent: { start: 0, end: 100 },
      }),
    ).toBe(expected)
  })

  it.each([
    [`start`, true],
    [`middle`, true],
    [`end`, true],
    [`center`, false],
    [undefined, false],
    [1, false],
  ])(`validates anchor %j`, (anchor, expected) => {
    expect(is_tick_label_anchor(anchor)).toBe(expected)
    if (expected) expect(validate_tick_label_anchor(anchor)).toBe(anchor)
    else expect(() => validate_tick_label_anchor(anchor)).toThrow(`tick label anchor`)
  })

  it(`respects a preferred anchor when candidates have equal overflow`, () => {
    expect(
      choose_tick_label_anchor({
        side: `y`,
        position: { axis: 50, cross_axis: 0 },
        rotation: 0,
        dimensions: dimensions(20),
        axis_extent: { start: 0, end: 100 },
        preferred_anchor: `middle`,
      }),
    ).toBe(`middle`)
  })
})

describe(`actual-position collision detection`, () => {
  const irregular_items = [
    tick_item(`right`, 80),
    tick_item(`left`, 0),
    tick_item(`near-left`, 14),
    tick_item(`middle`, 45),
  ]
  const irregular_labels = calculate_tick_label_geometry({
    items: irregular_items,
    side: `x`,
    axis_extent: { start: -100, end: 100 },
  })

  it(`uses irregular nonmonotonic positions rather than nominal tick pitch`, () => {
    const sweep = detect_tick_label_collisions_sweep(irregular_labels)
    expect(sweep.pairs).toEqual([
      { first_idx: 1, second_idx: 2, first_id: `left`, second_id: `near-left` },
    ])
    expect(sweep).toMatchObject({
      colliding_indices: [1, 2],
      colliding_ids: [`left`, `near-left`],
      count: 1,
      has_collisions: true,
    })
  })

  test.each([`x`, `x2`, `y`, `y2`] as const)(
    `%s labels detect overlap and honor exact gaps`,
    (side) => {
      const collides = (second_position: number, gap = 0): boolean =>
        detect_tick_label_collisions_sweep(
          calculate_tick_label_geometry({
            items: [tick_item(`first`, 0, 10), tick_item(`second`, second_position, 10)],
            side,
            axis_extent: { start: -100, end: 100 },
          }),
          gap,
        ).has_collisions
      expect(collides(8)).toBe(true)
      expect(collides(15, 5)).toBe(false)
      expect(collides(15, 5.01)).toBe(true)
    },
  )

  it(`uses actual cross-axis positions for staggered rows`, () => {
    const labels = calculate_tick_label_geometry({
      items: [
        tick_item(`row-0`, 20, 20, {
          stagger_row: 0,
          position: { axis: 20, cross_axis: 0 },
        }),
        tick_item(`row-1`, 20, 20, {
          stagger_row: 1,
          position: { axis: 20, cross_axis: 20 },
        }),
      ],
      side: `x`,
      axis_extent: { start: 0, end: 100 },
    })
    expect(labels.map(({ stagger_row }) => stagger_row)).toEqual([0, 1])
    expect(detect_tick_label_collisions_sweep(labels).has_collisions).toBe(false)
  })

  it(`uses signed rotation for cross-axis collision distances`, () => {
    const labels = calculate_tick_label_geometry({
      items: [
        tick_item(`first`, 0, 20, {
          anchor: `start`,
          dimensions: dimensions(20, 16),
          position: { axis: 0, cross_axis: 0 },
          rotation: -30,
        }),
        tick_item(`second`, 10, 20, {
          anchor: `start`,
          dimensions: dimensions(20, 16),
          position: { axis: 10, cross_axis: -20 },
          rotation: -30,
        }),
      ],
      side: `x`,
      axis_extent: { start: 0, end: 100 },
    })
    expect(detect_tick_label_collisions_sweep(labels).has_collisions).toBe(true)
  })

  it(`separates rotated labels whose AABBs overlap`, () => {
    const labels = calculate_tick_label_geometry({
      items: [
        tick_item(`first`, 0, 8, { anchor: `start`, rotation: 30 }),
        // Their AABBs overlap, but the text blocks are disjoint along the rotated baseline.
        tick_item(`second`, 10, 8, { anchor: `start`, rotation: 30 }),
      ],
      side: `x`,
      axis_extent: { start: 0, end: 100 },
    })
    expect(detect_tick_label_collisions_sweep(labels).pairs).toEqual([])
  })

  it(`detects collisions without mutating labels`, () => {
    const labels_before = structuredClone(irregular_labels)
    detect_tick_label_collisions_sweep(irregular_labels, 15)
    expect(irregular_labels).toEqual(labels_before)
  })

  it(`bounds sparse sweep geometry reads below pairwise growth`, () => {
    const item_count = 500
    const labels = calculate_tick_label_geometry({
      items: Array.from({ length: item_count }, (_unused, item_idx) =>
        tick_item(`item-${item_idx}`, item_idx * 30, 10),
      ),
      side: `x`,
      axis_extent: { start: 0, end: item_count * 30 },
    })
    let aabb_reads = 0
    const instrumented = labels.map((label) => {
      const { aabb } = label
      return Object.defineProperty({ ...label }, `aabb`, {
        enumerable: true,
        get: () => {
          aabb_reads++
          return aabb
        },
      })
    })

    expect(detect_tick_label_collisions_sweep(instrumented).pairs).toEqual([])
    expect(aabb_reads).toBeLessThan(item_count * 100)
  })

  it(`reports no collisions when every pair meets the configured gap`, () => {
    const labels = calculate_tick_label_geometry({
      items: [
        tick_item(`first`, 0, 10),
        tick_item(`second`, 20, 10),
        tick_item(`third`, 40, 10),
      ],
      side: `x`,
      axis_extent: { start: -20, end: 60 },
    })
    expect(detect_tick_label_collisions_sweep(labels, 5)).toMatchObject({
      pairs: [],
      colliding_indices: [],
      colliding_ids: [],
      count: 0,
      has_collisions: false,
    })
  })
})

describe(`axis-edge overflow`, () => {
  test.each([
    [`x`, 2, 3, 0],
    [`x2`, 98, 0, 3],
    [`y`, 2, 3, 0],
    [`y2`, 98, 0, 3],
  ] as const)(
    `%s reports endpoint overflow from actual AABB coordinates`,
    (side, axis, expected_start, expected_end) => {
      const [label] = calculate_tick_label_geometry({
        items: [tick_item(`edge`, axis, 10)],
        side,
        axis_extent: { start: 0, end: 100 },
      })
      expect(detect_axis_edge_overflow(label.aabb, side, { start: 0, end: 100 })).toEqual({
        start: expected_start,
        end: expected_end,
        total: expected_start + expected_end,
      })
    },
  )

  it(`adds edge gap to the required inset`, () => {
    const aabb = calculate_rotated_tick_label_aabb({
      position: { axis: 2, cross_axis: 0 },
      side: `x`,
      anchor: `middle`,
      rotation: 0,
      dimensions: dimensions(10),
    })
    expect(detect_axis_edge_overflow(aabb, `x`, { start: 0, end: 100 }, 2)).toEqual({
      start: 5,
      end: 0,
      total: 5,
    })
  })

  it(`preserves start/end semantics for a reversed axis`, () => {
    const aabb = calculate_rotated_tick_label_aabb({
      position: { axis: 98, cross_axis: 0 },
      side: `x`,
      anchor: `middle`,
      rotation: 0,
      dimensions: dimensions(10),
    })
    expect(detect_axis_edge_overflow(aabb, `x`, { start: 100, end: 0 })).toEqual({
      start: 3,
      end: 0,
      total: 3,
    })
  })
})

describe(`geometry summaries and measurement`, () => {
  it(`accepts a measurement callback and preserves multiline widths`, () => {
    const measure = vi.fn((_item: TickLabelItem, item_idx: number) => ({
      line_widths: item_idx === 0 ? [10, 30] : [12],
      line_height: 8,
    }))
    const labels = calculate_tick_label_geometry({
      items: [
        {
          id: `multiline`,
          lines: [`wide`, `wider`],
          position: { axis: 30, cross_axis: 0 },
        },
        {
          id: `single`,
          lines: [`single`],
          position: { axis: 70, cross_axis: 0 },
        },
      ],
      side: `x`,
      axis_extent: { start: 0, end: 100 },
      measure,
    })
    expect(measure).toHaveBeenCalledTimes(2)
    expect(labels[0]).toMatchObject({
      dimensions: { line_widths: [10, 30], line_height: 8 },
      aabb: { width: 30, height: 16 },
    })
  })

  it(`returns deterministic collision and overflow summaries`, () => {
    const options = {
      items: [
        tick_item(`right`, 20, 16),
        tick_item(`left`, 0, 16),
        tick_item(`center`, 10, 16),
      ],
      side: `x` as const,
      axis_extent: { start: -20, end: 40 },
    }
    const first = analyze_tick_label_geometry(options)
    const second = analyze_tick_label_geometry(options)
    expect(second).toEqual(first)
    expect(first.collisions).toMatchObject({
      pairs: [
        { first_idx: 0, second_idx: 2, first_id: `right`, second_id: `center` },
        { first_idx: 1, second_idx: 2, first_id: `left`, second_id: `center` },
      ],
      colliding_indices: [0, 1, 2],
      colliding_ids: [`right`, `left`, `center`],
      count: 2,
      has_collisions: true,
    })
    expect(first).toMatchObject({
      overflows: [],
      overflowing_indices: [],
      overflowing_ids: [],
      has_overflow: false,
    })
  })

  it.each([
    [
      `missing dimensions`,
      { id: `bad`, lines: [`bad`], position: { axis: 0, cross_axis: 0 } },
      `needs explicit dimensions or a measurement callback`,
    ],
    [
      `mismatched multiline widths`,
      {
        id: `bad`,
        lines: [`one`, `two`],
        position: { axis: 0, cross_axis: 0 },
        dimensions: dimensions(10),
      },
      `1 entries for 2 lines`,
    ],
    [
      `invalid stagger row`,
      tick_item(`bad`, 0, 10, { stagger_row: 0.5 }),
      `stagger_row must be a non-negative integer`,
    ],
  ] as const)(`rejects %s`, (_name, item, message) => {
    expect(() =>
      calculate_tick_label_geometry({
        items: [item],
        side: `x`,
        axis_extent: { start: 0, end: 100 },
      }),
    ).toThrow(message)
  })
})
