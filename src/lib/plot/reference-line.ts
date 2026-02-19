// Reference line utilities: helper functions and coordinate resolution
import type { LayerZIndex, RefLine, RefLineValue } from './types'

export type IndexedRefLine = RefLine & { idx: number }

// Create indexed ref_lines, filtering out invisible ones
export function index_ref_lines(ref_lines: RefLine[] | undefined): IndexedRefLine[] {
  return (ref_lines ?? [])
    .filter((line) => line.visible !== false)
    .map((line, idx) => ({ ...line, idx }))
}

// Z-index groups for ordered rendering
export interface RefLinesByZIndex {
  below_grid: IndexedRefLine[]
  below_lines: IndexedRefLine[]
  below_points: IndexedRefLine[]
  above_all: IndexedRefLine[]
}

// Map z-index type values to object keys
const Z_INDEX_KEY_MAP: Record<LayerZIndex, keyof RefLinesByZIndex> = {
  'below-grid': `below_grid`,
  'below-lines': `below_lines`,
  'below-points': `below_points`,
  'above-all': `above_all`,
}

// Group indexed ref_lines by z-index for ordered rendering
export function group_ref_lines_by_z(lines: IndexedRefLine[]): RefLinesByZIndex {
  const groups: RefLinesByZIndex = {
    below_grid: [],
    below_lines: [],
    below_points: [],
    above_all: [],
  }
  for (const line of lines) {
    const key = Z_INDEX_KEY_MAP[line.z_index ?? `below-lines`]
    groups[key].push(line)
  }
  return groups
}

// Convert RefLineValue (number | Date | string) to numeric value
export function normalize_value(value: RefLineValue): number {
  if (typeof value === `number`) return value
  if (value instanceof Date) return value.getTime()
  // Empty/whitespace strings are invalid (Number("") returns 0 silently)
  if (typeof value === `string` && value.trim() === ``) {
    console.warn(`Invalid RefLineValue: empty string, defaulting to 0`)
    return 0
  }
  // Try numeric conversion first (handles "42", "3.14", "-5")
  const num = Number(value)
  if (!isNaN(num)) return num
  // Then try as ISO date string (handles "2024-06-15")
  const parsed = Date.parse(value)
  if (!isNaN(parsed)) return parsed
  console.warn(`Invalid RefLineValue: "${value}", defaulting to 0`)
  return 0
}

// Normalize a point tuple
export const normalize_point = (
  point: [RefLineValue, RefLineValue],
): [number, number] => [normalize_value(point[0]), normalize_value(point[1])]

// Clip a line segment to a rectangle using Liang-Barsky algorithm
// Returns clipped [x1, y1, x2, y2] or null if segment is entirely outside
function clip_segment_to_rect(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  x_min: number,
  x_max: number,
  y_min: number,
  y_max: number,
): [number, number, number, number] | null {
  const dx = p2x - p1x
  const dy = p2y - p1y

  // p values represent the direction, q values the signed distance to boundary
  // Boundaries: left (x_min), right (x_max), bottom (y_min), top (y_max)
  const p_vals = [-dx, dx, -dy, dy]
  const q_vals = [p1x - x_min, x_max - p1x, p1y - y_min, y_max - p1y]

  let [t_enter, t_leave] = [0, 1]

  for (let idx = 0; idx < 4; idx++) {
    if (p_vals[idx] === 0) {
      // Line parallel to boundary
      if (q_vals[idx] < 0) return null // Outside and parallel - no intersection
    } else {
      const t_val = q_vals[idx] / p_vals[idx]
      // Entering boundary
      if (p_vals[idx] < 0) t_enter = Math.max(t_enter, t_val)
      // Leaving boundary
      else t_leave = Math.min(t_leave, t_val)
    }
  }

  if (t_enter > t_leave) return null // Segment entirely outside

  return [p1x + t_enter * dx, p1y + t_enter * dy, p1x + t_leave * dx, p1y + t_leave * dy]
}

