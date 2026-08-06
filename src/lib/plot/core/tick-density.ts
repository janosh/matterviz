// Pure tick-density helpers shared by scale generation and plot layout. These functions do
// not depend on a particular scale implementation or on browser measurement APIs.

const assert_non_negative_finite = (name: string, value: number): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number, got ${value}`)
  }
}

const assert_non_negative_integer = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer, got ${value}`)
  }
}

// Estimate a conservative first-pass tick count from the widest measured label. The result
// keeps room for gap_pixels between labels and reserves both endpoints whenever they exist.
export const suggest_tick_count = (
  axis_pixels: number,
  label_widths: readonly number[],
  gap_pixels: number,
): number => {
  assert_non_negative_finite(`axis_pixels`, axis_pixels)
  assert_non_negative_finite(`gap_pixels`, gap_pixels)
  let widest_label = 0
  for (const [label_idx, label_width] of label_widths.entries()) {
    assert_non_negative_finite(`label_widths[${label_idx}]`, label_width)
    widest_label = Math.max(widest_label, label_width)
  }

  const label_count = label_widths.length
  if (label_count <= 1) return label_count
  const largest_measurement = Math.max(axis_pixels, widest_label, gap_pixels)
  if (largest_measurement === 0) return label_count

  // Normalize before adding so valid but very large measurements cannot overflow to Infinity.
  const normalized_available =
    axis_pixels / largest_measurement + gap_pixels / largest_measurement
  const normalized_slot = widest_label / largest_measurement + gap_pixels / largest_measurement
  const count_from_pixels = Math.floor(normalized_available / normalized_slot)
  return Math.min(label_count, Math.max(2, count_from_pixels))
}

// Return evenly spaced source indices while retaining both endpoints.
export const thin_tick_indices = (
  item_count: number,
  requested_visible_count: number,
): number[] => {
  assert_non_negative_integer(`item_count`, item_count)
  assert_non_negative_integer(`requested_visible_count`, requested_visible_count)
  const target_count = Math.min(item_count, Math.max(requested_visible_count, 2))
  if (target_count >= item_count) {
    return Array.from({ length: item_count }, (_unused, item_idx) => item_idx)
  }
  return Array.from({ length: target_count }, (_unused, item_idx) =>
    Math.round((item_idx * (item_count - 1)) / (target_count - 1)),
  )
}
