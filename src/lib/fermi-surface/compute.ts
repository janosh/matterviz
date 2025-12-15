// Fermi surface computation and analysis functions
import * as math from '$lib/math'
import { EPS, type Matrix3x3, type Vec3 } from '$lib/math'
import {
  CLOSED_CONTOUR_TOLERANCE,
  IRREDUCIBLE_BZ_MIN_VERTICES,
  IRREDUCIBLE_BZ_TOLERANCE,
  MAX_GRID_POINTS,
  SPANNING_THRESHOLD,
} from './constants'
import { marching_cubes } from './marching-cubes'
import type {
  BandGridData,
  FermiSliceData,
  FermiSliceOptions,
  FermiSurfaceData,
  FermiSurfaceMetadata,
  FermiSurfaceOptions,
  Isoline,
  Isosurface,
  SpinChannel,
  SurfaceDimensionality,
} from './types'

// Precompute Catmull-Rom coefficients for a given t value
// Returns [c0, c1, c2, c3] where result = c0*p0 + c1*p1 + c2*p2 + c3*p3
function catmull_rom_coeffs(t: number): [number, number, number, number] {
  const t2 = t * t
  const t3 = t2 * t
  return [
    0.5 * (-t + 2 * t2 - t3),
    0.5 * (2 - 5 * t2 + 3 * t3),
    0.5 * (t + 4 * t2 - 3 * t3),
    0.5 * (-t2 + t3),
  ]
}

// Tricubic interpolation with cached wrap indices and precomputed coefficients
function tricubic_interpolate(
  grid: number[][][],
  fx: number,
  fy: number,
  fz: number,
  nx: number,
  ny: number,
  nz: number,
): number {
  // Get integer and fractional parts
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const iz = Math.floor(fz)

  // Precompute Catmull-Rom coefficients
  const [cx0, cx1, cx2, cx3] = catmull_rom_coeffs(fx - ix)
  const [cy0, cy1, cy2, cy3] = catmull_rom_coeffs(fy - iy)
  const [cz0, cz1, cz2, cz3] = catmull_rom_coeffs(fz - iz)

  // Precompute wrapped indices (avoid modulo in inner loop)
  const wrap_x = (v: number) => ((v % nx) + nx) % nx
  const wrap_y = (v: number) => ((v % ny) + ny) % ny
  const wrap_z = (v: number) => ((v % nz) + nz) % nz

  const wx = [wrap_x(ix - 1), wrap_x(ix), wrap_x(ix + 1), wrap_x(ix + 2)]
  const wy = [wrap_y(iy - 1), wrap_y(iy), wrap_y(iy + 1), wrap_y(iy + 2)]
  const wz = [wrap_z(iz - 1), wrap_z(iz), wrap_z(iz + 1), wrap_z(iz + 2)]

  // Interpolate along z, then y, then x (fully inlined)
  let result = 0
  const cx = [cx0, cx1, cx2, cx3]
  const cy = [cy0, cy1, cy2, cy3]
  const cz = [cz0, cz1, cz2, cz3]

  for (let xi = 0; xi < 4; xi++) {
    const row = grid[wx[xi]]
    let y_sum = 0
    for (let yi = 0; yi < 4; yi++) {
      const col = row[wy[yi]]
      // Inline z interpolation
      y_sum += cy[yi] * (cz[0] * col[wz[0]] + cz[1] * col[wz[1]] +
        cz[2] * col[wz[2]] + cz[3] * col[wz[3]])
    }
    result += cx[xi] * y_sum
  }

  return result
}

