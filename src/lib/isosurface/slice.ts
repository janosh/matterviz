// HKL plane slicing for volumetric data: samples a 3D grid along an arbitrary
// crystallographic plane defined by Miller indices, using trilinear interpolation.
import { reciprocal_lattice } from '$lib/brillouin'
import type { Vec2, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { create_volume_sampler, sanitize_display_range, type DisplayRange } from './sampling'
import type { VolumetricData } from './types'

const CELL_EDGES = [
  [0, 1],
  [0, 2],
  [0, 4],
  [1, 3],
  [1, 5],
  [2, 3],
  [2, 6],
  [3, 7],
  [4, 5],
  [4, 6],
  [5, 7],
  [6, 7],
] as const
const PLANE_TOLERANCE = 1e-9
const DEFAULT_MAX_PIXELS = 512 * 512
const UNIT_CELL_RANGE: DisplayRange = [
  [0, 1],
  [0, 1],
  [0, 1],
]

export const volume_center = (volume: VolumetricData): Vec3 =>
  math.add(volume.origin, math.create_frac_to_cart(volume.lattice)([0.5, 0.5, 0.5]))

/** Resolve a Cartesian slice point, defaulting to the volume center or origin. */
export const resolve_slice_cartesian_point = (
  point: Vec3 | undefined,
  volume?: VolumetricData,
): Vec3 => point ?? (volume ? volume_center(volume) : [0, 0, 0])

export interface CartesianPlane {
  point: Vec3 // absolute Cartesian point on the plane
  normal: Vec3 // Cartesian plane normal (normalization is handled internally)
  up?: Vec3 // optional preferred in-plane orientation
}

export interface PlaneSliceOptions {
  resolution?: number | Vec2 // scalar = longest side, tuple = exact [width, height]
  max_pixels?: number
  fractional_bounds?: DisplayRange
}

// Result of sampling a 2D slice through volumetric data
export interface SliceResult {
  data: Float64Array // sampled values, row-major [height * width]; masked pixels are NaN
  mask: Uint8Array // 1 inside the exact cell/plane intersection, 0 outside
  width: number
  height: number
  min: number // data minimum for colormap
  max: number // data maximum for colormap
  point: Vec3
  normal: Vec3
  u_axis: Vec3
  v_axis: Vec3
  u_range: Vec2
  v_range: Vec2
  polygon: Vec2[] // exact convex cell/plane intersection in local (u, v)
}

const cell_corners = (volume: VolumetricData, bounds: DisplayRange): Vec3[] => {
  const frac_to_cart = math.create_frac_to_cart(volume.lattice)
  return Array.from({ length: 8 }, (_, corner_idx) =>
    math.add(
      volume.origin,
      frac_to_cart([
        bounds[0][corner_idx & 1 ? 1 : 0],
        bounds[1][corner_idx & 2 ? 1 : 0],
        bounds[2][corner_idx & 4 ? 1 : 0],
      ]),
    ),
  )
}

const add_unique_point = (points: Vec3[], point: Vec3): void => {
  if (
    points.some(
      (existing) =>
        (existing[0] - point[0]) ** 2 +
          (existing[1] - point[1]) ** 2 +
          (existing[2] - point[2]) ** 2 <
        PLANE_TOLERANCE ** 2,
    )
  )
    return
  points.push(point)
}

const plane_basis = (normal: Vec3, up?: Vec3): [Vec3, Vec3] => {
  if (!up) return math.compute_in_plane_basis(normal)
  const normal_projection = math.dot(up, normal)
  const projected = math.subtract(up, math.scale(normal, normal_projection))
  if (Math.hypot(...projected) < PLANE_TOLERANCE) {
    return math.compute_in_plane_basis(normal)
  }
  const u_axis = math.normalize_vec(projected)
  return [u_axis, math.cross_3d(normal, u_axis)]
}

const intersect_plane_cell = (
  corners: Vec3[],
  point: Vec3,
  normal: Vec3,
  u_axis: Vec3,
  v_axis: Vec3,
): Vec2[] => {
  const intersections: Vec3[] = []
  for (const [start_idx, end_idx] of CELL_EDGES) {
    const start = corners[start_idx]
    const end = corners[end_idx]
    const start_distance = math.dot(math.subtract(start, point), normal)
    const end_distance = math.dot(math.subtract(end, point), normal)
    if (Math.abs(start_distance) <= PLANE_TOLERANCE) add_unique_point(intersections, start)
    if (Math.abs(end_distance) <= PLANE_TOLERANCE) add_unique_point(intersections, end)
    if (start_distance * end_distance >= -(PLANE_TOLERANCE ** 2)) continue
    const fraction = start_distance / (start_distance - end_distance)
    add_unique_point(intersections, [
      start[0] + fraction * (end[0] - start[0]),
      start[1] + fraction * (end[1] - start[1]),
      start[2] + fraction * (end[2] - start[2]),
    ])
  }
  return math.convex_hull_2d(
    intersections.map((intersection) => {
      const relative = math.subtract(intersection, point)
      return [math.dot(relative, u_axis), math.dot(relative, v_axis)]
    }),
    PLANE_TOLERANCE,
  )
}

const point_in_convex_polygon = (point: Vec2, polygon: Vec2[]): boolean => {
  let orientation = 0
  for (let point_idx = 0; point_idx < polygon.length; point_idx++) {
    const start = polygon[point_idx]
    const end = polygon[(point_idx + 1) % polygon.length]
    const cross =
      (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0])
    if (Math.abs(cross) <= PLANE_TOLERANCE) continue
    const current_orientation = Math.sign(cross)
    if (orientation && current_orientation !== orientation) return false
    orientation = current_orientation
  }
  return true
}

