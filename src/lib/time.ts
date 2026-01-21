// Parse and validate date, returns null if invalid.
// Strings without timezone are treated as UTC (append Z if missing).
export const parse_date = (date?: Date | string): Date | null => {
  if (!date) return null
  if (typeof date === `string`) {
    // If string lacks timezone indicator, treat as UTC by appending Z
    // Matches ISO format without timezone: 2024-01-15T14:30:00 or 2024-01-15 14:30:00
    const has_tz = /Z$|[+-]\d{2}:\d{2}$|[+-]\d{4}$/.test(date)
    const normalized = has_tz ? date : `${date.replace(` `, `T`)}Z`
    const parsed = new Date(normalized)
    return isNaN(parsed.getTime()) ? null : parsed
  }
  return isNaN(date.getTime()) ? null : date
}

// Format date as relative time: "5 hours ago", "2 days ago".
// Dates treated as UTC to avoid timezone issues. Future dates return absolute UTC time.
export const format_relative_time = (
  date?: Date | string,
  reference_date?: Date | string,
): string => {
  const timestamp = parse_date(date)
  const now = reference_date ? parse_date(reference_date) : new Date()
  if (!timestamp || !now) return `N/A`

  const diff_ms = now.getTime() - timestamp.getTime()
  if (diff_ms < 0) return format_utc_time(timestamp)

  const diff_mins = Math.max(1, Math.floor(diff_ms / (1000 * 60)))
  const diff_hours = Math.floor(diff_ms / (1000 * 60 * 60))
  const diff_days = Math.floor(diff_ms / (1000 * 60 * 60 * 24))

  if (diff_mins < 60) return `${diff_mins} minute${diff_mins === 1 ? `` : `s`} ago`
  if (diff_hours < 24) return `${diff_hours} hour${diff_hours === 1 ? `` : `s`} ago`
  return `${diff_days} day${diff_days === 1 ? `` : `s`} ago`
}

// Format date as UTC string: "2024-01-15 14:30:00 UTC".
export const format_utc_time = (date?: Date | string): string => {
  if (!date) return `N/A`
  const timestamp = typeof date === `string` ? new Date(date) : date
  if (isNaN(timestamp.getTime())) return `N/A`
  return timestamp.toISOString().replace(`T`, ` `).replace(/\.\d+Z$/, ` UTC`)
}

// Format duration between two dates: "5h 23m", "2d 3h", "45m".
export const format_duration = (
  start?: Date | string,
  end?: Date | string,
): string => {
  if (!start || !end) return `N/A`
  const start_time = typeof start === `string` ? new Date(start) : start
  const end_time = typeof end === `string` ? new Date(end) : end
  if (isNaN(start_time.getTime()) || isNaN(end_time.getTime())) return `N/A`

  const diff_ms = Math.abs(end_time.getTime() - start_time.getTime())
  const diff_mins = Math.floor(diff_ms / (1000 * 60))
  const diff_hours = Math.floor(diff_ms / (1000 * 60 * 60))
  const diff_days = Math.floor(diff_ms / (1000 * 60 * 60 * 24))

  if (diff_days > 0) {
    const remaining_hours = diff_hours % 24
    return remaining_hours > 0 ? `${diff_days}d ${remaining_hours}h` : `${diff_days}d`
  }
  if (diff_hours > 0) {
    const remaining_mins = diff_mins % 60
    return remaining_mins > 0 ? `${diff_hours}h ${remaining_mins}m` : `${diff_hours}h`
  }
  if (diff_mins > 0) return `${diff_mins}m`
  return `<1m`
}
