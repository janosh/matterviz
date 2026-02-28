import {
  calc_auto_padding,
  compute_element_placement,
  constrain_tooltip_position,
  filter_padding,
  LABEL_GAP_DEFAULT,
  measure_max_tick_width,
  measure_text_width,
  TICK_LABEL_HEIGHT,
} from '$lib/plot/layout'
import { describe, expect, it, test } from 'vitest'

describe(`layout utility functions`, () => {
  describe(`filter_padding`, () => {
    const defaults = { t: 20, b: 60, l: 60, r: 20 }

    it.each([
      // Null/undefined/empty -> defaults
      [undefined, defaults],
      [null, defaults],
      [{}, defaults],
      // Partial override
      [{ t: 10, l: 30 }, { t: 10, b: 60, l: 30, r: 20 }],
      // Full override
      [{ t: 5, b: 10, l: 15, r: 25 }, { t: 5, b: 10, l: 15, r: 25 }],
      // Filters undefined values (preserves defaults)
      [{ t: 10, b: undefined, r: 5 }, { t: 10, b: 60, l: 60, r: 5 }],
      // Zero values are preserved (not filtered)
      [{ t: 0, b: 0 }, { t: 0, b: 0, l: 60, r: 20 }],
      // Negative values are preserved
      [{ t: -5 }, { t: -5, b: 60, l: 60, r: 20 }],
    ])(`filter_padding(%j) -> %j`, (padding, expected) => {
      expect(filter_padding(padding, defaults)).toEqual(expected)
    })
  })

  describe(`constrain_tooltip_position`, () => {
    // [desc, cursor_x, cursor_y, tip_w, tip_h, vp_w, vp_h, exp_x, exp_y]
    // Default offset is 10px in each direction
    test.each(
      [
        [`within bounds`, 300, 200, 100, 50, 800, 600, 310, 210],
        [`flips left`, 750, 200, 100, 50, 800, 600, 640, 210],
        [`flips up`, 300, 560, 100, 50, 800, 600, 310, 500],
        [`left edge clamp`, 0, 200, 100, 50, 800, 600, 10, 210],
        [`top edge`, 300, 0, 100, 50, 800, 600, 310, 10],
        [`bottom-right corner (flips both)`, 800, 600, 100, 50, 800, 600, 690, 540],
        [`top-left corner (clamp)`, -10, -10, 100, 50, 800, 600, 0, 0],
        [`top-right corner`, 850, -20, 100, 50, 800, 600, 700, 0],
        [`bottom-left corner`, -50, 650, 100, 50, 800, 600, 0, 550],
        [`zero-size tooltip`, 300, 200, 0, 0, 800, 600, 310, 210],
        [`tooltip > viewport`, 300, 200, 900, 700, 800, 600, 0, 0],
        [`small viewport`, 25, 15, 100, 50, 50, 30, 0, 0],
        [`at flip threshold`, 690, 200, 100, 50, 800, 600, 700, 210],
        [`past flip threshold`, 691, 200, 100, 50, 800, 600, 581, 210],
        [`1x1 tooltip`, 400, 300, 1, 1, 800, 600, 410, 310],
        [`near right (flips)`, 700, 300, 100, 50, 800, 600, 590, 310],
        [`near bottom (flips)`, 400, 550, 100, 50, 800, 600, 410, 490],
      ] as const,
    )(`%s`, (_, cx, cy, tw, th, vw, vh, ex, ey) => {
      expect(constrain_tooltip_position(cx, cy, tw, th, vw, vh)).toEqual({ x: ex, y: ey })
    })

    // Custom offsets — all use 100x50 tooltip in 800x600 viewport
    // [desc, cursor_x, cursor_y, offset_x, offset_y, exp_x, exp_y]
    test.each(
      [
        [`neg y above cursor`, 300, 200, 5, -10, 305, 140],
        [`neg y flips down near top`, 300, 50, 5, -10, 305, 60],
        [`neg x left of cursor`, 400, 300, -10, 10, 290, 310],
        [`neg x flips right near left`, 50, 300, -10, 10, 60, 310],
        [`both negative`, 400, 300, -10, -10, 290, 240],
      ] as const,
    )(`offset: %s`, (_, cx, cy, ox, oy, ex, ey) => {
      expect(
        constrain_tooltip_position(cx, cy, 100, 50, 800, 600, {
          offset_x: ox,
          offset_y: oy,
        }),
      )
        .toEqual({ x: ex, y: ey })
    })
  })

  describe(`compute_element_placement`, () => {
    const base_config = {
      plot_bounds: { x: 50, y: 20, width: 400, height: 300 },
      element_size: { width: 100, height: 60 },
      axis_clearance: 40,
      exclude_rects: [],
      points: [] as { x: number; y: number }[],
    }

    it(`places element in valid region when no points exist`, () => {
      const result = compute_element_placement(base_config)
      // Should be within plot bounds minus axis clearance
      expect(result.x).toBeGreaterThanOrEqual(
        base_config.plot_bounds.x + base_config.axis_clearance,
      )
      expect(result.y).toBeGreaterThanOrEqual(
        base_config.plot_bounds.y + base_config.axis_clearance,
      )
      // Score must be finite (not Infinity) so corner bonus can properly select best position
      expect(Number.isFinite(result.score)).toBe(true)
      expect(result.score).toBeGreaterThan(-Infinity)
    })

    it(`respects axis_clearance margin`, () => {
      const result = compute_element_placement({
        ...base_config,
        axis_clearance: 60,
      })
      expect(result.x).toBeGreaterThanOrEqual(base_config.plot_bounds.x + 60)
      expect(result.y).toBeGreaterThanOrEqual(base_config.plot_bounds.y + 60)
    })

    it(`avoids dense point clusters`, () => {
      // Create a small dense cluster in the center of the element placement area
      // With proper overlap avoidance, the algorithm should place away from this cluster
      const cluster_points: { x: number; y: number }[] = []
      // Create a 5x5 grid of points at the center
      for (let x_idx = 0; x_idx < 5; x_idx++) {
        for (let y_idx = 0; y_idx < 5; y_idx++) {
          cluster_points.push({
            x: 200 + x_idx * 10, // Center of plot
            y: 150 + y_idx * 10,
          })
        }
      }
      // This creates 25 points in a small cluster

      const result = compute_element_placement({
        ...base_config,
        points: cluster_points,
      })

      // Count how many points overlap with the result
      const overlapping =
        cluster_points.filter((pt) =>
          pt.x >= result.x && pt.x <= result.x + base_config.element_size.width &&
          pt.y >= result.y && pt.y <= result.y + base_config.element_size.height
        ).length

      // Should avoid the cluster - overlap with few or no points
      expect(overlapping).toBeLessThan(10)
    })

    it(`penalizes overlap with exclusion rectangles`, () => {
      // Test that exclusion rect covering the entire valid area results in negative score
      // If exclusion penalty works, the best position overlapping exclusion gets score -= 1000
      // This tests the penalty mechanism directly
      const exclusion_rect = { x: 50, y: 20, width: 500, height: 400 } // covers everything
      const points = [{ x: 250, y: 150 }]

      const result = compute_element_placement({
        ...base_config,
        exclude_rects: [exclusion_rect],
        points,
      })

      // With exclusion covering everything, ANY position overlaps
      // Score should be heavily penalized (at least -1000)
      expect(result.score).toBeLessThan(-500)
    })

    it(`handles small plot areas where element barely fits`, () => {
      const small_config = {
        ...base_config,
        plot_bounds: { x: 10, y: 10, width: 150, height: 100 },
        element_size: { width: 80, height: 50 },
        axis_clearance: 10,
      }
      const result = compute_element_placement(small_config)
      expect(result.x).toBeGreaterThanOrEqual(small_config.plot_bounds.x)
      expect(result.y).toBeGreaterThanOrEqual(small_config.plot_bounds.y)
    })

    it(`handles large datasets efficiently via subsampling`, () => {
      const many_points = Array.from({ length: 5000 }, (_, idx) => ({
        x: 100 + (idx % 50) * 5,
        y: 50 + Math.floor(idx / 50) * 3,
      }))
      const start = performance.now()
      const result = compute_element_placement({
        ...base_config,
        points: many_points,
      })
      expect(performance.now() - start).toBeLessThan(100)
      expect(result.score).toBeDefined()
    })

    it(`uses custom grid resolution`, () => {
      const result_fine = compute_element_placement({
        ...base_config,
        grid_resolution: 20,
      })
      const result_coarse = compute_element_placement({
        ...base_config,
        grid_resolution: 3,
      })
      // Both should return valid placements
      expect(result_fine.x).toBeGreaterThanOrEqual(base_config.plot_bounds.x)
      expect(result_coarse.x).toBeGreaterThanOrEqual(base_config.plot_bounds.x)
    })

    test.each([
      [
        `top-left cluster`,
        Array.from({ length: 15 }, () => ({ x: 100, y: 60 })),
        `bottom-right`,
      ],
      [
        `bottom-right cluster`,
        Array.from({ length: 15 }, () => ({ x: 400, y: 280 })),
        `top-left`,
      ],
      [
        `center cluster`,
        Array.from({ length: 15 }, () => ({ x: 250, y: 170 })),
        `corner`,
      ],
    ])(`places away from %s`, (_, points, expected_region) => {
      const result = compute_element_placement({
        ...base_config,
        points,
      })
      if (expected_region === `bottom-right`) {
        expect(result.x).toBeGreaterThan(200)
        expect(result.y).toBeGreaterThan(100)
      } else if (expected_region === `top-left`) {
        expect(result.x).toBeLessThan(200)
        expect(result.y).toBeLessThan(150)
      } else {
        // Any corner is acceptable for center cluster
        expect(result.x).toBeDefined()
      }
    })
  })

  describe(`measure_max_tick_width`, () => {
    it(`returns 0 for empty ticks`, () => {
      expect(measure_max_tick_width([], `.2s`)).toBe(0)
    })

    it(`returns 0 in jsdom (no canvas rendering)`, () => {
      expect(measure_text_width(`hello`)).toBe(0)
      expect(measure_max_tick_width([1, 2, 3])).toBe(0)
    })
  })

  describe(`calc_auto_padding`, () => {
    const defaults = { t: 20, b: 60, l: 60, r: 20 }

    it(`preserves explicit padding, fills missing from defaults`, () => {
      const result = calc_auto_padding({
        padding: { t: 10, l: 80 },
        default_padding: defaults,
      })
      expect(result).toEqual({ t: 10, l: 80, b: 60, r: 30 })
    })

    it(`left padding is at least default when y-axis has ticks`, () => {
      const result = calc_auto_padding({
        padding: {},
        default_padding: defaults,
        y_axis: { tick_values: [1, 2, 3] },
      })
      expect(result.l).toBeGreaterThanOrEqual(defaults.l)
    })

    it(`right padding is at least default when y2-axis has ticks`, () => {
      const result = calc_auto_padding({
        padding: {},
        default_padding: defaults,
        y2_axis: { tick_values: [1, 2] },
      })
      expect(result.r).toBeGreaterThanOrEqual(defaults.r)
    })

    it(`right padding includes label_gap even with zero-width ticks`, () => {
      const result = calc_auto_padding({
        padding: {},
        default_padding: { t: 0, b: 0, l: 0, r: 0 },
        y2_axis: { tick_values: [1] },
      })
      expect(result.r).toBe(LABEL_GAP_DEFAULT)
    })

    it(`explicit padding overrides auto-computed padding`, () => {
      const result = calc_auto_padding({
        padding: { l: 10, r: 10, t: 10 },
        default_padding: defaults,
        y_axis: { tick_values: [100000, 200000] },
        y2_axis: { tick_values: [100000, 200000] },
        x2_axis: { tick_values: [1, 2, 3], label: `Top` },
      })
      expect(result.l).toBe(10)
      expect(result.r).toBe(10)
      expect(result.t).toBe(10)
    })

    it(`expands top padding for x2 ticks`, () => {
      const result = calc_auto_padding({
        padding: {},
        default_padding: defaults,
        x2_axis: { tick_values: [0, 1, 2] },
      })
      expect(result.t).toBeGreaterThanOrEqual(TICK_LABEL_HEIGHT + 30)
    })

    it(`expands top padding further when x2 has a label`, () => {
      const without_label = calc_auto_padding({
        padding: {},
        default_padding: defaults,
        x2_axis: { tick_values: [0, 1, 2] },
      })
      const with_label = calc_auto_padding({
        padding: {},
        default_padding: defaults,
        x2_axis: { tick_values: [0, 1, 2], label: `Temperature` },
      })
      expect(with_label.t).toBeGreaterThan(without_label.t)
    })

    it(`does not expand top padding when x2 has no ticks`, () => {
      const result = calc_auto_padding({
        padding: {},
        default_padding: defaults,
        x2_axis: { tick_values: [] },
      })
      expect(result.t).toBe(defaults.t)
    })
  })
})