// Upsample a 3D grid using tricubic interpolation for smoother surfaces
function upsample_grid(
  grid: number[][][],
  factor: number,
): number[][][] {
  if (factor <= 1) return grid

  const nx = grid.length
  const ny = grid[0]?.length || 0
  const nz = grid[0]?.[0]?.length || 0

  const new_nx = Math.round(nx * factor)
  const new_ny = Math.round(ny * factor)
  const new_nz = Math.round(nz * factor)

  // Precompute fractional coordinates for each axis
  const fx_arr = new Float64Array(new_nx)
  const fy_arr = new Float64Array(new_ny)
  const fz_arr = new Float64Array(new_nz)

  for (let ix = 0; ix < new_nx; ix++) fx_arr[ix] = (ix / new_nx) * nx
  for (let iy = 0; iy < new_ny; iy++) fy_arr[iy] = (iy / new_ny) * ny
  for (let iz = 0; iz < new_nz; iz++) fz_arr[iz] = (iz / new_nz) * nz

  // Preallocate output grid
  const new_grid: number[][][] = new Array(new_nx)

  for (let ix = 0; ix < new_nx; ix++) {
    const fx = fx_arr[ix]
    const iy_arr: number[][] = new Array(new_ny)
    for (let iy = 0; iy < new_ny; iy++) {
      const fy = fy_arr[iy]
      const iz_arr = new Float64Array(new_nz)
      for (let iz = 0; iz < new_nz; iz++) {
        iz_arr[iz] = tricubic_interpolate(grid, fx, fy, fz_arr[iz], nx, ny, nz)
      }
      // Convert Float64Array back to regular array for compatibility
      iy_arr[iy] = Array.from(iz_arr)
    }
    new_grid[ix] = iy_arr
  }

  return new_grid
}

// Downsample a 3D energy grid by taking every nth point (optimized with pre-allocation)
function downsample_grid(
  grid: number[][][],
  factor: number,
): number[][][] {
  const nx = grid.length
  const ny = grid[0]?.length ?? 0
  const nz = grid[0]?.[0]?.length ?? 0

  const new_nx = Math.ceil(nx / factor)
  const new_ny = Math.ceil(ny / factor)
  const new_nz = Math.ceil(nz / factor)

  // Pre-allocate arrays for better performance
  const result: number[][][] = new Array(new_nx)
  for (let ix = 0; ix < new_nx; ix++) {
    const src_ix = Math.min(ix * factor, nx - 1)
    const row: number[][] = new Array(new_ny)
    for (let iy = 0; iy < new_ny; iy++) {
      const src_iy = Math.min(iy * factor, ny - 1)
      const col: number[] = new Array(new_nz)
      for (let iz = 0; iz < new_nz; iz++) {
        col[iz] = grid[src_ix][src_iy][Math.min(iz * factor, nz - 1)]
      }
      row[iy] = col
    }
    result[ix] = row
  }
  return result
}