const resolve_resolution = (
  resolution: number | Vec2 | undefined,
  u_span: number,
  v_span: number,
  max_grid_dim: number,
  max_pixels: number,
): Vec2 => {
  let counts: Vec2
  if (Array.isArray(resolution)) {
    counts = [Math.max(2, Math.round(resolution[0])), Math.max(2, Math.round(resolution[1]))]
  } else {
    const longest_count = Math.max(2, Math.round(resolution ?? max_grid_dim))
    const longest_span = Math.max(u_span, v_span, PLANE_TOLERANCE)
    counts = [
      Math.max(2, Math.round((longest_count * u_span) / longest_span)),
      Math.max(2, Math.round((longest_count * v_span) / longest_span)),
    ]
  }
  const pixel_budget = Number.isFinite(max_pixels)
    ? Math.max(4, Math.floor(max_pixels))
    : DEFAULT_MAX_PIXELS
  const shrink = Math.min(1, Math.sqrt(pixel_budget / (counts[0] * counts[1])))
  if (shrink >= 1) return counts
  counts = counts.map((count) => Math.max(2, Math.floor(count * shrink))) as Vec2
  if (counts[0] * counts[1] > pixel_budget) {
    const axis = counts[0] >= counts[1] ? 0 : 1
    counts[axis] = Math.max(2, Math.floor(pixel_budget / counts[axis === 0 ? 1 : 0]))
  }
  return counts
}

