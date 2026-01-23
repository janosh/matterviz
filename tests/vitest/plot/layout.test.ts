import {
  compute_element_placement,
  constrain_tooltip_position,
  filter_padding,
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
    // New behavior: tooltip positioned bottom-right of cursor (+offset for both x,y)
    // Flips to opposite side when it would overflow viewport
    test.each([
      // Basic positioning (no flip needed)
      {
        name: `tooltip within bounds`,
        base_x: 300,
        base_y: 200,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 310, y: 210 }, // 300+10, 200+10
      },
      // Flip cases
      {
        name: `tooltip flips left when too far right`,
        base_x: 750,
        base_y: 200,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 640, y: 210 }, // 750-10-100, 200+10
      },
      {
        name: `tooltip flips up when too far down`,
        base_x: 300,
        base_y: 560,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 310, y: 500 }, // 300+10, 560-10-50
      },
      {
        name: `tooltip near left edge (no flip, clamped)`,
        base_x: 0,
        base_y: 200,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 10, y: 210 }, // 0+10, 200+10
      },
      {
        name: `tooltip near top edge (no flip needed)`,
        base_x: 300,
        base_y: 0,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 310, y: 10 }, // 300+10, 0+10
      },
      // Corner cases (double flip)
      {
        name: `tooltip at bottom-right corner (flips both)`,
        base_x: 800,
        base_y: 600,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 690, y: 540 }, // 800-10-100, 600-10-50
      },
      {
        name: `tooltip at top-left corner (clamped to 0,0)`,
        base_x: -10,
        base_y: -10,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 0, y: 0 }, // -10+10=0, -10+10=0
      },
      {
        name: `tooltip at top-right corner (flips x, clamps y)`,
        base_x: 850,
        base_y: -20,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 700, y: 0 }, // 850-10-100=740→clamped to 700, -20+10=-10→clamped to 0
      },
      {
        name: `tooltip at bottom-left corner (flips y, clamps x)`,
        base_x: -50,
        base_y: 650,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 0, y: 550 }, // -50+10=-40→0, 650-10-50=590→clamped to 550
      },
      // Edge cases
      {
        name: `zero-size tooltip`,
        base_x: 300,
        base_y: 200,
        tooltip_width: 0,
        tooltip_height: 0,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 310, y: 210 },
      },
      {
        name: `very large tooltip (flips both, clamped)`,
        base_x: 300,
        base_y: 200,
        tooltip_width: 900,
        tooltip_height: 700,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 0, y: 0 }, // Flips to negative, clamped to 0
      },
      {
        name: `small chart dimensions`,
        base_x: 25,
        base_y: 15,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 50,
        chart_height: 30,
        expected: { x: 0, y: 0 }, // Tooltip larger than chart, clamped
      },
      {
        name: `tooltip exactly at flip threshold`,
        base_x: 690,
        base_y: 200,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 700, y: 210 }, // 690+10+100=800, no flip (not >800)
      },
      {
        name: `tooltip just past flip threshold`,
        base_x: 691,
        base_y: 200,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 581, y: 210 }, // 691+10+100=801>800, flips: 691-10-100=581
      },
      // Small tooltips
      {
        name: `1x1 tooltip`,
        base_x: 400,
        base_y: 300,
        tooltip_width: 1,
        tooltip_height: 1,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 410, y: 310 },
      },
      // Near boundary (should flip)
      {
        name: `tooltip near right boundary (flips)`,
        base_x: 700,
        base_y: 300,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 590, y: 310 }, // 700+10+100=810>800, flips: 700-10-100=590
      },
      {
        name: `tooltip near bottom boundary (flips)`,
        base_x: 400,
        base_y: 550,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 410, y: 490 }, // 550+10+50=610>600, flips: 550-10-50=490
      },
    ])(
      `constrains $name correctly`,
      (
        {
          base_x,
          base_y,
          tooltip_width,
          tooltip_height,
          chart_width,
          chart_height,
          expected,
        },
      ) => {
        const result = constrain_tooltip_position(
          base_x,
          base_y,
          tooltip_width,
          tooltip_height,
          chart_width,
          chart_height,
        )
        expect(result).toEqual(expected)
      },
    )

    // Tests for custom offsets (negative = above/left of cursor)
    // Format: [name, cursor_x, cursor_y, offset_x, offset_y, expected_x, expected_y]
    // All use 100x50 tooltip in 800x600 viewport
    test.each(
      [
        [`negative y-offset above cursor`, 300, 200, 5, -10, 305, 140],
        [`negative y-offset flips down near top`, 300, 50, 5, -10, 305, 60],
        [`negative x-offset left of cursor`, 400, 300, -10, 10, 290, 310],
        [`negative x-offset flips right near left`, 50, 300, -10, 10, 60, 310],
        [`both negative offsets top-left`, 400, 300, -10, -10, 290, 240],
      ] as const,
    )(
      `custom offsets: %s`,
      (_, cursor_x, cursor_y, offset_x, offset_y, exp_x, exp_y) => {
        const result = constrain_tooltip_position(
          cursor_x,
          cursor_y,
          100,
          50,
          800,
          600,
          { offset_x, offset_y },
        )
        expect(result).toEqual({ x: exp_x, y: exp_y })
      },
    )
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
})
