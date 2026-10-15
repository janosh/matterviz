// Fermi surface computation and analysis functions
// d3 directly, not #lib/colors: its barrel pulls Svelte modules into the extraction worker
import { rgb } from 'd3-color'
import { interpolateRdBu } from 'd3-scale-chromatic'
import { compute_brillouin_zone, generate_bz_vertices } from '#lib/brillouin/compute.js'
import * as math from '#lib/math.js'
import { EPS } from '#lib/math.js'
import type { Vec2, Vec3 } from '#lib/math.js'
import { grid_dimensions, scalar_grid_strides } from '#lib/isosurface/grid.js'
import { marching_cubes } from '#lib/marching-cubes.js'
import type {
  BandEnergyGrid,
  BandGridData,
  FermiSliceData,
  FermiSliceOptions,
  FermiSurfaceData,
  FermiSurfaceOptions,
  Isoline,
  FermiIsosurface,
  FermiSlicePlane,
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
// Auto grid density (interpolation_factor 0) refines a k-mesh until its longest axis has this
// many points, at most 4x: smooth Fermi surfaces and slices on coarse meshes while demo meshes
// stay under the scene's 50k-triangle tiling cap (64 pushes a 17³ mesh past it). The longest
// axis drives it so slabs (n×n×1) and anisotropic meshes are not over-refined.
const AUTO_GRID_POINTS = 48

export const auto_interpolation_factor = (k_grid: Vec3): number =>
  Math.min(4, Math.max(1, AUTO_GRID_POINTS / Math.max(...k_grid)))

// Catmull-Rom weights for the 4-point stencil at fractional offset t, written into `out`
// (result = out[0]*p0 + out[1]*p1 + out[2]*p2 + out[3]*p3)
function catmull_rom_coeffs(fraction: number, out: Float64Array): void {
  const param_2 = fraction * fraction
  const param_3 = param_2 * fraction
  out[0] = 0.5 * (-fraction + 2 * param_2 - param_3)
  out[1] = 0.5 * (2 - 5 * param_2 + 3 * param_3)
  out[2] = 0.5 * (fraction + 4 * param_2 - 3 * param_3)
  out[3] = 0.5 * (-param_2 + param_3)
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

  const [size_x, size_y, size_z] = grid_dimensions(grid)
  const [stride_x, stride_y, stride_z] = scalar_grid_strides(grid)
  const { values } = grid

  // Endpoint-inclusive grids carry one duplicated boundary sample per axis; the wrap
  // period (count of unique points) doubles as the resampling span numerator
  const endpoint = periodic ? 0 : 1
  const [pixel_x, pixel_y, pixel_z] = [size_x - endpoint, size_y - endpoint, size_z - endpoint]
  const [new_nx, new_ny, new_nz] = [pixel_x, pixel_y, pixel_z].map(
    (period) => Math.round(period * factor) + endpoint,
  )
  // Bound the point count, not the factor: output grows as factor³ per band, so the settings
  // cap of 5 bounds nothing (100³ at factor 5 is 496³ = 1.22e8 points, 976 MB per band).
  // Negated so NaN is rejected here, not downstream as a bad dims triple.
  const upsampled_points = new_nx * new_ny * new_nz
  if (!(upsampled_points <= MAX_UPSAMPLED_POINTS)) {
    throw new Error(
      `upsample_grid: factor ${factor} turns a ${size_x}×${size_y}×${size_z} band grid into ` +
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
  // One 1D Catmull-Rom pass along an axis: src[outer][axis][inner] → out[outer][new_n][inner],
  // where outer_bases are the src offsets of each outer slab and `stride` the src step along
  // the axis. Tricubic = separable passes along z, y, then x.
  const resample_axis = (
    src: ArrayLike<number>,
    outer_bases: Int32Array | number[],
    new_n: number,
    period: number,
    stride: number,
    n_inner: number,
  ): Float64Array => {
    const coords = src_coords(new_n, period)
    const offsets = new Int32Array(4 * new_n)
    const coeffs = new Float64Array(4 * new_n)
    for (let idx = 0; idx < new_n; idx++) {
      const coord = coords[idx]
      wrapped_stencil(coord, period, stride, offsets.subarray(4 * idx, 4 * idx + 4))
      catmull_rom_coeffs(coord - Math.floor(coord), coeffs.subarray(4 * idx, 4 * idx + 4))
    }
    const out = new Float64Array(outer_bases.length * new_n * n_inner)
    let out_idx = 0
    for (const slab of outer_bases) {
      for (let tap = 0; tap < 4 * new_n; tap += 4) {
        for (let inner = slab; inner < slab + n_inner; inner++) {
          out[out_idx++] =
            coeffs[tap] * src[inner + offsets[tap]] +
            coeffs[tap + 1] * src[inner + offsets[tap + 1]] +
            coeffs[tap + 2] * src[inner + offsets[tap + 2]] +
            coeffs[tap + 3] * src[inner + offsets[tap + 3]]
        }
      }
    }
    return out
  }
  const rows = Int32Array.from(
    { length: size_x * size_y },
    (_, idx) => Math.floor(idx / size_y) * stride_x + (idx % size_y) * stride_y,
  )
  const pass_z = resample_axis(values, rows, new_nz, pixel_z, stride_z, 1)
  const slabs = Int32Array.from({ length: size_x }, (_, idx_x) => idx_x * size_y * new_nz)
  const pass_y = resample_axis(pass_z, slabs, new_ny, pixel_y, new_nz, new_nz)
  const plane_size = new_ny * new_nz
  const out = resample_axis(pass_y, [0], new_nx, pixel_x, plane_size, plane_size)
  return { values: out, dims: [new_nx, new_ny, new_nz], order: `z_fastest` }
}

// Roll a periodic band grid so it covers the Γ-centred cell [−½, ½) along every axis, and
// return the fractional position of its new index 0. `index0_frac` is where index 0 sits in
// the source grid: 0 for Γ-centred meshes (BXSF, FRMSF lshift=1), ½/n for lshift=2,
// (½ − n/2)/n for lshift=0 Monkhorst-Pack meshes. Rolling the data rather than shifting
// vertices by −½(a*+b*+c*) keeps Γ at the cell centre. Endpoint-inclusive grids (BXSF) roll
// their n−1 unique points and re-append the duplicate.
type CenteredGrid = { grid: BandEnergyGrid; index0_frac: Vec3 }
function center_grid_on_gamma(
  grid: BandEnergyGrid,
  periodic: boolean,
  index0_frac: Vec3,
): CenteredGrid {
  const dims = grid_dimensions(grid)
  const strides = scalar_grid_strides(grid)
  const periods = dims.map((count) => (periodic ? count : count - 1))
  // Smallest roll r putting the new index 0 in [−½, −½ + 1/p): r/p + f0 ≡ −½ (mod 1),
  // rounded up; 1e-9 keeps a float that lands a hair above an integer from skipping a step
  const rolls = periods.map((period, axis) =>
    period > 0
      ? ((Math.ceil((-0.5 - index0_frac[axis]) * period - 1e-9) % period) + period) % period
      : 0,
  )
  const new_index0 = periods.map((period, axis) => {
    const frac = period > 0 ? rolls[axis] / period + index0_frac[axis] : 0
    return frac - Math.floor(frac + 0.5)
  }) as Vec3
  if (rolls.every((roll) => roll === 0)) return { grid, index0_frac: new_index0 }

  const [x_offsets, y_offsets, z_offsets] = dims.map((count, axis) =>
    Int32Array.from({ length: count }, (_, idx) =>
      periods[axis] > 0 ? ((idx + rolls[axis]) % periods[axis]) * strides[axis] : 0,
    ),
  )
  const values = new Float64Array(dims[0] * dims[1] * dims[2])
  let out_idx = 0
  for (const x_offset of x_offsets) {
    for (const y_offset of y_offsets) {
      for (const z_offset of z_offsets)
        values[out_idx++] = grid.values[x_offset + y_offset + z_offset]
    }
  }
  return { grid: { values, dims, order: `z_fastest` }, index0_frac: new_index0 }
}

// Upsampled, Γ-centred grids per source grid and key, so mu changes skip the upsampling that
// dominates each extraction
const prepared_grids = new WeakMap<BandEnergyGrid, Map<string, CenteredGrid>>()

// BXSF grids are endpoint-inclusive (k=0 and k=1 both stored → periodic false), FRMSF grids
// store k=i/n. Grid point i sits at index0_frac + i/period along each axis.
const grid_layout = (band_data: BandGridData): { periodic: boolean; index0_frac: Vec3 } => {
  const periodic = band_data.periodic ?? false
  const index0_frac = band_data.k_grid.map(
    (count, axis) => (band_data.grid_shift?.[axis] ?? 0) / (periodic ? count : count - 1),
  ) as Vec3
  return { periodic, index0_frac }
}

// interpolation_factor 0 means auto
export const resolved_factor = (band_data: BandGridData, factor: number): number =>
  factor > 0 ? factor : auto_interpolation_factor(band_data.k_grid)
const grid_key = (band_data: BandGridData, factor: number): string =>
  `${resolved_factor(band_data, factor)}|${band_data.periodic}|${band_data.grid_shift}`

// Upsampled grids cached per band, oldest out, so a hover preview and the full-resolution
// surface do not evict each other
export const PREPARED_FACTORS_PER_BAND = 2
// One band's grid upsampled and rolled to the Γ-centred cell (cached, see above)
function prepared_band_grid(
  band_data: BandGridData,
  raw_energies: BandEnergyGrid,
  interpolation_factor: number,
): CenteredGrid {
  const cache = prepared_grids.get(raw_energies) ?? new Map<string, CenteredGrid>()
  prepared_grids.set(raw_energies, cache)
  const key = grid_key(band_data, interpolation_factor)
  const cached = cache.get(key)
  if (cached) return cached
  const { periodic, index0_frac } = grid_layout(band_data)
  const factor = resolved_factor(band_data, interpolation_factor)
  const upsampled = upsample_grid(raw_energies, factor, periodic)
  const centered = center_grid_on_gamma(upsampled, periodic, index0_frac)
  cache.set(key, centered)
  const [oldest] = cache.keys() // Maps iterate in insertion order
  if (cache.size > PREPARED_FACTORS_PER_BAND) cache.delete(oldest)
  return centered
}

// Factor for a pointer-driven preview: capped at the k-mesh's auto factor so updates keep up
export const preview_interpolation_factor = (band_data: BandGridData, factor: number) =>
  Math.min(resolved_factor(band_data, factor), auto_interpolation_factor(band_data.k_grid))

// Every band the level `isovalue` crosses, with its spin channel and absolute band index
function* crossing_bands(band_data: BandGridData, isovalue: number) {
  for (const [spin_idx, bands] of band_data.energies.entries()) {
    const spin: SpinChannel = band_data.n_spins === 2 ? (spin_idx === 0 ? `up` : `down`) : null
    for (const [band_idx, grid] of bands.entries()) {
      if (!band_intersects_fermi(grid.values, isovalue)) continue
      const band_index = band_data.band_indices?.[band_idx] ?? band_idx
      yield { spin_idx, band_idx, spin, band_index, grid }
    }
  }
}

// One band's energies at Cartesian points, from the same grid marching cubes runs on
function sample_band_energies(
  band_data: BandGridData,
  raw_energies: BandEnergyGrid,
  factor: number,
  positions: ArrayLike<number>,
): Float32Array {
  const { grid, index0_frac } = prepared_band_grid(band_data, raw_energies, factor)
  return sample_vertex_values(positions, [grid], band_data, index0_frac)[0]
}

// Cartesian k of the in-plane coordinates (x, y) on a slice plane
export const slice_point_to_k = (
  { plane_normal, plane_distance, in_plane_basis: [axis_u, axis_v] }: FermiSlicePlane,
  coord_x: number,
  coord_y: number,
): Vec3 =>
  [0, 1, 2].map(
    (axis) =>
      plane_normal[axis] * plane_distance + axis_u[axis] * coord_x + axis_v[axis] * coord_y,
  ) as Vec3

// Extract the Fermi surface of every band the level E_F + mu crosses
export function extract_fermi_surface(
  band_data: BandGridData,
  options: FermiSurfaceOptions = {},
): FermiSurfaceData {
  const { mu: mean = 0, interpolation_factor = 1, wigner_seitz = false } = options
  const isovalue = band_data.fermi_energy + mean
  const isosurfaces: FermiIsosurface[] = []
  const { index0_frac } = grid_layout(band_data)
  const frac_to_cart = math.create_frac_to_cart(band_data.k_lattice)

  for (const { spin_idx, band_idx, spin, band_index, grid } of crossing_bands(
    band_data,
    isovalue,
  )) {
    // Marching cubes output stays in the Γ-centred parallelepiped cell; the renderer's
    // symmetry tiling covers the full Wigner-Seitz zone.
    const centered = prepared_band_grid(band_data, grid, interpolation_factor)
    const mesh = marching_cubes(centered.grid, isovalue, band_data.k_lattice, {
      periodic: band_data.periodic ?? false,
      position_offset: frac_to_cart(centered.index0_frac),
    })
    if (mesh.positions.length === 0) continue
    const fields = Object.entries(band_data.properties ?? {})
    const grids = fields.map(([, field]) => field[spin_idx][band_idx])
    const sampled = sample_vertex_values(mesh.positions, grids, band_data, index0_frac)
    const properties =
      band_data.properties &&
      Object.fromEntries(fields.map(([name], idx) => [name, sampled[idx]]))
    isosurfaces.push({ ...mesh, properties, band_index, spin })
  }

  return {
    isosurfaces: wigner_seitz
      ? isosurfaces.map((surface) => fold_to_wigner_seitz(surface, band_data.k_lattice))
      : isosurfaces,
    k_lattice: band_data.k_lattice,
    fermi_energy: band_data.fermi_energy,
    reciprocal_cell: wigner_seitz ? `wigner_seitz` : `parallelepiped`,
    metadata: { n_bands: band_data.n_bands, n_surfaces: isosurfaces.length },
  }
}

// Relative tolerance (× zone radius) for a point to count as on a zone face: 4 f32 ulps, since
// positions arrive as Float32 and a marching-cubes vertex exactly on a face sits up to ~1e-7
// relative past it. A point within it is the cut itself (no sliver cut a rounding error away
// from it) and stays where it is, so surfaces with nothing past a face fold as whole triangles.
const ZONE_FACE_RTOL = 4 * 2 ** -23

// A Bragg plane bounding the Wigner-Seitz zone {k : k·normal ≤ dist}, dist = |G|/2, and the
// integer indices of its lattice vector G in the k_lattice basis
type ZonePlane = { normal: Vec3; dist: number; indices: Vec3 }

// Lattice vectors within max_len of Γ (Γ excluded), nearest first. Enumerated in a reduced
// basis, where |nᵢ| ≤ max_len·|cᵢ| (cᵢ the dual rows) bounds the search exactly; returned with
// their integer indices in the k_lattice basis.
function lattice_vectors_within(
  k_lattice: math.Matrix3x3,
  max_len: number,
): { cart: Vec3; indices: Vec3 }[] {
  const basis = math.reduce_basis(k_lattice)
  const ranges = math
    .reciprocal_lattice(basis)
    .map((row) => Math.floor(max_len * Math.hypot(...row)))
  const to_frac = math.create_cart_to_frac(k_lattice)
  const found: { cart: Vec3; indices: Vec3 }[] = []
  for (let n_1 = -ranges[0]; n_1 <= ranges[0]; n_1++) {
    for (let n_2 = -ranges[1]; n_2 <= ranges[1]; n_2++) {
      for (let n_3 = -ranges[2]; n_3 <= ranges[2]; n_3++) {
        if (n_1 === 0 && n_2 === 0 && n_3 === 0) continue
        const cart = [0, 1, 2].map(
          (axis) => n_1 * basis[0][axis] + n_2 * basis[1][axis] + n_3 * basis[2][axis],
        ) as Vec3
        if (Math.hypot(...cart) > max_len) continue
        found.push({ cart, indices: to_frac(cart).map(Math.round) as Vec3 })
      }
    }
  }
  return found.toSorted(
    (vec_a, vec_b) => Math.hypot(...vec_a.cart) - Math.hypot(...vec_b.cart),
  )
}

// The Wigner-Seitz zone as its face planes: the Bragg planes holding at least 3 zone vertices
// (the zone is on the inner side of every Bragg plane). Planes meeting it only along an edge or
// at a corner (e.g. simple cubic ⟨110⟩) are left out: the zone is the intersection of its face
// half-spaces, so they never cut it. Also the zone's circumradius, which bounds which shifted
// zones a small triangle can reach.
// Cached per k_lattice object: the zone build costs more than folding a typical surface.
type ZoneBounds = { planes: ZonePlane[]; radius: number }
const zone_bounds_cache = new WeakMap<math.Matrix3x3, ZoneBounds>()
function wigner_seitz_planes(k_lattice: math.Matrix3x3): ZoneBounds {
  const cached = zone_bounds_cache.get(k_lattice)
  if (cached) return cached
  const vertices = generate_bz_vertices(k_lattice, 1)
  const radius = math.array_max(vertices.map((vertex) => Math.hypot(...vertex)))
  const tol = ZONE_FACE_RTOL * radius
  const planes = lattice_vectors_within(k_lattice, 2 * radius + tol).flatMap(
    ({ cart, indices }) => {
      const len = Math.hypot(...cart)
      const normal = math.scale(cart, 1 / len)
      const dist = len / 2
      const n_on_plane = vertices.filter(
        (vertex) => math.dot(vertex, normal) >= dist - tol,
      ).length
      return n_on_plane >= 3 ? [{ normal, dist, indices }] : []
    },
  )
  const bounds = { planes, radius }
  zone_bounds_cache.set(k_lattice, bounds)
  return bounds
}

// A vertex of a triangle being clipped: its identity (original vertex index, or the cut of an
// edge between two keyed vertices by a zone plane), position in the zone, normal and properties
type ClipVertex = { key: string; pos: Vec3; normal: Vec3; props: number[] }

// Sutherland-Hodgman: the part of a convex polygon on the inner side of one plane. Cut points
// interpolate position, normal and properties linearly along the cut edge, and are keyed by
// the plane and the edge's (sorted) end keys, so a cut shared by two triangles is one vertex.
function clip_polygon(
  polygon: ClipVertex[],
  { normal, dist }: ZonePlane,
  plane_idx: number,
  tol: number,
): ClipVertex[] {
  // scalar loop: runs per zone plane for every candidate shift of every straddling triangle
  const offsets: number[] = []
  let all_inside = true
  for (const { pos } of polygon) {
    const offset = pos[0] * normal[0] + pos[1] * normal[1] + pos[2] * normal[2] - dist
    offsets.push(offset)
    all_inside &&= offset <= tol
  }
  if (all_inside) return polygon
  const clipped: ClipVertex[] = []
  for (const [idx, current] of polygon.entries()) {
    const next_idx = (idx + 1) % polygon.length
    const [next, d_cur, d_next] = [polygon[next_idx], offsets[idx], offsets[next_idx]]
    const [cur_in, next_in] = [d_cur <= tol, d_next <= tol]
    if (cur_in) clipped.push(current)
    // a cut strictly between the ends (an end within tol of the plane is the cut itself)
    if (cur_in !== next_in && Math.abs(d_cur) > tol && Math.abs(d_next) > tol) {
      const frac = d_cur / (d_cur - d_next)
      const lerp = (from: readonly number[], to: readonly number[]) =>
        from.map((val, axis) => val + frac * (to[axis] - val))
      const lerped_normal = lerp(current.normal, next.normal) as Vec3
      const normal_len = Math.hypot(...lerped_normal) || 1
      const end_keys = [current.key, next.key].toSorted()
      clipped.push({
        key: `${plane_idx}(${end_keys[0]}|${end_keys[1]})`,
        pos: lerp(current.pos, next.pos) as Vec3,
        normal: math.scale(lerped_normal, 1 / normal_len),
        props: lerp(current.props, next.props),
      })
    }
  }
  return clipped
}

// Move a band-grid surface from the Γ-centred cell into the Wigner-Seitz zone, so sheets line
// up with a k-path drawn through it. Each triangle first shifts by the lattice vector G nearest
// its centroid (centroid minus its minimum image from Γ; min_image_displacement searches a
// reduced basis, so this stays exact for sheared or supercell bases). A triangle still crossing
// a zone face is clipped exactly at the faces (Sutherland-Hodgman): each piece lands in the
// zone of G + H for H = 0 or a nearby lattice vector and shifts by that, so the sheet ends on
// the faces in a continuous cut instead of a triangle-sized staircase, and the cuts on
// opposite faces match. Vertices stay shared per shift, cut points per shift, plane and edge.
export function fold_to_wigner_seitz(
  surface: FermiIsosurface,
  k_lattice: math.Matrix3x3,
): FermiIsosurface {
  const { positions, indices, normals, properties } = surface
  // built once per surface: caches the reduced search basis for every triangle
  const converters = math.create_lattice_converters(k_lattice)
  const { planes, radius } = wigner_seitz_planes(k_lattice)
  const tol = ZONE_FACE_RTOL * radius
  // points within the zone's inradius skip the per-plane test
  const inradius = Math.min(...planes.map(({ dist }) => dist)) - tol
  const inner_sq = inradius ** 2
  const n_vertices = vertex_count(surface)
  const prop_entries = Object.entries(properties ?? {})
  const prop_values = prop_entries.map(([, values]) => values)
  const has_normals = normals.length === positions.length
  // [normal_x, normal_y, normal_z, dist] per plane: the per-vertex and per-corner plane loops
  // below run over every vertex of every sheet
  const plane_data = Float64Array.from(planes.flatMap(({ normal, dist }) => [...normal, dist]))

  // distinct shifts G (integer indices → id), with their Cartesian vectors
  const shift_ids = new Map<number, number>()
  const shift_carts: Vec3[] = []
  const shift_id_of = (shift: Vec3): number => {
    // indices stay far inside ±2¹⁵ (a few zone radii), so this packs them without collisions
    const key = ((shift[0] + 32768) * 65536 + shift[1] + 32768) * 65536 + shift[2] + 32768
    let shift_id = shift_ids.get(key)
    if (shift_id === undefined) {
      shift_id = shift_carts.length
      shift_ids.set(key, shift_id)
      shift_carts.push(converters.frac_to_cart(shift))
    }
    return shift_id
  }
  const zero: Vec3 = [0, 0, 0]
  const zero_shift = shift_id_of(zero)

  // output: the input vertices first (kept at their index under G = 0), then appended ones
  const out_positions: number[] = []
  const out_normals: number[] = []
  const out_props: number[][] = prop_entries.map(() => [])
  const out_indices: number[] = []
  let n_appended = 0
  const append = (pos: Vec3, normal: Vec3, props: number[]): number => {
    out_positions.push(pos[0], pos[1], pos[2])
    out_normals.push(normal[0], normal[1], normal[2])
    for (const [prop_idx, values] of out_props.entries()) values.push(props[prop_idx])
    return n_vertices + n_appended++
  }
  const vertex_pos = (idx: number): Vec3 => [
    positions[3 * idx],
    positions[3 * idx + 1],
    positions[3 * idx + 2],
  ]
  // normals stay unread (out_normals is dropped) when the surface has none
  const vertex_normal = (idx: number): Vec3 =>
    has_normals ? [normals[3 * idx], normals[3 * idx + 1], normals[3 * idx + 2]] : [0, 0, 0]
  const vertex_props = (idx: number) => prop_values.map((values) => values[idx])
  // output index of each input vertex under a shift, per shift id (−1 until emitted)
  const shifted_vertex = new Map<number, Int32Array>()
  const emit_original = (idx: number, shift_id: number): number => {
    if (shift_id === zero_shift) return idx
    let out_ids = shifted_vertex.get(shift_id)
    if (!out_ids) {
      out_ids = new Int32Array(n_vertices).fill(-1)
      shifted_vertex.set(shift_id, out_ids)
    }
    if (out_ids[idx] === -1) {
      const pos = math.subtract(vertex_pos(idx), shift_carts[shift_id])
      out_ids[idx] = append(pos, vertex_normal(idx), vertex_props(idx))
    }
    return out_ids[idx]
  }
  const cut_vertex = new Map<string, number>() // `shift id|cut key` → output index
  // A point's largest offset k·n − dist past the zone planes (negative inside); also leaves
  // the plane it was largest for in worst_plane
  let worst_plane = 0
  const worst_offset = (pos_x: number, pos_y: number, pos_z: number): number => {
    let worst = -Infinity
    for (let at = 0; at < plane_data.length; at += 4) {
      const offset =
        pos_x * plane_data[at] +
        pos_y * plane_data[at + 1] +
        pos_z * plane_data[at + 2] -
        plane_data[at + 3]
      if (offset > worst) [worst_plane, worst] = [at / 4, offset]
    }
    return worst
  }
  // whether a point lies past a zone face
  const outside = (pos_x: number, pos_y: number, pos_z: number): boolean =>
    pos_x * pos_x + pos_y * pos_y + pos_z * pos_z > inner_sq &&
    worst_offset(pos_x, pos_y, pos_z) > tol
  // whether a point lies inside every face by at least 2·tol
  const clears_zone = (pos_x: number, pos_y: number, pos_z: number): boolean =>
    pos_x * pos_x + pos_y * pos_y + pos_z * pos_z <= (inradius - 2 * tol) ** 2 ||
    worst_offset(pos_x, pos_y, pos_z) <= -2 * tol

  // Each vertex's own shift: the G (Γ, else the one of its most-violated face) whose zone it
  // lies inside by at least 2·tol, or −1. Slack (a min of affine functions) is concave, so when
  // all three corners clear the zone of one G, the centroid clears it by tol up to ~1e-16
  // relative rounding: c − G is then the centroid's unique minimum image and there is nothing
  // to clip, so those triangles skip the image search and plane clipping below.
  const vertex_shift = new Int32Array(n_vertices).fill(-1)
  for (let idx = 0; idx < n_vertices; idx++) {
    const [pos_x, pos_y, pos_z] = vertex_pos(idx)
    if (clears_zone(pos_x, pos_y, pos_z)) {
      vertex_shift[idx] = zero_shift
      continue
    }
    // clears_zone ran the full plane loop (its inradius early-out passes), so worst_plane is set
    const shift_id = shift_id_of(planes[worst_plane].indices)
    const [shift_x, shift_y, shift_z] = shift_carts[shift_id]
    if (clears_zone(pos_x - shift_x, pos_y - shift_y, pos_z - shift_z)) {
      vertex_shift[idx] = shift_id
    }
  }

  // Clip candidates, built on the first triangle that needs clipping. With r the largest
  // corner distance from a triangle's centroid, a point within r of a centroid inside the zone
  // lies in the zone of some H with |H| ≤ 2·radius + r, so those H (and 0) are the candidates.
  let neighbors: { shifts: Vec3[]; carts: Vec3[] } | undefined
  const clip_neighbors = (): { shifts: Vec3[]; carts: Vec3[] } => {
    let max_tri_radius_sq = 0
    for (let tri = 0; tri < indices.length; tri += 3) {
      const [off_0, off_1, off_2] = [
        3 * indices[tri],
        3 * indices[tri + 1],
        3 * indices[tri + 2],
      ]
      const cen_x = (positions[off_0] + positions[off_1] + positions[off_2]) / 3
      const cen_y = (positions[off_0 + 1] + positions[off_1 + 1] + positions[off_2 + 1]) / 3
      const cen_z = (positions[off_0 + 2] + positions[off_1 + 2] + positions[off_2 + 2]) / 3
      for (const offset of [off_0, off_1, off_2]) {
        const dist_sq =
          (positions[offset] - cen_x) ** 2 +
          (positions[offset + 1] - cen_y) ** 2 +
          (positions[offset + 2] - cen_z) ** 2
        if (dist_sq > max_tri_radius_sq) max_tri_radius_sq = dist_sq
      }
    }
    const reach = 2 * radius + Math.sqrt(max_tri_radius_sq) + tol
    const shifts: Vec3[] = [
      zero,
      ...lattice_vectors_within(k_lattice, reach).map(({ indices: shift }) => shift),
    ]
    return { shifts, carts: shifts.map((shift) => converters.frac_to_cart(shift)) }
  }

  const centroid: Vec3 = [0, 0, 0]
  for (let tri = 0; tri < indices.length; tri += 3) {
    const [idx_0, idx_1, idx_2] = [indices[tri], indices[tri + 1], indices[tri + 2]]
    const tri_shift = vertex_shift[idx_0]
    const shared_shift =
      tri_shift !== -1 &&
      tri_shift === vertex_shift[idx_1] &&
      tri_shift === vertex_shift[idx_2]
    if (shared_shift && tri_shift === zero_shift) {
      out_indices.push(idx_0, idx_1, idx_2)
      continue
    }
    for (let axis = 0; axis < 3; axis++) {
      centroid[axis] =
        (positions[3 * idx_0 + axis] +
          positions[3 * idx_1 + axis] +
          positions[3 * idx_2 + axis]) /
        3
    }
    const [cen_x, cen_y, cen_z] = centroid
    // a shared G ≠ 0 must also beat Γ by the 1e-6 tie margin below by more than rounding,
    // else the triangle takes the exact path
    if (shared_shift) {
      const [shift_x, shift_y, shift_z] = shift_carts[tri_shift]
      const gain =
        Math.hypot(cen_x, cen_y, cen_z) -
        Math.hypot(cen_x - shift_x, cen_y - shift_y, cen_z - shift_z)
      if (gain > 1e-6 + tol) {
        out_indices.push(
          emit_original(idx_0, tri_shift),
          emit_original(idx_1, tri_shift),
          emit_original(idx_2, tri_shift),
        )
        continue
      }
    }
    const image = math.min_image_displacement(zero, centroid, k_lattice, converters)
    // ties stay at G = 0
    const base_shift: Vec3 =
      Math.hypot(...image) >= Math.hypot(...centroid) - 1e-6
        ? zero
        : (converters.cart_to_frac(math.subtract(centroid, image)).map(Math.round) as Vec3)
    const base_id = shift_id_of(base_shift)
    const [base_x, base_y, base_z] = shift_carts[base_id]
    const corner_ids = [idx_0, idx_1, idx_2]
    const straddles = corner_ids.some((idx) =>
      outside(
        positions[3 * idx] - base_x,
        positions[3 * idx + 1] - base_y,
        positions[3 * idx + 2] - base_z,
      ),
    )
    if (!straddles) {
      for (const idx of corner_ids) out_indices.push(emit_original(idx, base_id))
      continue
    }
    // crosses a face: clip the triangle into the zone of every shift it reaches
    const corners: ClipVertex[] = corner_ids.map((idx) => ({
      key: String(idx),
      pos: vertex_pos(idx),
      normal: vertex_normal(idx),
      props: vertex_props(idx),
    }))
    const tri_radius = Math.max(
      ...corners.map(({ pos }) => math.euclidean_dist(pos, centroid)),
    )
    const reach = radius + tri_radius + tol
    neighbors ??= clip_neighbors()
    for (const [neighbor_idx, neighbor] of neighbors.shifts.entries()) {
      // base + neighbour in Cartesian differs from the exact frac_to_cart(shift) only by
      // rounding (~1e-16 relative), far below the tol margin, so this skips no reachable shift
      const [nbr_x, nbr_y, nbr_z] = neighbors.carts[neighbor_idx]
      const approx_dist = Math.hypot(
        cen_x - base_x - nbr_x,
        cen_y - base_y - nbr_y,
        cen_z - base_z - nbr_z,
      )
      if (approx_dist > reach + tol) continue
      const shift = math.add(base_shift, neighbor)
      const shift_cart = converters.frac_to_cart(shift)
      if (math.euclidean_dist(centroid, shift_cart) > reach) continue
      let polygon = corners.map((corner) => ({
        ...corner,
        pos: math.subtract(corner.pos, shift_cart),
      }))
      for (const [plane_idx, plane] of planes.entries()) {
        polygon = clip_polygon(polygon, plane, plane_idx, tol)
        if (polygon.length < 3) break
      }
      if (polygon.length < 3) continue
      const shift_id = shift_id_of(shift)
      const ids = polygon.map(({ key, pos, normal, props }) => {
        if (!key.includes(`(`)) return emit_original(Number(key), shift_id)
        const cut_key = `${shift_id}|${key}`
        let out_idx = cut_vertex.get(cut_key)
        if (out_idx === undefined) {
          out_idx = append(pos, normal, props)
          cut_vertex.set(cut_key, out_idx)
        }
        return out_idx
      })
      // fan triangulation keeps the winding; slivers (height within tol, below what Float32
      // positions resolve) drop
      for (let fan = 1; fan + 1 < polygon.length; fan++) {
        const [pos_a, pos_b, pos_c] = [polygon[0].pos, polygon[fan].pos, polygon[fan + 1].pos]
        const twice_area = Math.hypot(
          ...math.cross_3d(math.subtract(pos_b, pos_a), math.subtract(pos_c, pos_a)),
        )
        const longest = Math.max(
          math.euclidean_dist(pos_a, pos_b),
          math.euclidean_dist(pos_b, pos_c),
          math.euclidean_dist(pos_c, pos_a),
        )
        if (twice_area > tol * longest) out_indices.push(ids[0], ids[fan], ids[fan + 1])
      }
    }
  }
  const unchanged =
    n_appended === 0 &&
    out_indices.length === indices.length &&
    out_indices.every((idx, pos) => idx === indices[pos])
  if (unchanged) return surface
  const extend = (values: Float32Array, extra: number[]): Float32Array => {
    const out = new Float32Array(values.length + extra.length)
    out.set(values)
    out.set(extra, values.length)
    return out
  }
  return {
    ...surface,
    positions: extend(positions, out_positions),
    normals: has_normals ? extend(normals, out_normals) : normals,
    indices: Uint32Array.from(out_indices),
    properties:
      properties &&
      Object.fromEntries(
        prop_entries.map(([name, values], prop_idx) => [
          name,
          extend(values, out_props[prop_idx]),
        ]),
      ),
  }
}

// Band-grid field values at Cartesian points (Å⁻¹), trilinear on a grid of band_data's layout
// whose index 0 sits at index0_frac; one Float32Array per grid. Sampling the raw grid keeps
// properties independent of interpolation_factor and free of tricubic overshoot (a gap Δ_nk
// stays ≥ 0). NaN corners (no value, e.g. outside a Fermi window) drop out and the other
// weights renormalise; NaN only where all eight are missing.
function sample_vertex_values(
  positions: ArrayLike<number>,
  grids: BandEnergyGrid[],
  band_data: Pick<BandGridData, `k_lattice` | `periodic`>,
  index0_frac: Vec3,
): Float32Array[] {
  const n_vertices = positions.length / 3
  const outputs = grids.map(() => new Float32Array(n_vertices))
  if (grids.length === 0) return outputs
  const cart_to_frac = math.create_cart_to_frac(band_data.k_lattice)
  const strides = scalar_grid_strides(grids[0])
  const periods = grid_dimensions(grids[0]).map((count) =>
    Math.max(band_data.periodic ? count : count - 1, 1),
  )
  const base: Vec3 = [0, 0, 0]
  const fractions = [0, 0, 0]
  const corner_offsets = new Int32Array(8)
  const corner_weights = new Float64Array(8)
  for (let vert_idx = 0; vert_idx < n_vertices; vert_idx++) {
    const offset = 3 * vert_idx
    const point: Vec3 = [positions[offset], positions[offset + 1], positions[offset + 2]]
    cart_to_frac(point, base)
    for (let axis = 0; axis < 3; axis++) {
      const coord = (base[axis] - index0_frac[axis]) * periods[axis]
      base[axis] = Math.floor(coord)
      fractions[axis] = coord - base[axis]
    }
    for (let corner = 0; corner < 8; corner++) {
      let corner_offset = 0
      let weight = 1
      for (let axis = 0; axis < 3; axis++) {
        const upper = (corner >> axis) & 1
        const period = periods[axis]
        corner_offset += ((((base[axis] + upper) % period) + period) % period) * strides[axis]
        weight *= upper ? fractions[axis] : 1 - fractions[axis]
      }
      corner_offsets[corner] = corner_offset
      corner_weights[corner] = weight
    }
    for (const [grid_idx, { values }] of grids.entries()) {
      let [sum, weight_sum] = [0, 0]
      for (let corner = 0; corner < 8; corner++) {
        const value = values[corner_offsets[corner]]
        if (Number.isFinite(value)) {
          sum += corner_weights[corner] * value
          weight_sum += corner_weights[corner]
        }
      }
      outputs[grid_idx][vert_idx] = weight_sum > 0 ? sum / weight_sum : NaN
    }
  }
  return outputs
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

// Unit Cartesian normal of the slice plane with Miller indices (h k l): h·b₁ + k·b₂ + l·b₃
export function slice_plane_normal(k_lattice: math.Matrix3x3, miller_indices: Vec3): Vec3 {
  if (miller_indices.every((miller_idx) => miller_idx === 0)) {
    throw new Error(
      `Invalid miller indices [0, 0, 0]: at least one index must be non-zero to define a plane`,
    )
  }
  const plane_normal = math.create_frac_to_cart(k_lattice)(miller_indices)
  if (Math.hypot(...plane_normal) < EPS) {
    throw new Error(
      `Degenerate plane normal: k_lattice vectors produce a zero-length normal for miller indices [${miller_indices.join(`, `)}]`,
    )
  }
  return math.normalize_vec(plane_normal)
}

// The 12 edges of the Γ-centred reciprocal cell [−½, ½]³ where band-grid surfaces live
export function centered_cell_edges(k_lattice: math.Matrix3x3): [Vec3, Vec3][] {
  const frac_to_cart = math.create_frac_to_cart(k_lattice)
  const corner = (frac: Vec3) => frac_to_cart(math.subtract(frac, [0.5, 0.5, 0.5]))
  return math.UNIT_CUBE_EDGES.map(([start, end]) => [corner(start), corner(end)])
}

// Where the plane normal·k = distance cuts the cell the data's surfaces live in: the
// Wigner–Seitz zone (`zone_edges` when given, else computed) or the Γ-centred parallelepiped.
// Empty when the plane misses it.
export function reciprocal_cell_section(
  { k_lattice, reciprocal_cell }: Pick<FermiSurfaceData, `k_lattice` | `reciprocal_cell`>,
  normal: Vec3,
  distance: number,
  zone_edges?: readonly (readonly Vec3[])[],
): Vec3[] {
  const edges =
    reciprocal_cell === `parallelepiped`
      ? centered_cell_edges(k_lattice)
      : (zone_edges ?? compute_brillouin_zone(k_lattice, 1).edges)
  return math.plane_polyhedron_section(edges, normal, distance)
}

export type CarrierType = `electron` | `hole`
// FermiSlice shading: band pockets (electron solid, hole hatched), occupied side, ε − E_F
export type SliceShading = `pockets` | `occupied` | `energy`
export interface SliceEnergyMap {
  width: number
  height: number
  layers: { band_index: number; spin: SpinChannel; values: Float32Array }[]
}
// ε_nk − (E_F + mu) of every band crossing E_F + mu on a width × height pixel grid over the
// rectangle `bounds` in the plane's 2D coordinates (rows top to bottom). The zero level of each
// layer traces that band's slice contour.
export function sample_slice_energies(
  band_data: BandGridData,
  options: {
    plane: FermiSlicePlane
    bounds: { min: Vec2; max: Vec2 }
    mu?: number
    interpolation_factor?: number
    resolution?: number // pixels along the longer side
  },
): SliceEnergyMap {
  const { plane, bounds, mu = 0, interpolation_factor = 1, resolution = 256 } = options
  const [span_x, span_y] = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]]
  const scale = resolution / Math.max(span_x, span_y)
  const [width, height] = [span_x, span_y].map((span) => Math.max(1, Math.round(span * scale)))
  const positions = new Float32Array(3 * width * height)
  for (let row = 0; row < height; row++) {
    const coord_y = bounds.max[1] - ((row + 0.5) / height) * span_y
    for (let col = 0; col < width; col++) {
      const coord_x = bounds.min[0] + ((col + 0.5) / width) * span_x
      positions.set(slice_point_to_k(plane, coord_x, coord_y), 3 * (row * width + col))
    }
  }
  const isovalue = band_data.fermi_energy + mu
  const layers = [...crossing_bands(band_data, isovalue)].map(({ band_index, spin, grid }) => {
    const values = sample_band_energies(band_data, grid, interpolation_factor, positions)
    for (let idx = 0; idx < values.length; idx++) values[idx] -= isovalue
    return { band_index, spin, values }
  })
  return { width, height, layers }
}

// RGBA pixels (row-major) shading a slice energy map:
// - `pockets`: an electron band's occupied side in its colour, a hole band's empty side hatched
// - `occupied`: every band's filled side (ε < E_F + mu), overlapping bands darkening
// - `energy`: ε − E_F of the band nearest E_F per pixel on a diverging scale, so near-crossings
//   show before a mu change makes pockets
export function slice_shading_rgba(
  energy_map: SliceEnergyMap,
  mode: SliceShading,
  band_colors: readonly string[],
  {
    opacity = 0.22,
    carriers = new Map(),
  }: { opacity?: number; carriers?: Map<number, CarrierType> } = {},
): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, layers } = energy_map
  const n_pixels = width * height
  const pixels = new Uint8ClampedArray(4 * n_pixels)
  if (layers.length === 0) return pixels
  if (mode !== `energy`) {
    // straight-alpha source-over of each layer's shaded side (alpha in [0, 1] until the end)
    const rgba = new Float32Array(4 * n_pixels)
    for (const { band_index, values } of layers) {
      const { r, g, b } = rgb(band_colors[band_index % band_colors.length])
      const hole = mode === `pockets` && carriers.get(band_index) === `hole`
      for (let idx = 0; idx < n_pixels; idx++) {
        if (!(hole ? values[idx] > 0 : values[idx] < 0)) continue
        if (hole && (Math.floor(idx / width) + (idx % width)) % 6 >= 3) continue // stripes
        // out_a = a_s + a_d (1 − a_s); out_c = (c_s a_s + c_d a_d (1 − a_s)) / out_a
        const at = 4 * idx
        const out_alpha = opacity + rgba[at + 3] * (1 - opacity)
        const keep = (rgba[at + 3] * (1 - opacity)) / out_alpha
        const add = opacity / out_alpha
        rgba[at] = r * add + rgba[at] * keep
        rgba[at + 1] = g * add + rgba[at + 1] * keep
        rgba[at + 2] = b * add + rgba[at + 2] * keep
        rgba[at + 3] = out_alpha
      }
    }
    for (let idx = 3; idx < rgba.length; idx += 4) rgba[idx] *= 255
    pixels.set(rgba)
    return pixels
  }
  const nearest = new Float32Array(n_pixels).fill(NaN)
  for (const { values } of layers) {
    for (let idx = 0; idx < n_pixels; idx++) {
      const value = values[idx]
      if (Number.isFinite(value) && !(Math.abs(value) >= Math.abs(nearest[idx])))
        nearest[idx] = value
    }
  }
  let abs_max = 0
  for (const value of nearest)
    if (Number.isFinite(value)) abs_max = Math.max(abs_max, Math.abs(value))
  for (let idx = 0; idx < n_pixels; idx++) {
    const value = nearest[idx]
    if (!Number.isFinite(value) || abs_max === 0) continue
    // RdBu: below E_F (occupied) red, above blue
    const color = rgb(interpolateRdBu(0.5 + (0.5 * value) / abs_max))
    pixels.set([color.r, color.g, color.b, 255 * opacity * 2], 4 * idx)
  }
  return pixels
}

