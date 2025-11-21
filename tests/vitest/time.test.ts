import { format_duration, format_relative_time, format_utc_time } from '$lib/time'
import { describe, expect, test } from 'vitest'

describe(`format_utc_time`, () => {
  test.each([
    {
      input: new Date(`2024-01-15T14:30:00.000Z`),
      expected: `2024-01-15 14:30:00 UTC`,
      description: `formats Date object`,
    },
    {
      input: `2024-01-15T14:30:00.000Z`,
      expected: `2024-01-15 14:30:00 UTC`,
      description: `formats ISO string`,
    },
    {
      input: new Date(`2024-12-25T00:00:00.000Z`),
      expected: `2024-12-25 00:00:00 UTC`,
      description: `handles midnight`,
    },
    {
      input: new Date(`2024-06-15T23:59:59.999Z`),
      expected: `2024-06-15 23:59:59 UTC`,
      description: `handles end of day`,
    },
    {
      input: undefined,
      expected: `N/A`,
      description: `returns N/A for undefined`,
    },
    {
      input: `invalid-date`,
      expected: `N/A`,
      description: `returns N/A for invalid date string`,
    },
  ])(`$description`, ({ input, expected }) => {
    expect(format_utc_time(input as Date | string | undefined)).toBe(expected)
  })

  test(`removes milliseconds from output`, () => {
    const result = format_utc_time(new Date(`2024-01-15T14:30:45.999Z`))
    expect(result).not.toContain(`.`)
    expect(result).toBe(`2024-01-15 14:30:45 UTC`)
  })

  test(`matches expected format pattern`, () => {
    const result = format_utc_time(new Date(`2024-01-15T14:30:45.123Z`))
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/)
  })
})

