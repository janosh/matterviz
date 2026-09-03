// Fermi surface computation and analysis functions
import * as math from '$lib/math'
import { EPS } from '$lib/math'
import type { Matrix3x3, Vec2, Vec3 } from '$lib/math'
import { grid_dimensions, scalar_grid_strides } from '$lib/isosurface/grid'
import { marching_cubes } from '$lib/marching-cubes'
import type {
  BandEnergyGrid,
  BandGridData,
  FermiSliceData,
  FermiSliceOptions,
  FermiSurfaceData,
  FermiSurfaceOptions,
  Isoline,
  FermiIsosurface,
  SpinChannel,
} from './types'
import { vertex_count } from './types'

// Distance below which a traced contour's ends count as joined
const CLOSED_CONTOUR_TOLERANCE = 1e-6
// Irreducible-wedge detection: every vertex in the positive octant within this fraction of the
// data's own extent. Relative, not absolute: a fixed 0.01 1/A is 16% of a 50 A supercell's
// zone, where a small full-zone pocket at Gamma never dips below it and gets tiled 48 times.
const IRREDUCIBLE_BZ_TOLERANCE = 0.01
const IRREDUCIBLE_BZ_MIN_VERTICES = 10
// Ceiling on one upsampled band grid: 2e7 points is 160 MB as Float64 and ~1 s of marching
// cubes, above every k-mesh the UI can reach (64³ at 4x is 1.6e7, 48³ at 5x is 1.3e7)
const MAX_UPSAMPLED_POINTS = 20_000_000

// Catmull-Rom weights for the 4-point stencil at fractional offset t, written into `out`
// (result = out[0]*p0 + out[1]*p1 + out[2]*p2 + out[3]*p3)
function catmull_rom_coeffs(t: number, out: Float64Array): void {
  const t2 = t * t
  const t3 = t2 * t
  out[0] = 0.5 * (-t + 2 * t2 - t3)
  out[1] = 0.5 * (2 - 5 * t2 + 3 * t3)
  out[2] = 0.5 * (t + 4 * t2 - 3 * t3)
  out[3] = 0.5 * (-t2 + t3)
}

// Wrapped 4-point stencil offsets (already multiplied by the axis stride) around floor(coord).
// `period` is the number of unique points along the axis: n for periodic grids, n−1 for
// endpoint-inclusive grids whose last point duplicates the first. A zero period
// (single-point axis) has no neighbours, so the stencil collapses onto index 0.
function wrapped_stencil(
  coord: number,
  period: number,
  stride: number,
  out: Int32Array,
): void {
  const base = Math.floor(coord)
  for (let tap = 0; tap < 4; tap++) {
    const idx = base - 1 + tap
    out[tap] = (period > 0 ? ((idx % period) + period) % period : 0) * stride
  }
}