// Compute the screen coordinates for a reference line
// Returns [x1, y1, x2, y2] in pixel coordinates, or null if line is not visible
export function resolve_line_endpoints(
  ref_line: RefLine,
  { x_min, x_max, y_min, y_max }: {
    x_min: number
    x_max: number
    y_min: number
    y_max: number
  },
  { x_scale, y_scale, y2_scale }: {
    x_scale: (val: number) => number
    y_scale: (val: number) => number
    y2_scale?: (val: number) => number
  },
): [number, number, number, number] | null {
  // Determine which y-scale to use
  const active_y_scale = ref_line.y_axis === `y2` && y2_scale ? y2_scale : y_scale

  // Check if value is within plot bounds (for visibility)
  const is_x_visible = (x_val: number): boolean => x_val >= x_min && x_val <= x_max
  const is_y_visible = (y_val: number): boolean => y_val >= y_min && y_val <= y_max

  // Apply span constraints (works for both x and y)
  const apply_span = (
    v1: number,
    v2: number,
    span?: [number | null, number | null],
  ): [number, number] => {
    if (!span) return [v1, v2]
    return [
      span[0] !== null ? Math.max(v1, span[0]) : v1,
      span[1] !== null ? Math.min(v2, span[1]) : v2,
    ]
  }
  const apply_x_span = (x1: number, x2: number) => apply_span(x1, x2, ref_line.x_span)
  const apply_y_span = (y1: number, y2: number) => apply_span(y1, y2, ref_line.y_span)

  // Relative to data coordinate conversion
  const to_data_x = (rel: number): number => x_min + rel * (x_max - x_min)
  const to_data_y = (rel: number): number => y_min + rel * (y_max - y_min)

  let x1_data = 0
  let y1_data = 0
  let x2_data = 0
  let y2_data = 0

  const line_type = ref_line.type

  if (line_type === `horizontal`) {
    const y_val = normalize_value(ref_line.y)
    const y_coord = ref_line.coord_mode === `relative` ? to_data_y(y_val) : y_val
    if (!is_y_visible(y_coord)) return null
    ;[x1_data, x2_data] = apply_x_span(x_min, x_max)
    y1_data = y_coord
    y2_data = y_coord
  } else if (line_type === `vertical`) {
    const x_val = normalize_value(ref_line.x)
    const x_coord = ref_line.coord_mode === `relative` ? to_data_x(x_val) : x_val
    if (!is_x_visible(x_coord)) return null
    x1_data = x_coord
    x2_data = x_coord
    ;[y1_data, y2_data] = apply_y_span(y_min, y_max)
  } else if (line_type === `diagonal` || line_type === `line`) {
    // Get slope/intercept - either from props or computed from points
    let slope: number
    let intercept: number
    let handled_as_vertical = false

    if (ref_line.type === `diagonal`) {
      slope = ref_line.slope
      intercept = ref_line.intercept
    } else {
      const [p1x, p1y] = normalize_point(ref_line.p1)
      const [p2x, p2y] = normalize_point(ref_line.p2)
      const dx = p2x - p1x
      if (Math.abs(dx) < 1e-10) {
        // Nearly vertical line - check x-bounds like we do for vertical type
        if (!is_x_visible(p1x)) return null
        x1_data = p1x
        x2_data = p1x
        ;[y1_data, y2_data] = apply_y_span(y_min, y_max)
        handled_as_vertical = true
        slope = 0 // Won't be used
        intercept = 0
      } else {
        slope = (p2y - p1y) / dx
        intercept = p1y - slope * p1x
      }
    }

    if (!handled_as_vertical) {
      // Clip line to y bounds
      let x1 = x_min
      let x2 = x_max
      let y1 = slope * x_min + intercept
      let y2 = slope * x_max + intercept

      if (slope === 0) {
        if (y1 < y_min || y1 > y_max) return null
      } else {
        // Clip each endpoint to y bounds
        const clip_y = (x: number, y: number, bound: number) =>
          y < y_min || y > y_max ? [(bound - intercept) / slope, bound] : [x, y]
        ;[x1, y1] = clip_y(x1, y1, y1 < y_min ? y_min : y_max)
        ;[x2, y2] = clip_y(x2, y2, y2 < y_min ? y_min : y_max)
        // If both endpoints clipped to same point, line is entirely outside bounds
        if (x1 === x2 && y1 === y2) return null
      }

      // Ensure consistent ordering before applying span constraints
      const [x_lo, x_hi] = x1 <= x2 ? [x1, x2] : [x2, x1]
      const [y_lo, y_hi] = y1 <= y2 ? [y1, y2] : [y2, y1]
      ;[x1_data, x2_data] = apply_x_span(x_lo, x_hi)
      ;[y1_data, y2_data] = apply_y_span(y_lo, y_hi)
      if (x1_data > x_max || x2_data < x_min) return null
    }
  } else if (line_type === `segment`) {
    const [p1x, p1y] = normalize_point(ref_line.p1)
    const [p2x, p2y] = normalize_point(ref_line.p2)

    // Determine clipping bounds (span constraints override plot bounds)
    const clip_x_min = ref_line.x_span?.[0] ?? x_min
    const clip_x_max = ref_line.x_span?.[1] ?? x_max
    const clip_y_min = ref_line.y_span?.[0] ?? y_min
    const clip_y_max = ref_line.y_span?.[1] ?? y_max

    const clipped = clip_segment_to_rect(
      p1x,
      p1y,
      p2x,
      p2y,
      clip_x_min,
      clip_x_max,
      clip_y_min,
      clip_y_max,
    )
    if (!clipped) return null
    ;[x1_data, y1_data, x2_data, y2_data] = clipped
  } else {
    return null
  }

  // Convert data coordinates to screen pixels
  const x1_px = x_scale(x1_data)
  const y1_px = active_y_scale(y1_data)
  const x2_px = x_scale(x2_data)
  const y2_px = active_y_scale(y2_data)

  // Validate that pixels are finite
  if (!isFinite(x1_px) || !isFinite(y1_px) || !isFinite(x2_px) || !isFinite(y2_px)) {
    return null
  }

  return [x1_px, y1_px, x2_px, y2_px]
}