describe(`format_relative_time`, () => {
  const reference = new Date(`2024-01-15T12:00:00.000Z`)

  describe(`relative time intervals`, () => {
    test.each([
      {
        date: new Date(`2024-01-15T11:59:00.000Z`),
        expected: `1 minute ago`,
        description: `1 minute ago`,
      },
      {
        date: new Date(`2024-01-15T11:45:00.000Z`),
        expected: `15 minutes ago`,
        description: `15 minutes ago`,
      },
      {
        date: new Date(`2024-01-15T11:00:00.000Z`),
        expected: `1 hour ago`,
        description: `1 hour ago`,
      },
      {
        date: new Date(`2024-01-15T08:00:00.000Z`),
        expected: `4 hours ago`,
        description: `4 hours ago`,
      },
      {
        date: new Date(`2024-01-14T12:00:00.000Z`),
        expected: `1 day ago`,
        description: `1 day ago`,
      },
      {
        date: new Date(`2024-01-10T12:00:00.000Z`),
        expected: `5 days ago`,
        description: `5 days ago`,
      },
      {
        date: new Date(`2024-01-01T00:00:00.000Z`),
        expected: `14 days ago`,
        description: `14 days ago`,
      },
    ])(`$description`, ({ date, expected }) => {
      expect(format_relative_time(date, reference)).toBe(expected)
    })
  })

  describe(`boundary cases`, () => {
    test.each([
      {
        date: new Date(`2024-01-15T11:59:59.000Z`),
        expected: `1 minute ago`,
        description: `rounds down to 1 minute minimum`,
      },
      {
        date: new Date(`2024-01-15T11:00:01.000Z`),
        expected: `59 minutes ago`,
        description: `just under 1 hour`,
      },
      {
        date: new Date(`2024-01-14T12:00:01.000Z`),
        expected: `23 hours ago`,
        description: `just under 1 day`,
      },
    ])(`$description`, ({ date, expected }) => {
      expect(format_relative_time(date, reference)).toBe(expected)
    })

    test(`handles UTC timestamps with specific times`, () => {
      const ref = new Date(`2025-11-04T22:35:12.178Z`)
      const past = new Date(`2025-11-04T14:35:12.178Z`) // 8 hours earlier
      expect(format_relative_time(past, ref)).toBe(`8 hours ago`)
    })
  })

  describe(`future dates`, () => {
    test.each([
      {
        date: new Date(`2024-01-15T13:00:00.000Z`),
        description: `returns UTC time for future date`,
      },
      {
        date: new Date(`2025-01-01T00:00:00.000Z`),
        description: `returns UTC time for far future`,
      },
    ])(`$description`, ({ date }) => {
      const result = format_relative_time(date, reference)
      expect(result).toContain(`UTC`)
      expect(result).not.toContain(`ago`)
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/)
    })

    test(`displays specific future date correctly`, () => {
      const ref = new Date(`2025-11-04T16:00:00Z`)
      const future = new Date(`2025-11-04T22:35:12Z`)
      expect(format_relative_time(future, ref)).toBe(`2025-11-04 22:35:12 UTC`)
    })
  })

  describe(`string inputs`, () => {
    test(`handles ISO string dates`, () => {
      expect(format_relative_time(`2024-01-15T11:00:00.000Z`, reference)).toBe(
        `1 hour ago`,
      )
    })

    test(`handles ISO string reference`, () => {
      expect(
        format_relative_time(
          `2024-01-15T11:00:00.000Z`,
          `2024-01-15T12:00:00.000Z`,
        ),
      ).toBe(`1 hour ago`)
    })
  })

  describe(`edge cases`, () => {
    test.each([
      {
        input: undefined,
        expected: `N/A`,
        description: `undefined date`,
      },
      {
        input: `invalid-date`,
        expected: `N/A`,
        description: `invalid date string`,
      },
    ])(`returns N/A for $description`, ({ input, expected }) => {
      expect(format_relative_time(input as string | undefined, reference)).toBe(expected)
    })

    test(`returns N/A for invalid reference_date`, () => {
      const valid_date = new Date(`2024-01-15T11:00:00.000Z`)
      expect(format_relative_time(valid_date, `invalid-date`)).toBe(`N/A`)
    })

    test(`uses current time when no reference provided`, () => {
      const recent = new Date(Date.now() - 5 * 60 * 1000) // 5 minutes ago
      const result = format_relative_time(recent)
      expect(result).toMatch(/\d+ minutes? ago/)
    })
  })

  describe(`plural handling`, () => {
    test.each([
      {
        date: new Date(`2024-01-15T11:59:00.000Z`),
        expected: `1 minute ago`,
        description: `singular minute`,
      },
      {
        date: new Date(`2024-01-15T11:58:00.000Z`),
        expected: `2 minutes ago`,
        description: `plural minutes`,
      },
      {
        date: new Date(`2024-01-15T11:00:00.000Z`),
        expected: `1 hour ago`,
        description: `singular hour`,
      },
      {
        date: new Date(`2024-01-15T10:00:00.000Z`),
        expected: `2 hours ago`,
        description: `plural hours`,
      },
      {
        date: new Date(`2024-01-14T12:00:00.000Z`),
        expected: `1 day ago`,
        description: `singular day`,
      },
      {
        date: new Date(`2024-01-13T12:00:00.000Z`),
        expected: `2 days ago`,
        description: `plural days`,
      },
    ])(`$description`, ({ date, expected }) => {
      expect(format_relative_time(date, reference)).toBe(expected)
    })
  })
})

