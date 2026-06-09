import type { DataSeries, InternalPoint } from '$lib/plot'
import type { PlotScaleFn } from '$lib/plot/core/scales'
import type { LabelPlacementConfig } from '$lib/plot/core/types'
import {
  compute_delta_energy,
  compute_label_positions,
  estimate_label_size,
  generate_candidates,
  label_leader_segment,
  parse_font_size,
  rect_circle_overlap,
  rect_out_of_bounds_area,
  rect_overlap_area,
  segment_rect_intersects,
  segments_intersect,
} from '$lib/plot/core/utils/label-placement'
import { describe, expect, test } from 'vitest'

// === Geometry helpers ===

describe(`rect_overlap_area`, () => {
  test.each([
    {
      label: `non-overlapping`,
      a: { x: 0, y: 0, w: 10, h: 10 },
      b: { x: 20, y: 20, w: 10, h: 10 },
      expected: 0,
    },
    {
      label: `edge-touching`,
      a: { x: 0, y: 0, w: 10, h: 10 },
      b: { x: 10, y: 0, w: 10, h: 10 },
      expected: 0,
    },
    {
      label: `partial overlap`,
      a: { x: 0, y: 0, w: 10, h: 10 },
      b: { x: 5, y: 5, w: 10, h: 10 },
      expected: 25,
    },
    {
      label: `fully contained`,
      a: { x: 0, y: 0, w: 20, h: 20 },
      b: { x: 5, y: 5, w: 5, h: 5 },
      expected: 25,
    },
    {
      label: `identical`,
      a: { x: 5, y: 5, w: 10, h: 20 },
      b: { x: 5, y: 5, w: 10, h: 20 },
      expected: 200,
    },
  ])(`$label → $expected`, ({ a: rect_a, b: rect_b, expected }) => {
    expect(rect_overlap_area(rect_a, rect_b)).toBe(expected)
  })

  test(`is commutative`, () => {
    const rect_a = { x: 0, y: 0, w: 10, h: 10 }
    const rect_b = { x: 5, y: 3, w: 8, h: 12 }
    expect(rect_overlap_area(rect_a, rect_b)).toBe(rect_overlap_area(rect_b, rect_a))
  })
})

const unit_rect = { x: 0, y: 0, w: 10, h: 10 }

describe(`rect_circle_overlap`, () => {
  // rect (0,0,10,10), exclusion zone inflated by radius r:
  //   left = -r, top = -r, right = 10+r, bottom = 10+r
  // penalty = min(cx-left, right-cx, cy-top, bottom-cy) + r
  test.each([
    { label: `far outside`, cx: 100, cy: 100, r: 3, expected: 0 },
    { label: `center inside rect`, cx: 5, cy: 5, r: 3, expected: 11 },
    { label: `near edge within radius`, cx: 12, cy: 5, r: 3, expected: 4 },
    { label: `outside exclusion zone`, cx: 20, cy: 5, r: 3, expected: 0 },
  ])(`$label → $expected`, ({ cx, cy, r, expected }) => {
    expect(rect_circle_overlap(unit_rect, cx, cy, r)).toBe(expected)
  })
})

describe(`segments_intersect`, () => {
  test.each([
    { label: `X-shaped cross`, a: [0, 0, 10, 10], b: [0, 10, 10, 0], expected: true },
    { label: `parallel`, a: [0, 0, 10, 0], b: [0, 5, 10, 5], expected: false },
    { label: `collinear non-overlapping`, a: [0, 0, 5, 0], b: [6, 0, 10, 0], expected: false },
    { label: `L-shape non-crossing`, a: [0, 0, 5, 0], b: [6, -1, 6, 5], expected: false },
    { label: `shared endpoint (strict)`, a: [0, 0, 5, 5], b: [5, 5, 10, 0], expected: false },
  ])(`$label → $expected`, ({ a: seg_a, b: seg_b, expected }) => {
    expect(
      segments_intersect(
        seg_a[0],
        seg_a[1],
        seg_a[2],
        seg_a[3],
        seg_b[0],
        seg_b[1],
        seg_b[2],
        seg_b[3],
      ),
    ).toBe(expected)
  })
})

describe(`segment_rect_intersects`, () => {
  test.each([
    { label: `crosses left edge`, seg: [-5, 5, 15, 5], expected: true },
    { label: `entirely outside`, seg: [20, 20, 30, 30], expected: false },
    { label: `entirely inside`, seg: [3, 3, 7, 7], expected: false },
  ])(`$label → $expected`, ({ seg, expected }) => {
    expect(segment_rect_intersects(seg[0], seg[1], seg[2], seg[3], unit_rect)).toBe(expected)
  })
})

