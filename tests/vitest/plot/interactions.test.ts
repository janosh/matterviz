import { get_relative_coords, is_valid_dimension } from '$lib/plot/interactions'
import { describe, expect, test, vi } from 'vitest'

describe(`interactions utility functions`, () => {
  describe(`get_relative_coords`, () => {
    test.each([
      {
        name: `returns relative coordinates for valid event`,
        client_x: 300,
        client_y: 200,
        svg_bounds: { left: 100, top: 50, width: 800, height: 600 },
        has_bounds_method: true,
        has_current_target: true,
        expected: { x: 200, y: 150 },
      },
      {
        name: `handles zero client coordinates`,
        client_x: 0,
        client_y: 0,
        svg_bounds: { left: 50, top: 25, width: 800, height: 600 },
        has_bounds_method: true,
        has_current_target: true,
        expected: { x: -50, y: -25 },
      },
      {
        name: `handles negative relative coordinates`,
        client_x: 100,
        client_y: 50,
        svg_bounds: { left: 200, top: 150, width: 800, height: 600 },
        has_bounds_method: true,
        has_current_target: true,
        expected: { x: -100, y: -100 },
      },
      {
        name: `handles large client coordinates`,
        client_x: 9999,
        client_y: 8888,
        svg_bounds: { left: 10, top: 10, width: 800, height: 600 },
        has_bounds_method: true,
        has_current_target: true,
        expected: { x: 9989, y: 8878 },
      },
      {
        name: `handles decimal coordinates`,
        client_x: 300.75,
        client_y: 200.5,
        svg_bounds: { left: 100.5, top: 50.25, width: 800, height: 600 },
        has_bounds_method: true,
        has_current_target: true,
        expected: { x: 200.25, y: 150.25 },
      },
      {
        name: `handles coordinates at SVG origin`,
        client_x: 100,
        client_y: 50,
        svg_bounds: { left: 100, top: 50, width: 800, height: 600 },
        has_bounds_method: true,
        has_current_target: true,
        expected: { x: 0, y: 0 },
      },
      {
        name: `handles coordinates at SVG bottom-right`,
        client_x: 900,
        client_y: 650,
        svg_bounds: { left: 100, top: 50, width: 800, height: 600 },
        has_bounds_method: true,
        has_current_target: true,
        expected: { x: 800, y: 600 },
      },
      {
        name: `handles very small SVG bounds`,
        client_x: 11,
        client_y: 6,
        svg_bounds: { left: 10, top: 5, width: 2, height: 2 },
        has_bounds_method: true,
        has_current_target: true,
        expected: { x: 1, y: 1 },
      },
      {
        name: `returns null when currentTarget is null`,
        client_x: 300,
        client_y: 200,
        svg_bounds: null,
        has_bounds_method: false,
        has_current_target: false,
        expected: null,
      },
      {
        name: `returns null when currentTarget is undefined`,
        client_x: 300,
        client_y: 200,
        svg_bounds: undefined,
        has_bounds_method: false,
        has_current_target: false,
        expected: null,
      },
      {
        name: `returns null when getBoundingClientRect is undefined`,
        client_x: 300,
        client_y: 200,
        svg_bounds: null,
        has_bounds_method: false,
        has_current_target: true,
        expected: null,
      },
    ])(
      `$name`,
      (
        {
          client_x,
          client_y,
          svg_bounds,
          has_bounds_method,
          has_current_target,
          expected,
        },
      ) => {
        let mock_svg: SVGElement | null = null
        const mock_event: MouseEvent = (() => {
          if (has_current_target) {
            if (has_bounds_method && svg_bounds) {
              mock_svg = {
                getBoundingClientRect: vi.fn(() => svg_bounds),
              } as unknown as SVGElement
            } else {
              mock_svg = {} as SVGElement
            }
          }

          return {
            clientX: client_x,
            clientY: client_y,
            currentTarget: mock_svg,
          } as unknown as MouseEvent
        })()

        const result = get_relative_coords(mock_event)

        expect(result).toEqual(expected)
        if (has_bounds_method && svg_bounds && mock_svg) {
          expect(mock_svg.getBoundingClientRect).toHaveBeenCalledOnce()
        }
      },
    )
  })

  describe(`is_valid_dimension`, () => {
    test.each([
      // Basic range validation
      { val: 50, min: 0, max: 100, expected: true },
      { val: 0, min: 0, max: 100, expected: true },
      { val: 100, min: 0, max: 100, expected: true },
      { val: -1, min: 0, max: 100, expected: false },
      { val: 101, min: 0, max: 100, expected: false },
      { val: 50.5, min: 0, max: 100, expected: true },
      { val: 0.1, min: 0, max: 100, expected: true },
      { val: 99.9, min: 0, max: 100, expected: true },

      // Negative ranges
      { val: -50, min: -100, max: 0, expected: true },
      { val: -150, min: -100, max: 0, expected: false },
      { val: 50, min: -100, max: 0, expected: false },
      { val: -100, min: -100, max: 0, expected: true },
      { val: 0, min: -100, max: 0, expected: true },

      // Zero range (single point)
      { val: 42, min: 42, max: 42, expected: true },
      { val: 41, min: 42, max: 42, expected: false },
      { val: 43, min: 42, max: 42, expected: false },
      { val: 42.0, min: 42, max: 42, expected: true },

      // Inverted range (max < min) - technically invalid but should handle gracefully
      { val: 50, min: 100, max: 0, expected: false },
      { val: 0, min: 100, max: 0, expected: false },
      { val: 100, min: 100, max: 0, expected: false },
      { val: 75, min: 100, max: 0, expected: false },

      // Very large numbers
      { val: 1e10, min: 0, max: 2e10, expected: true },
      { val: 3e10, min: 0, max: 2e10, expected: false },
      { val: 1e15, min: 1e14, max: 2e15, expected: true },
      { val: 9e14, min: 1e14, max: 2e15, expected: true }, // Actually within range

      // Very small numbers
      { val: 1e-10, min: 0, max: 1e-5, expected: true },
      { val: 1e-3, min: 0, max: 1e-5, expected: false },
      { val: 5e-8, min: 1e-10, max: 1e-6, expected: true },
      { val: 1e-12, min: 1e-10, max: 1e-6, expected: false },

      // Decimal precision edge cases
      { val: 0.1 + 0.2, min: 0.3, max: 0.4, expected: true }, // JavaScript precision issues
      { val: 1.0000000000001, min: 1, max: 1.1, expected: true },
      { val: 0.9999999999999, min: 0.9, max: 1, expected: true },

      // Special numeric values
      { val: NaN, min: 0, max: 100, expected: false },
      { val: Infinity, min: 0, max: 100, expected: false },
      { val: -Infinity, min: 0, max: 100, expected: false },
      { val: 50, min: -Infinity, max: Infinity, expected: true },
      { val: NaN, min: -Infinity, max: Infinity, expected: false },
      { val: Infinity, min: -Infinity, max: Infinity, expected: true }, // Actually valid

      // Edge cases with infinity ranges
      { val: 1e100, min: 0, max: Infinity, expected: true }, // Actually valid
      { val: -1e100, min: -Infinity, max: 0, expected: true }, // Actually valid

      // Zero values
      { val: 0, min: 0, max: 0, expected: true },
      { val: -0, min: 0, max: 0, expected: true },
      { val: 0, min: -1, max: 1, expected: true },
      { val: -0, min: -1, max: 1, expected: true },

      // Boundary precision
      { val: 99.99999999999999, min: 0, max: 100, expected: true },
      { val: 100.00000000000001, min: 0, max: 100, expected: false },
      { val: -0.00000000000001, min: 0, max: 100, expected: false },
    ])(
      `validates $val within range [$min, $max] as $expected`,
      ({ val, min, max, expected }) => {
        expect(is_valid_dimension(val, min, max)).toBe(expected)
      },
    )

    test.each([
      // Invalid value types
      { val: null, min: 0, max: 100, expected: false },
      { val: undefined, min: 0, max: 100, expected: false },
      { val: `50`, min: 0, max: 100, expected: true }, // String numbers are coerced
      { val: `not a number`, min: 0, max: 100, expected: false },
      { val: [], min: 0, max: 100, expected: true }, // Empty array coerces to 0
      { val: {}, min: 0, max: 100, expected: false },
      { val: true, min: 0, max: 100, expected: true }, // true coerces to 1
      { val: false, min: 0, max: 100, expected: true }, // false coerces to 0

      // Invalid min/max types
      { val: 50, min: null, max: 100, expected: true }, // null coerces to 0
      { val: 50, min: 0, max: null, expected: false },
      { val: 50, min: undefined, max: 100, expected: false },
      { val: 50, min: 0, max: undefined, expected: false },
      { val: 50, min: `0`, max: 100, expected: true }, // String numbers are coerced
      { val: 50, min: 0, max: `100`, expected: true }, // String numbers are coerced

      // All parameters invalid
      { val: null, min: null, max: null, expected: false },
      { val: undefined, min: undefined, max: undefined, expected: false },
      { val: NaN, min: NaN, max: NaN, expected: false },
    ])(
      `handles invalid types: val=$val, min=$min, max=$max`,
      ({ val, min, max, expected }) => {
        expect(
          is_valid_dimension(
            val as number | null | undefined,
            min as number,
            max as number,
          ),
        ).toBe(
          expected,
        )
      },
    )
  })
})
