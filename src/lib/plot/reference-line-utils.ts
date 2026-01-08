// Reference line utilities: helper functions and coordinate resolution
import type {
  RefLine,
  RefLine3D,
  RefLine3DBase,
  RefLineBase,
  RefLineValue,
  RefPlane,
  RefPlaneBase,
} from './types'
import type { Vec3 } from '$lib/math'

// ============================================================================
// Indexed RefLine type for component rendering (shared across 2D plots)
// ============================================================================

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

// Group indexed ref_lines by z-index for ordered rendering
export function group_ref_lines_by_z(lines: IndexedRefLine[]): RefLinesByZIndex {
  const groups: RefLinesByZIndex = {
    below_grid: [],
    below_lines: [],
    below_points: [],
    above_all: [],
  }

  for (const line of lines) {
    if (line.z_index === `below-grid`) groups.below_grid.push(line)
    else if (line.z_index === `below-points`) groups.below_points.push(line)
    else if (line.z_index === `above-all`) groups.above_all.push(line)
    else groups.below_lines.push(line) // default: 'below-lines'
  }
  return groups
}

// ============================================================================
// Value normalization - convert Date/string values to numbers
// ============================================================================

// Convert RefLineValue (number | Date | string) to numeric value
export function normalize_value(value: RefLineValue): number {
  if (typeof value === `number`) return value
  if (value instanceof Date) return value.getTime()
  // Try to parse as number first (e.g. "42.5", "-100")
  const num = parseFloat(value)
  if (!isNaN(num) && /^-?\d+(\.\d+)?$/.test(value.trim())) return num
  // Try to parse ISO date string
  const parsed = Date.parse(value)
  if (!isNaN(parsed)) return parsed
  // If not a date either, check if parseFloat succeeded
  if (!isNaN(num)) return num
  console.warn(`Invalid RefLineValue: ${value}, defaulting to 0`)
  return 0
}

// Normalize a point tuple
export function normalize_point(
  point: [RefLineValue, RefLineValue],
): [number, number] {
  return [normalize_value(point[0]), normalize_value(point[1])]
}

// ============================================================================
// 2D Helper Functions - create RefLine objects with common patterns
// ============================================================================

// Create a horizontal reference line at y = value
export function horizontal_line(
  y_value: RefLineValue,
  opts?: Partial<RefLineBase>,
): RefLine {
  return { type: `horizontal`, y: y_value, ...opts }
}

// Create a vertical reference line at x = value
export function vertical_line(
  x_value: RefLineValue,
  opts?: Partial<RefLineBase>,
): RefLine {
  return { type: `vertical`, x: x_value, ...opts }
}

// Create a diagonal reference line with y = slope * x + intercept
export function diagonal_line(
  slope: number,
  intercept: number,
  opts?: Partial<RefLineBase>,
): RefLine {
  return { type: `diagonal`, slope, intercept, ...opts }
}

// Create a line segment between two points
export function line_segment(
  p1: [RefLineValue, RefLineValue],
  p2: [RefLineValue, RefLineValue],
  opts?: Partial<RefLineBase>,
): RefLine {
  return { type: `segment`, p1, p2, ...opts }
}

// Create a line through two points, extended to plot edges
export function line_through(
  p1: [RefLineValue, RefLineValue],
  p2: [RefLineValue, RefLineValue],
  opts?: Partial<RefLineBase>,
): RefLine {
  return { type: `line`, p1, p2, ...opts }
}

// Batch helper: create multiple horizontal lines
export function horizontal_lines(
  values: RefLineValue[],
  opts?: Partial<RefLineBase>,
): RefLine[] {
  return values.map((y_value) => horizontal_line(y_value, opts))
}

// Batch helper: create multiple vertical lines
export function vertical_lines(
  values: RefLineValue[],
  opts?: Partial<RefLineBase>,
): RefLine[] {
  return values.map((x_value) => vertical_line(x_value, opts))
}

// ============================================================================
// 3D Helper Functions - create RefPlane objects with common patterns
// ============================================================================

// Create an XY plane at z = value (horizontal plane)
export function plane_xy(z_value: number, opts?: Partial<RefPlaneBase>): RefPlane {
  return { type: `xy`, z: z_value, ...opts }
}

// Create an XZ plane at y = value
export function plane_xz(y_value: number, opts?: Partial<RefPlaneBase>): RefPlane {
  return { type: `xz`, y: y_value, ...opts }
}

