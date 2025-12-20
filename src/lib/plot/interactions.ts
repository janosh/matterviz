// Get relative coordinates from a mouse event
export function get_relative_coords(evt: MouseEvent): { x: number; y: number } | null {
  const current_target = evt.currentTarget as SVGElement
  if (!current_target || typeof current_target.getBoundingClientRect !== `function`) {
    return null
  }

  const svg_box = current_target.getBoundingClientRect()
  if (!svg_box) return null
  return { x: evt.clientX - svg_box.left, y: evt.clientY - svg_box.top }
}

// Check if a value is within a range
export const is_valid_dimension = (
  val: number | null | undefined,
  min: number,
  max: number,
): boolean => val !== null && val !== undefined && !isNaN(val) && val >= min && val <= max