describe(`rect_out_of_bounds_area`, () => {
  const bounds = { min_x: 0, min_y: 0, max_x: 100, max_y: 100 }

  test.each([
    { label: `fully inside`, rect: { x: 10, y: 10, w: 20, h: 20 }, expected: 0 },
    { label: `left overshoot 5px, h=20`, rect: { x: -5, y: 10, w: 20, h: 20 }, expected: 100 },
    {
      label: `right overshoot 10px, h=20`,
      rect: { x: 90, y: 10, w: 20, h: 20 },
      expected: 200,
    },
    {
      label: `top overshoot 10px, w=30 (non-square)`,
      rect: { x: 10, y: -10, w: 30, h: 10 },
      expected: 300,
    },
    {
      label: `bottom overshoot 10px, w=15 (non-square)`,
      rect: { x: 10, y: 90, w: 15, h: 20 },
      expected: 150,
    },
    { label: `left+top combined`, rect: { x: -5, y: -3, w: 25, h: 40 }, expected: 275 },
  ])(`$label → $expected`, ({ rect, expected }) => {
    expect(rect_out_of_bounds_area(rect, bounds)).toBe(expected)
  })
})

// === parse_font_size ===

describe(`parse_font_size`, () => {
  test.each([
    { input: undefined, expected: 12 },
    { input: `10px`, expected: 10 },
    { input: `14`, expected: 14 },
    { input: `1.5em`, expected: 24 },
    { input: `1.5rem`, expected: 24 },
    { input: `garbage`, expected: 12 },
    { input: ``, expected: 12 },
  ])(`parse_font_size($input) → $expected`, ({ input, expected }) => {
    expect(parse_font_size(input)).toBe(expected)
  })
})

describe(`estimate_label_size`, () => {
  test(`uses the longest line and measured line count`, () => {
    expect(estimate_label_size(`Li2O\nwbm-123`, `10px`)).toEqual({
      width: 52,
      height: 24,
    })
  })
})

describe(`label_leader_segment`, () => {
  test(`trims from point rim to label edge`, () => {
    const segment = label_leader_segment({
      point: { x: 0, y: 0 },
      point_radius: 4,
      label_center: { x: 40, y: 0 },
      label_size: { width: 20, height: 10 },
      min_length: 6,
      label_padding: 0,
    })

    expect(segment).toEqual({ x1: 4, y1: 0, x2: 30, y2: 0 })
  })

  test(`hides segments shorter than the minimum visible length`, () => {
    expect(
      label_leader_segment({
        point: { x: 0, y: 0 },
        point_radius: 4,
        label_center: { x: 12, y: 0 },
        label_size: { width: 8, height: 8 },
        min_length: 6,
        label_padding: 0,
      }),
    ).toBeNull()
  })

  test(`hides segments when the label overlaps the point rim`, () => {
    expect(
      label_leader_segment({
        point: { x: 0, y: 0 },
        point_radius: 8,
        label_center: { x: 12, y: 0 },
        label_size: { width: 30, height: 10 },
        min_length: 6,
        label_padding: 0,
      }),
    ).toBeNull()
  })

  test(`trims diagonal leaders in the correct quadrant`, () => {
    const segment = label_leader_segment({
      point: { x: 10, y: 10 },
      point_radius: 5,
      label_center: { x: 50, y: 50 },
      label_size: { width: 20, height: 20 },
      min_length: 6,
      label_padding: 0,
    })

    expect(segment?.x1).toBeCloseTo(13.54, 2)
    expect(segment?.y1).toBeCloseTo(13.54, 2)
    expect(segment?.x2).toBeCloseTo(40)
    expect(segment?.y2).toBeCloseTo(40)
  })
})

// === Candidate generation ===

