/**
 * SVG path and rendering utilities for plot components.
 */

/**
 * Generate SVG path for a bar with rounded corners on the "free" end (away from axis).
 * For vertical bars, rounds top corners. For horizontal bars, rounds right corners.
 */
export function bar_path(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  vertical: boolean = true,
): string {
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`

  return vertical
    ? `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${
      x + w - r
    }A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`
    : `M${x},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${
      y + h - r
    }A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x}Z`
}
