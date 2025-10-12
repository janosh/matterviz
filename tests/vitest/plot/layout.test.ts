import { constrain_tooltip_position, find_best_plot_area } from '$lib/plot/layout'
import { describe, expect, it, test } from 'vitest'

describe(`layout utility functions`, () => {
  describe(`constrain_tooltip_position`, () => {
    test.each([
      // Basic positioning
      {
        name: `tooltip within bounds`,
        base_x: 300,
        base_y: 200,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 305, y: 190 },
      },
      {
        name: `tooltip too far right`,
        base_x: 750,
        base_y: 200,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 690, y: 190 },
      },
      {
        name: `tooltip too far down`,
        base_x: 300,
        base_y: 580,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 305, y: 540 },
      },
      {
        name: `tooltip too far left`,
        base_x: 0,
        base_y: 200,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 10, y: 190 },
      },
      {
        name: `tooltip too far up`,
        base_x: 300,
        base_y: 0,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 305, y: 10 },
      },
      // Corner cases
      {
        name: `tooltip at bottom-right corner`,
        base_x: 800,
        base_y: 600,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 690, y: 540 },
      },
      {
        name: `tooltip at top-left corner`,
        base_x: -10,
        base_y: -10,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 10, y: 10 },
      },
      {
        name: `tooltip at top-right corner`,
        base_x: 850,
        base_y: -20,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 690, y: 10 },
      },
      {
        name: `tooltip at bottom-left corner`,
        base_x: -50,
        base_y: 650,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 10, y: 540 },
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
        expected: { x: 305, y: 190 },
      },
      {
        name: `very large tooltip`,
        base_x: 300,
        base_y: 200,
        tooltip_width: 900,
        tooltip_height: 700,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 10, y: 10 },
      },
      {
        name: `small chart dimensions`,
        base_x: 25,
        base_y: 15,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 50,
        chart_height: 30,
        expected: { x: 10, y: 10 },
      },
      {
        name: `tooltip exactly at right edge`,
        base_x: 695,
        base_y: 200,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 690, y: 190 },
      },
      {
        name: `tooltip exactly at bottom edge`,
        base_x: 300,
        base_y: 545,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 305, y: 535 },
      },
      // Very small tooltips
      {
        name: `1x1 tooltip`,
        base_x: 400,
        base_y: 300,
        tooltip_width: 1,
        tooltip_height: 1,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 405, y: 290 },
      },
      // Near boundary positioning
      {
        name: `tooltip near right boundary`,
        base_x: 700,
        base_y: 300,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 690, y: 290 },
      },
      {
        name: `tooltip near bottom boundary`,
        base_x: 400,
        base_y: 550,
        tooltip_width: 100,
        tooltip_height: 50,
        chart_width: 800,
        chart_height: 600,
        expected: { x: 405, y: 540 },
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
  })

  describe(`find_best_plot_area`, () => {
    const base_config = {
      plot_width: 400,
      plot_height: 300,
      padding: { t: 20, b: 40, l: 50, r: 20 },
      margin: 10,
      legend_size: { width: 100, height: 60 },
    }

    it(`should place legend in top-left corner when no points exist`, () => {
      const result = find_best_plot_area([], base_config)

      expect(result.position).toBe(`top-left`)
      expect(result.x).toBeGreaterThan(0)
      expect(result.y).toBeGreaterThan(0)
    })

    it(`should avoid regions with many points`, () => {
      // Create points clustered in top-left
      const points = Array.from({ length: 20 }, () => ({
        x: base_config.padding.l + 50,
        y: base_config.padding.t + 50,
      }))

      const result = find_best_plot_area(points, base_config)

      // Should NOT be top-left since that's crowded
      expect(result.position).not.toBe(`top-left`)
    })

    it(`should prefer corners over edge midpoints`, () => {
      // Create points only in center, leaving all corners clear
      const points = [
        {
          x: base_config.padding.l + base_config.plot_width / 2,
          y: base_config.padding.t + base_config.plot_height / 2,
        },
      ]

      const result = find_best_plot_area(points, base_config)

      // Should be one of the four corners
      const corners = [`top-left`, `top-right`, `bottom-left`, `bottom-right`]
      expect(corners).toContain(result.position)
    })

    it(`should choose least populated region among similar options`, () => {
      // Create 5 points in top-right, 3 in bottom-right, none elsewhere
      const points = [
        ...Array.from({ length: 5 }, () => ({
          x: base_config.padding.l + base_config.plot_width - 20,
          y: base_config.padding.t + 20,
        })),
        ...Array.from({ length: 3 }, () => ({
          x: base_config.padding.l + base_config.plot_width - 20,
          y: base_config.padding.t + base_config.plot_height - 20,
        })),
      ]

      const result = find_best_plot_area(points, base_config)

      // Should prefer top-left or bottom-left (both have 0 points)
      expect([`top-left`, `bottom-left`]).toContain(result.position)
    })

    it(`should respect margin settings`, () => {
      const config_with_margin = { ...base_config, margin: 20 }
      const result = find_best_plot_area([], config_with_margin)

      // Top-left corner with margin
      expect(result.x).toBe(base_config.padding.l + 20)
      expect(result.y).toBe(base_config.padding.t + 20)
    })

    it(`should calculate correct coordinates within plot area`, () => {
      const result = find_best_plot_area([], base_config)

      // Should be within plot area boundaries
      expect(result.x).toBeGreaterThanOrEqual(base_config.padding.l)
      expect(result.x).toBeLessThanOrEqual(
        base_config.padding.l + base_config.plot_width,
      )
      expect(result.y).toBeGreaterThanOrEqual(base_config.padding.t)
      expect(result.y).toBeLessThanOrEqual(
        base_config.padding.t + base_config.plot_height,
      )
    })

    it(`should always return a transform string`, () => {
      const result = find_best_plot_area([], base_config)

      expect(typeof result.transform).toBe(`string`)
    })
  })
})