describe(`generate_candidates`, () => {
  const ax = 50,
    ay = 50,
    radius = 5,
    label_w = 30,
    label_h = 10,
    gap = 4
  const candidates = generate_candidates(ax, ay, radius, label_w, label_h, gap)

  test(`returns 8 candidate positions`, () => {
    expect(candidates).toHaveLength(8)
  })

  test(`no candidate label rect overlaps the marker circle`, () => {
    for (const candidate of candidates) {
      const overlap = rect_circle_overlap(
        { x: candidate.x, y: candidate.y, w: label_w, h: label_h },
        ax,
        ay,
        radius,
      )
      expect(overlap).toBe(0)
    }
  })

  test(`first candidate (R) is to the right of the anchor`, () => {
    expect(candidates[0].x).toBeGreaterThanOrEqual(ax + radius + gap)
  })

  test(`candidates span all compass directions`, () => {
    const half_w = label_w / 2,
      half_h = label_h / 2
    expect(candidates.some((candidate) => candidate.x + half_w < ax)).toBe(true)
    expect(candidates.some((candidate) => candidate.x + half_w > ax)).toBe(true)
    expect(candidates.some((candidate) => candidate.y + half_h < ay)).toBe(true)
    expect(candidates.some((candidate) => candidate.y + half_h > ay)).toBe(true)
  })
})

// === compute_delta_energy ===

describe(`compute_delta_energy`, () => {
  const bounds = { min_x: 0, min_y: 0, max_x: 400, max_y: 300 }
  const zero_weights = {
    overlap: 0,
    marker: 0,
    leader_cross: 0,
    leader_text: 0,
    distance: 0,
    bounds: 0,
  }

  test(`moving label closer to its anchor yields negative distance delta`, () => {
    const anchors = [{ x: 100, y: 100, radius: 4 }]
    const far = { x: 150, y: 150, w: 30, h: 12, anchor_idx: 0 }
    const near = { ...far, x: 105, y: 95 }
    const delta = compute_delta_energy(
      [far],
      anchors,
      0,
      far,
      near,
      { ...zero_weights, distance: 1 },
      bounds,
    )
    expect(delta).toBeLessThan(0)
  })

  test(`moving label into overlap with another label yields positive overlap delta`, () => {
    const anchors = [
      { x: 100, y: 100, radius: 4 },
      { x: 200, y: 100, radius: 4 },
    ]
    const label_a = { x: 100, y: 90, w: 30, h: 12, anchor_idx: 0 }
    const label_b = { x: 200, y: 90, w: 30, h: 12, anchor_idx: 1 }
    const moved = { ...label_a, x: 200 }
    const delta = compute_delta_energy(
      [label_a, label_b],
      anchors,
      0,
      label_a,
      moved,
      { ...zero_weights, overlap: 30 },
      bounds,
    )
    expect(delta).toBeGreaterThan(0)
  })

  test(`moving label out of bounds yields positive bounds delta`, () => {
    const anchors = [{ x: 10, y: 10, radius: 4 }]
    const inside = { x: 10, y: 10, w: 30, h: 12, anchor_idx: 0 }
    const outside = { ...inside, x: -20 }
    const delta = compute_delta_energy(
      [inside],
      anchors,
      0,
      inside,
      outside,
      { ...zero_weights, bounds: 100 },
      bounds,
    )
    expect(delta).toBeGreaterThan(0)
  })

  test(`moving label onto a marker yields positive marker delta`, () => {
    const anchors = [{ x: 100, y: 100, radius: 8 }]
    const clear = { x: 120, y: 90, w: 30, h: 12, anchor_idx: 0 }
    const on_marker = { ...clear, x: 90, y: 94 }
    const delta = compute_delta_energy(
      [clear],
      anchors,
      0,
      clear,
      on_marker,
      { ...zero_weights, marker: 100 },
      bounds,
    )
    expect(delta).toBeGreaterThan(0)
  })
})

// === compute_label_positions (integration) ===

const identity_scale = ((val: number | Date) =>
  typeof val === `number` ? val : val.getTime()) as PlotScaleFn
identity_scale.invert = (val: number) => val
identity_scale.domain = (() => [0, 100]) as PlotScaleFn[`domain`]
identity_scale.range = (() => [0, 400]) as PlotScaleFn[`range`]

const default_scales = {
  x_scale_fn: identity_scale,
  y_scale_fn: identity_scale,
  y2_scale_fn: identity_scale,
  x_axis: { label: `X` },
}

const default_bounds = {
  width: 400,
  height: 300,
  pad: { t: 10, b: 10, l: 10, r: 10 },
}

const default_config: LabelPlacementConfig = {
  sa_iterations: 500,
  max_labels: 300,
  leader_line_threshold: 15,
}

