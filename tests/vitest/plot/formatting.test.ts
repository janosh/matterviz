import { format_value } from '$lib/plot/formatting'
import { describe, expect, test } from 'vitest'

describe(`formatting utility functions`, () => {
  describe(`format_value`, () => {
    test.each([
      // Basic decimal formatting
      { value: 123.456, formatter: `.2f`, expected: `123.46` },
      { value: 123.400, formatter: `.2f`, expected: `123.4` },
      { value: 123.000, formatter: `.2f`, expected: `123` },
      { value: 0.001, formatter: `.3f`, expected: `0.001` },
      { value: 0.100, formatter: `.3f`, expected: `0.1` },
      { value: 0.0000, formatter: `.4f`, expected: `0` },
      { value: 123.4000, formatter: `.4f`, expected: `123.4` },
      { value: 0.1000, formatter: `.4f`, expected: `0.1` },

      // Scientific notation
      { value: 1000000, formatter: `.2e`, expected: `1.00e+6` },
      { value: 0.000001, formatter: `.2e`, expected: `1.00e-6` },
      { value: 123000, formatter: `.2e`, expected: `1.23e+5` },
      { value: 0.00123, formatter: `.2e`, expected: `1.23e-3` },

      // Integer formatting
      { value: 42, formatter: `d`, expected: `42` },
      { value: 42.7, formatter: `d`, expected: `43` },
      { value: -42.3, formatter: `d`, expected: `-42` },
      { value: 0, formatter: `d`, expected: `0` },

      // Comma-separated formatting
      { value: 1234.5, formatter: `,.1f`, expected: `1,234.5` },
      { value: 1234.0, formatter: `,.1f`, expected: `1,234` },
      { value: 12345678.9, formatter: `,.2f`, expected: `12,345,678.9` },
      { value: 999.999, formatter: `,.0f`, expected: `1,000` },

      // Percentage formatting
      { value: 0.123, formatter: `.1%`, expected: `12.3%` },
      { value: 0.100, formatter: `.1%`, expected: `10%` },
      { value: 1.0, formatter: `.0%`, expected: `100%` },
      { value: 0.0, formatter: `.1%`, expected: `0%` },
      { value: 2.5, formatter: `.0%`, expected: `250%` },

      // Currency formatting
      { value: 1234.5, formatter: `$,.2f`, expected: `$1,234.50` },
      { value: 1234.0, formatter: `$,.2f`, expected: `$1,234.00` },
      { value: 0.99, formatter: `$,.2f`, expected: `$0.99` },
      { value: -50.25, formatter: `$,.2f`, expected: `-$50.25` },

      // Special values
      { value: NaN, formatter: `.2f`, expected: `NaN` },
      { value: Infinity, formatter: `.2f`, expected: `Infinity` },
      { value: -Infinity, formatter: `.2f`, expected: `-Infinity` },
      { value: NaN, formatter: `.2e`, expected: `NaN` },
      { value: Infinity, formatter: `d`, expected: `Infinity` },

      // Edge cases
      { value: 0, formatter: `.2f`, expected: `0` },
      { value: -0, formatter: `.2f`, expected: `0` },
      { value: 0.0001, formatter: `.4f`, expected: `0.0001` },
      { value: 999.9999, formatter: `.2f`, expected: `1000` },
      { value: -123.456, formatter: `.2f`, expected: `-123.46` },

      // No formatter/empty formatter
      { value: 123.456, formatter: ``, expected: `123.456` },
      { value: 123.456, formatter: undefined, expected: `123.456` },
      { value: 0, formatter: ``, expected: `0` },
      { value: -42, formatter: undefined, expected: `-42` },
    ])(
      `formats $value with formatter "$formatter" as "$expected"`,
      ({ value, formatter, expected }) => {
        if (formatter === undefined) {
          // @ts-expect-error Testing edge case
          expect(format_value(value, formatter)).toBe(expected)
        } else {
          expect(format_value(value, formatter)).toBe(expected)
        }
      },
    )

    test.each([
      // Date formatting
      {
        value: new Date(2023, 0, 1).getTime(),
        formatter: `%Y-%m-%d`,
        expected: `2023-01-01`,
      },
      {
        value: new Date(2023, 5, 15).getTime(),
        formatter: `%b %d, %Y`,
        expected: `Jun 15, 2023`,
      },
      {
        value: new Date(2023, 11, 31, 23, 59, 59).getTime(),
        formatter: `%Y-%m-%d %H:%M:%S`,
        expected: `2023-12-31 23:59:59`,
      },
      {
        value: new Date(2023, 0, 1).getTime(),
        formatter: `%A, %B %d, %Y`,
        expected: `Sunday, January 01, 2023`,
      },
      {
        value: new Date(2023, 0, 1, 12, 0, 0).getTime(),
        formatter: `%I:%M %p`,
        expected: `12:00 PM`,
      },
      {
        value: new Date(2023, 0, 1, 0, 0, 0).getTime(),
        formatter: `%I:%M %p`,
        expected: `12:00 AM`,
      },
      {
        value: new Date(2023, 6, 4).getTime(),
        formatter: `%j`,
        expected: `185`,
      },
      {
        value: new Date(2020, 1, 29).getTime(), // Leap year
        formatter: `%Y-%m-%d`,
        expected: `2020-02-29`,
      },
    ])(
      `formats timestamp $value with formatter "$formatter" as "$expected"`,
      ({ value, formatter, expected }) => {
        expect(format_value(value, formatter)).toBe(expected)
      },
    )
  })
})
