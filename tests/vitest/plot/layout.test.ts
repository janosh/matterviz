import {
  constrain_tooltip_position,
  find_best_legend_placement,
  get_chart_dimensions,
} from '$lib/plot/layout'
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

  describe(`get_chart_dimensions`, () => {
    test.each([
      // Standard cases
      {
        name: `standard dimensions`,
        width: 800,
        height: 600,
        padding: { t: 20, b: 40, l: 60, r: 30 },
        expected: { width: 710, height: 540 },
      },
      {
        name: `square dimensions`,
        width: 400,
        height: 400,
        padding: { t: 10, b: 10, l: 10, r: 10 },
        expected: { width: 380, height: 380 },
      },
      {
        name: `no padding`,
        width: 500,
        height: 300,
        padding: { t: 0, b: 0, l: 0, r: 0 },
        expected: { width: 500, height: 300 },
      },
      {
        name: `asymmetric padding`,
        width: 1000,
        height: 800,
        padding: { t: 50, b: 100, l: 150, r: 25 },
        expected: { width: 825, height: 650 },
      },
      // Edge cases
      {
        name: `zero dimensions`,
        width: 0,
        height: 0,
        padding: { t: 10, b: 10, l: 10, r: 10 },
        expected: { width: -20, height: -20 },
      },
      {
        name: `padding larger than dimensions`,
        width: 100,
        height: 100,
        padding: { t: 50, b: 60, l: 70, r: 80 },
        expected: { width: -50, height: -10 },
      },
      {
        name: `negative padding`,
        width: 400,
        height: 300,
        padding: { t: -10, b: -20, l: -30, r: -40 },
        expected: { width: 470, height: 330 },
      },
      {
        name: `decimal padding`,
        width: 400,
        height: 300,
        padding: { t: 10.5, b: 20.7, l: 30.3, r: 40.1 },
        expected: { width: 329.6, height: 268.8 },
      },
      // More edge cases
      {
        name: `very small dimensions`,
        width: 10,
        height: 5,
        padding: { t: 1, b: 1, l: 1, r: 1 },
        expected: { width: 8, height: 3 },
      },
      {
        name: `very large dimensions`,
        width: 10000,
        height: 8000,
        padding: { t: 100, b: 200, l: 150, r: 50 },
        expected: { width: 9800, height: 7700 },
      },
      {
        name: `only top and bottom padding`,
        width: 600,
        height: 400,
        padding: { t: 50, b: 50, l: 0, r: 0 },
        expected: { width: 600, height: 300 },
      },
      {
        name: `only left and right padding`,
        width: 600,
        height: 400,
        padding: { t: 0, b: 0, l: 100, r: 100 },
        expected: { width: 400, height: 400 },
      },
      {
        name: `mixed positive and negative padding`,
        width: 500,
        height: 400,
        padding: { t: 20, b: -10, l: -5, r: 15 },
        expected: { width: 490, height: 390 },
      },
      {
        name: `zero width, non-zero height`,
        width: 0,
        height: 100,
        padding: { t: 10, b: 10, l: 5, r: 5 },
        expected: { width: -10, height: 80 },
      },
      {
        name: `non-zero width, zero height`,
        width: 100,
        height: 0,
        padding: { t: 10, b: 10, l: 5, r: 5 },
        expected: { width: 90, height: -20 },
      },
    ])(`calculates $name correctly`, ({ width, height, padding, expected }) => {
      const result = get_chart_dimensions(width, height, padding)
      // Use approximate equality for floating-point comparisons
      expect(result.width).toBeCloseTo(expected.width, 10)
      expect(result.height).toBeCloseTo(expected.height, 10)
    })
  })

  describe(`find_best_legend_placement`, () => {
    const base_config = {
      plot_width: 400,
      plot_height: 300,
      padding: { t: 20, b: 40, l: 50, r: 20 },
      margin: 10,
      legend_size: { width: 100, height: 60 },
    }

    it(`should place legend in top-left corner when no points exist`, () => {
      const result = find_best_legend_placement([], base_config)

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

      const result = find_best_legend_placement(points, base_config)

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

      const result = find_best_legend_placement(points, base_config)

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

      const result = find_best_legend_placement(points, base_config)

      // Should prefer top-left or bottom-left (both have 0 points)
      expect([`top-left`, `bottom-left`]).toContain(result.position)
    })

    it(`should respect margin settings`, () => {
      const config_with_margin = { ...base_config, margin: 20 }
      const result = find_best_legend_placement([], config_with_margin)

      // Top-left corner with margin
      expect(result.x).toBe(base_config.padding.l + 20)
      expect(result.y).toBe(base_config.padding.t + 20)
    })

    it(`should calculate correct coordinates within plot area`, () => {
      const result = find_best_legend_placement([], base_config)

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
      const result = find_best_legend_placement([], base_config)

      expect(typeof result.transform).toBe(`string`)
    })
  })
})