// A point strictly inside a simple polygon: its centroid when inside, else the midpoint of the
// first inside stretch of the horizontal line through it
export function polygon_interior_point(points: readonly Vec2[]): Vec2 {
  const n_points = points.length
  const centroid: Vec2 = [0, 1].map(
    (axis) => points.reduce((sum, point) => sum + point[axis], 0) / n_points,
  ) as Vec2
  const crossings: number[] = []
  for (let idx = 0; idx < n_points; idx++) {
    const [x_1, y_1] = points[idx]
    const [x_2, y_2] = points[(idx + 1) % n_points]
    if (y_1 > centroid[1] !== y_2 > centroid[1]) {
      crossings.push(x_1 + ((centroid[1] - y_1) / (y_2 - y_1)) * (x_2 - x_1))
    }
  }
  crossings.sort((left, right) => left - right)
  // even-odd: inside when an odd number of crossings lie left of it (fewer than two crossings:
  // a degenerate polygon keeps its centroid)
  const n_left = crossings.filter((cross_x) => cross_x < centroid[0]).length
  if (n_left % 2 === 1 || crossings.length < 2) return centroid
  return [(crossings[0] + crossings[1]) / 2, centroid[1]]
}

// Electron or hole carrier per band from its slice contours: the band's energy at a point inside
// each contour is below E_F + mu for an electron pocket, above for a hole pocket, and the band
// takes its contours' majority (ties go to electron). A contour cut open by the cell boundary is
// closed by its chord, which keeps the point inside the usual convex pocket.
export function band_carriers(
  band_data: BandGridData,
  slice_data: FermiSliceData,
  { mu = 0, interpolation_factor = 1 }: { mu?: number; interpolation_factor?: number } = {},
): Map<number, CarrierType> {
  const hole_votes = new Map<number, number>()
  for (const { points_2d, band_index, spin } of slice_data.isolines) {
    const band_idx = band_data.band_indices?.indexOf(band_index) ?? band_index
    const grid = band_data.energies[spin === `down` ? 1 : 0]?.[band_idx]
    if (points_2d.length < 3 || !grid) continue
    const k_point = slice_point_to_k(slice_data, ...polygon_interior_point(points_2d))
    const [energy] = sample_band_energies(band_data, grid, interpolation_factor, k_point)
    const vote = energy < band_data.fermi_energy + mu ? -1 : 1
    hole_votes.set(band_index, (hole_votes.get(band_index) ?? 0) + vote)
  }
  return new Map(
    [...hole_votes].map(([band, votes]) => [band, votes > 0 ? `hole` : `electron`]),
  )
}