// Upsample a band grid with tricubic (Catmull-Rom) interpolation, preserving the grid
// convention: endpoint-inclusive (BXSF, point i ↔ frac i/(n−1)) vs periodic (FRMSF,
// i ↔ i/n). Mixing conventions rescales the surface and distorts the zone boundary.
export function upsample_grid(
  grid: BandEnergyGrid,
  factor: number,
  periodic = false,
): BandEnergyGrid {
  if (factor <= 1) return grid

  const [nx, ny, nz] = grid_dimensions(grid)
  const [stride_x, stride_y, stride_z] = scalar_grid_strides(grid)
  const { values } = grid

  // Endpoint-inclusive grids carry one duplicated boundary sample per axis; the wrap
  // period (count of unique points) doubles as the resampling span numerator
  const endpoint = periodic ? 0 : 1
  const [px, py, pz] = [nx - endpoint, ny - endpoint, nz - endpoint]
  const [new_nx, new_ny, new_nz] = [px, py, pz].map(
    (period) => Math.round(period * factor) + endpoint,
  )
  // Bound the point count, not the factor: output grows as factor³ per band, so the settings
  // cap of 5 bounds nothing (100³ at factor 5 is 496³ = 1.22e8 points, 976 MB per band).
  // Negated so NaN is rejected here, not downstream as a bad dims triple.
  const upsampled_points = new_nx * new_ny * new_nz
  if (!(upsampled_points <= MAX_UPSAMPLED_POINTS)) {
    throw new Error(
      `upsample_grid: factor ${factor} turns a ${nx}×${ny}×${nz} band grid into ` +
        `${new_nx}×${new_ny}×${new_nz} = ${upsampled_points.toPrecision(3)} points ` +
        `(${(upsampled_points * 8e-6).toPrecision(3)} MB per band), past the ` +
        `${MAX_UPSAMPLED_POINTS} cap. Lower options.interpolation_factor.`,
    )
  }

  // Map new index → source coordinate; a single-point axis (span 0) pins its lone
  // output to source 0 to avoid 0/0 = NaN
  const src_coords = (new_n: number, period: number) => {
    const span = new_n - endpoint
    return Float64Array.from({ length: new_n }, (_, idx) =>
      span > 0 ? (idx / span) * period : 0,
    )
  }
  const fx_arr = src_coords(new_nx, px)
  const fy_arr = src_coords(new_ny, py)
  const fz_arr = src_coords(new_nz, pz)

  // Per-axis stencil offsets and weights are precomputed once per output row/plane so the
  // innermost loop is 64 multiply-adds with no allocation or modulo
  const x_offsets = new Int32Array(4)
  const y_offsets = new Int32Array(4)
  const z_offsets = new Int32Array(4 * new_nz)
  const cx = new Float64Array(4)
  const cy = new Float64Array(4)
  const cz = new Float64Array(4 * new_nz)
  for (let iz = 0; iz < new_nz; iz++) {
    const fz = fz_arr[iz]
    wrapped_stencil(fz, pz, stride_z, z_offsets.subarray(4 * iz, 4 * iz + 4))
    catmull_rom_coeffs(fz - Math.floor(fz), cz.subarray(4 * iz, 4 * iz + 4))
  }

  const out = new Float64Array(new_nx * new_ny * new_nz)
  let out_idx = 0
  for (let ix = 0; ix < new_nx; ix++) {
    const fx = fx_arr[ix]
    wrapped_stencil(fx, px, stride_x, x_offsets)
    catmull_rom_coeffs(fx - Math.floor(fx), cx)
    for (let iy = 0; iy < new_ny; iy++) {
      const fy = fy_arr[iy]
      wrapped_stencil(fy, py, stride_y, y_offsets)
      catmull_rom_coeffs(fy - Math.floor(fy), cy)
      for (let iz = 0; iz < new_nz; iz++) {
        const z_base = 4 * iz
        const oz0 = z_offsets[z_base]
        const oz1 = z_offsets[z_base + 1]
        const oz2 = z_offsets[z_base + 2]
        const oz3 = z_offsets[z_base + 3]
        const cz0 = cz[z_base]
        const cz1 = cz[z_base + 1]
        const cz2 = cz[z_base + 2]
        const cz3 = cz[z_base + 3]
        // Interpolate along z, then y, then x
        let result = 0
        for (let xi = 0; xi < 4; xi++) {
          const x_off = x_offsets[xi]
          let y_sum = 0
          for (let yi = 0; yi < 4; yi++) {
            const row = x_off + y_offsets[yi]
            y_sum +=
              cy[yi] *
              (cz0 * values[row + oz0] +
                cz1 * values[row + oz1] +
                cz2 * values[row + oz2] +
                cz3 * values[row + oz3])
          }
          result += cx[xi] * y_sum
        }
        out[out_idx++] = result
      }
    }
  }

  return { values: out, dims: [new_nx, new_ny, new_nz], order: `z_fastest` }
}

