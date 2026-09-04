// Planes inside the unit cell: (hkl) lattice planes drawn e.g. to show where a surface slab is
// cut, plus the generic clipper that turns `coeffs · frac = level` into a Cartesian polygon
// (also used for mirror and glide planes by $lib/symmetry). Miller indices refer to the basis
// of the drawn cell; in fractional coordinates the plane at `offset` is h·x + k·y + l·z =
// offset, so integer offsets are the lattice planes of the family and neighbouring integers
// sit one interplanar spacing d_hkl apart.
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'

// Like symmetry elements, planes are indexed in the input cell and blanked in other frames;
// the structure viewer toasts this whenever either overlay is on and the cell leaves that frame
export const OVERLAYS_INPUT_FRAME_NOTE = `Symmetry elements and lattice planes are drawn only in the original (input) cell`

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
  const lo = hkl.reduce((sum, val) => sum + Math.min(val, 0), 0)
  const hi = hkl.reduce((sum, val) => sum + Math.max(val, 0), 0)
  const n_planes = hi - lo + 1
  if (n_planes > MAX_AUTO_PLANES) {
    throw new Error(
      `(${hkl.join(` `)}) has ${n_planes} lattice planes in the cell, more than the ${MAX_AUTO_PLANES} drawn automatically; pass explicit offsets to pick a subset`,
    )
  }
  return Array.from({ length: n_planes }, (_, idx) => lo + idx)
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

// The 12 edges of the unit cube [0,1]³: every corner joins, along each of its zero
// coordinates, the corner with that coordinate set to 1 (8 corners, 3 - #ones edges each)
const UNIT_CUBE_CORNERS: Vec3[] = [0, 1].flatMap((x) =>
  [0, 1].flatMap((y) => [0, 1].map((z): Vec3 => [x, y, z])),
)
const UNIT_CUBE_EDGES: readonly (readonly [Vec3, Vec3])[] = UNIT_CUBE_CORNERS.flatMap(
  (corner) =>
    corner.flatMap((val, dim) =>
      val === 0 ? [[corner, corner.with(dim, 1) as Vec3] as const] : [],
    ),
)

// Clip the plane `coeffs · frac = level` (fractional coordinates, so integer coeffs are
// Miller indices and integer levels are the lattice planes of that family) to the unit
// cell, returning the Cartesian polygon vertices in winding order (empty if the plane
// misses the cell or only touches a corner or an edge).
export function clip_frac_plane_to_cell(
  coeffs: Vec3,
  level: number,
  lattice: Matrix3x3,
): Vec3[] {
  const tol = 1e-7
  // Vertices closer than this (fractional) collapse into one: a plane passing just outside
  // `tol` of a corner would otherwise cross all three of its edges and yield a sliver triangle
  const dedup_tol = 1e-6
  const signed_dist = (frac: Vec3) => math.dot(coeffs, frac) - level
  const frac_points: Vec3[] = []
  const push_unique = (frac: Vec3) => {
    if (!frac_points.some((seen) => math.euclidean_dist(seen, frac) < dedup_tol)) {
      frac_points.push(frac)
    }
  }
  // Corners on the plane, plus interior crossings of the 12 cell edges
  for (const [corner_a, corner_b] of UNIT_CUBE_EDGES) {
    const [dist_a, dist_b] = [signed_dist(corner_a), signed_dist(corner_b)]
    const [on_a, on_b] = [Math.abs(dist_a) < tol, Math.abs(dist_b) < tol]
    if (on_a) push_unique(corner_a)
    if (on_b) push_unique(corner_b)
    if (!on_a && !on_b && dist_a * dist_b < 0) {
      const frac_t = dist_a / (dist_a - dist_b)
      push_unique(corner_a.map((val, dim) => val + frac_t * (corner_b[dim] - val)) as Vec3)
    }
  }
  if (frac_points.length < 3) return []
  const cart_points = frac_points.map(math.create_frac_to_cart(lattice))

  // Order vertices by angle around the centroid within the plane; only the direction of the
  // plane normal matters here
  const centroid = math.scale(math.add(...cart_points), 1 / cart_points.length)
  const normal_unit = math.normalize_vec(math.miller_plane_normal(lattice, coeffs))
  const ref_vec = math.normalize_vec(math.subtract(cart_points[0], centroid))
  const cross_ref = math.cross_3d(normal_unit, ref_vec)
  return cart_points
    .map((vert) => {
      const rel = math.subtract(vert, centroid)
      return { vert, angle: Math.atan2(math.dot(rel, cross_ref), math.dot(rel, ref_vec)) }
    })
    .toSorted((pt_a, pt_b) => pt_a.angle - pt_b.angle)
    .map(({ vert }) => vert)
}

// Vertices of the fan triangulation of a convex polygon, three per triangle, for a
// non-indexed BufferGeometry position attribute
export const polygon_fan_vertices = (polygon: Vec3[]): Vec3[] =>
  polygon.slice(1, -1).flatMap((vert, idx) => [polygon[0], vert, polygon[idx + 2]])

// Vertex pairs of the polygon outline, one pair per edge, for a LineSegments geometry
export const polygon_edge_vertices = (polygon: Vec3[]): Vec3[] =>
  polygon.flatMap((vert, idx) => [vert, polygon[(idx + 1) % polygon.length]])
