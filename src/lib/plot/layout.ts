// Constrain tooltip position within chart bounds
export function constrain_tooltip_position(
  base_x: number,
  base_y: number,
  tooltip_width: number,
  tooltip_height: number,
  chart_width: number,
  chart_height: number,
) {
  // Calculate the maximum allowable position for the tooltip
  const max_x = Math.max(10, chart_width - tooltip_width - 10)
  const max_y = Math.max(10, chart_height - tooltip_height - 10)

  return {
    x: Math.min(max_x, Math.max(10, base_x + 5)),
    y: Math.min(max_y, Math.max(10, base_y - 10)),
  }
}

// Get chart dimensions from width, height, and padding
export function get_chart_dimensions(
  width: number,
  height: number,
  padding: { t: number; b: number; l: number; r: number },
) {
  return { width: width - padding.l - padding.r, height: height - padding.t - padding.b }
}
