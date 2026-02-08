// HKL plane slicing for volumetric data: samples a 3D grid along an arbitrary
// crystallographic plane defined by Miller indices, using trilinear interpolation.
import { reciprocal_lattice } from '$lib/brillouin'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { VolumetricData } from './types'

// Result of sampling a 2D slice through volumetric data
export interface SliceResult {
  data: Float64Array // sampled values, row-major [height * width]
  width: number
  height: number
  min: number // data minimum for colormap
  max: number // data maximum for colormap
}

// Trilinear interpolation of a scalar 3D grid at fractional coordinates.
// Periodic grids wrap with modulo; non-periodic return 0 for out-of-bounds.
export function trilinear_interpolate(
  grid: number[][][],
  fx: number,
  fy: number,
  fz: number,
  periodic: boolean,
): number {
  const nx = grid.length
  const ny = grid[0]?.length ?? 0
  const nz = grid[0]?.[0]?.length ?? 0
  if (nx === 0 || ny === 0 || nz === 0) return 0

  // Convert fractional to grid coordinates
  const gx = periodic ? fx * nx : fx * (nx - 1)
  const gy = periodic ? fy * ny : fy * (ny - 1)
  const gz = periodic ? fz * nz : fz * (nz - 1)

  if (!periodic) {
    // Out-of-bounds check for non-periodic grids
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1 || fz < 0 || fz > 1) return 0
  }

  const safe_mod = (val: number, dim: number) => ((val % dim) + dim) % dim

  const x0 = periodic
    ? safe_mod(Math.floor(gx), nx)
    : Math.max(0, Math.min(Math.floor(gx), nx - 2))
  const y0 = periodic
    ? safe_mod(Math.floor(gy), ny)
    : Math.max(0, Math.min(Math.floor(gy), ny - 2))
  const z0 = periodic
    ? safe_mod(Math.floor(gz), nz)
    : Math.max(0, Math.min(Math.floor(gz), nz - 2))
  const x1 = periodic ? (x0 + 1) % nx : Math.min(x0 + 1, nx - 1)
  const y1 = periodic ? (y0 + 1) % ny : Math.min(y0 + 1, ny - 1)
  const z1 = periodic ? (z0 + 1) % nz : Math.min(z0 + 1, nz - 1)

  const xd = gx - Math.floor(gx)
  const yd = gy - Math.floor(gy)
  const zd = gz - Math.floor(gz)

  // 8-point interpolation
  const c000 = grid[x0][y0][z0]
  const c001 = grid[x0][y0][z1]
  const c010 = grid[x0][y1][z0]
  const c011 = grid[x0][y1][z1]
  const c100 = grid[x1][y0][z0]
  const c101 = grid[x1][y0][z1]
  const c110 = grid[x1][y1][z0]
  const c111 = grid[x1][y1][z1]

  const c00 = c000 + (c100 - c000) * xd
  const c01 = c001 + (c101 - c001) * xd
  const c10 = c010 + (c110 - c010) * xd
  const c11 = c011 + (c111 - c011) * xd

  const c0 = c00 + (c10 - c00) * yd
  const c1 = c01 + (c11 - c01) * yd

  return c0 + (c1 - c0) * zd
}

// Sample a 2D slice through volumetric data along a Miller-index plane.
// `miller_indices` [h,k,l] defines the plane normal in reciprocal space.
// `distance` is fractional [0,1] along the normal direction within the cell.
// Returns null if indices are all zero.
export function sample_hkl_slice(
  volume: VolumetricData,
  miller_indices: [number, number, number],
  distance: number,
): SliceResult | null {
  const [h_idx, k_idx, l_idx] = miller_indices
  if (h_idx === 0 && k_idx === 0 && l_idx === 0) return null

  const { grid, grid_dims, lattice, periodic } = volume
  const [nx, ny, nz] = grid_dims

  // Compute plane normal from Miller indices via reciprocal lattice
  const recip = reciprocal_lattice(lattice)
  const plane_normal: Vec3 = math.add(
    math.add(
      math.scale(recip[0], h_idx),
      math.scale(recip[1], k_idx),
    ),
    math.scale(recip[2], l_idx),
  ) as Vec3

  const normal_len = Math.hypot(...plane_normal)
  if (normal_len < 1e-12) return null
  const unit_normal: Vec3 = [
    plane_normal[0] / normal_len,
    plane_normal[1] / normal_len,
    plane_normal[2] / normal_len,
  ]

  // In-plane basis vectors
  const [u_vec, v_vec] = math.compute_in_plane_basis(unit_normal)

  // Compute lattice inverse for Cartesian → fractional conversion
  const lattice_inv = math.matrix_inverse_3x3(lattice)

  // Project all 8 unit cell corners onto the (u, v) plane to find sampling bounds.
  // Corners are at fractional coords (0 or 1) for each axis.
  let u_min = Infinity
  let u_max = -Infinity
  let v_min = Infinity
  let v_max = -Infinity
  let normal_min = Infinity
  let normal_max = -Infinity

  for (let ci = 0; ci < 8; ci++) {
    const fi = (ci & 1) ? 1 : 0
    const fj = (ci & 2) ? 1 : 0
    const fk = (ci & 4) ? 1 : 0
    // Corner in Cartesian: frac * lattice
    const corner: Vec3 = [
      fi * lattice[0][0] + fj * lattice[1][0] + fk * lattice[2][0],
      fi * lattice[0][1] + fj * lattice[1][1] + fk * lattice[2][1],
      fi * lattice[0][2] + fj * lattice[1][2] + fk * lattice[2][2],
    ]
    const u_proj = math.dot(corner, u_vec) as number
    const v_proj = math.dot(corner, v_vec) as number
    const n_proj = math.dot(corner, unit_normal) as number
    if (u_proj < u_min) u_min = u_proj
    if (u_proj > u_max) u_max = u_proj
    if (v_proj < v_min) v_min = v_proj
    if (v_proj > v_max) v_max = v_proj
    if (n_proj < normal_min) normal_min = n_proj
    if (n_proj > normal_max) normal_max = n_proj
  }

  // Plane position: fractional distance [0,1] along the normal extent
  const d_cartesian = normal_min + distance * (normal_max - normal_min)

  // Sampling resolution: use the max grid dimension
  const resolution = Math.max(nx, ny, nz)
  const width = resolution
  const height = resolution

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

      // Convert to fractional coordinates: frac = lattice_inv * p
      const fx = lattice_inv[0][0] * px + lattice_inv[0][1] * py + lattice_inv[0][2] * pz
      const fy = lattice_inv[1][0] * px + lattice_inv[1][1] * py + lattice_inv[1][2] * pz
      const fz = lattice_inv[2][0] * px + lattice_inv[2][1] * py + lattice_inv[2][2] * pz

      const val = trilinear_interpolate(grid, fx, fy, fz, periodic)
      data[row * width + col] = val
      if (val < data_min) data_min = val
      if (val > data_max) data_max = val
    }
  }

  return { data, width, height, min: data_min, max: data_max }
}