function make_labeled_series(points: { x: number; y: number; text: string }[]): DataSeries[] {
  const filtered_data: InternalPoint[] = points.map((pt, idx) => ({
    x: pt.x,
    y: pt.y,
    series_idx: 0,
    point_idx: idx,
    point_style: { fill: `blue`, radius: 4 },
    point_label: { text: pt.text, auto_placement: true, font_size: `10px` },
  }))
  return [
    {
      x: points.map((pt) => pt.x),
      y: points.map((pt) => pt.y),
      point_style: { fill: `blue`, radius: 4 },
      filtered_data,
    },
  ]
}

function place_and_expect_finite(
  points: { x: number; y: number; text: string }[],
  config = default_config,
): Record<string, { x: number; y: number }> {
  const result = compute_label_positions(
    make_labeled_series(points),
    config,
    default_scales,
    default_bounds,
  )
  expect(Object.keys(result)).toHaveLength(points.length)
  for (const pos of Object.values(result)) {
    expect(pos.x).not.toBeNaN()
    expect(pos.y).not.toBeNaN()
  }
  return result
}

const estimate_label_width = (text: string, font_size = 10): number =>
  estimate_label_size(text, `${font_size}px`).width

describe(`compute_label_positions`, () => {
  test(`returns empty for empty series or disabled auto_placement`, () => {
    expect(
      compute_label_positions([], default_config, default_scales, default_bounds),
    ).toEqual({})

    const disabled: DataSeries[] = [
      {
        x: [10, 20],
        y: [10, 20],
        filtered_data: [
          {
            x: 10,
            y: 10,
            series_idx: 0,
            point_idx: 0,
            point_label: { text: `A`, auto_placement: false },
          },
          {
            x: 20,
            y: 20,
            series_idx: 0,
            point_idx: 1,
            point_label: { text: `B`, auto_placement: false },
          },
        ],
      },
    ]
    expect(
      compute_label_positions(disabled, default_config, default_scales, default_bounds),
    ).toEqual({})
  })

  test(`places labels at finite positions for single and boundary points`, () => {
    place_and_expect_finite([{ x: 50, y: 50, text: `Only` }])
    place_and_expect_finite([
      { x: 15, y: 15, text: `Corner` },
      { x: 385, y: 285, text: `FarCorner` },
    ])
  })

  test(`is deterministic (seeded PRNG)`, () => {
    const series = make_labeled_series([
      { x: 50, y: 50, text: `A` },
      { x: 55, y: 52, text: `B` },
      { x: 48, y: 53, text: `C` },
    ])
    const result1 = compute_label_positions(
      series,
      default_config,
      default_scales,
      default_bounds,
    )
    const result2 = compute_label_positions(
      series,
      default_config,
      default_scales,
      default_bounds,
    )
    expect(result1).toEqual(result2)
  })

  test(`well-separated labels stay near their anchors`, () => {
    const anchors = [
      { x: 50, y: 50, text: `A` },
      { x: 200, y: 200, text: `B` },
    ]
    const result = place_and_expect_finite(anchors)
    for (const [idx, key] of Object.keys(result).entries()) {
      const dist = Math.hypot(result[key].x - anchors[idx].x, result[key].y - anchors[idx].y)
      expect(dist).toBeLessThan(40)
    }
  })

  test(`falls back to clamped offset when exceeding max_labels`, () => {
    // Points spread across the plot, including near edges
    const points = Array.from({ length: 10 }, (_, idx) => ({
      x: idx * 40,
      y: idx * 30,
      text: `P${idx}`,
    }))
    const result = place_and_expect_finite(points, { ...default_config, max_labels: 5 })
    // All fallback positions must stay within plot bounds (pad=10 each side)
    for (const pos of Object.values(result)) {
      expect(pos.x).toBeGreaterThanOrEqual(10)
      expect(pos.x).toBeLessThanOrEqual(390)
      expect(pos.y).toBeGreaterThanOrEqual(10)
      expect(pos.y).toBeLessThanOrEqual(290)
    }
    // Interior points still get the +5 offset (not clamped)
    const mid_key = Object.keys(result)[3]
    expect(result[mid_key].x).toBe(points[3].x + 5)
    expect(result[mid_key].y).toBe(points[3].y)
  })

  test(`fallback clamps right-edge point to keep label within bounds`, () => {
    // Two points to exceed max_labels=1 and trigger fallback.
    // Second point at far right edge: anchor_x=380, +5 gives 385,
    // but label width ≈ 22px so right edge = 407 > max_x=390
    // Should clamp x to max_x - label_width = 390 - 22 = 368
    const points = [
      { x: 50, y: 50, text: `OK` },
      { x: 380, y: 150, text: `RR` },
    ]
    const result = place_and_expect_finite(points, { ...default_config, max_labels: 1 })
    const edge_key = Object.keys(result)[1]
    const label_w = estimate_label_width(`RR`)
    expect(result[edge_key].x).toBe(390 - label_w)
  })

  test(`candidate_gap controls candidate distance from marker radius`, () => {
    const series = make_labeled_series([{ x: 100, y: 100, text: `A` }])
    const no_gap = compute_label_positions(
      series,
      { ...default_config, sa_iterations: 0, candidate_gap: 0 },
      default_scales,
      default_bounds,
    )[`0-0`]
    const large_gap = compute_label_positions(
      series,
      { ...default_config, sa_iterations: 0, candidate_gap: 20 },
      default_scales,
      default_bounds,
    )[`0-0`]

    expect(Math.hypot(no_gap.x - 100, no_gap.y - 100)).toBeLessThan(
      Math.hypot(large_gap.x - 100, large_gap.y - 100),
    )
  })

  test(`SA minimizes bounding-box overlap for dense cluster`, () => {
    const points = [
      { x: 100, y: 100, text: `Alpha` },
      { x: 102, y: 101, text: `Beta` },
      { x: 99, y: 103, text: `Gamma` },
      { x: 101, y: 99, text: `Delta` },
      { x: 103, y: 102, text: `Epsilon` },
      { x: 98, y: 100, text: `Zeta` },
    ]
    const result = place_and_expect_finite(points, { ...default_config, sa_iterations: 2000 })
    const entries = Object.entries(result)

    const font_size = 10
    const label_rects = entries.map(([_key, pos], idx) => {
      const label_width = estimate_label_width(points[idx].text, font_size)
      const label_height = font_size * 1.2
      return {
        x: pos.x - label_width / 2,
        y: pos.y - label_height / 2,
        w: label_width,
        h: label_height,
      }
    })

    let total_overlap = 0
    for (let idx = 0; idx < label_rects.length; idx++) {
      for (let jdx = idx + 1; jdx < label_rects.length; jdx++) {
        total_overlap += rect_overlap_area(label_rects[idx], label_rects[jdx])
      }
    }
    expect(total_overlap).toBeLessThan(50)
  })

  const cluster_points = Array.from({ length: 6 }, (_, idx) => ({
    x: 100 + idx,
    y: 100 + idx,
    text: `C${idx}`,
  }))
  const cull_points = [...cluster_points, { x: 350, y: 50, text: `Lonely` }]
  const all_label_ids = cull_points.map((_point, idx) => `0-${idx}`)

  test.each([
    { label: `disabled culling keeps all`, max_neighbors: undefined, kept: all_label_ids },
    {
      label: `tight budget culls dense cluster, keeps isolated`,
      max_neighbors: { count: 1, radius: 30 },
      kept: [`0-6`],
    },
    {
      label: `generous budget keeps all`,
      max_neighbors: { count: 5, radius: 30 },
      kept: all_label_ids,
    },
    {
      label: `small radius keeps all`,
      max_neighbors: { count: 1, radius: 1 },
      kept: all_label_ids,
    },
  ])(`max_neighbors $label`, ({ max_neighbors, kept }) => {
    const result = compute_label_positions(
      make_labeled_series(cull_points),
      { ...default_config, max_neighbors },
      default_scales,
      default_bounds,
    )
    expect(Object.keys(result).sort()).toEqual([...kept].sort())
  })

  test(`high distance weight keeps labels closer to anchors than high overlap weight`, () => {
    const anchors = [
      { x: 50, y: 50, text: `A` },
      { x: 52, y: 51, text: `B` },
    ]
    const series = make_labeled_series(anchors)
    const result_dist = compute_label_positions(
      series,
      { ...default_config, weights: { distance: 100, overlap: 0 } },
      default_scales,
      default_bounds,
    )
    const result_overlap = compute_label_positions(
      series,
      { ...default_config, weights: { distance: 0, overlap: 100 } },
      default_scales,
      default_bounds,
    )

    const avg_dist = (res: Record<string, { x: number; y: number }>) => {
      const positions = Object.values(res)
      const dist_sum = positions.reduce(
        (sum, pos, idx) => sum + Math.hypot(pos.x - anchors[idx].x, pos.y - anchors[idx].y),
        0,
      )
      return dist_sum / positions.length
    }

    expect(avg_dist(result_dist)).toBeLessThan(avg_dist(result_overlap))
  })
})
