// Planes inside the unit cell: (hkl) lattice planes drawn e.g. to show where a surface slab is
// cut, plus the generic clipper that turns `coeffs · frac = level` into a Cartesian polygon
// (also used for mirror and glide planes by #lib/symmetry). Miller indices refer to the basis
// of the drawn cell; in fractional coordinates the plane at `offset` is h·x + k·y + l·z =
// offset, so integer offsets are the lattice planes of the family and neighbouring integers
// sit one interplanar spacing d_hkl apart.
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'

// Cell-aligned overlays cannot follow standardized cells without a coordinate transformation.
export const OVERLAYS_INPUT_FRAME_NOTE = `Cell-aligned overlays and cutaways are shown only in the original (input) cell`

export interface LatticePlane {
  hkl: Vec3
  // Plane positions in units of d_hkl. Default: every lattice plane that cuts the cell.
  offsets?: number[]
  color?: string
  opacity?: number
}

// A whole family is drawn by default: |h|+|k|+|l|+1 planes. The cap sits where the cost bites
// (measured: 1e5 planes clip and mesh in ~250 ms / 600k vertices, 1e6 in seconds) and above
// anything the slab builder can produce (MAX_SLAB_SITES stops it near 4e4 planes), so a typo
// like (1000000) fails fast instead of hanging the scene or exceeding the max array length
export const MAX_AUTO_PLANES = 100_000

// Integer offsets whose plane crosses the unit cell: the extreme values of h·x + k·y + l·z
// over the cell are reached at corners, i.e. the sums of the negative and positive indices.
function lattice_plane_offsets(hkl: Vec3): number[] {
  const lower = hkl.reduce((sum, val) => sum + Math.min(val, 0), 0)
  const upper = hkl.reduce((sum, val) => sum + Math.max(val, 0), 0)
  const n_planes = upper - lower + 1
  if (n_planes > MAX_AUTO_PLANES) {
    throw new Error(
      `(${hkl.join(` `)}) has ${n_planes} lattice planes in the cell, more than the ${MAX_AUTO_PLANES} drawn automatically; pass explicit offsets to pick a subset`,
    )
  }
  return Array.from({ length: n_planes }, (_, idx) => lower + idx)
}

// Block-frame Miller indices scale with cell repeats, preserving spacing and orientation.
// Explicit offsets retain their planes; automatic offsets enumerate the whole block.
export const tile_lattice_planes = (planes: LatticePlane[], tiling: Vec3): LatticePlane[] =>
  tiling.every((count) => count === 1)
    ? planes
    : planes.map((plane) => ({
        ...plane,
        hkl: plane.hkl.map(
          (index, axis) => index * Math.max(1, Math.floor(tiling[axis])),
        ) as Vec3,
      }))

// Cartesian polygons of the planes in `plane` clipped to the cell. Planes that miss the cell
// or only touch a corner or an edge come back empty from the clipper and are dropped, and a
// repeated offset is drawn once (coincident translucent fills would stack up opaque).
export function lattice_plane_polygons(
  plane: LatticePlane,
  lattice: Matrix3x3,
): { offset: number; polygon: Vec3[] }[] {
  const { hkl, offsets } = plane
  math.validate_miller_indices(hkl)
  return [...new Set(offsets ?? lattice_plane_offsets(hkl))]
    .map((offset) => ({ offset, polygon: clip_frac_plane_to_cell(hkl, offset, lattice) }))
    .filter(({ polygon }) => polygon.length > 0)
}

// Clip the plane `coeffs · frac = level` (fractional coordinates, so integer coeffs are
// Miller indices and integer levels are the lattice planes of that family) to the unit
// cell, returning the Cartesian polygon vertices counter-clockwise about the plane normal
// h·b₁ + k·b₂ + l·b₃ (empty if the plane misses the cell or only touches a corner or an edge).
export function clip_frac_plane_to_cell(
  coeffs: Vec3,
  level: number,
  lattice: Matrix3x3,
): Vec3[] {
  // Clipped in fractional coordinates, where the cell is the unit cube. Corners closer than
  // dedup tolerance collapse into one: a plane passing just outside the on-plane tolerance of
  // a corner would otherwise cross all three of its edges and yield a sliver triangle.
  const frac_polygon = math.plane_polyhedron_section(math.UNIT_CUBE_EDGES, coeffs, level, {
    plane_tol: 1e-7,
    merge_tol: 1e-6,
  })
  const to_cart = math.create_frac_to_cart(lattice)
  const polygon = frac_polygon.map((frac) => to_cart(frac))
  // The linear map to Cartesian keeps the winding about the normal unless it mirrors
  return math.det_3x3(lattice) < 0 ? polygon.toReversed() : polygon
}

// Vertices of the fan triangulation of a convex polygon, three per triangle, for a
// non-indexed BufferGeometry position attribute
export const polygon_fan_vertices = (polygon: Vec3[]): Vec3[] =>
  polygon.slice(1, -1).flatMap((vert, idx) => [polygon[0], vert, polygon[idx + 2]])

// Vertex pairs of the polygon outline, one pair per edge, for a LineSegments geometry
export const polygon_edge_vertices = (polygon: Vec3[]): Vec3[] =>
  polygon.flatMap((vert, idx) => [vert, polygon[(idx + 1) % polygon.length]])