// Compute 2D Fermi slice along a specified plane
export function compute_fermi_slice(
  fermi_data: FermiSurfaceData,
  options: FermiSliceOptions = {},
): FermiSliceData {
  const { miller_indices = [0, 0, 1], distance = 0 } = options
  // Contours carry one property: the requested one, else the first any sheet has
  const property =
    options.property ??
    fermi_data.isosurfaces.flatMap((surface) => Object.keys(surface.properties ?? {}))[0]

  const plane_normal = slice_plane_normal(fermi_data.k_lattice, miller_indices)
  const plane: FermiSlicePlane = {
    plane_normal,
    plane_distance: distance,
    in_plane_basis: math.compute_in_plane_basis(plane_normal),
  }
  const isolines = fermi_data.isosurfaces.flatMap((surface) =>
    slice_surface_with_plane(
      surface,
      property === undefined ? undefined : surface.properties?.[property],
      plane,
    ),
  )

  return {
    isolines,
    ...plane,
    metadata: {
      n_lines: isolines.length,
      has_properties: isolines.some((line) => line.properties !== undefined),
    },
  }
}

// Label for an in-plane slice direction: the signed Cartesian axis it runs along, or the
// direction itself when oblique
const K_AXIS_LABELS = [`kₓ`, `kᵧ`, `kz`] as const // (subscript z doesn't exist in Unicode)
export function slice_axis_label(direction: Vec3, fallback: string): string {
  const axis = direction.findIndex((component) => Math.abs(component) > 1 - 1e-6)
  if (axis !== -1) return `${direction[axis] < 0 ? `−` : ``}${K_AXIS_LABELS[axis]}`
  const rounded = direction.map((component) => Number(component.toFixed(2)) || 0)
  return `${fallback} ∥ [${rounded.join(`, `)}]`
}

