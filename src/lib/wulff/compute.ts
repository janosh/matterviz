// Wulff construction: the equilibrium shape of a crystal is the inner envelope of the planes
// n·x = γ(n) over every facet normal n, i.e. the intersection of the half-spaces n·x ≤ γ(n).
import { format_num } from 'svelte-widgets/format'
import { compute_convex_hull } from '#lib/brillouin/compute.js'
import { lattice_point_group_matrices } from '#lib/fermi-surface/symmetry.js'
import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import type { WulffFacet, WulffFacetInput, WulffFamily, WulffShapeData } from './types'

// A vertex within this of a plane lies on it; lengths are normalized to the farthest plane.
// compute_convex_hull merges dual faces within 1e-9, so a family within ~1e-5 relative γ of its
// critical value can read as absent; the area it loses there is below ~1e-10.
const PLANE_TOL = 1e-8
// Relative lattice distortion a point-group rotation may leave, both when finding the lattice
// holohedry and when checking a given point group: accepts cells rounded to 3 decimals, rejects
// a 4-fold on a c/a = 1.001 cell and any rotation given in the wrong convention
const WULFF_SYMPREC = 5e-4
// every shape's volume: a sphere of equal volume has radius 1
const WULFF_VOLUME = (4 * Math.PI) / 3

// Integer rotations W (acting on fractional coordinates, as moyo's point_group_rotations) of
// the lattice holohedry: 48 for cubic, 24 hexagonal, ... The point group pymatgen's WulffShape
// expands families with, and an upper bound on any crystal's.
export const lattice_holohedry = (lattice: Matrix3x3): Matrix3x3[] => {
  const lattice_t = math.transpose_3x3(lattice)
  const lattice_t_inv = math.reciprocal_lattice(lattice) // A⁻ᵀ
  return lattice_point_group_matrices(lattice, WULFF_SYMPREC).map((mat) => {
    // the 3x3 block of a column-major 4x4
    const rot = math.mat3x3_from_flat_col_major(
      [0, 1, 2, 4, 5, 6, 8, 9, 10].map((idx) => mat[idx]),
    )
    // Cartesian R = Aᵀ·W·A⁻ᵀ, so W = A⁻ᵀ·R·Aᵀ, integer up to the lattice's own rounding
    const frac = math.dot(math.dot(lattice_t_inv, rot), lattice_t)
    return frac.map((row) => row.map((val) => Math.round(val) + 0)) as Matrix3x3
  })
}

// `point_group` must be a group (identity, closed under products: the Wᵀ orbits below rely on
// it) of integer matrices preserving the metric G = A·Aᵀ, each entry of Wᵀ·G·W - G within
// WULFF_SYMPREC of √(Gᵢᵢ·Gⱼⱼ): else an operation is no symmetry of this lattice, or Cartesian
// rather than fractional
function assert_lattice_point_group(lattice: Matrix3x3, point_group: Matrix3x3[]): void {
  const metric = math.dot(lattice, math.transpose_3x3(lattice))
  for (const rot of point_group) {
    const image = math.dot(math.dot(math.transpose_3x3(rot), metric), rot)
    const deviation = math.array_max(
      image.flatMap((row, idx) =>
        row.map(
          (val, jdx) =>
            Math.abs(val - metric[idx][jdx]) / Math.sqrt(metric[idx][idx] * metric[jdx][jdx]),
        ),
      ),
    )
    if (rot.flat().some((val) => !Number.isInteger(val)) || deviation > WULFF_SYMPREC) {
      throw new Error(
        `Point-group operation ${JSON.stringify(rot)} is not an integer symmetry of lattice ${JSON.stringify(lattice)} (relative metric deviation ${format_num(deviation, `.2~e`)}); pass fractional rotations as moyo's point_group_rotations gives them`,
      )
    }
  }
  const keys = new Set(point_group.map((rot) => rot.flat().join(`,`)))
  const products_closed = point_group.every((left) =>
    point_group.every((right) => keys.has(math.dot(left, right).flat().join(`,`))),
  )
  if (!keys.has(`1,0,0,0,1,0,0,0,1`) || !products_closed) {
    throw new Error(
      `The ${point_group.length} point-group operations do not form a group (identity and all products)`,
    )
  }
}

