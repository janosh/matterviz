// HKL plane slicing for volumetric data: samples a 3D grid along an arbitrary
// crystallographic plane defined by Miller indices, using trilinear interpolation.
import type { Vec2, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import { lower_corner, safe_mod, upper_corner } from './grid'
import type { DisplayRange } from './sampling'
import type { VolumeSliceSettings } from './slice-settings'
import { sanitize_display_range, UNIT_CELL_RANGE } from './sampling'
import type { VolumetricData } from './types'

const PLANE_TOLERANCE = 1e-9
const DEFAULT_MAX_PIXELS = 1024 * 1024

export const volume_center = (volume: VolumetricData): Vec3 =>
  math.add(volume.origin, math.create_frac_to_cart(volume.lattice)([0.5, 0.5, 0.5]))

// Resolve a Cartesian slice point, defaulting to the volume center or origin.
export const resolve_slice_cartesian_point = (
  point: Vec3 | undefined,
  volume?: VolumetricData,
): Vec3 => point ?? (volume ? volume_center(volume) : [0, 0, 0])

const POLE = Math.sqrt(3) - 2 // pole of the cubic B-spline interpolation prefilter
const HORIZON = 30 // POLE ** 30 ≈ 1e-17: the prefilter's exponential tail

// Upsample one axis of an [outer, size, inner] row-major array by an integer factor with an
// interpolating cubic B-spline (Unser's recursive prefilter, then the spline's 4 taps): it
// passes through every sample and is C2, so isolines bend smoothly instead of kinking at
// grid lines. Periodic axes wrap, finite ones mirror. Values are clamped to `[lower, upper]`.
const upsample_axis = (
  values: Float64Array,
  [outer, size, inner]: Vec3,
  factor: number,
  periodic: boolean,
  [lower, upper]: Vec2,
): Float64Array => {
  const period = periodic ? size : 2 * size - 2
  const index = (idx: number): number => {
    const wrapped = safe_mod(idx, period)
    return wrapped < size ? wrapped : period - wrapped
  }
  const out_size = periodic ? size * factor : (size - 1) * factor + 1
  const out = new Float64Array(outer * out_size * inner)
  const coefs = new Float64Array(size)
  for (let line = 0; line < outer * inner; line++) {
    const [outer_idx, inner_idx] = [Math.floor(line / inner), line % inner]
    const src = outer_idx * size * inner + inner_idx
    for (let idx = 0; idx < size; idx++) coefs[idx] = 6 * values[src + idx * inner]
    // causal pass y[k] = x[k] + POLE * y[k - 1], seeded with the extended signal's tail
    let seed = 0
    for (let lag = HORIZON; lag >= 0; lag--) seed = seed * POLE + coefs[index(-lag)]
    coefs[0] = seed
    for (let idx = 1; idx < size; idx++) coefs[idx] += POLE * coefs[idx - 1]
    // anti-causal pass d[k] = POLE * (d[k + 1] - y[k])
    if (periodic) {
      seed = 0
      for (let lag = HORIZON; lag >= 0; lag--)
        seed = seed * POLE - POLE * coefs[index(size - 1 + lag)]
    } else seed = (POLE / (POLE * POLE - 1)) * (POLE * coefs[size - 2] + coefs[size - 1])
    coefs[size - 1] = seed
    for (let idx = size - 2; idx >= 0; idx--) coefs[idx] = POLE * (coefs[idx + 1] - coefs[idx])
    const dst = outer_idx * out_size * inner + inner_idx
    for (let out_idx = 0; out_idx < out_size; out_idx++) {
      const base = Math.floor(out_idx / factor)
      const frac = out_idx / factor - base
      const spline =
        ((1 - frac) ** 3 * coefs[index(base - 1)] +
          (3 * frac ** 3 - 6 * frac ** 2 + 4) * coefs[index(base)] +
          (-3 * frac ** 3 + 3 * frac ** 2 + 3 * frac + 1) * coefs[index(base + 1)] +
          frac ** 3 * coefs[index(base + 2)]) /
        6
      out[dst + out_idx * inner] = Math.max(lower, Math.min(upper, spline))
    }
  }
  return out
}

// Trilinear interpolation kinks wherever a slice crosses a grid plane, so coarse grids draw
// visibly polygonal isolines. Refine each axis with interpolating cubic B-splines until it has
// about `min_axis_points` samples (within `max_points` total), so a slice crosses many small
// cells of a smooth field instead. Grid samples and the data range are preserved.
export function upsample_volume(
  volume: VolumetricData,
  { min_axis_points = 64, max_points = 4_000_000 } = {},
): VolumetricData {
  const { periodic, data_range } = volume
  let values = volume.values
  const dims: Vec3 = [...volume.dims]
  for (const axis of [2, 1, 0] as const) {
    const size = dims[axis]
    const room = max_points / (dims[0] * dims[1] * dims[2])
    const factor = Math.max(1, Math.min(Math.ceil(min_axis_points / size), Math.floor(room)))
    if (factor === 1 || size < 2) continue
    const outer = axis === 0 ? 1 : axis === 1 ? dims[0] : dims[0] * dims[1]
    const inner = axis === 0 ? dims[1] * dims[2] : axis === 1 ? dims[2] : 1
    const range: Vec2 = [data_range.min, data_range.max]
    values = upsample_axis(values, [outer, size, inner], factor, periodic, range)
    dims[axis] = periodic ? size * factor : (size - 1) * factor + 1
  }
  return values === volume.values ? volume : { ...volume, values, dims }
}

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

// Maps unit-cube corners to the absolute Cartesian corners of the cell
// block spanning `bounds` (fractional, per axis)
const bounded_cell_corner = (volume: VolumetricData, bounds: DisplayRange) => {
  const frac_to_cart = math.create_frac_to_cart(volume.lattice)
  return (unit: Vec3): Vec3 =>
    math.add(volume.origin, frac_to_cart(unit.map((bit, axis) => bounds[axis][bit]) as Vec3))
}

const plane_basis = (normal: Vec3, up_vector?: Vec3): [Vec3, Vec3] => {
  if (!up_vector) return math.compute_in_plane_basis(normal)
  const normal_projection = math.dot(up_vector, normal)
  const projected = math.subtract(up_vector, math.scale(normal, normal_projection))
  if (Math.hypot(...projected) < PLANE_TOLERANCE) {
    return math.compute_in_plane_basis(normal)
  }
  const u_axis = math.normalize_vec(projected)
  return [u_axis, math.cross_3d(normal, u_axis)]
}

// Edges as flat [start_u, start_v, delta_u, delta_v] quadruples, so the per-pixel test below
// reads typed scalars (the same doubles the polygon's Vec2 arithmetic would produce)
const polygon_edges = (polygon: Vec2[]): Float64Array => {
  const edges = new Float64Array(polygon.length * 4)
  for (const [point_idx, start] of polygon.entries()) {
    const end = polygon[(point_idx + 1) % polygon.length]
    edges.set([start[0], start[1], end[0] - start[0], end[1] - start[1]], point_idx * 4)
  }
  return edges
}

// Inside (or within PLANE_TOLERANCE of) a convex polygon: no edge may see the point on the
// opposite side from another
const point_in_convex_polygon = (u_coord: number, v_coord: number, edges: Float64Array) => {
  let orientation = 0
  for (let edge_idx = 0; edge_idx < edges.length; edge_idx += 4) {
    const cross =
      edges[edge_idx + 2] * (v_coord - edges[edge_idx + 1]) -
      edges[edge_idx + 3] * (u_coord - edges[edge_idx])
    if (cross <= PLANE_TOLERANCE && cross >= -PLANE_TOLERANCE) continue
    const current_orientation = cross > 0 ? 1 : -1
    if (orientation && current_orientation !== orientation) return false
    orientation = current_orientation
  }
  return true
}

// u extent of a convex polygon along the line v = v_coord (all of u when the line misses
// it), only as a starting guess for the exact test
const polygon_row_extent = (v_coord: number, edges: Float64Array): Vec2 => {
  let [u_min, u_max] = [Infinity, -Infinity]
  for (let edge_idx = 0; edge_idx < edges.length; edge_idx += 4) {
    const fraction = (v_coord - edges[edge_idx + 1]) / edges[edge_idx + 3]
    if (!(fraction >= 0 && fraction <= 1)) continue // also skips horizontal edges (NaN, ±∞)
    const u_coord = edges[edge_idx] + fraction * edges[edge_idx + 2]
    u_min = Math.min(u_min, u_coord)
    u_max = Math.max(u_max, u_coord)
  }
  return u_min <= u_max ? [u_min, u_max] : [-Infinity, Infinity]
}

// First index past `idx` where floor(start + index * step) leaves `floor_value`
const cell_exit = (idx: number, start: number, step: number, floor_value: number): number => {
  if (step === 0) return Infinity
  const exit =
    step > 0
      ? Math.ceil((floor_value + 1 - start) / step)
      : Math.floor((floor_value - start) / step) + 1
  return Math.max(exit, idx + 1)
}

// Trilinear samples at grid coordinates start + idx * step (idx < count), written to
// out[offset + idx] for every pixel of every slider frame. Between grid-plane crossings a run
// stays in one cell, where the blend of its 8 corners is a cubic in idx: each cell costs one
// gather and each pixel one Horner step. Matches trilinear_interpolate up to rounding.
function sample_grid_run(
  { periodic, values, dims }: VolumetricData,
  [start_x, start_y, start_z]: Vec3,
  [step_x, step_y, step_z]: Vec3,
  count: number,
  out: Float64Array,
  offset: number,
): void {
  if (values.length === 0) return void out.fill(0, offset, offset + count)
  const [size_x, size_y, size_z] = dims
  const stride_x = size_y * size_z
  let idx = 0
  while (idx < count) {
    const at_x = start_x + idx * step_x
    const at_y = start_y + idx * step_y
    const at_z = start_z + idx * step_z
    const [floor_x, floor_y, floor_z] = [Math.floor(at_x), Math.floor(at_y), Math.floor(at_z)]
    const end = Math.min(
      count,
      cell_exit(idx, start_x, step_x, floor_x),
      cell_exit(idx, start_y, step_y, floor_y),
      cell_exit(idx, start_z, step_z, floor_z),
    )
    // periodic cells wrap; finite ones clamp the lower corner to n - 2 (singleton axes to 0)
    const x_0 = lower_corner(size_x, floor_x, periodic)
    const y_0 = lower_corner(size_y, floor_y, periodic)
    const z_0 = lower_corner(size_z, floor_z, periodic)
    const x_1 = upper_corner(size_x, x_0, periodic)
    const y_1 = upper_corner(size_y, y_0, periodic)
    const z_1 = upper_corner(size_z, z_0, periodic)
    // in-cell fractions at idx: periodic cells start at the unwrapped floor, finite ones at
    // the clamped lower corner
    const ax = at_x - (periodic ? floor_x : x_0)
    const ay = at_y - (periodic ? floor_y : y_0)
    const az = at_z - (periodic ? floor_z : z_0)
    const c000 = values[x_0 * stride_x + y_0 * size_z + z_0]
    const c001 = values[x_0 * stride_x + y_0 * size_z + z_1]
    const c010 = values[x_0 * stride_x + y_1 * size_z + z_0]
    const c011 = values[x_0 * stride_x + y_1 * size_z + z_1]
    const c100 = values[x_1 * stride_x + y_0 * size_z + z_0]
    const c101 = values[x_1 * stride_x + y_0 * size_z + z_1]
    const c110 = values[x_1 * stride_x + y_1 * size_z + z_0]
    const c111 = values[x_1 * stride_x + y_1 * size_z + z_1]
    // trilinear blend as a polynomial in the in-cell fractions X, Y, Z ...
    const k_x = c100 - c000
    const k_y = c010 - c000
    const k_z = c001 - c000
    const k_xy = c110 - c100 - c010 + c000
    const k_xz = c101 - c100 - c001 + c000
    const k_yz = c011 - c010 - c001 + c000
    const k_xyz = c111 - c110 - c101 - c011 + c100 + c010 + c001 - c000
    // ... with X = ax + t * step_x (likewise Y, Z): a cubic in t = idx - segment start
    const coef_0 =
      c000 +
      k_x * ax +
      k_y * ay +
      k_z * az +
      k_xy * ax * ay +
      k_xz * ax * az +
      k_yz * ay * az +
      k_xyz * ax * ay * az
    const coef_1 =
      k_x * step_x +
      k_y * step_y +
      k_z * step_z +
      k_xy * (ax * step_y + ay * step_x) +
      k_xz * (ax * step_z + az * step_x) +
      k_yz * (ay * step_z + az * step_y) +
      k_xyz * (step_x * ay * az + ax * step_y * az + ax * ay * step_z)
    const coef_2 =
      k_xy * step_x * step_y +
      k_xz * step_x * step_z +
      k_yz * step_y * step_z +
      k_xyz * (step_x * step_y * az + step_x * ay * step_z + ax * step_y * step_z)
    const coef_3 = k_xyz * step_x * step_y * step_z
    for (let t_idx = 0; idx < end; idx++, t_idx++)
      out[offset + idx] = ((coef_3 * t_idx + coef_2) * t_idx + coef_1) * t_idx + coef_0
  }
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

// Unit normal of a plane with a finite point and a finite, non-degenerate normal, else null
const valid_unit_normal = ({ point, normal }: CartesianPlane): Vec3 | null =>
  point.every(Number.isFinite) &&
  normal.every(Number.isFinite) &&
  Math.hypot(...normal) >= PLANE_TOLERANCE
    ? math.normalize_vec(normal)
    : null

// Cartesian corners (counter-clockwise about the normal) of the plane's cut through the cell
// block `fractional_bounds` spans: the outline sample_plane_slice fills. Empty on a miss.
export function slice_cell_polygon(
  volume: VolumetricData,
  plane: CartesianPlane,
  fractional_bounds: DisplayRange = UNIT_CELL_RANGE,
): Vec3[] {
  const normal = valid_unit_normal(plane)
  if (!normal) return []
  const corner = bounded_cell_corner(
    volume,
    sanitize_display_range(fractional_bounds, volume.periodic),
  )
  const edges = math.UNIT_CUBE_EDGES.map(([start, end]) => [corner(start), corner(end)])
  return math.plane_polyhedron_section(edges, normal, math.dot(normal, plane.point), {
    plane_tol: PLANE_TOLERANCE,
    merge_tol: PLANE_TOLERANCE,
  })
}

// Sample a scalar volume on an arbitrary absolute Cartesian plane.
export function sample_plane_slice(
  volume: VolumetricData,
  plane: CartesianPlane,
  options: PlaneSliceOptions = {},
): SliceResult | null {
  const normal = valid_unit_normal(plane)
  if (!normal || (plane.up && !plane.up.every(Number.isFinite))) return null
  const [u_axis, v_axis] = plane_basis(normal, plane.up)
  const polygon = slice_cell_polygon(volume, plane, options.fractional_bounds).map(
    (corner): Vec2 => {
      const relative = math.subtract(corner, plane.point)
      return [math.dot(relative, u_axis), math.dot(relative, v_axis)]
    },
  )
  if (polygon.length < 3) return null

  // Sampling bounds: the (u, v) bounding box of the cell/plane intersection
  const { min, max, width: u_span, height: v_span } = math.compute_bounding_box_2d(polygon)
  const u_range: Vec2 = [min[0], max[0]]
  const v_range: Vec2 = [min[1], max[1]]
  if (u_span <= PLANE_TOLERANCE || v_span <= PLANE_TOLERANCE) return null

  // Sampling resolution: caller-specified or default to max grid dimension
  const [width, height] = resolve_resolution(
    options.resolution,
    u_span,
    v_span,
    Math.max(...volume.dims),
    options.max_pixels ?? DEFAULT_MAX_PIXELS,
  )
  const data = new Float64Array(width * height)
  data.fill(Number.NaN)
  const mask = new Uint8Array(width * height)
  let data_min = Infinity
  let data_max = -Infinity
  const u_step = u_span / (width - 1)
  const v_step = v_span / (height - 1)
  const edges = polygon_edges(polygon)
  const u_at = (col: number): number => u_range[0] + col * u_step
  const col_at = (u_coord: number): number =>
    math.clamp(Math.round((u_coord - u_range[0]) / u_step), 0, width - 1)
  // grid coordinates (periodic point i at i/n, finite at i/(n-1)) are affine in (u, v)
  const recip = math.reciprocal_lattice(volume.lattice)
  const to_grid = (cart: Vec3): Vec3 =>
    math
      .mat3x3_vec3_multiply(recip, cart)
      .map((frac, axis) => frac * (volume.dims[axis] - (volume.periodic ? 0 : 1))) as Vec3
  const [plane_grid, u_grid, v_grid] = [
    to_grid(math.subtract(plane.point, volume.origin)),
    to_grid(u_axis),
    to_grid(v_axis),
  ]
  const run_step = math.scale(u_grid, u_step)

  for (let row = 0; row < height; row++) {
    const v_value = v_range[0] + row * v_step
    // A convex polygon covers one run of each row: walk from its analytic ends to where the
    // exact test flips, so a row costs a few tests instead of one per pixel outside it
    const inside = (col: number): boolean => point_in_convex_polygon(u_at(col), v_value, edges)
    const [u_min, u_max] = polygon_row_extent(v_value, edges)
    let first_col = col_at(u_min)
    if (inside(first_col)) while (first_col > 0 && inside(first_col - 1)) first_col--
    else while (first_col < width && !inside(first_col)) first_col++
    if (first_col >= width) continue
    let last_col = Math.max(first_col, col_at(u_max))
    if (inside(last_col)) while (last_col < width - 1 && inside(last_col + 1)) last_col++
    else while (last_col > first_col && !inside(last_col)) last_col--
    const [row_start, row_end] = [row * width + first_col, row * width + last_col + 1]
    const run_start = math.add(
      plane_grid,
      math.scale(u_grid, u_at(first_col)),
      math.scale(v_grid, v_value),
    )
    sample_grid_run(volume, run_start, run_step, row_end - row_start, data, row_start)
    mask.fill(1, row_start, row_end)
    for (let data_idx = row_start; data_idx < row_end; data_idx++) {
      const value = data[data_idx]
      if (!Number.isFinite(value)) data[data_idx] = Number.NaN
      else [data_min, data_max] = [Math.min(data_min, value), Math.max(data_max, value)]
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

// The (h k l) plane at fraction `position` of the cell's extent along h·b₁ + k·b₂ + l·b₃, so 0
// and 1 touch the outermost corners. Null for (0 0 0) or a degenerate normal.
export function hkl_slice_plane(
  volume: VolumetricData,
  miller_indices: Vec3,
  position: number,
): CartesianPlane | null {
  if (miller_indices.every((index) => index === 0)) return null
  const plane_normal = math.miller_plane_normal(volume.lattice, miller_indices)
  if (Math.hypot(...plane_normal) < PLANE_TOLERANCE) return null // degenerate normal
  const normal = math.normalize_vec(plane_normal)
  const corner = bounded_cell_corner(volume, UNIT_CELL_RANGE)
  const projections = math.UNIT_CUBE_EDGES.flat().map((unit) => math.dot(corner(unit), normal))
  const [normal_min, normal_max] = math.array_extent(projections)
  return {
    point: math.scale(normal, normal_min + position * (normal_max - normal_min)),
    normal,
  }
}

// The plane a VolumeSliceView samples: hkl + position, or Cartesian point (default: cell center)
export const resolve_slice_plane = (
  volume: VolumetricData,
  settings: VolumeSliceSettings,
): CartesianPlane | null =>
  settings.plane_mode === `hkl`
    ? hkl_slice_plane(volume, settings.miller_indices, settings.position)
    : {
        point: resolve_slice_cartesian_point(settings.cartesian_point, volume),
        normal: settings.cartesian_normal,
        up: settings.cartesian_up,
      }
