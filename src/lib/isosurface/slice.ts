// HKL plane slicing for volumetric data: samples a 3D grid along an arbitrary
// crystallographic plane defined by Miller indices, using trilinear interpolation.
import { reciprocal_lattice } from '$lib/brillouin'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { trilinear_interpolate } from './sampling'
import type { VolumetricData } from './types'

// Result of sampling a 2D slice through volumetric data
export interface SliceResult {
  data: Float64Array // sampled values, row-major [height * width]
  width: number
  height: number
  min: number // data minimum for colormap
  max: number // data maximum for colormap
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

  const { grid, grid_dims, lattice, periodic } = volume
  const [nx, ny, nz] = grid_dims

  // Plane normal G = h*b1 + k*b2 + l*b3 where b_i are reciprocal lattice rows
  const recip = reciprocal_lattice(lattice)
  const plane_normal: Vec3 = [
    h_idx * recip[0][0] + k_idx * recip[1][0] + l_idx * recip[2][0],
    h_idx * recip[0][1] + k_idx * recip[1][1] + l_idx * recip[2][1],
    h_idx * recip[0][2] + k_idx * recip[1][2] + l_idx * recip[2][2],
  ]
  if (Math.hypot(...plane_normal) < 1e-12) return null // degenerate normal
  const unit_normal = math.normalize_vec(plane_normal)

  // In-plane basis vectors
  const [u_vec, v_vec] = math.compute_in_plane_basis(unit_normal)

  const cart_to_frac = math.create_cart_to_frac(lattice)

  // Project all 8 unit cell corners onto the (u, v) plane to find sampling bounds.
  // Corners are at fractional coords (0 or 1) for each axis.
  let u_min = Infinity
  let u_max = -Infinity
  let v_min = Infinity
  let v_max = -Infinity
  let normal_min = Infinity
  let normal_max = -Infinity

  for (let ci = 0; ci < 8; ci++) {
    const fi = ci & 1 ? 1 : 0
    const fj = ci & 2 ? 1 : 0
    const fk = ci & 4 ? 1 : 0
    // Corner in Cartesian: frac * lattice
    const corner: Vec3 = [
      fi * lattice[0][0] + fj * lattice[1][0] + fk * lattice[2][0],
      fi * lattice[0][1] + fj * lattice[1][1] + fk * lattice[2][1],
      fi * lattice[0][2] + fj * lattice[1][2] + fk * lattice[2][2],
    ]
    const u_proj = math.dot(corner, u_vec)
    const v_proj = math.dot(corner, v_vec)
    const n_proj = math.dot(corner, unit_normal)
    if (u_proj < u_min) u_min = u_proj
    if (u_proj > u_max) u_max = u_proj
    if (v_proj < v_min) v_min = v_proj
    if (v_proj > v_max) v_max = v_proj
    if (n_proj < normal_min) normal_min = n_proj
    if (n_proj > normal_max) normal_max = n_proj
  }

  // Plane position: fractional distance [0,1] along the normal extent
  const d_cartesian = normal_min + distance * (normal_max - normal_min)

  // Sampling resolution: caller-specified or default to max grid dimension
  const width = n_points ?? Math.max(nx, ny, nz)
  const height = width

  const data = new Float64Array(width * height)
  let data_min = Infinity
  let data_max = -Infinity

  const u_step = (u_max - u_min) / (width - 1 || 1)
  const v_step = (v_max - v_min) / (height - 1 || 1)

  for (let row = 0; row < height; row++) {
    const v_val = v_min + row * v_step
    for (let col = 0; col < width; col++) {
      const u_val = u_min + col * u_step

      // Cartesian position on the plane
      const px = d_cartesian * unit_normal[0] + u_val * u_vec[0] + v_val * v_vec[0]
      const py = d_cartesian * unit_normal[1] + u_val * u_vec[1] + v_val * v_vec[1]
      const pz = d_cartesian * unit_normal[2] + u_val * u_vec[2] + v_val * v_vec[2]

      const [fx, fy, fz] = cart_to_frac([px, py, pz])
      const val = trilinear_interpolate(grid, fx, fy, fz, periodic)
      data[row * width + col] = val
      if (val < data_min) data_min = val
      if (val > data_max) data_max = val
    }
  }

  return { data, width, height, min: data_min, max: data_max }
}
