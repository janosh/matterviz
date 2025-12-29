import { constrain_tooltip_position, find_best_plot_area } from '$lib/plot/layout'
import { describe, expect, it, test } from 'vitest'

describe(`layout utility functions`, () => {
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
