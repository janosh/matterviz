// Check if value is a plain object (not array, null, or other types)
const is_plain_object = (val: unknown): val is Record<string, unknown> =>
  typeof val === `object` && val !== null && !Array.isArray(val)

// Merge nested objects (1 level deep).
export function merge_nested<T extends Record<string, unknown>>(
  obj1: T,
  obj2?: Partial<T>,
): T {
  const result = { ...obj1, ...(obj2 || {}) } as T
  for (const key in obj1) {
    if (is_plain_object(obj1[key]) && is_plain_object(obj2?.[key])) {
      result[key] = { ...obj1[key], ...obj2[key] }
    }
  }
  return result
}

// Escape HTML special characters to prevent XSS attacks
export const escape_html = (unsafe_string: string): string =>
  unsafe_string
    .replaceAll(`&`, `&amp;`)
    .replaceAll(`<`, `&lt;`)
    .replaceAll(`>`, `&gt;`)
    .replaceAll(`"`, `&quot;`)
    .replaceAll(`'`, `&#39;`)