// Extract Fermi surface from band grid data
export function extract_fermi_surface(
  band_data: BandGridData,
  options: FermiSurfaceOptions = {},
): FermiSurfaceData {
  const {
    mu = 0,
    wigner_seitz = true,
    compute_velocities = false,
    compute_dimensionality = false,
    selected_bands,
    interpolation_factor = 1,
    selected_spins,
  } = options

  const iso_value = band_data.fermi_energy + mu
  const isosurfaces: Isosurface[] = []
  let total_area = 0

  // Check if grid is too large and needs downsampling
  const [nx, ny, nz] = band_data.k_grid
  const total_points = nx * ny * nz
  const downsample_factor = total_points > MAX_GRID_POINTS
    ? Math.ceil(Math.cbrt(total_points / MAX_GRID_POINTS))
    : 1

  if (downsample_factor > 1) {
    console.warn(
      `Grid size ${nx}×${ny}×${nz} = ${total_points} points exceeds limit. ` +
        `Downsampling by factor ${downsample_factor} for performance.`,
    )
  }

  // Process each spin channel and band
  for (let spin_idx = 0; spin_idx < band_data.n_spins; spin_idx++) {
    const spin: SpinChannel = band_data.n_spins === 2
      ? (spin_idx === 0 ? `up` : `down`)
      : null

    // Skip if spin not selected
    if (selected_spins && !selected_spins.includes(spin)) continue

    for (let band_idx = 0; band_idx < band_data.n_bands; band_idx++) {
      // Skip if band not selected
      if (selected_bands && !selected_bands.includes(band_idx)) continue

      let raw_energies = band_data.energies[spin_idx][band_idx]

      // Downsample large grids for performance
      if (downsample_factor > 1) {
        raw_energies = downsample_grid(raw_energies, downsample_factor)
      }

      // Check if Fermi level intersects this band
      if (!band_intersects_fermi(raw_energies, iso_value)) continue

      // Apply interpolation for smoother surfaces
      const energies = interpolation_factor > 1
        ? upsample_grid(raw_energies, interpolation_factor)
        : raw_energies

      // Extract isosurface using marching cubes
      // Use periodic: false because BXSF grids include both endpoints (k=0 and k=1)
      // which are equivalent due to BZ periodicity. This matches scikit-image behavior.
      const mc_result = marching_cubes(energies, iso_value, band_data.k_lattice, {
        periodic: false,
        interpolate: true,
      })

      if (mc_result.vertices.length === 0) continue

      // Build isosurface
      // Note: We don't clip to Wigner-Seitz BZ here because marching cubes output is in
      // a centered parallelepiped cell. BZ symmetry tiling in renderer handles full BZ.
      const isosurface: Isosurface = {
        vertices: mc_result.vertices,
        faces: mc_result.faces,
        normals: mc_result.normals,
        band_index: band_idx,
        spin,
      }

      // Compute surface area
      isosurface.area = compute_surface_area(isosurface)
      total_area += isosurface.area

      // Compute Fermi velocities if requested
      if (compute_velocities && band_data.velocities) {
        isosurface.properties = compute_fermi_velocities(
          isosurface,
          band_data.velocities[spin_idx][band_idx],
          band_data.k_lattice,
          band_data.k_grid,
        )
        isosurface.avg_velocity = isosurface.properties.reduce((s, v) => s + v, 0) /
          isosurface.properties.length
      }

      // Compute dimensionality if requested
      if (compute_dimensionality) {
        const { dimensionality, orientation } = analyze_surface_topology(
          isosurface,
          null, // BZ data not used for topology analysis since we don't clip to Wigner-Seitz
        )
        isosurface.dimensionality = dimensionality
        isosurface.orientation = orientation
      }

      isosurfaces.push(isosurface)
    }
  }

  const metadata: FermiSurfaceMetadata = {
    n_bands: band_data.n_bands,
    n_surfaces: isosurfaces.length,
    total_area,
    has_spin: band_data.n_spins === 2,
    has_velocities: compute_velocities && band_data.velocities !== undefined,
  }

  return {
    isosurfaces,
    k_lattice: band_data.k_lattice,
    fermi_energy: band_data.fermi_energy,
    reciprocal_cell: wigner_seitz ? `wigner_seitz` : `parallelepiped`,
    metadata,
  }
}

// Check if Fermi level intersects a band (has values both above and below)
function band_intersects_fermi(energies: number[][][], iso_value: number): boolean {
  let has_below = false
  let has_above = false

  for (const plane of energies) {
    for (const row of plane) {
      for (const energy of row) {
        if (energy < iso_value) has_below = true
        else if (energy > iso_value) has_above = true
        if (has_below && has_above) return true
      }
    }
  }
  return false
}

// Compute surface area of an isosurface (optimized with inlined math)
export function compute_surface_area(surface: Isosurface): number {
  let total_area = 0
  const verts = surface.vertices

  for (const face of surface.faces) {
    if (face.length < 3) continue
    const [v0x, v0y, v0z] = verts[face[0]]
    const [v1x, v1y, v1z] = verts[face[1]]
    const [v2x, v2y, v2z] = verts[face[2]]

    // Inlined edge subtraction and cross product
    const [e1x, e1y, e1z] = [v1x - v0x, v1y - v0y, v1z - v0z]
    const [e2x, e2y, e2z] = [v2x - v0x, v2y - v0y, v2z - v0z]
    const cx = e1y * e2z - e1z * e2y
    const cy = e1z * e2x - e1x * e2z
    const cz = e1x * e2y - e1y * e2x

    // Area is half the magnitude of cross product
    total_area += Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5
  }

  return total_area
}