/** Sample a scalar volume on an arbitrary absolute Cartesian plane. */
export function sample_plane_slice(
  volume: VolumetricData,
  plane: CartesianPlane,
  options: PlaneSliceOptions = {},
): SliceResult | null {
  if (!plane.point.every(Number.isFinite) || !plane.normal.every(Number.isFinite)) return null
  if (plane.up && !plane.up.every(Number.isFinite)) return null
  if (Math.hypot(...plane.normal) < PLANE_TOLERANCE) return null // degenerate normal
  const normal = math.normalize_vec(plane.normal)

  // In-plane basis vectors
  const [u_axis, v_axis] = plane_basis(normal, plane.up)
  const bounds = sanitize_display_range(
    options.fractional_bounds ?? UNIT_CELL_RANGE,
    volume.periodic,
  )
  const corners = cell_corners(volume, bounds)
  const polygon = intersect_plane_cell(corners, plane.point, normal, u_axis, v_axis)
  if (polygon.length < 3) return null

  // Project all 8 unit cell corners onto the (u, v) plane to find sampling bounds.
  // Corners are at fractional coords (0 or 1) for each axis.
  const { min, max, width: u_span, height: v_span } = math.compute_bounding_box_2d(polygon)
  const u_range: Vec2 = [min[0], max[0]]
  const v_range: Vec2 = [min[1], max[1]]
  if (u_span <= PLANE_TOLERANCE || v_span <= PLANE_TOLERANCE) return null

  // Sampling resolution: caller-specified or default to max grid dimension
  const [width, height] = resolve_resolution(
    options.resolution,
    u_span,
    v_span,
    Math.max(...volume.grid_dims),
    options.max_pixels ?? DEFAULT_MAX_PIXELS,
  )
  const data = new Float64Array(width * height)
  data.fill(Number.NaN)
  const mask = new Uint8Array(width * height)
  let data_min = Infinity
  let data_max = -Infinity
  const sample = create_volume_sampler(volume, {
    out_of_bounds: volume.periodic ? `clamp` : `fallback`,
  })
  const u_step = u_span / (width - 1)
  const v_step = v_span / (height - 1)
  const cartesian: Vec3 = [0, 0, 0]

  for (let row = 0; row < height; row++) {
    const v_value = v_range[0] + row * v_step
    for (let col = 0; col < width; col++) {
      const u_value = u_range[0] + col * u_step
      if (!point_in_convex_polygon([u_value, v_value], polygon)) continue
      const data_idx = row * width + col
      mask[data_idx] = 1

      // Cartesian position on the plane
      cartesian[0] = plane.point[0] + u_value * u_axis[0] + v_value * v_axis[0]
      cartesian[1] = plane.point[1] + u_value * u_axis[1] + v_value * v_axis[1]
      cartesian[2] = plane.point[2] + u_value * u_axis[2] + v_value * v_axis[2]
      const value = sample(cartesian)
      if (!Number.isFinite(value)) continue
      data[data_idx] = value
      if (value < data_min) data_min = value
      if (value > data_max) data_max = value
    }
  }

  return {
    data,
    mask,
    width,
    height,
    min: data_min === Infinity ? 0 : data_min,
    max: data_max === -Infinity ? 0 : data_max,
    point: [...plane.point],
    normal,
    u_axis,
    v_axis,
    u_range,
    v_range,
    polygon,
  }
}

// Sample a 2D slice through volumetric data along a Miller-index plane.
// `miller_indices` [h,k,l] defines the plane normal in reciprocal space.
// `distance` is fractional [0,1] along the normal direction within the cell.
// Returns null if indices are all zero.
export function sample_hkl_slice(
  volume: VolumetricData,
  miller_indices: Vec3,
  distance: number,
  n_points?: number,
): SliceResult | null {
  const [h_idx, k_idx, l_idx] = miller_indices
  if (h_idx === 0 && k_idx === 0 && l_idx === 0) return null

  // Plane normal G = h*b1 + k*b2 + l*b3 where b_i are reciprocal lattice rows
  const recip = reciprocal_lattice(volume.lattice)
  const plane_normal: Vec3 = [
    h_idx * recip[0][0] + k_idx * recip[1][0] + l_idx * recip[2][0],
    h_idx * recip[0][1] + k_idx * recip[1][1] + l_idx * recip[2][1],
    h_idx * recip[0][2] + k_idx * recip[1][2] + l_idx * recip[2][2],
  ]
  if (Math.hypot(...plane_normal) < PLANE_TOLERANCE) return null // degenerate normal
  const unit_normal = math.normalize_vec(plane_normal)
  const corners = cell_corners(volume, UNIT_CELL_RANGE)
  const projections = corners.map((corner) => math.dot(corner, unit_normal))
  const normal_min = Math.min(...projections)
  const normal_max = Math.max(...projections)

  // Plane position: fractional distance [0,1] along the normal extent
  const d_cartesian = normal_min + distance * (normal_max - normal_min)
  const point: Vec3 = [
    d_cartesian * unit_normal[0],
    d_cartesian * unit_normal[1],
    d_cartesian * unit_normal[2],
  ]
  const resolution = n_points ?? Math.max(...volume.grid_dims)
  return sample_plane_slice(
    volume,
    { point, normal: unit_normal },
    { resolution: [resolution, resolution] },
  )
}
