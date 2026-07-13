import { format_duration, format_relative_time, format_utc_time } from '$lib/time'
import { describe, expect, test } from 'vitest'

describe(`format_utc_time`, () => {
  test.each([
    [new Date(`2024-01-15T14:30:00.000Z`), `2024-01-15 14:30:00 UTC`, `Date object`],
    [`2024-01-15T14:30:00.000Z`, `2024-01-15 14:30:00 UTC`, `ISO string`],
    [new Date(`2024-12-25T00:00:00.000Z`), `2024-12-25 00:00:00 UTC`, `midnight`],
    [new Date(`2024-06-15T23:59:59.999Z`), `2024-06-15 23:59:59 UTC`, `end of day`],
    [new Date(`2024-01-15T14:30:45.999Z`), `2024-01-15 14:30:45 UTC`, `strips milliseconds`],
    [undefined, `N/A`, `undefined`],
    [`invalid-date`, `N/A`, `invalid date string`],
  ])(`%s -> %s (%s)`, (input, expected, _desc) => {
    expect(format_utc_time(input)).toBe(expected)
  })
})

describe(`format_relative_time`, () => {
  const reference = new Date(`2024-01-15T12:00:00.000Z`)

  test.each([
    [`2024-01-15T11:59:00.000Z`, `1 minute ago`],
    [`2024-01-15T11:58:00.000Z`, `2 minutes ago`],
    [`2024-01-15T11:45:00.000Z`, `15 minutes ago`],
    [`2024-01-15T11:00:00.000Z`, `1 hour ago`],
    [`2024-01-15T10:00:00.000Z`, `2 hours ago`],
    [`2024-01-15T08:00:00.000Z`, `4 hours ago`],
    [`2024-01-14T12:00:00.000Z`, `1 day ago`],
    [`2024-01-13T12:00:00.000Z`, `2 days ago`],
    [`2024-01-10T12:00:00.000Z`, `5 days ago`],
    [`2024-01-01T00:00:00.000Z`, `14 days ago`],
    // boundary cases
    [`2024-01-15T11:59:59.000Z`, `1 minute ago`], // rounds down to 1 minute minimum
    [`2024-01-15T11:00:01.000Z`, `59 minutes ago`], // just under 1 hour
    [`2024-01-14T12:00:01.000Z`, `23 hours ago`], // just under 1 day
  ])(`%s -> %s`, (date, expected) => {
    expect(format_relative_time(new Date(date), reference)).toBe(expected)
  })

  test(`handles UTC timestamps with specific times`, () => {
    const ref = new Date(`2025-11-04T22:35:12.178Z`)
    const past = new Date(`2025-11-04T14:35:12.178Z`) // 8 hours earlier
    expect(format_relative_time(past, ref)).toBe(`8 hours ago`)
  })

  describe(`future dates`, () => {
    test.each([
      [new Date(`2024-01-15T13:00:00.000Z`), `near future`],
      [new Date(`2025-01-01T00:00:00.000Z`), `far future`],
    ])(`returns UTC time for %s (%s)`, (date) => {
      const result = format_relative_time(date, reference)
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
      expect(format_relative_time(`2024-01-15T11:00:00.000Z`, reference)).toBe(`1 hour ago`)
    })

    test(`handles ISO string reference`, () => {
      expect(
        format_relative_time(`2024-01-15T11:00:00.000Z`, `2024-01-15T12:00:00.000Z`),
      ).toBe(`1 hour ago`)
    })
  })

  describe(`edge cases`, () => {
    test.each([
      [undefined, `undefined date`],
      [`invalid-date`, `invalid date string`],
    ])(`returns N/A for %s (%s)`, (input, _desc) => {
      expect(format_relative_time(input, reference)).toBe(`N/A`)
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
})

describe(`format_duration`, () => {
  const reference_start = new Date(`2024-01-15T10:00:00.000Z`)

  test.each([
    [`2024-01-15T10:00:30.000Z`, `<1m`], // under 1 minute
    [`2024-01-15T10:01:00.000Z`, `1m`],
    [`2024-01-15T10:15:00.000Z`, `15m`],
    [`2024-01-15T10:45:30.000Z`, `45m`],
    [`2024-01-15T11:00:00.000Z`, `1h`], // hours component only shows when non-zero
    [`2024-01-15T11:30:00.000Z`, `1h 30m`],
    [`2024-01-15T13:45:00.000Z`, `3h 45m`],
    [`2024-01-16T10:00:00.000Z`, `1d`], // minutes dropped once days shown
    [`2024-01-16T11:45:00.000Z`, `1d 1h`], // drops minutes when showing days
    [`2024-01-16T13:00:00.000Z`, `1d 3h`],
    [`2024-01-18T14:30:00.000Z`, `3d 4h`],
    [`2024-01-20T10:00:00.000Z`, `5d`],
  ])(`start + duration to %s -> %s`, (end, expected) => {
    expect(format_duration(reference_start, new Date(end))).toBe(expected)
  })

  describe(`string inputs`, () => {
    test(`handles ISO string dates`, () => {
      expect(format_duration(`2024-01-15T10:00:00.000Z`, `2024-01-15T11:30:00.000Z`)).toBe(
        `1h 30m`,
      )
    })

    test(`handles mixed Date and string`, () => {
      expect(format_duration(reference_start, `2024-01-15T11:00:00.000Z`)).toBe(`1h`)
    })
  })

  test(`uses absolute value (order-independent)`, () => {
    const [start, end] = [`2024-01-15T10:00:00.000Z`, `2024-01-15T12:00:00.000Z`]
    expect(format_duration(start, end)).toBe(`2h`)
    expect(format_duration(end, start)).toBe(`2h`)
  })

  describe(`edge cases`, () => {
    test.each([
      [undefined, new Date(), `undefined start`],
      [new Date(), undefined, `undefined end`],
      [undefined, undefined, `both undefined`],
      [`invalid`, new Date(), `invalid start date`],
      [new Date(), `invalid`, `invalid end date`],
    ])(`returns N/A for %s/%s (%s)`, (start, end, _desc) => {
      expect(format_duration(start as Date | undefined, end as Date | undefined)).toBe(`N/A`)
    })

    test(`handles same start and end time`, () => {
      expect(format_duration(reference_start, reference_start)).toBe(`<1m`)
    })
  })
})