// Cartesian shift that centres marching-cubes output on Γ: vertices come out at
// k_latticeᵀ·frac with frac ∈ [0, 1], so subtract ½(a* + b* + c*). A half-step grid shift
// (FRMSF lshift=2) puts grid point i at (i + ½)/n rather than i/n, which moves the whole
// surface by +½·(a*/n + b*/n + c*/n) on top of that.
const centering_offset = (k_lattice: Matrix3x3, k_grid: Vec3, grid_shift?: Vec3): Vec3 => {
  const offset: Vec3 = [0, 0, 0]
  for (let axis = 0; axis < 3; axis++) {
    const weight = -0.5 + (grid_shift?.[axis] ?? 0) / k_grid[axis]
    for (let comp = 0; comp < 3; comp++) offset[comp] += weight * k_lattice[axis][comp]
  }
  return offset
}

// Extract the Fermi surface of every band the level E_F + mu crosses
export function extract_fermi_surface(
  band_data: BandGridData,
  options: FermiSurfaceOptions = {},
): FermiSurfaceData {
  const { mu = 0, interpolation_factor = 1 } = options
  const isovalue = band_data.fermi_energy + mu
  const isosurfaces: FermiIsosurface[] = []
  // BXSF grids are endpoint-inclusive (store both equivalent k=0 and k=1 → false);
  // FRMSF grids store k=i/n without the duplicated endpoint (→ true)
  const periodic = band_data.periodic ?? false
  const position_offset = centering_offset(
    band_data.k_lattice,
    band_data.k_grid,
    band_data.grid_shift,
  )

  for (let spin_idx = 0; spin_idx < band_data.n_spins; spin_idx++) {
    const spin: SpinChannel = band_data.n_spins === 2 ? (spin_idx === 0 ? `up` : `down`) : null

    for (let band_idx = 0; band_idx < band_data.n_bands; band_idx++) {
      const raw_energies = band_data.energies[spin_idx][band_idx]
      if (!band_intersects_fermi(raw_energies.values, isovalue)) continue

      const energies =
        interpolation_factor > 1
          ? upsample_grid(raw_energies, interpolation_factor, periodic)
          : raw_energies

      // Marching cubes output stays in the centred parallelepiped cell; the renderer's
      // symmetry tiling covers the full Wigner-Seitz zone.
      const mesh = marching_cubes(energies, isovalue, band_data.k_lattice, {
        periodic,
        position_offset,
      })
      if (mesh.positions.length === 0) continue
      isosurfaces.push({ ...mesh, band_index: band_idx, spin })
    }
  }

  return {
    isosurfaces,
    k_lattice: band_data.k_lattice,
    fermi_energy: band_data.fermi_energy,
    reciprocal_cell: `parallelepiped`,
    metadata: { n_bands: band_data.n_bands, n_surfaces: isosurfaces.length },
  }
}

// Check if Fermi level intersects a band (has values both above and below)
function band_intersects_fermi(energies: Float64Array, isovalue: number): boolean {
  let has_below = false
  let has_above = false
  for (const energy of energies) {
    if (energy < isovalue) has_below = true
    else if (energy > isovalue) has_above = true
    if (has_below && has_above) return true
  }
  return false
}

// Compute 2D Fermi slice along a specified plane
export function compute_fermi_slice(
  fermi_data: FermiSurfaceData,
  options: FermiSliceOptions = {},
): FermiSliceData {
  const { miller_indices = [0, 0, 1], distance = 0 } = options

  if (miller_indices.every((miller_idx) => miller_idx === 0)) {
    throw new Error(
      `Invalid miller indices [0, 0, 0]: at least one index must be non-zero to define a plane`,
    )
  }

  // Compute plane normal in Cartesian coordinates
  const plane_normal = math.add(
    math.scale(fermi_data.k_lattice[0], miller_indices[0]),
    math.scale(fermi_data.k_lattice[1], miller_indices[1]),
    math.scale(fermi_data.k_lattice[2], miller_indices[2]),
  )

  const normal_len = Math.hypot(...plane_normal)
  if (normal_len < EPS) {
    throw new Error(
      `Degenerate plane normal: k_lattice vectors produce a zero-length normal for miller indices [${miller_indices.join(
        `, `,
      )}]`,
    )
  }
  const unit_normal = math.normalize_vec(plane_normal)

  const [in_plane_u, in_plane_v] = math.compute_in_plane_basis(unit_normal)

  const isolines: Isoline[] = fermi_data.isosurfaces.flatMap((surface) =>
    slice_surface_with_plane(surface, unit_normal, distance, in_plane_u, in_plane_v),
  )

  return {
    isolines,
    plane_normal: unit_normal,
    plane_distance: distance,
    metadata: {
      n_lines: isolines.length,
      has_properties: isolines.some((line) => line.properties !== undefined),
    },
  }
}

