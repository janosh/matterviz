// Isosurface geometry extraction shared by the main-thread fallback and geometry-worker.ts:
// marching cubes for every requested isovalue on each volume's grid, prepared by the caller
// (prepare_geometry_grid) so a worker receives at most MAX_GRID_POINTS values. A finite grid
// is the window itself; a periodic one is the unit cell, tiled over the window and clipped.
import { marching_cubes } from '#lib/marching-cubes.js'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import { create_frac_to_cart, det_3x3, inverse_3x3 } from '#lib/math.js'
import { type ScalarGrid3D, scalar_grid_strides } from './grid'
import { resample_periodic, type SurfaceClip } from './sampling'
import { MAX_GRID_POINTS } from './types'

interface GeometryVolumeJob {
  grid: ScalarGrid3D<Float64Array>
  lattice: Matrix3x3
  origin: Vec3
  clip?: SurfaceClip
  surfaces: { token: string; isovalue: number }[]
}

type Mesh = { positions: Float32Array; indices: Uint32Array }
// A periodic unit-cell surface: vertex base fractions, each vertex's grid edge (lower end
// i, j, k unwrapped up to n, then its axis) and the triangles
type UnitSurface = { fracs: Float64Array; edges: Int32Array; indices: Uint32Array }

// Estimated triangles past which a tiled surface coarsens its unit grid: half one per point of
// the grid budget (a 3x3x3 window of a 64³ density resampled to 500k points gave 135k)
export const MAX_SURFACE_TRIANGLES = MAX_GRID_POINTS / 2
// frame fractions this close to a window face lie on it, so the clip cuts no slivers
const SNAP = 1e-9

// Marching cubes on the periodic unit grid. Its topology depends only on which values lie
// below the isovalue, so it runs on that 0/1 pattern: every crossing then sits at an edge
// midpoint, exact in f32 index space, which names the vertex's grid edge. The position along
// that edge is interpolated in f64 from the lower end, so it is the same in every copy.
function unit_surface(grid: ScalarGrid3D, isovalue: number): UnitSurface {
  const { values, dims } = grid
  const below = new Float64Array(values.length) // a loop: Float64Array.from(fn) took 9 ms at 64³
  for (let idx = 0; idx < values.length; idx++) below[idx] = values[idx] < isovalue ? 0 : 1
  const index_space: Matrix3x3 = [
    [dims[0], 0, 0],
    [0, dims[1], 0],
    [0, 0, dims[2]],
  ]
  const { positions, indices } = marching_cubes({ ...grid, values: below }, 0.5, index_space, {
    normals: false,
  })
  const strides = scalar_grid_strides(grid)
  const n_verts = positions.length / 3
  const edges = new Int32Array(4 * n_verts)
  const fracs = new Float64Array(3 * n_verts)
  for (let vert = 0; vert < n_verts; vert++) {
    let [axis, lower] = [0, 0]
    for (let col = 0; col < 3; col++) {
      const twice = Math.round(2 * positions[3 * vert + col])
      if (twice & 1) axis = col
      edges[4 * vert + col] = twice >> 1
      lower += ((twice >> 1) % dims[col]) * strides[col]
    }
    edges[4 * vert + 3] = axis
    const along = edges[4 * vert + axis]
    const upper = lower + (((along + 1) % dims[axis]) - (along % dims[axis])) * strides[axis]
    const weight = (isovalue - values[lower]) / (values[upper] - values[lower])
    for (let col = 0; col < 3; col++)
      fracs[3 * vert + col] = (edges[4 * vert + col] + (col === axis ? weight : 0)) / dims[col]
  }
  return { fracs, edges, indices }
}