// Create a YZ plane at x = value
export function plane_yz(x_value: number, opts?: Partial<RefPlaneBase>): RefPlane {
  return { type: `yz`, x: x_value, ...opts }
}

// Create a plane defined by normal vector and a point on the plane
export function plane_normal(
  normal: [number, number, number],
  point: [number, number, number],
  opts?: Partial<RefPlaneBase>,
): RefPlane {
  return { type: `normal`, normal, point, ...opts }
}

// Create a plane through three points
export function plane_through_points(
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  opts?: Partial<RefPlaneBase>,
): RefPlane {
  return { type: `points`, p1, p2, p3, ...opts }
}

// ============================================================================
// 3D Line Helpers
// ============================================================================

// Create a 3D line parallel to x-axis at given y, z
export function line_x_axis(
  y_value: number,
  z_value: number,
  opts?: Partial<RefLine3DBase>,
): RefLine3D {
  return { type: `x-axis`, y: y_value, z: z_value, ...opts }
}

// Create a 3D line parallel to y-axis at given x, z
export function line_y_axis(
  x_value: number,
  z_value: number,
  opts?: Partial<RefLine3DBase>,
): RefLine3D {
  return { type: `y-axis`, x: x_value, z: z_value, ...opts }
}

// Create a 3D line parallel to z-axis at given x, y
export function line_z_axis(
  x_value: number,
  y_value: number,
  opts?: Partial<RefLine3DBase>,
): RefLine3D {
  return { type: `z-axis`, x: x_value, y: y_value, ...opts }
}

// Create a 3D line segment between two points
export function line_segment_3d(
  p1: [number, number, number],
  p2: [number, number, number],
  opts?: Partial<RefLine3DBase>,
): RefLine3D {
  return { type: `segment`, p1, p2, ...opts }
}

// Create a 3D line through two points, extended to bounds
export function line_through_3d(
  p1: [number, number, number],
  p2: [number, number, number],
  opts?: Partial<RefLine3DBase>,
): RefLine3D {
  return { type: `line`, p1, p2, ...opts }
}

// ============================================================================
// Coordinate resolution - compute line endpoints from RefLine spec
// ============================================================================

interface PlotBounds {
  x_min: number
  x_max: number
  y_min: number
  y_max: number
  pad: { l: number; r: number; t: number; b: number }
  width: number
  height: number
}

interface ScaleFunctions {
  x_scale: (val: number) => number
  y_scale: (val: number) => number
  y2_scale?: (val: number) => number
}