// Compute Fermi velocities at surface vertices
function compute_fermi_velocities(
  surface: Isosurface,
  velocity_grid: Vec3[][][],
  k_lattice: Matrix3x3,
  k_grid: Vec3,
): number[] {
  const [nx, ny, nz] = k_grid
  const velocities: number[] = []

  // Inverse of k_lattice for Cartesian to fractional conversion
  const k_inv = math.matrix_inverse_3x3(k_lattice)

  for (const vertex of surface.vertices) {
    // Convert Cartesian to fractional coordinates
    const frac = math.mat3x3_vec3_multiply(k_inv, vertex)

    // Wrap to [0, 1)
    const wrapped: Vec3 = [
      ((frac[0] % 1) + 1) % 1,
      ((frac[1] % 1) + 1) % 1,
      ((frac[2] % 1) + 1) % 1,
    ]

    // Grid indices (with interpolation)
    const gx = wrapped[0] * nx
    const gy = wrapped[1] * ny
    const gz = wrapped[2] * nz

    // Trilinear interpolation of velocity
    const velocity = trilinear_interpolate_vec3(velocity_grid, gx, gy, gz)
    velocities.push(Math.hypot(...velocity)) // magnitude
  }

  return velocities
}

// Trilinear interpolation for Vec3 grid
function trilinear_interpolate_vec3(
  grid: Vec3[][][],
  x: number,
  y: number,
  z: number,
): Vec3 {
  const nx = grid.length
  const ny = grid[0]?.length || 0
  const nz = grid[0]?.[0]?.length || 0

  // Guard against empty or malformed grids to prevent division by zero in modulo
  if (nx === 0 || ny === 0 || nz === 0) return [0, 0, 0]

  // Use safe modulo pattern to handle negative values from floating-point edge cases
  const safe_mod = (val: number, n: number) => ((val % n) + n) % n
  const x0 = safe_mod(Math.floor(x), nx)
  const y0 = safe_mod(Math.floor(y), ny)
  const z0 = safe_mod(Math.floor(z), nz)
  const x1 = (x0 + 1) % nx
  const y1 = (y0 + 1) % ny
  const z1 = (z0 + 1) % nz

  const xd = x - Math.floor(x)
  const yd = y - Math.floor(y)
  const zd = z - Math.floor(z)

  const c000 = grid[x0][y0][z0]
  const c001 = grid[x0][y0][z1]
  const c010 = grid[x0][y1][z0]
  const c011 = grid[x0][y1][z1]
  const c100 = grid[x1][y0][z0]
  const c101 = grid[x1][y0][z1]
  const c110 = grid[x1][y1][z0]
  const c111 = grid[x1][y1][z1]

  const c00 = math.lerp_vec3(c000, c100, xd)
  const c01 = math.lerp_vec3(c001, c101, xd)
  const c10 = math.lerp_vec3(c010, c110, xd)
  const c11 = math.lerp_vec3(c011, c111, xd)

  const c0 = math.lerp_vec3(c00, c10, yd)
  const c1 = math.lerp_vec3(c01, c11, yd)

  return math.lerp_vec3(c0, c1, zd)
}

// Analyze surface topology to determine dimensionality
function analyze_surface_topology(
  surface: Isosurface,
  bz_data: { vertices: Vec3[] } | null,
): { dimensionality: SurfaceDimensionality; orientation: Vec3 | null } {
  if (surface.vertices.length === 0) {
    return { dimensionality: `3D`, orientation: null }
  }

  // Check if surface spans the full BZ in each direction
  const bz_extent = bz_data
    ? math.compute_bounding_box(bz_data.vertices)
    : { min: [-1, -1, -1] as Vec3, max: [1, 1, 1] as Vec3 }

  const surface_extent = math.compute_bounding_box(surface.vertices)

  // Check spanning in each direction
  const spans: [boolean, boolean, boolean] = [false, false, false]
  for (let axis_idx = 0; axis_idx < 3; axis_idx++) {
    const bz_size = bz_extent.max[axis_idx] - bz_extent.min[axis_idx]
    const surface_size = surface_extent.max[axis_idx] - surface_extent.min[axis_idx]
    // Consider spanning if surface covers significant fraction of BZ extent
    spans[axis_idx] = surface_size > SPANNING_THRESHOLD * bz_size
  }

  const n_spanning = spans.filter(Boolean).length

  if (n_spanning === 0) {
    // Closed surface, no spanning directions
    return { dimensionality: `3D`, orientation: null }
  } else if (n_spanning === 1) {
    // 2D sheet spanning one direction
    const axis_idx = spans.indexOf(true)
    const orientation: Vec3 = [0, 0, 0]
    orientation[axis_idx] = 1
    return { dimensionality: `2D`, orientation }
  } else if (n_spanning === 2) {
    // 1D noodle-like (tube spanning 2 directions, bounded in 1)
    const axis_idx = spans.indexOf(false)
    const orientation: Vec3 = [0, 0, 0]
    orientation[axis_idx] = 1
    return { dimensionality: `1D`, orientation }
  } else {
    // Spans all 3 directions - complex warped network
    return { dimensionality: `quasi-2D`, orientation: null }
  }
}