// The unit-cell surface (`lattice` rows at `origin`) tiled over the window's cells and clipped
// to its parallelepiped. A copy's vertex on a cell face (edge end 0 or n off its axis) is the
// neighbor copy's vertex on the same global grid edge, so copies weld by that edge, never by
// position. Triangles outside the window are dropped before anything is allocated for them,
// straddling ones cut per face plane at points shared by both triangles of a cut edge.
function tile_and_clip(
  { fracs, edges, indices }: UnitSurface,
  dims: Vec3,
  lattice: Matrix3x3,
  origin: Vec3,
  { frame, range, cells }: SurfaceClip,
): Mesh {
  const n_verts = fracs.length / 3
  const to_cart = create_frac_to_cart(lattice)
  const to_frame = create_frac_to_cart(inverse_3x3(frame)) // s = f · M⁻¹
  // unit vertices' Cartesian offsets and frame fractions
  const unit = new Float64Array(6 * n_verts)
  const frac: Vec3 = [0, 0, 0]
  for (let vert = 0; vert < n_verts; vert++) {
    for (let col = 0; col < 3; col++) frac[col] = fracs[3 * vert + col]
    unit.set(to_cart(frac), 6 * vert)
    unit.set(to_frame(frac), 6 * vert + 3)
  }
  // output vertices: Cartesian offset from origin, then frame fractions
  let out = new Float64Array(6 * Math.max(n_verts, 64))
  let out_tris = new Uint32Array(3 * Math.max(indices.length, 64))
  let [n_out, n_tri_idx] = [0, 0]
  const add_vertex = (values: Float64Array): number => {
    if (6 * n_out === out.length) out = grow(out)
    for (let col = 0; col < 6; col++) out[6 * n_out + col] = values[col]
    return n_out++
  }
  const emit = (vert_a: number, vert_b: number, vert_c: number): void => {
    if (n_tri_idx + 3 > out_tris.length) out_tris = grow(out_tris)
    out_tris[n_tri_idx++] = vert_a
    out_tris[n_tri_idx++] = vert_b
    out_tris[n_tri_idx++] = vert_c
  }
  // Sutherland-Hodgman per face plane. A distance within SNAP of the plane is 0, so a vertex
  // on it is reused as the cut point instead of cutting a sliver next to it.
  const cut_points = [0, 1, 2, 3, 4, 5].map(() => new Map<number, number>())
  const scratch = new Float64Array(6)
  const clip_polygon = (triangle: number[]): void => {
    let polygon = triangle
    for (let plane = 0; plane < 6 && polygon.length >= 3; plane++) {
      const [axis, side] = [plane >> 1, plane & 1 ? -1 : 1]
      const bound = range[axis][plane & 1]
      const dists = polygon.map((vert) => {
        const val = side * (out[6 * vert + 3 + axis] - bound)
        return Math.abs(val) < SNAP ? 0 : val
      })
      if (dists.every((val) => val >= 0)) continue
      const clipped: number[] = []
      for (const [idx, vert] of polygon.entries()) {
        const next_idx = (idx + 1) % polygon.length
        if (dists[idx] >= 0 && clipped.at(-1) !== vert) clipped.push(vert)
        if (dists[idx] >= 0 === dists[next_idx] >= 0) continue
        const next = polygon[next_idx]
        // n_out < 2^26 (the triangle budget), so the pair key stays an exact integer
        const key = Math.min(vert, next) * 2 ** 26 + Math.max(vert, next)
        let cut = cut_points[plane].get(key)
        if (cut === undefined) {
          // one end is inside (distance >= 0), the other outside (< 0): a weight of 0 or 1
          // means the inside end lies on the plane, so it is the cut point
          const weight = dists[idx] / (dists[idx] - dists[next_idx])
          if (weight === 0) cut = vert
          else if (weight === 1) cut = next
          else {
            for (let col = 0; col < 6; col++)
              scratch[col] =
                out[6 * vert + col] + weight * (out[6 * next + col] - out[6 * vert + col])
            scratch[3 + axis] = bound
            cut = add_vertex(scratch)
          }
          cut_points[plane].set(key, cut)
        }
        if (clipped.at(-1) !== cut) clipped.push(cut)
      }
      if (clipped.length > 1 && clipped[0] === clipped.at(-1)) clipped.pop()
      polygon = clipped
    }
    for (let idx = 1; idx + 1 < polygon.length; idx++)
      emit(polygon[0], polygon[idx], polygon[idx + 1])
  }
  // global grid-edge ids of the tiled cells' face vertices, shifted to be non-negative
  const cell_min = [0, 1, 2].map((axis) => Math.min(...cells.map((cell) => cell[axis])))
  const spans = [0, 1, 2].map(
    (axis) =>
      (Math.max(...cells.map((cell) => cell[axis])) - cell_min[axis] + 1) * dims[axis] + 1,
  )
  const welded = new Map<number, number>()
  const image = new Int32Array(n_verts)
  const flip = det_3x3(lattice) < 0 // marching cubes wound the triangles in index space
  for (const cell of cells) {
    const shift = [...to_cart(cell), ...to_frame(cell)]
    const lower = range.map(([bound], axis) => bound - SNAP - shift[3 + axis])
    const upper = range.map(([, bound], axis) => bound + SNAP - shift[3 + axis])
    image.fill(-1)
    const vertex = (vert: number): number => {
      if (image[vert] >= 0) return image[vert]
      const axis = edges[4 * vert + 3]
      let key = axis
      let on_face = false
      for (let col = 0; col < 3; col++) {
        const end = edges[4 * vert + col]
        on_face ||= col !== axis && (end === 0 || end === dims[col])
        key = key * spans[col] + end + (cell[col] - cell_min[col]) * dims[col]
      }
      const known = on_face ? welded.get(key) : undefined
      if (known !== undefined) return (image[vert] = known)
      for (let col = 0; col < 6; col++) scratch[col] = unit[6 * vert + col] + shift[col]
      image[vert] = add_vertex(scratch)
      if (on_face) welded.set(key, image[vert])
      return image[vert]
    }
    for (let tri = 0; tri < indices.length; tri += 3) {
      const vert_a = indices[tri]
      const vert_b = indices[tri + (flip ? 2 : 1)]
      const vert_c = indices[tri + (flip ? 1 : 2)]
      // in unit frame fractions: all three beyond one face plane (drop), all inside the window
      // (keep whole) or straddling (clip)
      let inside = true
      let dropped = false
      for (let axis = 0; axis < 3; axis++) {
        const frac_a = unit[6 * vert_a + 3 + axis]
        const frac_b = unit[6 * vert_b + 3 + axis]
        const frac_c = unit[6 * vert_c + 3 + axis]
        const lo = lower[axis]
        const hi = upper[axis]
        if (
          (frac_a < lo && frac_b < lo && frac_c < lo) ||
          (frac_a > hi && frac_b > hi && frac_c > hi)
        )
          dropped = true
        inside &&=
          Math.min(frac_a, frac_b, frac_c) >= lo && Math.max(frac_a, frac_b, frac_c) <= hi
      }
      if (dropped) continue
      if (inside) emit(vertex(vert_a), vertex(vert_b), vertex(vert_c))
      else clip_polygon([vertex(vert_a), vertex(vert_b), vertex(vert_c)])
    }
  }
  // keep only the vertices the triangles use, at origin + offset in f32
  const remap = new Int32Array(n_out).fill(-1)
  const positions = new Float32Array(3 * n_out)
  const tris = out_tris.slice(0, n_tri_idx)
  let n_used = 0
  for (let idx = 0; idx < tris.length; idx++) {
    const vert = tris[idx]
    if (remap[vert] < 0) {
      remap[vert] = n_used
      for (let col = 0; col < 3; col++)
        positions[3 * n_used + col] = origin[col] + out[6 * vert + col]
      n_used++
    }
    tris[idx] = remap[vert]
  }
  return { positions: positions.slice(0, 3 * n_used), indices: tris }
}