// Compute the screen coordinates for a reference line
// Returns [x1, y1, x2, y2] in pixel coordinates, or null if line is not visible
export function resolve_line_endpoints(
  ref_line: RefLine,
  bounds: PlotBounds,
  scales: ScaleFunctions,
): [number, number, number, number] | null {
  const { x_min, x_max, y_min, y_max } = bounds
  const { x_scale, y_scale, y2_scale } = scales

  // Determine which y-scale to use
  const active_y_scale = ref_line.y_axis === `y2` && y2_scale ? y2_scale : y_scale

  // Check if value is within plot bounds (for visibility)
  const is_x_visible = (x_val: number): boolean => x_val >= x_min && x_val <= x_max
  const is_y_visible = (y_val: number): boolean => y_val >= y_min && y_val <= y_max

  // Apply span constraints
  const apply_x_span = (x1: number, x2: number): [number, number] => {
    const span = ref_line.x_span
    if (!span) return [x1, x2]
    const [min_x, max_x] = span
    return [
      min_x !== null ? Math.max(x1, min_x) : x1,
      max_x !== null ? Math.min(x2, max_x) : x2,
    ]
  }

  const apply_y_span = (y1: number, y2: number): [number, number] => {
    const span = ref_line.y_span
    if (!span) return [y1, y2]
    const [min_y, max_y] = span
    return [
      min_y !== null ? Math.max(y1, min_y) : y1,
      max_y !== null ? Math.min(y2, max_y) : y2,
    ]
  }

  // Relative to data coordinate conversion
  const to_data_x = (rel: number): number => x_min + rel * (x_max - x_min)
  const to_data_y = (rel: number): number => y_min + rel * (y_max - y_min)

  let x1_data: number
  let y1_data: number
  let x2_data: number
  let y2_data: number

  switch (ref_line.type) {
    case `horizontal`: {
      const y_val = normalize_value(ref_line.y)
      const y_coord = ref_line.coord_mode === `relative` ? to_data_y(y_val) : y_val
      if (!is_y_visible(y_coord)) return null
      ;[x1_data, x2_data] = apply_x_span(x_min, x_max)
      y1_data = y_coord
      y2_data = y_coord
      break
    }

    case `vertical`: {
      const x_val = normalize_value(ref_line.x)
      const x_coord = ref_line.coord_mode === `relative` ? to_data_x(x_val) : x_val
      if (!is_x_visible(x_coord)) return null
      x1_data = x_coord
      x2_data = x_coord
      ;[y1_data, y2_data] = apply_y_span(y_min, y_max)
      break
    }

    case `diagonal`: {
      const { slope, intercept } = ref_line
      // Calculate y at x_min and x_max
      const y_at_x_min = slope * x_min + intercept
      const y_at_x_max = slope * x_max + intercept
      // Start with full x range
      let x1 = x_min
      let x2 = x_max
      let y1 = y_at_x_min
      let y2 = y_at_x_max

      // Clip to y bounds
      if (y1 < y_min) {
        x1 = (y_min - intercept) / slope
        y1 = y_min
      } else if (y1 > y_max) {
        x1 = (y_max - intercept) / slope
        y1 = y_max
      }
      if (y2 < y_min) {
        x2 = (y_min - intercept) / slope
        y2 = y_min
      } else if (y2 > y_max) {
        x2 = (y_max - intercept) / slope
        y2 = y_max
      } // Apply span constraints

      ;[x1_data, x2_data] = apply_x_span(x1, x2)
      ;[y1_data, y2_data] = apply_y_span(y1, y2)

      // Ensure line is at least partially visible
      if (x1_data > x_max || x2_data < x_min) return null
      break
    }

    case `segment`: {
      const [p1x, p1y] = normalize_point(ref_line.p1)
      const [p2x, p2y] = normalize_point(ref_line.p2)
      x1_data = p1x
      y1_data = p1y
      x2_data = p2x
      y2_data = p2y // Apply span constraints (clip segment)
      ;[x1_data, x2_data] = apply_x_span(
        Math.min(x1_data, x2_data),
        Math.max(x1_data, x2_data),
      )
      ;[y1_data, y2_data] = apply_y_span(
        Math.min(y1_data, y2_data),
        Math.max(y1_data, y2_data),
      )
      break
    }

    case `line`: {
      // Line through two points, extended to plot edges
      const [p1x, p1y] = normalize_point(ref_line.p1)
      const [p2x, p2y] = normalize_point(ref_line.p2)

      // Calculate slope and intercept
      const dx = p2x - p1x
      const dy = p2y - p1y

      if (Math.abs(dx) < 1e-10) {
        // Nearly vertical line
        x1_data = p1x
        x2_data = p1x
        ;[y1_data, y2_data] = apply_y_span(y_min, y_max)
      } else {
        const slope = dy / dx
        const intercept = p1y - slope * p1x

        // Same logic as diagonal
        let x1 = x_min
        let x2 = x_max
        let y1 = slope * x_min + intercept
        let y2 = slope * x_max + intercept

        // Clip to y bounds
        if (slope !== 0) {
          if (y1 < y_min) {
            x1 = (y_min - intercept) / slope
            y1 = y_min
          } else if (y1 > y_max) {
            x1 = (y_max - intercept) / slope
            y1 = y_max
          }
          if (y2 < y_min) {
            x2 = (y_min - intercept) / slope
            y2 = y_min
          } else if (y2 > y_max) {
            x2 = (y_max - intercept) / slope
            y2 = y_max
          }
        }

        ;[x1_data, x2_data] = apply_x_span(x1, x2)
        ;[y1_data, y2_data] = apply_y_span(y1, y2)
      }
      break
    }

    default:
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

// ============================================================================
// Annotation positioning helpers
// ============================================================================

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
    rotate?: boolean
  },
): AnnotationPosition {
  const position = annotation.position ?? `end`
  const side = annotation.side ?? `above`
  const offset_x = annotation.offset?.x ?? 0
  const offset_y = annotation.offset?.y ?? 0

  // Calculate position along line
  let frac: number
  switch (position) {
    case `start`:
      frac = 0
      break
    case `center`:
      frac = 0.5
      break
    case `end`:
    default:
      frac = 1
      break
  }

  const base_x = x1 + frac * (x2 - x1)
  const base_y = y1 + frac * (y2 - y1)

  // Calculate perpendicular offset based on side
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  const default_offset = 8 // pixels from line

  let perp_x = 0
  let perp_y = 0
  if (len > 0) {
    // Perpendicular vector (normalized)
    const nx = -dy / len
    const ny = dx / len

    switch (side) {
      case `above`:
        perp_x = nx * default_offset
        perp_y = ny * default_offset
        // In SVG, y increases downward, so "above" means negative y
        if (perp_y > 0) {
          perp_x = -perp_x
          perp_y = -perp_y
        }
        break
      case `below`:
        perp_x = nx * default_offset
        perp_y = ny * default_offset
        if (perp_y < 0) {
          perp_x = -perp_x
          perp_y = -perp_y
        }
        break
      case `left`:
        perp_x = -default_offset
        perp_y = 0
        break
      case `right`:
        perp_x = default_offset
        perp_y = 0
        break
    }
  }

  const final_x = base_x + perp_x + offset_x
  const final_y = base_y + perp_y + offset_y

  // Text anchor based on position
  let text_anchor: `start` | `middle` | `end` = `middle`
  if (position === `start`) text_anchor = `start`
  else if (position === `end`) text_anchor = `end`

  // Dominant baseline based on side
  let dominant_baseline: `auto` | `middle` | `hanging` = `middle`
  if (side === `above`) dominant_baseline = `auto`
  else if (side === `below`) dominant_baseline = `hanging`

  // Calculate rotation if needed
  let rotation: number | undefined
  if (annotation.rotate && len > 0) {
    rotation = Math.atan2(dy, dx) * (180 / Math.PI)
    // Keep text readable (not upside down)
    if (rotation > 90) rotation -= 180
    else if (rotation < -90) rotation += 180
  }

  return { x: final_x, y: final_y, text_anchor, dominant_baseline, rotation }
}