type WulffPlane = { family_idx: number; miller: Vec3; normal: Vec3; dist: number }
type PlaneDirection = Omit<WulffPlane, `dist`>

// Every symmetry-equivalent plane of each family. A rotation W of fractional
// coordinates maps (hkl) to W⁻ᵀ·hkl; over a group that orbit equals the one under Wᵀ, which stays
// exactly integer. Planes are keyed by their gcd-reduced indices, so (100) and (200), or (100)
// and (010) in a cubic crystal, are one family that cannot take two surface energies.
function expand_families(
  lattice: Matrix3x3,
  millers: Vec3[],
  point_group: Matrix3x3[],
): PlaneDirection[] {
  const lattice_inv = math.inverse_3x3(lattice) // throws for a singular lattice
  const owners = new Map<string, PlaneDirection>()
  for (const [family_idx, miller] of millers.entries()) {
    for (const rot of point_group) {
      const hkl = math
        .mul_3x3_vec3(math.transpose_3x3(rot), miller)
        .map((val) => val + 0) as Vec3
      const key = math.reduce_miller_indices(hkl).join(`,`)
      const owner = owners.get(key)
      if (owner?.family_idx === family_idx) continue
      if (owner) {
        const other = millers[owner.family_idx]
        throw new Error(
          other.join(`,`) === miller.join(`,`)
            ? `Facet (${miller.join(` `)}) appears twice`
            : `Facets (${miller.join(` `)}) and (${other.join(` `)}) are symmetry-equivalent (plane (${owner.miller.join(` `)})), so they cannot have separate surface energies`,
        )
      }
      // the plane normal is the reciprocal vector G = A⁻¹·hkl
      const g_vec = math.dot(lattice_inv, hkl)
      const normal = math.scale(g_vec, 1 / Math.hypot(...g_vec))
      owners.set(key, { family_idx, miller: hkl, normal })
    }
  }
  return [...owners.values()]
}

// The planes' intersection is bounded iff their normals leave no direction r with n·r ≤ 0 for
// all n, i.e. the origin lies strictly inside the convex hull of the normals. A hull needs
// normals spanning 3D, checked via the scatter matrix Σ n·nᵀ (singular iff they are coplanar).
function assert_normals_span_3d(planes: PlaneDirection[]): void {
  const scatter = [0, 1, 2].map((row) =>
    [0, 1, 2].map((col) =>
      planes.reduce((sum, { normal }) => sum + normal[row] * normal[col], 0),
    ),
  ) as Matrix3x3
  // det over (trace/3)³ is scale-free: 1 for isotropic normals, 0 for coplanar ones
  const trace = scatter[0][0] + scatter[1][1] + scatter[2][2]
  if (math.det_3x3(scatter) / (trace / 3) ** 3 > 1e-9) return
  throw new Error(
    `Wulff shape is unbounded: all ${planes.length} facet normals lie in one plane, so the shape is open perpendicular to them. Add a family whose normal points out of that plane.`,
  )
}

// The energy-independent part of compute_wulff_shape (point-group checks, symmetry expansion,
// boundedness), kept for the last lattice, families and point group: a γ slider tick reuses it
let last_expansion: { key: string; ops: Matrix3x3[]; directions: PlaneDirection[] } | null =
  null
function expand_cached(lattice: Matrix3x3, millers: Vec3[], point_group?: Matrix3x3[]) {
  const key = JSON.stringify([lattice, millers, point_group ?? null])
  if (last_expansion?.key === key) return last_expansion
  // after validation: the holohedry search inverts the lattice
  const ops = point_group ?? lattice_holohedry(lattice)
  assert_lattice_point_group(lattice, ops)
  const directions = expand_families(lattice, millers, ops)
  assert_normals_span_3d(directions)
  last_expansion = { key, ops, directions }
  return last_expansion
}

