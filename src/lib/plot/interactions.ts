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

// Shift a range by a delta amount (no bounds constraint for free panning)
export function pan_range(
  current: [number, number],
  delta: number,
): [number, number] {
  return [current[0] + delta, current[1] + delta]
}

// Convert pixel delta to data delta using current data range and pixel range
export function pixels_to_data_delta(
  pixel_delta: number,
  data_range: [number, number],
  pixel_range: number,
): number {
  if (pixel_range === 0) return 0
  const data_span = data_range[1] - data_range[0]
  return (pixel_delta / pixel_range) * data_span
}

// Threshold for distinguishing pinch-zoom from pan in touch gestures
// Scale change > this value triggers zoom instead of pan
export const PINCH_ZOOM_THRESHOLD = 0.1