// ============================================================================
// Validation helpers
// ============================================================================

// Validate a RefLine object has required fields
export function validate_ref_line(line: RefLine): boolean {
  if (!line || typeof line !== `object`) return false
  if (!line.type) return false

  switch (line.type) {
    case `horizontal`:
      return line.y !== undefined
    case `vertical`:
      return line.x !== undefined
    case `diagonal`:
      return typeof line.slope === `number` && typeof line.intercept === `number`
    case `segment`:
    case `line`:
      return (
        Array.isArray(line.p1) &&
        line.p1.length === 2 &&
        Array.isArray(line.p2) &&
        line.p2.length === 2
      )
    default:
      return false
  }
}

// Validate a RefLine3D object
export function validate_ref_line_3d(line: RefLine3D): boolean {
  if (!line || typeof line !== `object`) return false
  if (!line.type) return false

  switch (line.type) {
    case `x-axis`:
      return typeof line.y === `number` && typeof line.z === `number`
    case `y-axis`:
      return typeof line.x === `number` && typeof line.z === `number`
    case `z-axis`:
      return typeof line.x === `number` && typeof line.y === `number`
    case `segment`:
    case `line`:
      return (
        Array.isArray(line.p1) &&
        line.p1.length === 3 &&
        Array.isArray(line.p2) &&
        line.p2.length === 3
      )
    default:
      return false
  }
}

// Validate a RefPlane object
export function validate_ref_plane(plane: RefPlane): boolean {
  if (!plane || typeof plane !== `object`) return false
  if (!plane.type) return false

  switch (plane.type) {
    case `xy`:
      return typeof plane.z === `number`
    case `xz`:
      return typeof plane.y === `number`
    case `yz`:
      return typeof plane.x === `number`
    case `normal`:
      return (
        Array.isArray(plane.normal) &&
        plane.normal.length === 3 &&
        Array.isArray(plane.point) &&
        plane.point.length === 3
      )
    case `points`:
      return (
        Array.isArray(plane.p1) &&
        plane.p1.length === 3 &&
        Array.isArray(plane.p2) &&
        plane.p2.length === 3 &&
        Array.isArray(plane.p3) &&
        plane.p3.length === 3
      )
    default:
      return false
  }
}

// ============================================================================
// 3D Coordinate Transforms - shared between ReferenceLine3D and ReferencePlane
// ============================================================================

export interface Scene3DParams {
  scene_x: number
  scene_y: number
  scene_z: number
  x_range: [number, number]
  y_range: [number, number]
  z_range: [number, number]
}

// Normalize a data value to scene coordinates (centered around 0)
export function normalize_to_scene(
  value: number,
  [min_val, max_val]: [number, number],
  scene_size: number,
): number {
  return ((value - min_val) / (max_val - min_val || 1) - 0.5) * scene_size
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
