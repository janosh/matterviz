// Pure tick-density helpers shared by scale generation and plot layout. These functions do
// not depend on a particular scale implementation or on browser measurement APIs.

export interface TickDensitySearchOptions<Tick> {
  min_requested_count?: number
  max_requested_count: number
  generate_ticks: (requested_count: number) => readonly Tick[]
  layout_fits: (ticks: readonly Tick[], requested_count: number) => boolean
}

export interface TickDensitySearchResult<Tick> {
  requested_count: number
  ticks: Tick[]
}

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

const sorted_mandatory_indices = (
  item_count: number,
  important_indices: readonly number[],
): number[] => {
  important_indices.forEach((item_idx, important_idx) => {
    if (!Number.isSafeInteger(item_idx) || item_idx < 0 || item_idx >= item_count) {
      throw new Error(
        `important_indices[${important_idx}] must be an integer in [0, ${item_count}), got ${item_idx}`,
      )
    }
  })

  if (item_count === 0) return []
  return [0, ...important_indices, item_count - 1]
    .toSorted((left, right) => left - right)
    .filter((item_idx, sorted_idx, sorted) => item_idx !== sorted[sorted_idx - 1])
}

// Return an increasing subsequence of item indices. The requested count is a target rather
// than a hard cap: first, last, and caller-marked important indices are always retained.
// Optional slots are apportioned across mandatory gaps, then evenly spaced within each gap, in
// O(result size + important count log important count), independent of a large item_count.
export const thin_tick_indices = (
  item_count: number,
  requested_visible_count: number,
  important_indices: readonly number[] = [],
): number[] => {
  assert_non_negative_integer(`item_count`, item_count)
  assert_non_negative_integer(`requested_visible_count`, requested_visible_count)

  const mandatory_indices = sorted_mandatory_indices(item_count, important_indices)
  if (item_count <= 2 || requested_visible_count >= item_count) {
    return Array.from({ length: item_count }, (_unused, item_idx) => item_idx)
  }

  const target_count = Math.min(
    item_count,
    Math.max(requested_visible_count, mandatory_indices.length),
  )
  const optional_needed = target_count - mandatory_indices.length
  if (optional_needed === 0) return mandatory_indices

  const optional_count = item_count - mandatory_indices.length
  const gaps = mandatory_indices.slice(1).map((right_idx, gap_idx) => {
    const left_idx = mandatory_indices[gap_idx]
    const available_count = right_idx - left_idx - 1
    const ideal_count = (optional_needed / optional_count) * available_count
    return {
      left_idx,
      right_idx,
      selected_count: Math.floor(ideal_count),
      remainder: ideal_count - Math.floor(ideal_count),
      gap_idx,
    }
  })
  const allocated_count = gaps.reduce(
    (total_count, { selected_count }) => total_count + selected_count,
    0,
  )
  const remaining_count = optional_needed - allocated_count
  const remainder_order = gaps.toSorted(
    (left, right) => right.remainder - left.remainder || left.gap_idx - right.gap_idx,
  )
  for (let remainder_idx = 0; remainder_idx < remaining_count; remainder_idx++) {
    remainder_order[remainder_idx].selected_count += 1
  }

  const selected_indices = [mandatory_indices[0]]
  for (const { left_idx, right_idx, selected_count } of gaps) {
    const gap_span = right_idx - left_idx
    for (let slot_idx = 1; slot_idx <= selected_count; slot_idx++) {
      selected_indices.push(
        Math.round(left_idx + (slot_idx * gap_span) / (selected_count + 1)),
      )
    }
    selected_indices.push(right_idx)
  }
  return selected_indices
}

// Thin arbitrary tick values by source index while preserving their original sorted order.
export const thin_ticks = <Tick>(
  ticks: readonly Tick[],
  requested_visible_count: number,
  important_indices: readonly number[] = [],
): Tick[] =>
  thin_tick_indices(ticks.length, requested_visible_count, important_indices).map(
    (tick_idx) => ticks[tick_idx],
  )

// Find the largest requested count whose generated ticks pass layout_fits. Candidate density
// and layout fitness must be monotonic with requested count: adding requested ticks may turn a
// fit into a rejection, but not the reverse. The binary search evaluates O(log(count range))
// candidates and returns the requested count so a measured second pass can reproduce it.
export const search_densest_fitting_ticks = <Tick>(
  options: TickDensitySearchOptions<Tick>,
): TickDensitySearchResult<Tick> | null => {
  const { min_requested_count = 0, max_requested_count, generate_ticks, layout_fits } = options
  assert_non_negative_integer(`min_requested_count`, min_requested_count)
  assert_non_negative_integer(`max_requested_count`, max_requested_count)
  if (min_requested_count > max_requested_count) {
    throw new Error(
      `min_requested_count (${min_requested_count}) must not exceed max_requested_count (${max_requested_count})`,
    )
  }
  if (typeof generate_ticks !== `function`) {
    throw new TypeError(`generate_ticks must be a function, got ${typeof generate_ticks}`)
  }
  if (typeof layout_fits !== `function`) {
    throw new TypeError(`layout_fits must be a function, got ${typeof layout_fits}`)
  }

  let lower_count = min_requested_count
  let upper_count = max_requested_count
  let best_result: TickDensitySearchResult<Tick> | null = null

  while (lower_count <= upper_count) {
    const requested_count = lower_count + Math.floor((upper_count - lower_count) / 2)
    const candidate_ticks = generate_ticks(requested_count)
    if (!Array.isArray(candidate_ticks)) {
      throw new TypeError(
        `generate_ticks must return an array for requested_count=${requested_count}`,
      )
    }
    const fits = layout_fits(candidate_ticks, requested_count)
    if (typeof fits !== `boolean`) {
      throw new TypeError(
        `layout_fits must return a boolean for requested_count=${requested_count}, got ${typeof fits}`,
      )
    }

    if (fits) {
      best_result = { requested_count, ticks: [...candidate_ticks] }
      lower_count = requested_count + 1
    } else {
      upper_count = requested_count - 1
    }
  }
  return best_result
}