describe(`format_duration`, () => {
  const start = new Date(`2024-01-15T10:00:00.000Z`)

  describe(`duration formats`, () => {
    test.each([
      {
        end: new Date(`2024-01-15T10:00:30.000Z`),
        expected: `<1m`,
        description: `under 1 minute`,
      },
      {
        end: new Date(`2024-01-15T10:01:00.000Z`),
        expected: `1m`,
        description: `exactly 1 minute`,
      },
      {
        end: new Date(`2024-01-15T10:15:00.000Z`),
        expected: `15m`,
        description: `15 minutes`,
      },
      {
        end: new Date(`2024-01-15T10:45:30.000Z`),
        expected: `45m`,
        description: `45 minutes`,
      },
      {
        end: new Date(`2024-01-15T11:00:00.000Z`),
        expected: `1h`,
        description: `exactly 1 hour`,
      },
      {
        end: new Date(`2024-01-15T11:30:00.000Z`),
        expected: `1h 30m`,
        description: `1 hour 30 minutes`,
      },
      {
        end: new Date(`2024-01-15T13:45:00.000Z`),
        expected: `3h 45m`,
        description: `3 hours 45 minutes`,
      },
      {
        end: new Date(`2024-01-16T10:00:00.000Z`),
        expected: `1d`,
        description: `exactly 1 day`,
      },
      {
        end: new Date(`2024-01-16T13:00:00.000Z`),
        expected: `1d 3h`,
        description: `1 day 3 hours`,
      },
      {
        end: new Date(`2024-01-18T14:30:00.000Z`),
        expected: `3d 4h`,
        description: `3 days 4 hours`,
      },
      {
        end: new Date(`2024-01-20T10:00:00.000Z`),
        expected: `5d`,
        description: `exactly 5 days`,
      },
    ])(`$description`, ({ end, expected }) => {
      expect(format_duration(start, end)).toBe(expected)
    })
  })

  describe(`string inputs`, () => {
    test(`handles ISO string dates`, () => {
      expect(
        format_duration(`2024-01-15T10:00:00.000Z`, `2024-01-15T11:30:00.000Z`),
      ).toBe(`1h 30m`)
    })

    test(`handles mixed Date and string`, () => {
      expect(format_duration(start, `2024-01-15T11:00:00.000Z`)).toBe(`1h`)
    })
  })

  describe(`absolute value (order-independent)`, () => {
    test.each([
      {
        start: new Date(`2024-01-15T10:00:00.000Z`),
        end: new Date(`2024-01-15T12:00:00.000Z`),
        expected: `2h`,
        description: `end after start`,
      },
      {
        start: new Date(`2024-01-15T12:00:00.000Z`),
        end: new Date(`2024-01-15T10:00:00.000Z`),
        expected: `2h`,
        description: `start after end (reversed)`,
      },
    ])(`$description`, ({ start, end, expected }) => {
      expect(format_duration(start, end)).toBe(expected)
    })
  })

  describe(`edge cases`, () => {
    test.each([
      {
        start: undefined,
        end: new Date(),
        expected: `N/A`,
        description: `undefined start`,
      },
      {
        start: new Date(),
        end: undefined,
        expected: `N/A`,
        description: `undefined end`,
      },
      {
        start: undefined,
        end: undefined,
        expected: `N/A`,
        description: `both undefined`,
      },
      {
        start: `invalid`,
        end: new Date(),
        expected: `N/A`,
        description: `invalid start date`,
      },
      {
        start: new Date(),
        end: `invalid`,
        expected: `N/A`,
        description: `invalid end date`,
      },
    ])(`returns N/A for $description`, ({ start, end, expected }) => {
      expect(format_duration(start as Date | undefined, end as Date | undefined)).toBe(
        expected,
      )
    })

    test(`handles same start and end time`, () => {
      expect(format_duration(start, start)).toBe(`<1m`)
    })
  })

  describe(`precision handling`, () => {
    test(`minutes component only shows when non-zero`, () => {
      const end = new Date(`2024-01-15T12:00:00.000Z`)
      expect(format_duration(start, end)).toBe(`2h`)
    })

    test(`hours component only shows when non-zero`, () => {
      const end = new Date(`2024-01-16T10:00:00.000Z`)
      expect(format_duration(start, end)).toBe(`1d`)
    })

    test(`drops minutes when showing days`, () => {
      const end = new Date(`2024-01-16T11:45:00.000Z`)
      expect(format_duration(start, end)).toBe(`1d 1h`)
    })
  })
})