interface AnnotationPosition {
  x: number
  y: number
  text_anchor: `start` | `middle` | `end`
  dominant_baseline: `auto` | `middle` | `hanging`
  rotation?: number
}

// Calculate annotation position given line endpoints and annotation config
export function calculate_annotation_position(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  annotation: {
    position?: `start` | `center` | `end`
    side?: `above` | `below` | `left` | `right`
    offset?: { x?: number; y?: number }
    gap?: number
    edge_padding?: number
    rotate?: boolean
  },
): AnnotationPosition {
  const position = annotation.position ?? `end`
  const side = annotation.side ?? `above`
  const offset_x = annotation.offset?.x ?? 0
  const offset_y = annotation.offset?.y ?? 0
  const gap = annotation.gap ?? 8 // pixels from line
  const edge_padding = annotation.edge_padding ?? 4 // pixels from plot edge at start/end

  // Fraction along line: start=0, center=0.5, end=1
  const frac = position === `start` ? 0 : position === `center` ? 0.5 : 1

  // Calculate base position with edge padding applied along line direction
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)

  let base_x = x1 + frac * dx
  let base_y = y1 + frac * dy

  // Apply edge padding to pull text slightly inward from plot boundaries
  if (len > 0 && position !== `center`) {
    const dir_x = dx / len
    const dir_y = dy / len
    // At 'end', move back toward start; at 'start', move toward end
    const inward = position === `end` ? -edge_padding : edge_padding
    base_x += dir_x * inward
    base_y += dir_y * inward
  }

  let perp_x = 0
  let perp_y = 0
  if (len > 0) {
    // Perpendicular vector (normalized)
    const nx = -dy / len
    const ny = dx / len
    if (side === `above` || side === `below`) {
      // In SVG, y increases downward. Flip sign if 'above' and perpendicular points down (ny > 0),
      // or if 'below' and perpendicular points up (ny <= 0), to ensure offset is in correct direction
      const sign = (side === `above`) === (ny > 0) ? -1 : 1
      perp_x = sign * nx * gap
      perp_y = sign * ny * gap
    } else {
      // left = perpendicular to the "left" of direction vector, right = opposite
      const sign = side === `left` ? 1 : -1
      perp_x = sign * nx * gap
      perp_y = sign * ny * gap
    }
  }

  const final_x = base_x + perp_x + offset_x
  const final_y = base_y + perp_y + offset_y

  // Text anchor and baseline based on position/side
  // For left/right sides, anchor is determined by side (text extends away from line)
  // For above/below sides, anchor is determined by position along line
  let text_anchor: `start` | `middle` | `end`
  if (side === `left`) {
    text_anchor = `end` // text ends at gap point, extends left
  } else if (side === `right`) {
    text_anchor = `start` // text starts at gap point, extends right
  } else {
    text_anchor = ({ start: `start`, end: `end`, center: `middle` }[position] ??
      `middle`) as `start` | `middle` | `end`
  }
  const dominant_baseline = ({
    above: `auto`,
    below: `hanging`,
    left: `middle`,
    right: `middle`,
  }[side] ?? `middle`) as `auto` | `middle` | `hanging`

  // Calculate rotation if needed (keep text readable)
  let rotation: number | undefined
  if (annotation.rotate && len > 0) {
    rotation = Math.atan2(dy, dx) * (180 / Math.PI)
    if (rotation > 90) rotation -= 180
    else if (rotation < -90) rotation += 180
  }

  return { x: final_x, y: final_y, text_anchor, dominant_baseline, rotation }
}

export interface Scene3DParams {
  scene_x: number
  scene_y: number
  scene_z: number
  x_range: [number, number]
  y_range: [number, number]
  z_range: [number, number]
}

/** Apply span constraints or use full range as fallback */
export function span_or(
  span: [number | null, number | null] | undefined,
  range: [number, number],
): [number, number] {
  return [span?.[0] ?? range[0], span?.[1] ?? range[1]]
}

// Normalize a data value to scene coordinates (centered around 0)
export function normalize_to_scene(
  value: number,
  [min_val, max_val]: [number, number],
  scene_size: number,
): number {
  const range = max_val - min_val
  // When range is zero (min === max), return center position
  if (range === 0) return 0
  return ((value - min_val) / range - 0.5) * scene_size
}

// Create a function to convert user data coordinates to Three.js coordinates
// Note: In Three.js, Y is vertical. We map:
// - user X → Three.js X (horizontal)
// - user Y → Three.js Z (depth/horizontal)
// - user Z → Three.js Y (vertical)
export function create_to_threejs(params: Scene3DParams): (
  user_x: number,
  user_y: number,
  user_z: number,
) => { x: number; y: number; z: number } {
  const { scene_x, scene_y, scene_z, x_range, y_range, z_range } = params
  return (user_x: number, user_y: number, user_z: number) => ({
    x: normalize_to_scene(user_x, x_range, scene_x),
    y: normalize_to_scene(user_z, z_range, scene_z), // z → Y
    z: normalize_to_scene(user_y, y_range, scene_y), // y → Z
  })
}