// Polygon of the shape's vertices on plane `normal`: ordered counter-clockwise seen from
// outside (by angle about the centroid in the basis u, n×u, n) with its area
function facet_polygon(
  vertices: Vec3[],
  on_plane: number[],
  normal: Vec3,
): { vertex_indices: number[]; area: number } {
  const points = on_plane.map((idx) => vertices[idx])
  const centroid = math.scale(math.add(...points), 1 / points.length)
  const offsets = points.map((point) => math.subtract(point, centroid))
  const axis_u = math.scale(offsets[0], 1 / Math.hypot(...offsets[0]))
  const axis_w = math.cross_3d(normal, axis_u)
  const angles = offsets.map((off) => Math.atan2(math.dot(off, axis_w), math.dot(off, axis_u)))
  const order = on_plane
    .map((_, idx) => idx)
    .toSorted((idx_a, idx_b) => angles[idx_a] - angles[idx_b])
  let twice_area = 0
  for (const [pos, idx] of order.entries()) {
    const next = order[(pos + 1) % order.length]
    twice_area += math.dot(math.cross_3d(offsets[idx], offsets[next]), normal)
  }
  return { vertex_indices: order.map((idx) => on_plane[idx]), area: twice_area / 2 }
}

// Equilibrium (Wulff) shape of a crystal with `lattice` (rows a, b, c in Å) and surface
// energies per Miller family. Each family is expanded to its symmetry-equivalent planes with
// `point_group`: integer rotations of fractional coordinates (moyo's point_group_rotations of
// the crystal, so a polar crystal keeps (hkl) and (h̄k̄l̄) apart), defaulting to the lattice
// holohedry as in pymatgen. The half-space intersection is found through polar duality:
// plane n·x = d maps to the point n/d, the planes bounding the shape are the vertices of the
// convex hull of those points, and each hull face {y : x·y = 1} is a corner x of the shape.
// A family with a `slope` takes γ = energy + slope·delta_mu (see WulffFacetInput).
export function compute_wulff_shape(
  lattice: Matrix3x3,
  facets: WulffFacetInput[],
  { point_group, delta_mu = 0 }: { point_group?: Matrix3x3[]; delta_mu?: number } = {},
): WulffShapeData {
  if (facets.length === 0) throw new Error(`Wulff shape needs at least one facet family`)
  if (lattice.flat().some((val) => !Number.isFinite(val))) {
    throw new Error(`Lattice has non-finite entries: ${JSON.stringify(lattice)}`)
  }
  const energies = facets.map(({ miller, energy, slope = 0 }) => {
    math.validate_miller_indices(miller)
    const gamma = energy + slope * delta_mu
    if (Number.isFinite(gamma) && gamma > 0) return gamma
    const at = slope === 0 ? `` : ` at Δμ = ${delta_mu} eV`
    throw new Error(
      `Surface energy of (${miller.join(` `)})${at} must be a positive number, got ${gamma}`,
    )
  })
  const { ops, directions } = expand_cached(
    lattice,
    facets.map(({ miller }) => miller),
    point_group,
  )
  const max_energy = Math.max(...energies)
  const planes: WulffPlane[] = directions.map((plane) => ({
    ...plane,
    dist: energies[plane.family_idx] / max_energy,
  }))

  const dual_points = planes.map(({ normal, dist }) => math.scale(normal, 1 / dist))
  const dual_hull = compute_convex_hull(dual_points, 0)
  // hull vertices are bit-exact copies of the dual points; match each back to its plane
  const plane_by_point = new Map(dual_points.map((point, idx) => [point.join(`,`), idx]))
  const plane_of = dual_hull.vertices.map((point) => {
    const plane_idx = plane_by_point.get(point.join(`,`))
    if (plane_idx === undefined) throw new Error(`Dual hull vertex ${point} matches no plane`)
    return plane_idx
  })

  // A corner per dual face: the point where its three planes meet. The origin
  // must lie strictly inside the dual hull, else the shape is open along that face's normal.
  const vertices: Vec3[] = []
  for (const face of dual_hull.faces) {
    const [plane_a, plane_b, plane_c] = face.map((vert_idx) => planes[plane_of[vert_idx]])
    const [q_a, q_b, q_c] = face.map((vert_idx) => dual_hull.vertices[vert_idx])
    const face_normal = math.cross_3d(math.subtract(q_b, q_a), math.subtract(q_c, q_a))
    if (math.dot(face_normal, q_a) <= 1e-9 * Math.hypot(...face_normal) * Math.hypot(...q_a)) {
      const open_dir = math.scale(face_normal, 1 / Math.hypot(...face_normal))
      throw new Error(
        `Wulff shape is unbounded: no facet family cuts direction [${open_dir.map((val) => format_num(val, `.3~f`)).join(`, `)}]. Add a family whose normal points that way.`,
      )
    }
    const corner = math.mul_3x3_vec3(
      math.inverse_3x3([plane_a.normal, plane_b.normal, plane_c.normal]),
      [plane_a.dist, plane_b.dist, plane_c.dist],
    )
    // four or more planes through one corner give it once per dual triangle
    if (!vertices.some((vert) => math.euclidean_dist(vert, corner) < PLANE_TOL)) {
      vertices.push(corner)
    }
  }

  // Each plane's corners form its facet; planes that only touch an edge or corner get none
  const facets_out: WulffFacet[] = []
  for (const plane_idx of new Set(plane_of)) {
    const { family_idx, miller, normal, dist } = planes[plane_idx]
    const on_plane = vertices.flatMap((vert, idx) =>
      Math.abs(math.dot(vert, normal) - dist) < PLANE_TOL ? [idx] : [],
    )
    if (on_plane.length < 3) continue
    const polygon = facet_polygon(vertices, on_plane, normal)
    facets_out.push({ family_idx, miller, normal, dist, ...polygon })
  }
  // The construction fixes the shape, not its size: scale it to a unit sphere's volume, so it
  // keeps its size while energies change (distances of γ/γ_max shrank it whenever an absent
  // family's γ rose). V = Σ d·A / 3 sums pyramids from the origin over every facet.
  const volume = facets_out.reduce((sum, { dist, area }) => sum + dist * area, 0) / 3
  const scale = Math.cbrt(WULFF_VOLUME / volume)
  for (const [idx, vert] of vertices.entries()) vertices[idx] = math.scale(vert, scale)
  for (const facet of facets_out) {
    facet.dist *= scale
    facet.area *= scale ** 2
  }
  const surface_area = facets_out.reduce((sum, { area }) => sum + area, 0)

  const families: WulffFamily[] = facets.map(({ miller }, family_idx) => {
    const own = facets_out.filter((facet) => facet.family_idx === family_idx)
    const area = own.reduce((sum, facet) => sum + facet.area, 0)
    return {
      miller,
      energy: energies[family_idx],
      multiplicity: planes.filter((plane) => plane.family_idx === family_idx).length,
      n_facets: own.length,
      area,
      area_fraction: area / surface_area,
    }
  })
  // area-weighted mean of a per-family quantity
  const area_mean = (value: (family: WulffFamily) => number) =>
    families.reduce((sum, family) => sum + value(family) * family.area_fraction, 0)
  const weighted_surface_energy = area_mean(({ energy }) => energy)
  const variance = area_mean(({ energy }) => (energy - weighted_surface_energy) ** 2)

  // every facet edge once, keyed by its sorted vertex pair
  const edges = new Map<string, Vec2>()
  for (const { vertex_indices } of facets_out) {
    for (const [pos, from] of vertex_indices.entries()) {
      const to = vertex_indices[(pos + 1) % vertex_indices.length]
      const key = from < to ? `${from},${to}` : `${to},${from}`
      if (!edges.has(key)) edges.set(key, [from, to])
    }
  }

  return {
    vertices,
    facets: facets_out,
    edges: [...edges.values()],
    families,
    surface_area,
    weighted_surface_energy,
    shape_factor: surface_area / WULFF_VOLUME ** (2 / 3),
    anisotropy: Math.sqrt(variance) / weighted_surface_energy,
    point_group: ops,
  }
}
