import { format } from 'd3-format'
import { timeFormat } from 'd3-time-format'

// Format a value for display with optional time formatting
export function format_value(value: number, formatter: string): string {
  if (!formatter) return `${value}`

  if (formatter.startsWith(`%`)) return timeFormat(formatter)(new Date(value))

  // Handle special values consistently
  if (value === -Infinity) return `-Infinity`
  if (value === Infinity) return `Infinity`
  if (Number.isNaN(value)) return `NaN`

  let formatted = format(formatter)(value)

  // Replace unicode minus with ASCII minus for consistency
  formatted = formatted.replace(/−/g, `-`)

  // Handle percentage formatting - remove trailing zeros but keep appropriate precision
  if (formatter.includes(`%`)) {
    return formatted.includes(`.`)
      ? formatted.replace(/(\.\d*?)0+%$/, `$1%`).replace(/\.%$/, `%`)
      : formatted
  }

  // Handle currency formatting - ensure proper decimal places
  if (formatter.includes(`$`)) {
    // If the formatter specifies decimal places (e.g., .2f), don't remove trailing zeros
    if (formatter.includes(`.`) && /\.\d+f/.test(formatter)) {
      return formatted
    }
    // Otherwise, remove trailing zeros as usual
    return formatted.includes(`.`)
      ? formatted.replace(/(\.\d*?)0+$/, `$1`).replace(/\.$/, ``)
      : formatted
  }

  // Remove trailing zeros after decimal point for other formats
  return formatted.includes(`.`)
    ? formatted.replace(/(\.\d*?)0+$/, `$1`).replace(/\.$/, ``)
    : formatted
}