// Slice a surface with a plane to get isolines. Traces connected contours by following
// adjacent triangles across shared edges. Edges are keyed by the numeric pair
// min·n_vertices + max so the map never builds strings in the per-triangle hot loop.
function slice_surface_with_plane(
  surface: FermiIsosurface,
  plane_normal: Vec3,
  plane_distance: number,
  in_plane_u: Vec3,
  in_plane_v: Vec3,
): Isoline[] {
  const { positions, indices, properties } = surface
  const n_vertices = vertex_count(surface)
  if (n_vertices === 0 || indices.length === 0) return []
  const [nx, ny, nz] = plane_normal

  // Signed distance of each vertex to the plane
  const vertex_distances = new Float64Array(n_vertices)
  for (let idx = 0; idx < n_vertices; idx++) {
    vertex_distances[idx] =
      positions[3 * idx] * nx +
      positions[3 * idx + 1] * ny +
      positions[3 * idx + 2] * nz -
      plane_distance
  }

  const edge_key = (v0_idx: number, v1_idx: number): number =>
    v0_idx < v1_idx ? v0_idx * n_vertices + v1_idx : v1_idx * n_vertices + v0_idx

  // Crossing point (and interpolated property) of edge v0→v1, or null when it doesn't cross.
  // A vertex lying exactly on the plane counts as the positive side rather than as no crossing:
  // an endpoint-inclusive BXSF grid with an odd point count puts a whole grid plane through Γ,
  // which is exactly where the default slice cuts, so `d0 * d1 >= 0` dropped those edges. Each
  // cut triangle then produced one crossing instead of two, failed the `!== 2` test below, and
  // the default view of such a file rendered nothing at all.
  const edge_intersection = (
    v0_idx: number,
    v1_idx: number,
  ): { point: Vec3; property: number } | null => {
    const d0 = vertex_distances[v0_idx]
    const d1 = vertex_distances[v1_idx]
    if (d0 >= 0 === d1 >= 0) return null
    const frac = d0 === 0 ? 0 : d1 === 0 ? 1 : d0 / (d0 - d1)
    // Taken from the vertex itself at the ends, so a crossing that lands on one is bit-identical
    // to it - that is what lets the degenerate-segment test below compare points exactly
    const snap = frac === 0 ? v0_idx : frac === 1 ? v1_idx : -1
    const point: Vec3 = [0, 0, 0]
    for (let comp = 0; comp < 3; comp++) {
      if (snap >= 0) point[comp] = positions[3 * snap + comp]
      else {
        const from = positions[3 * v0_idx + comp]
        point[comp] = from + frac * (positions[3 * v1_idx + comp] - from)
      }
    }
    let property = 0
    if (properties) {
      property =
        snap >= 0
          ? properties[snap]
          : properties[v0_idx] + frac * (properties[v1_idx] - properties[v0_idx])
    }
    return { point, property }
  }

  // Each triangle the plane cuts yields one segment between two of its edges
  type FaceSegment = {
    face_idx: number
    edge_keys: [number, number]
    points: [Vec3, Vec3]
    properties: Vec2
  }
  const face_segments: FaceSegment[] = []
  const edge_to_faces = new Map<number, number[]>()
  const face_to_segment = new Map<number, FaceSegment>()

  for (let tri = 0; tri < indices.length; tri += 3) {
    const face_idx = tri / 3
    const crossings: { key: number; point: Vec3; property: number }[] = []
    for (let corner = 0; corner < 3; corner++) {
      const v0_idx = indices[tri + corner]
      const v1_idx = indices[tri + ((corner + 1) % 3)]
      const intersection = edge_intersection(v0_idx, v1_idx)
      if (!intersection) continue
      const key = edge_key(v0_idx, v1_idx)
      crossings.push({ key, ...intersection })
      const faces = edge_to_faces.get(key)
      if (faces) faces.push(face_idx)
      else edge_to_faces.set(key, [face_idx])
    }
    if (crossings.length !== 2) continue
    const segment: FaceSegment = {
      face_idx,
      edge_keys: [crossings[0].key, crossings[1].key],
      points: [crossings[0].point, crossings[1].point],
      properties: [crossings[0].property, crossings[1].property],
    }
    face_segments.push(segment)
    face_to_segment.set(face_idx, segment)
  }
  if (face_segments.length === 0) return []

  const [ux, uy, uz] = in_plane_u
  const [vx, vy, vz] = in_plane_v
  const used_faces = new Set<number>()
  const isolines: Isoline[] = []

  for (const start_segment of face_segments) {
    if (used_faces.has(start_segment.face_idx)) continue
    used_faces.add(start_segment.face_idx)

    // Walk from one end of the segment across adjacent faces until the contour closes or
    // reaches a boundary; collected in traversal order and reversed for the backward half
    const trace_direction = (initial_edge: number): { points: Vec3[]; props: number[] } => {
      const points: Vec3[] = []
      const props: number[] = []
      let current_edge = initial_edge
      let found_next = true
      while (found_next) {
        found_next = false
        for (const adj_face_idx of edge_to_faces.get(current_edge) ?? []) {
          if (used_faces.has(adj_face_idx)) continue
          const adj = face_to_segment.get(adj_face_idx)
          if (!adj) continue
          let next_end: 0 | 1
          if (adj.edge_keys[0] === current_edge) next_end = 1
          else if (adj.edge_keys[1] === current_edge) next_end = 0
          else continue
          points.push(adj.points[next_end])
          props.push(adj.properties[next_end])
          used_faces.add(adj_face_idx)
          current_edge = adj.edge_keys[next_end]
          found_next = true
          break
        }
      }
      return { points, props }
    }

    const forward = trace_direction(start_segment.edge_keys[1])
    const backward = trace_direction(start_segment.edge_keys[0])
    const contour_points: Vec3[] = [
      ...backward.points.toReversed(),
      start_segment.points[0],
      start_segment.points[1],
      ...forward.points,
    ]
    const contour_props = properties
      ? [
          ...backward.props.toReversed(),
          start_segment.properties[0],
          start_segment.properties[1],
          ...forward.props,
        ]
      : undefined

    const first = contour_points[0]
    const last = contour_points[contour_points.length - 1]
    const is_closed = math.euclidean_dist(first, last) < CLOSED_CONTOUR_TOLERANCE

    const points_2d: Vec2[] = contour_points.map((point) => [
      point[0] * ux + point[1] * uy + point[2] * uz,
      point[0] * vx + point[1] * vy + point[2] * vz,
    ])

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
  const n_vertices = fermi_data.isosurfaces.reduce(
    (sum, surface) => sum + vertex_count(surface),
    0,
  )
  // Irreducible only with enough data and no vertex past the origin by more than round-off
  if (n_vertices <= IRREDUCIBLE_BZ_MIN_VERTICES) return false
  let [min_coord, extent] = [Infinity, 0]
  for (const { positions } of fermi_data.isosurfaces) {
    for (const coord of positions) {
      if (coord < min_coord) min_coord = coord
      if (Math.abs(coord) > extent) extent = Math.abs(coord)
    }
  }
  return min_coord >= -IRREDUCIBLE_BZ_TOLERANCE * extent
}
