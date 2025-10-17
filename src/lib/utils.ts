// Merge nested objects (1 level deep).
export function merge_nested<T extends Record<string, unknown>>(
  obj1: T,
  obj2?: Partial<T>,
): T {
  const result = { ...obj1, ...(obj2 || {}) } as T
  // Merge nested objects one level deep
  for (const key in obj1) {
    if (
      typeof obj1[key] === `object` &&
      obj1[key] !== null &&
      !Array.isArray(obj1[key])
    ) {
      // Only deep-merge if user value is also a plain object
      if (
        obj2?.[key] &&
        typeof obj2[key] === `object` &&
        !Array.isArray(obj2[key])
      ) {
        result[key] = {
          ...obj1[key],
          ...(obj2[key] as Record<string, unknown>),
        } as T[Extract<keyof T, string>]
      }
      // Otherwise keep the top-level override (already applied above)
    }
  }
  return result
}