// Compute 2D Fermi slice along a specified plane
export function compute_fermi_slice(
  fermi_data: FermiSurfaceData,
  options: FermiSliceOptions = {},
): FermiSliceData {
  const {
    miller_indices = [0, 0, 1],
    distance = 0,
  } = options

  // Validate miller indices are not all zero
  if (miller_indices[0] === 0 && miller_indices[1] === 0 && miller_indices[2] === 0) {
    throw new Error(
      `Invalid miller indices [0, 0, 0]: at least one index must be non-zero to define a plane`,
    )
  }

  // Compute plane normal in Cartesian coordinates
  const plane_normal = math.scale(
    math.add(
      math.add(
        math.scale(fermi_data.k_lattice[0], miller_indices[0]),
        math.scale(fermi_data.k_lattice[1], miller_indices[1]),
      ),
      math.scale(fermi_data.k_lattice[2], miller_indices[2]),
    ),
    1,
  ) as Vec3

  const normal_len = Math.hypot(...plane_normal)
  if (normal_len < EPS) {
    throw new Error(
      `Degenerate plane normal: k_lattice vectors produce a zero-length normal for miller indices [${
        miller_indices.join(`, `)
      }]`,
    )
  }
  const unit_normal = math.normalize_vec3(plane_normal)

  // Compute in-plane basis vectors
  const [in_plane_u, in_plane_v] = compute_in_plane_basis(unit_normal)

  // Slice each isosurface
  const isolines: Isoline[] = []

  for (const surface of fermi_data.isosurfaces) {
    const lines = slice_surface_with_plane(
      surface,
      unit_normal,
      distance,
      in_plane_u,
      in_plane_v,
    )
    isolines.push(...lines)
  }

  return {
    isolines,
    plane_normal: unit_normal,
    plane_distance: distance,
    k_lattice_2d: [in_plane_u, in_plane_v],
    metadata: {
      n_lines: isolines.length,
      has_properties: isolines.some((l) => l.properties !== undefined),
    },
  }
}

// Compute orthonormal basis vectors in a plane
function compute_in_plane_basis(normal: Vec3): [Vec3, Vec3] {
  // Find a vector not parallel to normal
  let ref: Vec3 = [1, 0, 0]
  if (Math.abs(normal[0]) > 0.9) {
    ref = [0, 1, 0]
  }

  // Gram-Schmidt to get first in-plane vector
  const dot_nr = math.dot(normal, ref) as number
  const u_unnorm: Vec3 = [
    ref[0] - dot_nr * normal[0],
    ref[1] - dot_nr * normal[1],
    ref[2] - dot_nr * normal[2],
  ]
  // Guard against near-zero length from failed Gram-Schmidt (numerical issues)
  const u = math.normalize_vec3(u_unnorm, [0, 1, 0])

  // Cross product for second in-plane vector
  const v = math.cross_3d(normal, u)

  return [u, v]
}

// Helper to create edge key (sorted vertex indices)
function make_edge_key(v0_idx: number, v1_idx: number): string {
  return `${Math.min(v0_idx, v1_idx)},${Math.max(v0_idx, v1_idx)}`
}