// Double a typed array's capacity, keeping its contents
const grow = <Arr extends Float64Array | Uint32Array>(array: Arr): Arr => {
  const next = new (array.constructor as new (length: number) => Arr)(2 * array.length)
  next.set(array)
  return next
}

// A periodic volume's surface over its window. Over MAX_SURFACE_TRIANGLES estimated, the unit
// grid is resampled coarser (triangle counts scale with its points per axis squared) until
// the estimate fits.
function tiled_surface(
  grid: ScalarGrid3D<Float64Array>,
  isovalue: number,
  lattice: Matrix3x3,
  origin: Vec3,
  clip: SurfaceClip,
): Mesh {
  // cost in unit-cell surfaces: the window's volume in cells, plus a tenth per tiled cell for
  // culling its triangles (measured ~8 ns per triangle vs ~80 ns per emitted one)
  const n_cells =
    Math.abs(det_3x3(clip.frame)) *
      clip.range.reduce((prod, [lower, upper]) => prod * (upper - lower), 1) +
    clip.cells.length / 10
  let [unit_grid, unit] = [grid, unit_surface(grid, isovalue)]
  for (
    let estimate = (n_cells * unit.indices.length) / 3;
    estimate > MAX_SURFACE_TRIANGLES && unit_grid.dims.some((dim) => dim > 2);
    estimate = (n_cells * unit.indices.length) / 3
  ) {
    const scale = Math.min(Math.sqrt(MAX_SURFACE_TRIANGLES / estimate), 0.9)
    const dims = unit_grid.dims.map((dim) => Math.max(2, Math.floor(dim * scale))) as Vec3
    unit_grid = resample_periodic(grid, dims)
    unit = unit_surface(unit_grid, isovalue)
  }
  return tile_and_clip(unit, unit_grid.dims, lattice, origin, clip)
}

export interface GeometryInput {
  volumes: GeometryVolumeJob[]
}

interface GeometrySurfaceResult {
  token: string
  positions: Float32Array
  indices: Uint32Array
  marching_cubes_ms: number
}

export interface GeometryResult {
  surfaces: GeometrySurfaceResult[]
}

export const compute_isosurface_geometries = (input: GeometryInput): GeometryResult => ({
  surfaces: input.volumes.flatMap(({ grid, lattice, origin, clip, surfaces }) =>
    surfaces.map(({ token, isovalue }): GeometrySurfaceResult => {
      const marching_start = performance.now()
      const { positions, indices } = clip
        ? tiled_surface(grid, isovalue, lattice, origin, clip)
        : marching_cubes(grid, isovalue, lattice, {
            periodic: false, // finite display window in scene coordinates
            normals: false, // BufferGeometry.computeVertexNormals() on the main thread
            position_offset: origin,
          })
      // Front faces must point away from the enclosed lobe for the transparent back-then-front
      // pass and winding-derived normals; a negative lobe encloses values below the isovalue
      if (isovalue < 0) {
        for (let idx = 0; idx < indices.length; idx += 3)
          indices.subarray(idx + 1, idx + 3).reverse()
      }
      return {
        token,
        positions,
        indices,
        marching_cubes_ms: performance.now() - marching_start,
      }
    }),
  ),
})

// Buffers a worker can hand back by ownership transfer instead of copying
export const geometry_result_transferables = (result: GeometryResult): Transferable[] =>
  result.surfaces.flatMap((surface) => [surface.positions.buffer, surface.indices.buffer])
