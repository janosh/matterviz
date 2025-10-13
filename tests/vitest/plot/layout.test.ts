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
    const cfg = {
      plot_width: 400,
      plot_height: 300,
      padding: { t: 20, b: 40, l: 50, r: 20 },
      margin: 10,
      legend_size: { width: 100, height: 60 },
    }
    const { l, t } = cfg.padding
    const { plot_width: w, plot_height: h } = cfg

    it(`places in top-left when no points exist`, () => {
      const result = find_best_plot_area([], cfg)
      expect(result.position).toBe(`top-left`)
    })

    it(`respects margin settings`, () => {
      const result = find_best_plot_area([], { ...cfg, margin: 20 })
      expect(result.x).toBe(l + 20)
      expect(result.y).toBe(t + 20)
    })

    it(`returns valid coordinates and transform`, () => {
      const result = find_best_plot_area([], cfg)
      expect(result.x).toBeGreaterThanOrEqual(l)
      expect(result.x).toBeLessThanOrEqual(l + w)
      expect(result.y).toBeGreaterThanOrEqual(t)
      expect(result.y).toBeLessThanOrEqual(t + h)
      expect(typeof result.transform).toBe(`string`)
    })

    test.each([
      [
        `top-left cluster`,
        Array.from({ length: 20 }, () => ({ x: l + 50, y: t + 50 })),
        [`bottom-right`, `right-center`, `bottom-center`],
      ],
      [
        `bottom-right cluster`,
        Array.from(
          { length: 10 },
          (_, i) => ({ x: l + w - 50 + i * 2, y: t + h - 50 + i * 2 }),
        ),
        [`top-left`, `left-center`, `top-center`],
      ],
      [
        `left vertical line`,
        Array.from({ length: 15 }, (_, i) => ({ x: l + 30, y: t + i * 20 })),
        [`top-right`, `bottom-right`, `right-center`],
      ],
      [
        `top horizontal line`,
        Array.from({ length: 15 }, (_, i) => ({ x: l + i * 25, y: t + 30 })),
        [`bottom-left`, `bottom-right`, `bottom-center`],
      ],
      [
        `center point`,
        [{ x: l + w / 2, y: t + h / 2 }],
        [`top-left`, `top-right`, `bottom-left`, `bottom-right`],
      ],
      [
        `center-left point`,
        [{ x: l + 50, y: t + h / 2 }],
        [`top-right`, `bottom-right`, `right-center`],
      ],
    ])(`maximizes distance: %s`, (_, points, expected) => {
      expect(expected).toContain(find_best_plot_area(points, cfg).position)
    })

    it(`handles large datasets efficiently via subsampling`, () => {
      const many_points = Array.from({ length: 1000 }, (_, i) => ({
        x: l + (i % 100),
        y: t + h - (i % 100),
      }))
      const start = performance.now()
      const result = find_best_plot_area(many_points, cfg)
      expect(performance.now() - start).toBeLessThan(50)
      expect(result.position).not.toBe(`bottom-left`)
    })
  })
})