// Compute intersection point on an edge
function compute_edge_intersection(
  surface: Isosurface,
  vertex_distances: number[],
  v0_idx: number,
  v1_idx: number,
): { point: Vec3; property?: number } | null {
  const d0 = vertex_distances[v0_idx]
  const d1 = vertex_distances[v1_idx]

  // Edge must cross the plane (opposite signs)
  if (d0 * d1 >= 0) return null

  const t = d0 / (d0 - d1)
  const v0 = surface.vertices[v0_idx]
  const v1 = surface.vertices[v1_idx]

  const point: Vec3 = [
    v0[0] + t * (v1[0] - v0[0]),
    v0[1] + t * (v1[1] - v0[1]),
    v0[2] + t * (v1[2] - v0[2]),
  ]

  let property: number | undefined
  if (surface.properties) {
    property = surface.properties[v0_idx] +
      t * (surface.properties[v1_idx] - surface.properties[v0_idx])
  }

  return { point, property }
}

// Slice a surface with a plane to get isolines
// Uses contour tracing to produce properly ordered line segments
function slice_surface_with_plane(
  surface: Isosurface,
  plane_normal: Vec3,
  plane_distance: number,
  in_plane_u: Vec3,
  in_plane_v: Vec3,
): Isoline[] {
  if (surface.vertices.length === 0 || surface.faces.length === 0) return []

  // Compute signed distance of each vertex to plane
  const vertex_distances = surface.vertices.map(
    (vert) => (math.dot(vert, plane_normal) as number) - plane_distance,
  )

  // Build edge-to-faces map and collect face segments
  // Each face that intersects the plane produces exactly one line segment
  type FaceSegment = {
    face_idx: number
    edge_keys: [string, string]
    points: [Vec3, Vec3]
    properties?: [number, number]
  }

  const face_segments: FaceSegment[] = []
  const edge_to_faces = new Map<string, number[]>() // edge_key -> face indices

  for (let face_idx = 0; face_idx < surface.faces.length; face_idx++) {
    const face = surface.faces[face_idx]
    if (face.length < 3) continue

    // Find which edges of this face cross the plane
    const crossing_edges: Array<{
      edge_key: string
      intersection: { point: Vec3; property?: number }
    }> = []

    for (let edge_idx = 0; edge_idx < face.length; edge_idx++) {
      const v0_idx = face[edge_idx]
      const v1_idx = face[(edge_idx + 1) % face.length]
      const edge_key = make_edge_key(v0_idx, v1_idx)

      const intersection = compute_edge_intersection(
        surface,
        vertex_distances,
        v0_idx,
        v1_idx,
      )

      if (intersection) {
        crossing_edges.push({ edge_key, intersection })

        // Register this face with the edge
        const faces = edge_to_faces.get(edge_key) || []
        faces.push(face_idx)
        edge_to_faces.set(edge_key, faces)
      }
    }

    // A face intersected by a plane has exactly 2 crossing edges
    if (crossing_edges.length === 2) {
      face_segments.push({
        face_idx,
        edge_keys: [crossing_edges[0].edge_key, crossing_edges[1].edge_key],
        points: [
          crossing_edges[0].intersection.point,
          crossing_edges[1].intersection.point,
        ],
        properties: surface.properties
          ? [
            crossing_edges[0].intersection.property ?? 0,
            crossing_edges[1].intersection.property ?? 0,
          ]
          : undefined,
      })
    }
  }

  if (face_segments.length === 0) return []

  // Build face_idx -> segment map for O(1) lookup
  const face_to_segment = new Map<number, typeof face_segments[0]>()
  for (const seg of face_segments) {
    face_to_segment.set(seg.face_idx, seg)
  }

  // Precompute in-plane basis dot products for faster 2D projection
  const [ux, uy, uz] = in_plane_u
  const [vx, vy, vz] = in_plane_v

  // Trace connected contours by following adjacent faces
  const used_faces = new Set<number>()
  const isolines: Isoline[] = []

  for (const start_segment of face_segments) {
    if (used_faces.has(start_segment.face_idx)) continue

    // Start a new contour from this segment
    // Use arrays that we'll reverse at the end instead of unshift (O(1) vs O(n))
    const forward_points: Vec3[] = [start_segment.points[1]]
    const backward_points: Vec3[] = []
    const forward_props: number[] | undefined = start_segment.properties
      ? [start_segment.properties[1]]
      : undefined
    const backward_props: number[] | undefined = start_segment.properties ? [] : undefined

    used_faces.add(start_segment.face_idx)

    // Helper to trace in one direction
    const trace_direction = (
      initial_edge: string,
      points: Vec3[],
      props: number[] | undefined,
    ) => {
      let current_edge = initial_edge
      let found_next = true

      while (found_next) {
        found_next = false
        const adjacent_faces = edge_to_faces.get(current_edge)
        if (!adjacent_faces) break

        for (const adj_face_idx of adjacent_faces) {
          if (used_faces.has(adj_face_idx)) continue

          const adj_segment = face_to_segment.get(adj_face_idx)
          if (!adj_segment) continue

          // Find which end connects to current_edge
          let next_point_idx: number
          let next_edge: string
          if (adj_segment.edge_keys[0] === current_edge) {
            next_point_idx = 1
            next_edge = adj_segment.edge_keys[1]
          } else if (adj_segment.edge_keys[1] === current_edge) {
            next_point_idx = 0
            next_edge = adj_segment.edge_keys[0]
          } else {
            continue
          }

          points.push(adj_segment.points[next_point_idx])
          if (props && adj_segment.properties) {
            props.push(adj_segment.properties[next_point_idx])
          }

          used_faces.add(adj_face_idx)
          current_edge = next_edge
          found_next = true
          break
        }
      }
    }

    // Trace forward and backward
    trace_direction(start_segment.edge_keys[1], forward_points, forward_props)
    trace_direction(start_segment.edge_keys[0], backward_points, backward_props)

    // Combine: backward (reversed) + start_point[0] + forward
    backward_points.reverse()
    if (backward_props) backward_props.reverse()

    const contour_points: Vec3[] = [
      ...backward_points,
      start_segment.points[0],
      ...forward_points,
    ]
    const contour_props: number[] | undefined = backward_props && forward_props &&
        start_segment.properties
      ? [...backward_props, start_segment.properties[0], ...forward_props]
      : undefined

    // Check if contour is closed
    const first = contour_points[0]
    const last = contour_points[contour_points.length - 1]
    const is_closed = math.euclidean_dist(first, last) < CLOSED_CONTOUR_TOLERANCE

    // Project to 2D (inlined dot product for speed)
    const points_2d: [number, number][] = new Array(contour_points.length)
    for (let idx = 0; idx < contour_points.length; idx++) {
      const p = contour_points[idx]
      points_2d[idx] = [
        p[0] * ux + p[1] * uy + p[2] * uz,
        p[0] * vx + p[1] * vy + p[2] * vz,
      ]
    }

    isolines.push({
      points: contour_points,
      points_2d,
      properties: contour_props,
      band_index: surface.band_index,
      spin: surface.spin,
      is_closed,
    })
  }

  return isolines
}

// Detect if Fermi surface data appears to cover only the irreducible BZ wedge.
// For cubic Oh symmetry, this is the region where all vertices are in the first octant
// (x >= 0, y >= 0, z >= 0) with some tolerance. Such data needs tiling to show the full BZ.
export function detect_irreducible_bz(fermi_data: FermiSurfaceData): boolean {
  if (fermi_data.isosurfaces.length === 0) return false

  // Check if all vertices are in the positive octant (with small tolerance for numerical error)
  let all_positive = true
  let vertex_count = 0

  for (const surface of fermi_data.isosurfaces) {
    for (const vertex of surface.vertices) {
      vertex_count++
      if (
        vertex[0] < -IRREDUCIBLE_BZ_TOLERANCE ||
        vertex[1] < -IRREDUCIBLE_BZ_TOLERANCE ||
        vertex[2] < -IRREDUCIBLE_BZ_TOLERANCE
      ) {
        all_positive = false
        break
      }
    }
    if (!all_positive) break
  }

  // Only consider it irreducible if we have significant data and all positive
  return all_positive && vertex_count > IRREDUCIBLE_BZ_MIN_VERTICES
}