// Slice a surface with a plane to get isolines. Traces connected contours by following
// adjacent triangles across shared edges. Edges are keyed by the numeric pair
// min·n_vertices + max so the map never builds strings in the per-triangle hot loop.
function slice_surface_with_plane(
  surface: FermiIsosurface,
  properties: Float32Array | undefined,
  { plane_normal, plane_distance, in_plane_basis }: FermiSlicePlane,
): Isoline[] {
  const { positions, indices } = surface
  const n_vertices = vertex_count(surface)
  if (n_vertices === 0 || indices.length === 0) return []
  const [normal_x, normal_y, normal_z] = plane_normal

  // Signed distance of each vertex to the plane
  const vertex_distances = new Float64Array(n_vertices)
  for (let idx = 0; idx < n_vertices; idx++) {
    vertex_distances[idx] =
      positions[3 * idx] * normal_x +
      positions[3 * idx + 1] * normal_y +
      positions[3 * idx + 2] * normal_z -
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
    const distance_0 = vertex_distances[v0_idx]
    const distance_1 = vertex_distances[v1_idx]
    if (distance_0 >= 0 === distance_1 >= 0) return null
    const frac =
      distance_0 === 0 ? 0 : distance_1 === 0 ? 1 : distance_0 / (distance_0 - distance_1)
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

  const [[unit_x, unit_y, unit_z], [vector_x, vector_y, vector_z]] = in_plane_basis
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
      point[0] * unit_x + point[1] * unit_y + point[2] * unit_z,
      point[0] * vector_x + point[1] * vector_y + point[2] * vector_z,
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
