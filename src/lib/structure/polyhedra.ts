import { BondFrame, type BondData } from './bond-rendering'
import { get_orig_site_idx, get_site, numeric_sites, site_count } from './site'
import { element_from_atomic_number } from '#lib/element/helpers.js'
import { get_element_counts } from './density'
// Coordination polyhedra detection and mesh generation.
// Self-contained: vertices come from the rendered bond graph, hulls from a custom
// quickhull tailored to small point sets (CN 4-12), output as merged typed arrays
// so the whole scene renders in 1-2 draw calls regardless of supercell size.
// Hot paths use scalar math and per-element caches to scale to large structures.

import type { ElementSymbol } from '#lib/element/index.js'
import { element_by_symbol } from '#lib/element/data.js'
import type { Vec3 } from '#lib/math.js'
import { array_extent, array_max, grow_capacity } from '#lib/math.js'
import { DEFAULTS } from '#lib/settings.js'
import type { AnyStructure } from '#lib/structure/index.js'
import { css_to_linear_rgb } from '#lib/scene/colors.js'
import type { InterleavedBuffer, InterleavedBufferAttribute } from 'three/webgpu'
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Line2NodeMaterial,
  Sphere,
} from 'three/webgpu'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { get_majority_element, has_framework_potential, is_spectator_center } from './bonding'

export type PolyhedraColorMode = `vertex` | `center` | `uniform`

// Screen-space fat line segments (polyhedra outlines, host-run trajectory trails): they stay
// pronounced when zooming out, independently of face opacity. The caller owns disposal of the
// returned geometry and material.
export function create_fat_segments(
  positions: Float32Array,
  colors: Float32Array,
): LineSegments2 {
  const geometry = new LineSegmentsGeometry().setPositions(positions).setColors(colors)
  const material = new Line2NodeMaterial({
    vertexColors: true,
    linewidth: 1,
    worldUnits: false,
  })
  const edges = new LineSegments2(geometry, material)
  edges.frustumCulled = false
  edges.raycast = () => undefined
  return edges
}

// Keep the mesh/material and GPU attributes across frames. Only growth replaces geometry;
// shrinking changes instanceCount so unused capacity never appears in the rendered lines.
export function update_fat_segments(
  edges: LineSegments2,
  positions: Float32Array,
  colors: Float32Array,
): void {
  const capacity = edges.geometry.getAttribute(`instanceStart`).count * 6
  if (positions.length > capacity) {
    const length = grow_capacity(capacity / 6, positions.length / 6) * 6
    const geometry = new LineSegmentsGeometry()
      .setPositions(new Float32Array(length))
      .setColors(new Float32Array(length))
    edges.geometry.dispose()
    edges.geometry = geometry
  }
  for (const [name, values] of [
    [`instanceStart`, positions],
    [`instanceColorStart`, colors],
  ] as const) {
    const { data } = edges.geometry.getAttribute(name) as InterleavedBufferAttribute
    overwrite(data.setUsage(DynamicDrawUsage), values)
  }
  edges.geometry.instanceCount = positions.length / 6
  set_bounds(edges.geometry, positions)
}

// Merged polyhedra faces as one geometry kept across frames: attributes are overwritten in
// place and the draw range trimmed. Returns `geometry` itself unless it is null or too small,
// in which case it is disposed and replaced by a new one with 1.5x headroom.
export function update_polyhedra_faces(
  geometry: BufferGeometry | null,
  buffers: Pick<MergedPolyhedraBuffers, `positions` | `normals` | `colors`>,
): BufferGeometry {
  const { positions, normals, colors } = buffers
  const capacity = geometry?.getAttribute(`position`).array.length ?? 0
  const grow = !geometry || positions.length > capacity
  if (grow) geometry?.dispose()
  const target = grow ? new BufferGeometry() : geometry
  const length = grow_capacity(capacity / 9, positions.length / 9) * 9
  const attributes = { position: positions, normal: normals, color: colors }
  for (const [name, values] of Object.entries(attributes)) {
    if (grow) {
      const attribute = new BufferAttribute(new Float32Array(length), 3)
      target.setAttribute(name, attribute.setUsage(DynamicDrawUsage))
    }
    overwrite(target.getAttribute(name) as BufferAttribute, values)
  }
  target.setDrawRange(0, positions.length / 3)
  set_bounds(target, positions)
  return target
}

// Overwrite the leading values of a kept buffer and upload only that range
function overwrite(buffer: BufferAttribute | InterleavedBuffer, values: Float32Array): void {
  buffer.array.set(values)
  buffer.clearUpdateRanges()
  buffer.addUpdateRange(0, values.length)
  buffer.needsUpdate = true
}

// Bounds from the drawn positions only: the stock computeBounding* walk every capacity slot,
// stale data from earlier, larger frames included. The sphere encloses the box.
function set_bounds(geometry: BufferGeometry, positions: Float32Array): void {
  geometry.boundingBox = (geometry.boundingBox ?? new Box3()).setFromArray(positions)
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(
    geometry.boundingSphere ?? new Sphere(),
  )
}

export type PolyhedraNeighborMode = `anion` | `bonded`

export interface PolyhedraOptions {
  neighbor_mode?: PolyhedraNeighborMode // bonded includes covalent and metallic shells
  min_neighbors?: number // min coordination number to form a polyhedron
  max_neighbors?: number // max CN - skips e.g. CN-12 cuboctahedra around A-site cations
  excluded_center_elements?: readonly string[] // per-element off-toggles
  included_center_elements?: readonly string[] // force-include (bypasses spectator/weak hiding + max_neighbors cap)
  electronegativity_margin?: number // vertex must be > center EN + margin
}

// Worker results belong to one immutable bond snapshot. Filters or bond edits create a
// different graph; appearance changes leave this geometry reusable.
const polyhedra_options_key = (options: PolyhedraOptions): string =>
  JSON.stringify([
    options.neighbor_mode ?? DEFAULTS.structure.polyhedra_neighbor_mode,
    options.min_neighbors ?? DEFAULTS.structure.polyhedra_min_neighbors,
    options.max_neighbors ?? DEFAULTS.structure.polyhedra_max_neighbors,
    options.excluded_center_elements ?? [],
    options.included_center_elements ?? [],
    options.electronegativity_margin ?? 0,
  ])
const prepared_polyhedra = new WeakMap<BondFrame, { key: string; polyhedra: Polyhedron[] }>()
export const cache_prepared_polyhedra = (
  bonds: BondFrame,
  options: PolyhedraOptions,
  polyhedra: Polyhedron[],
): void => {
  prepared_polyhedra.set(bonds, { key: polyhedra_options_key(options), polyhedra })
}

// Species whose mean bond dist / covalent-radii sum exceeds this are hidden when a
// strongly-bound framework species exists (e.g. lone-pair Bi3+)
const WEAK_BOND_NORM = 1.15
// Degenerate means FLAT, not small, so this is a fraction of the hull's own extent cubed: an
// absolute A^3 cutoff kept a CN-6 ring puckered by 1 mA across 3 A (9e-3 A^3, nine times 1e-3).
const VOLUME_EPS = 1e-3

interface ConvexHullResult {
  vertices: Vec3[] // deduped subset of input points on the hull
  input_idxs: number[] // index into the input `points` for each hull vertex
  faces: [number, number, number][] // outward-wound triangles indexing `vertices`
  volume: number // 0 if degenerate (collinear/coplanar/<4 unique points)
}

export interface Polyhedron {
  center_site_idx: number // index into the displayed structure's sites
  center_orig_idx: number // original unit-cell site index (color + completeness key)
  center_element: ElementSymbol
  vertices: Vec3[] // hull vertex positions
  vertex_site_idxs: number[] // displayed-structure site for each hull vertex
  faces: [number, number, number][]
  volume: number
}

interface MergedPolyhedraBuffers {
  positions: Float32Array // 9 floats per triangle (non-indexed, flat-shaded)
  normals: Float32Array // flat per-face unit normals matching positions
  colors: Float32Array // per-vertex rgb matching positions
  edge_positions: Float32Array // 6 floats per crease edge for LineSegments
  edge_colors: Float32Array // per-endpoint rgb matching face vertex colors
  triangle_count: number
  edge_count: number
}

// === Convex hull (quickhull) ===

// Faces store unit normal components as scalars (nx, ny, nz) to avoid Vec3
// allocations in the visibility scans that dominate hull runtime.
type HullFace = {
  vert_a: number
  vert_b: number
  vert_c: number
  nx: number
  ny: number
  nz: number
  offset: number // plane offset: dot(normal, point_on_face)
  outside: number[] // candidate point indices strictly outside this face
  deleted: boolean
}

const face_of = (
  points: readonly Vec3[],
  vert_a: number,
  vert_b: number,
  vert_c: number,
): HullFace => {
  const [axis_x, axis_y, axis_z] = points[vert_a]
  const abx = points[vert_b][0] - axis_x
  const aby = points[vert_b][1] - axis_y
  const abz = points[vert_b][2] - axis_z
  const acx = points[vert_c][0] - axis_x
  const acy = points[vert_c][1] - axis_y
  const acz = points[vert_c][2] - axis_z
  let size_x = aby * acz - abz * acy
  let size_y = abz * acx - abx * acz
  let size_z = abx * acy - aby * acx
  const len = Math.hypot(size_x, size_y, size_z)
  if (len > 0) {
    size_x /= len
    size_y /= len
    size_z /= len
  } else [size_x, size_y, size_z] = [0, 0, 1]
  return {
    vert_a,
    vert_b,
    vert_c,
    nx: size_x,
    ny: size_y,
    nz: size_z,
    offset: size_x * axis_x + size_y * axis_y + size_z * axis_z,
    outside: [],
    deleted: false,
  }
}

// Signed distance of point from face plane (positive = outside).
const dist_to_face = (face: HullFace, point: Vec3): number =>
  face.nx * point[0] + face.ny * point[1] + face.nz * point[2] - face.offset

// Compute the 3D convex hull of a small point set via quickhull.
// Returns a degenerate result (faces=[], volume=0) for <4 unique points or
// collinear/coplanar sets (e.g. square-planar CN=4 coordination draws nothing,
// matching VESTA behavior). Supports up to 65535 input points (edge keys are
// packed into 32-bit integers) - far beyond any coordination shell.
export function convex_hull_3d(points: readonly Vec3[], eps_scale = 1e-7): ConvexHullResult {
  // Dedup points (coordination shells are tiny, O(n^2) is fine)
  const unique: Vec3[] = []
  const unique_input_idx: number[] = []
  for (let p_idx = 0; p_idx < points.length; p_idx++) {
    const [pixel_x, pixel_y, pixel_z] = points[p_idx]
    let is_dup = false
    for (const other of unique) {
      const delta_x = pixel_x - other[0]
      const delta_y = pixel_y - other[1]
      const delta_z = pixel_z - other[2]
      if (delta_x * delta_x + delta_y * delta_y + delta_z * delta_z < 1e-12) {
        is_dup = true
        break
      }
    }
    if (!is_dup) {
      unique.push(points[p_idx])
      unique_input_idx.push(p_idx)
    }
  }
  const degenerate: ConvexHullResult = {
    vertices: unique,
    input_idxs: unique_input_idx,
    faces: [],
    volume: 0,
  }
  if (unique.length < 4) return degenerate

  // Bounding-box diagonal sets the numerical tolerance scale
  let [min_x, min_y, min_z] = unique[0]
  let [max_x, max_y, max_z] = unique[0]
  for (const [pixel_x, pixel_y, pixel_z] of unique) {
    if (pixel_x < min_x) min_x = pixel_x
    if (pixel_x > max_x) max_x = pixel_x
    if (pixel_y < min_y) min_y = pixel_y
    if (pixel_y > max_y) max_y = pixel_y
    if (pixel_z < min_z) min_z = pixel_z
    if (pixel_z > max_z) max_z = pixel_z
  }
  const diag = Math.hypot(max_x - min_x, max_y - min_y, max_z - min_z)
  const eps = eps_scale * Math.max(1, diag)

  // Initial simplex: farthest pair along principal axes -> farthest from line -> from plane
  let [pt_0, pt_1] = [0, 1]
  let max_dist = -1
  for (let axis = 0; axis < 3; axis++) {
    let [lo_idx, hi_idx] = [0, 0]
    for (let idx = 1; idx < unique.length; idx++) {
      if (unique[idx][axis] < unique[lo_idx][axis]) lo_idx = idx
      if (unique[idx][axis] > unique[hi_idx][axis]) hi_idx = idx
    }
    const delta_x = unique[hi_idx][0] - unique[lo_idx][0]
    const delta_y = unique[hi_idx][1] - unique[lo_idx][1]
    const delta_z = unique[hi_idx][2] - unique[lo_idx][2]
    const dist = Math.hypot(delta_x, delta_y, delta_z)
    if (dist > max_dist) [max_dist, pt_0, pt_1] = [dist, lo_idx, hi_idx]
  }
  if (max_dist < eps) return degenerate // all points coincide

  const [offset_x, offset_y, offset_z] = unique[pt_0]
  let dir_x = unique[pt_1][0] - offset_x
  let dir_y = unique[pt_1][1] - offset_y
  let dir_z = unique[pt_1][2] - offset_z
  const dir_len = Math.hypot(dir_x, dir_y, dir_z)
  dir_x /= dir_len
  dir_y /= dir_len
  dir_z /= dir_len
  let pt_2 = -1
  max_dist = eps
  for (let idx = 0; idx < unique.length; idx++) {
    const relative_x = unique[idx][0] - offset_x
    const relative_y = unique[idx][1] - offset_y
    const relative_z = unique[idx][2] - offset_z
    const proj = relative_x * dir_x + relative_y * dir_y + relative_z * dir_z
    const perp_sq =
      relative_x * relative_x + relative_y * relative_y + relative_z * relative_z - proj * proj
    if (perp_sq > max_dist * max_dist) {
      max_dist = Math.sqrt(perp_sq)
      pt_2 = idx
    }
  }
  if (pt_2 === -1) return degenerate // collinear

  const base = face_of(unique, pt_0, pt_1, pt_2)
  let pt_3 = -1
  max_dist = eps
  for (let idx = 0; idx < unique.length; idx++) {
    const dist = Math.abs(dist_to_face(base, unique[idx]))
    if (dist > max_dist) [max_dist, pt_3] = [dist, idx]
  }
  if (pt_3 === -1) return degenerate // coplanar

  // Build initial tetrahedron with outward-facing windings
  const centroid: Vec3 = [
    (unique[pt_0][0] + unique[pt_1][0] + unique[pt_2][0] + unique[pt_3][0]) / 4,
    (unique[pt_0][1] + unique[pt_1][1] + unique[pt_2][1] + unique[pt_3][1]) / 4,
    (unique[pt_0][2] + unique[pt_1][2] + unique[pt_2][2] + unique[pt_3][2]) / 4,
  ]
  const faces: HullFace[] = []
  for (const [idx_a, idx_b, idx_c] of [
    [pt_0, pt_1, pt_2],
    [pt_0, pt_1, pt_3],
    [pt_0, pt_2, pt_3],
    [pt_1, pt_2, pt_3],
  ]) {
    let face = face_of(unique, idx_a, idx_b, idx_c)
    if (dist_to_face(face, centroid) > 0) face = face_of(unique, idx_a, idx_c, idx_b)
    faces.push(face)
  }

  // Assign each remaining point to the face it lies farthest outside of
  const assign_point = (point_idx: number, candidates: HullFace[]) => {
    let [best_face, best_dist] = [null as HullFace | null, eps]
    for (const face of candidates) {
      if (face.deleted) continue
      const dist = dist_to_face(face, unique[point_idx])
      if (dist > best_dist) [best_face, best_dist] = [face, dist]
    }
    best_face?.outside.push(point_idx)
  }
  for (let idx = 0; idx < unique.length; idx++) {
    if (idx !== pt_0 && idx !== pt_1 && idx !== pt_2 && idx !== pt_3) {
      assign_point(idx, faces)
    }
  }

  // Expand hull: repeatedly absorb the farthest outside point. Horizon edges are
  // tracked as packed 32-bit integers (from * 2^16 + to) instead of strings.
  const edge_set = new Set<number>() // packed directed edges
  for (let guard = 0; guard < unique.length * 4; guard++) {
    const active = faces.find((face) => !face.deleted && face.outside.length > 0)
    if (!active) break

    let [eye, eye_dist] = [-1, -Infinity]
    for (const point_idx of active.outside) {
      const dist = dist_to_face(active, unique[point_idx])
      if (dist > eye_dist) [eye, eye_dist] = [point_idx, dist]
    }

    // Find all faces visible from the eye point and collect orphaned points
    const orphans: number[] = []
    edge_set.clear()
    for (const face of faces) {
      if (face.deleted || dist_to_face(face, unique[eye]) <= eps) continue
      face.deleted = true
      for (const point_idx of face.outside) if (point_idx !== eye) orphans.push(point_idx)
      for (const [from, target] of [
        [face.vert_a, face.vert_b],
        [face.vert_b, face.vert_c],
        [face.vert_c, face.vert_a],
      ]) {
        const reverse_key = target * 65536 + from
        if (edge_set.has(reverse_key)) edge_set.delete(reverse_key) // internal edge
        else edge_set.add(from * 65536 + target)
      }
    }

    // Horizon edges (directed, so new faces inherit outward winding)
    const new_faces: HullFace[] = []
    for (const packed of edge_set) {
      const from = Math.floor(packed / 65536)
      const target = packed % 65536
      const face = face_of(unique, from, target, eye)
      faces.push(face)
      new_faces.push(face)
    }
    for (const point_idx of orphans) assign_point(point_idx, new_faces)
  }

  // Compact vertices used by surviving faces and remap indices
  const vert_remap = new Map<number, number>()
  const vertices: Vec3[] = []
  const input_idxs: number[] = []
  const remap = (old_idx: number): number => {
    let new_idx = vert_remap.get(old_idx)
    if (new_idx === undefined) {
      new_idx = vertices.length
      vert_remap.set(old_idx, new_idx)
      vertices.push(unique[old_idx])
      input_idxs.push(unique_input_idx[old_idx])
    }
    return new_idx
  }
  const remapped: [number, number, number][] = []
  for (const face of faces) {
    if (!face.deleted) {
      remapped.push([remap(face.vert_a), remap(face.vert_b), remap(face.vert_c)])
    }
  }

  // Volume via signed tetrahedra from the hull centroid (positive with outward winding)
  let [center_x, center_y, center_z] = [0, 0, 0]
  for (const [vector_x, vector_y, vector_z] of vertices) {
    center_x += vector_x
    center_y += vector_y
    center_z += vector_z
  }
  center_x /= vertices.length
  center_y /= vertices.length
  center_z /= vertices.length
  let volume = 0
  for (const [idx_a, idx_b, idx_c] of remapped) {
    const axis_x = vertices[idx_a][0] - center_x
    const axis_y = vertices[idx_a][1] - center_y
    const axis_z = vertices[idx_a][2] - center_z
    const basis_x = vertices[idx_b][0] - center_x
    const basis_y = vertices[idx_b][1] - center_y
    const basis_z = vertices[idx_b][2] - center_z
    const delta_x = vertices[idx_c][0] - center_x
    const delta_y = vertices[idx_c][1] - center_y
    const delta_z = vertices[idx_c][2] - center_z
    volume +=
      (axis_x * (basis_y * delta_z - basis_z * delta_y) +
        axis_y * (basis_z * delta_x - basis_x * delta_z) +
        axis_z * (basis_x * delta_y - basis_y * delta_x)) /
      6
  }

  return { vertices, input_idxs, faces: remapped, volume: Math.abs(volume) }
}

// === Bond graph adjacency ===

interface PolyhedronNeighbor {
  site_idx: number // index into the displayed structure's sites
  // Displacement from the center to this neighbor, non-null only for bonds carrying a
  // periodic cell_shift. Such a bond ends at a lattice image of sites[site_idx], not at
  // its in-cell position, so the vertex has to be placed at center + offset. Left null
  // for the common (proximity-perceived) case so vertices stay the exact site positions.
  offset: Vec3 | null
}

// Symmetric site_idx -> neighbor list from rendered bond pairs. Zero-shift self-bonds
// are dropped; periodic images of the center are distinct geometric neighbors.
export function build_adjacency(
  bonds: BondData,
  accepts: (center: number, neighbor: number) => boolean = () => true,
): Map<number, PolyhedronNeighbor[]> {
  const adjacency = new Map<number, PolyhedronNeighbor[]>()
  const link = (from: number, target: number, offset: Vec3 | null) => {
    let neighbors = adjacency.get(from)
    if (!neighbors) adjacency.set(from, (neighbors = []))
    // The same site can appear twice through different periodic images, so dedupe on
    // (site, image) rather than site alone. Coordination shells are tiny (CN 4-12), so
    // this linear scan beats building a string key for every bond in a supercell.
    const is_dup = neighbors.some(
      (nbr) =>
        nbr.site_idx === target &&
        (nbr.offset === null
          ? offset === null
          : offset !== null &&
            nbr.offset[0] === offset[0] &&
            nbr.offset[1] === offset[1] &&
            nbr.offset[2] === offset[2]),
    )
    if (!is_dup) neighbors.push({ site_idx: target, offset })
  }
  const start: Vec3 = [0, 0, 0]
  const end: Vec3 = [0, 0, 0]
  for (let idx = 0; idx < bonds.length; idx++) {
    const site_idx_1 =
      bonds instanceof BondFrame ? bonds.columns.indices[idx * 2] : bonds[idx].site_idx_1
    const site_idx_2 =
      bonds instanceof BondFrame ? bonds.columns.indices[idx * 2 + 1] : bonds[idx].site_idx_2
    const cell_shift =
      bonds instanceof BondFrame ? bonds.cell_shift(idx) : bonds[idx].cell_shift
    if (site_idx_1 === site_idx_2 && !cell_shift?.some((value) => value !== 0)) continue
    const forward = accepts(site_idx_1, site_idx_2)
    const reverse = accepts(site_idx_2, site_idx_1)
    if (!forward && !reverse) continue
    if (!cell_shift?.some((value) => value !== 0)) {
      if (forward) link(site_idx_1, site_idx_2, null)
      if (reverse) link(site_idx_2, site_idx_1, null)
    } else {
      // pos_2 already carries the lattice translation (structure_bond_to_bond_pair), so
      // the bond vector is the center -> neighbor displacement; the reverse is its negation
      if (bonds instanceof BondFrame) bonds.write_endpoints(idx, start, end)
      const pos_1 = bonds instanceof BondFrame ? start : bonds[idx].pos_1
      const pos_2 = bonds instanceof BondFrame ? end : bonds[idx].pos_2
      const [delta_x, delta_y, delta_z] = [
        pos_2[0] - pos_1[0],
        pos_2[1] - pos_1[1],
        pos_2[2] - pos_1[2],
      ]
      const flip = (val: number) => (val === 0 ? 0 : -val) // no -0, matching negate_cell_shift
      if (forward) link(site_idx_1, site_idx_2, [delta_x, delta_y, delta_z])
      if (reverse) link(site_idx_2, site_idx_1, [flip(delta_x), flip(delta_y), flip(delta_z)])
    }
  }
  return adjacency
}

// === Center selection ===

// A bonded neighbor counts as a polyhedron vertex only if it's an anion-former:
// a nonmetal or metalloid that is more electronegative than the center. This keeps
// spurious cation-cation bonds (e.g. Ti-Ba in perovskites, Li-P in thiophosphates)
// from contaminating coordination environments.
function is_anion_vertex(
  center_en: number | null,
  center_is_metal: boolean,
  neighbor_element: ElementSymbol | null,
  electronegativity_margin: number,
): boolean {
  if (!neighbor_element) return false
  const n_data = element_by_symbol.get(neighbor_element)
  if (n_data?.metal) return false
  const n_en = n_data?.electronegativity ?? null
  if (center_en !== null && n_en !== null) {
    return n_en > center_en + electronegativity_margin
  }
  // EN data missing: only metal centers with nonmetal neighbors qualify
  return center_is_metal && n_data?.nonmetal === true
}

// === Top-level polyhedra computation ===

// Detect coordination polyhedra from the rendered bond graph, VESTA-style:
// vertices are bonded anion-former neighbors by default (nonmetals/metalloids more
// electronegative than the center), or every bonded neighbor in bonded mode.
// Rejecting an over-long contact is the bond detector's job, so there is no extra
// distance trim here. In anion mode, spectator A-site
// cations (alkali, heavy alkaline-earth) are skipped when framework cations exist,
// CN > max_neighbors hulls (e.g. CN-12 cuboctahedra) are skipped, and
// boundary-truncated copies only render when their vertex count matches the max
// among all copies of the same original site. Corners are displayed atoms for
// proximity-perceived bonds (boundary shells are completed upstream by
// bond-completing image atoms - see find_image_atoms in pbc.ts); explicit bonds
// carrying a cell_shift put the corner at the lattice image the bond points to.
export function compute_polyhedra(
  structure: AnyStructure,
  bond_data: BondData,
  options: PolyhedraOptions = {},
): Polyhedron[] {
  const {
    neighbor_mode = DEFAULTS.structure.polyhedra_neighbor_mode,
    // Neighbor-count fallbacks derive from DEFAULTS.structure so they can't drift
    // from the polyhedra_min/max_neighbors settings defaults
    min_neighbors = DEFAULTS.structure.polyhedra_min_neighbors,
    max_neighbors = DEFAULTS.structure.polyhedra_max_neighbors,
    excluded_center_elements = [],
    included_center_elements = [],
    electronegativity_margin = 0,
  } = options
  const cached =
    bond_data instanceof BondFrame && bond_data.structure === structure
      ? prepared_polyhedra.get(bond_data)
      : undefined
  if (cached?.key === polyhedra_options_key(options)) return cached.polyhedra
  if (site_count(structure) === 0 || bond_data.length === 0) return []

  const excluded = new Set(excluded_center_elements)
  const included = new Set(included_center_elements)
  const columns = numeric_sites.get(structure)
  const rich_elements = columns ? undefined : structure.sites.map(get_majority_element)
  const unique_elements = columns
    ? (Object.keys(get_element_counts(structure)) as ElementSymbol[])
    : [
        ...new Set(
          rich_elements?.filter((element): element is ElementSymbol => element !== null),
        ),
      ]

  // Per-center-element caches: which neighbor elements qualify as vertices and
  // their covalent-radii sums. Avoids repeated element-data lookups in the hot
  // loop (one entry per element, shared by all centers of that element).
  type CenterInfo = {
    accepts: Set<ElementSymbol>
    radii_sums: Map<ElementSymbol, number> // covalent-radii sums, only where both known
  }
  const center_info_cache = new Map<ElementSymbol, CenterInfo>()
  const center_info = (element: ElementSymbol): CenterInfo => {
    let info = center_info_cache.get(element)
    if (!info) {
      const data = element_by_symbol.get(element)
      const center_en = data?.electronegativity ?? null
      const r_center = data?.covalent_radius ?? null
      const accepts = new Set(
        unique_elements.filter(
          (n_elem) =>
            neighbor_mode === `bonded` ||
            is_anion_vertex(center_en, data?.metal === true, n_elem, electronegativity_margin),
        ),
      )
      const radii_sums = new Map<ElementSymbol, number>()
      for (const n_elem of unique_elements) {
        const r_n = element_by_symbol.get(n_elem)?.covalent_radius ?? null
        if (r_center !== null && r_n !== null) radii_sums.set(n_elem, r_center + r_n)
      }
      info = { accepts, radii_sums }
      center_info_cache.set(element, info)
    }
    return info
  }

  // Check for eligible anion shells before allocating the potentially million-edge graph.
  if (
    !unique_elements.some(
      (element) => !excluded.has(element) && center_info(element).accepts.size > 0,
    )
  )
    return []
  const site_elements =
    rich_elements ??
    Array.from(columns?.numbers ?? [], (number) => element_from_atomic_number(number) ?? null)
  const position = (idx: number): Vec3 =>
    columns ? columns.position(idx) : structure.sites[idx].xyz
  // Only shifted bonds can reach the same physical neighbor through different site indices.
  const has_shifted_bonds =
    bond_data instanceof BondFrame
      ? bond_data.columns.images.some((value, idx) => idx % 7 >= 4 && value !== 0)
      : bond_data.some((bond) => bond.cell_shift?.some((val) => val !== 0))
  // Reject ineligible edges before allocating neighbor records, especially in large alloys
  // where only interface atoms can have an anion shell. Numeric playback stays columnar.
  const accepted_elements = site_elements.map((element) =>
    element && !excluded.has(element) ? center_info(element).accepts : undefined,
  )
  // Preserve first bond encounter order: it decides which coincident periodic copy wins
  // hull deduplication, even when that center's first edge cannot be a polyhedron vertex.
  const center_order = new Uint32Array(site_elements.length)
  let next_order = 1
  const adjacency = build_adjacency(bond_data, (center, neighbor) => {
    if (!center_order[center]) center_order[center] = next_order++
    const element = site_elements[neighbor]
    return Boolean(element && accepted_elements[center]?.has(element))
  })

  // Pass 1: candidate centers with their anion-vertex sets
  type Candidate = {
    site_idx: number
    orig_idx: number
    element: ElementSymbol
    vertex_site_idxs: number[]
    vertex_positions: Vec3[] // parallel to vertex_site_idxs, PBC images resolved
    mean_norm_dist: number | null // mean bond dist / covalent-radii sum (bond softness)
  }
  const candidates: Candidate[] = []
  for (const [site_idx, neighbors] of [...adjacency].toSorted(
    ([first], [second]) => center_order[first] - center_order[second],
  )) {
    if (neighbors.length < min_neighbors) continue
    const element = site_elements[site_idx]
    if (!element || excluded.has(element)) continue
    const { accepts, radii_sums } = center_info(element)
    if (accepts.size === 0) continue
    const [center_x, center_y, center_z] = position(site_idx)

    // Every bonded anion is a vertex, deliberately without a distance trim (see the shell
    // penalties in electroneg_ratio): the 2.39 A Ti-O bond of tetragonal BaTiO3 (1.31x the
    // shortest) closes the octahedron the way the drawn bonds do, not a square pyramid.
    const vertex_site_idxs: number[] = []
    const vertex_positions: Vec3[] = []
    let [norm_sum, norm_count] = [0, 0]
    for (const { site_idx: idx, offset } of neighbors) {
      const n_elem = site_elements[idx]
      if (!n_elem || !accepts.has(n_elem)) continue
      const pos: Vec3 =
        offset === null
          ? position(idx)
          : [center_x + offset[0], center_y + offset[1], center_z + offset[2]]
      // One physical neighbor reached twice would inflate the coordination number that
      // gates max_neighbors and the boundary-completeness check (the hull dedupes the
      // vertex itself, so only the count is wrong). 1e-6 Å because the two paths build
      // the position differently - frac_to_cart(frac + shift) vs xyz + shift * lattice -
      // and disagree at ~1e-15, six orders below any real neighbor separation.
      if (
        has_shifted_bonds &&
        vertex_positions.some(
          (prev) =>
            Math.abs(prev[0] - pos[0]) < 1e-6 &&
            Math.abs(prev[1] - pos[1]) < 1e-6 &&
            Math.abs(prev[2] - pos[2]) < 1e-6,
        )
      )
        continue
      vertex_site_idxs.push(idx)
      vertex_positions.push(pos)
      // Bond softness: how stretched the bonds are vs the covalent-radii sum
      const r_sum = radii_sums.get(n_elem)
      if (r_sum !== undefined) {
        norm_sum += Math.hypot(pos[0] - center_x, pos[1] - center_y, pos[2] - center_z) / r_sum
        norm_count++
      }
    }
    if (vertex_site_idxs.length < min_neighbors) continue

    candidates.push({
      site_idx,
      orig_idx: get_orig_site_idx(get_site(structure, site_idx), site_idx),
      element,
      vertex_site_idxs,
      vertex_positions,
      mean_norm_dist: norm_count > 0 ? norm_sum / norm_count : null,
    })
  }

  // Pass 2: hide spectator A-site cations when the composition contains a
  // potential framework cation (a non-spectator element less electronegative than
  // the structure's most electronegative element, i.e. one that could coordinate
  // the anions). Composition-based rather than candidate-based so boundary
  // truncation of framework polyhedra doesn't promote Li/Na/Ba clutter; purely
  // ionic binaries like NaCl or CaF2 still draw their spectator polyhedra.
  const has_framework = has_framework_potential(unique_elements)

  // Weakly-bound center species (mean bond length well beyond the covalent-radii
  // sum, e.g. lone-pair Bi3+ with 8 long Bi-O bonds) are hidden when a
  // strongly-bound framework species exists - mirrors how pyrochlore-type figures
  // show only the B-site octahedra
  const norm_by_species = new Map<ElementSymbol, { sum: number; count: number }>()
  for (const { element, mean_norm_dist } of candidates) {
    if (mean_norm_dist === null) continue
    const entry = norm_by_species.get(element) ?? { sum: 0, count: 0 }
    entry.sum += mean_norm_dist
    entry.count++
    norm_by_species.set(element, entry)
  }
  const species_norm = (element: ElementSymbol): number | null => {
    const entry = norm_by_species.get(element)
    return entry ? entry.sum / entry.count : null
  }
  const has_strong_species = [...norm_by_species.keys()].some(
    (element) =>
      (species_norm(element) ?? Infinity) <= WEAK_BOND_NORM && !is_spectator_center(element),
  )
  const is_weak_species = (element: ElementSymbol): boolean =>
    has_strong_species && (species_norm(element) ?? 0) > WEAK_BOND_NORM

  const visible = candidates.filter(({ element }) => {
    if (neighbor_mode === `bonded` || included.has(element)) return true
    if (is_spectator_center(element) && has_framework) return false
    return !is_weak_species(element)
  })

  // Pass 3: boundary completeness - copies of the same original site only render
  // at the max observed vertex count, so any remaining truncated copies (bond
  // completing image atoms handle most) are skipped
  const max_cn_by_orig = new Map<number, number>()
  for (const { orig_idx, vertex_site_idxs } of visible) {
    if (vertex_site_idxs.length > (max_cn_by_orig.get(orig_idx) ?? 0)) {
      max_cn_by_orig.set(orig_idx, vertex_site_idxs.length)
    }
  }

  // Pass 4: CN cap (after completeness so capped interior copies don't let
  // truncated boundary copies of the same site slip through; force-included
  // elements bypass the cap - an explicit user request beats the clutter
  // heuristic), then build hulls, deduping identical center positions (base
  // atom vs PBC image)
  const polyhedra: Polyhedron[] = []
  const seen_positions = new Set<string>()
  for (const { site_idx, orig_idx, element, vertex_site_idxs, vertex_positions } of visible) {
    if (vertex_site_idxs.length !== max_cn_by_orig.get(orig_idx)) continue
    if (vertex_site_idxs.length > max_neighbors && !included.has(element)) continue

    const [pixel_x, pixel_y, pixel_z] = position(site_idx)
    const pos_key = `${Math.round(pixel_x * 1e3)},${Math.round(pixel_y * 1e3)},${Math.round(pixel_z * 1e3)}`
    if (seen_positions.has(pos_key)) continue
    seen_positions.add(pos_key)

    const hull = convex_hull_3d(vertex_positions)
    if (hull.faces.length === 0) continue
    const spans = [0, 1, 2].map((axis) => {
      const [lower, upper] = array_extent(hull.vertices.map((vert) => vert[axis]))
      return upper - lower
    })
    if (hull.volume < VOLUME_EPS * array_max(spans) ** 3) continue

    polyhedra.push({
      center_site_idx: site_idx,
      center_orig_idx: orig_idx,
      center_element: element,
      vertices: hull.vertices,
      vertex_site_idxs: hull.input_idxs.map((input_idx) => vertex_site_idxs[input_idx]),
      faces: hull.faces,
      volume: hull.volume,
    })
  }
  return polyhedra
}

// === Merged render buffers ===

// How merged polyhedra are colored: one CSS color for everything, or a per-site color taken
// from each hull vertex's own site (`vertex`) or the polyhedron's center site (`center`).
// site_color must be a pure function of site_idx: it is resolved once per distinct site.
export type PolyhedraColoring =
  | { mode: `uniform`; color: string }
  | { mode: `vertex` | `center`; site_color: (site_idx: number) => string }

// Merge all polyhedra into single non-indexed position/normal/color arrays (one draw call)
// plus crease-edge segments for outlines. Edges interior to coplanar face groups
// (e.g. quad diagonals on a cube) are omitted. Normals are the flat per-face normals
// BufferGeometry.computeVertexNormals would derive from the float32 positions, bit for bit,
// so callers can upload them directly.
export function merge_polyhedra_buffers(
  polyhedra: readonly Polyhedron[],
  coloring: PolyhedraColoring,
  coplanar_tol = 1e-3,
): MergedPolyhedraBuffers {
  let [triangle_count, max_faces, max_verts] = [0, 0, 0]
  for (const { faces, vertices } of polyhedra) {
    triangle_count += faces.length
    max_faces = Math.max(max_faces, faces.length)
    max_verts = Math.max(max_verts, vertices.length)
  }
  const positions = new Float32Array(triangle_count * 9)
  const normals = new Float32Array(triangle_count * 9)
  const colors = new Float32Array(triangle_count * 9)
  // A closed triangulated surface has at most 3F/2 unique edges
  const edge_positions = new Float32Array(Math.ceil(triangle_count * 1.5) * 6)
  const edge_colors = new Float32Array(edge_positions.length)
  // Per-polyhedron scratch. Crease detection indexes each undirected hull edge (lo, hi) at
  // cell lo * n_verts + hi of edge_at (edge_idx + 1, 0 = unseen) and records per edge, in
  // first-encounter order, its cell, first adjacent face normal and whether it is hidden.
  const vert_rgb = new Float32Array(max_verts * 3)
  const edge_at = new Int32Array(max_verts * max_verts)
  const edge_cells = new Int32Array(max_faces * 3)
  const edge_normals = new Float64Array(max_faces * 9)
  const edge_hidden = new Uint8Array(max_faces * 3) // 1 = the last face on it is coplanar
  // Linear rgb per site, resolved once per distinct site
  const site_rgb = new Map<number, ArrayLike<number>>()
  const site_color = coloring.mode === `uniform` ? () => coloring.color : coloring.site_color

  let offset = 0
  let edge_offset = 0
  const skipped_sites: string[] = []
  for (const poly of polyhedra) {
    // Rewind marks, in case this polyhedron turns out not to fit the shared edge pool below
    const [poly_offset, poly_edge_offset] = [offset, edge_offset]
    const { vertices: verts, faces } = poly
    const n_verts = verts.length
    for (let v_idx = 0; v_idx < n_verts; v_idx++) {
      const site_idx =
        coloring.mode === `vertex` ? poly.vertex_site_idxs[v_idx] : poly.center_site_idx
      let rgb = site_rgb.get(site_idx)
      if (!rgb) site_rgb.set(site_idx, (rgb = css_to_linear_rgb(site_color(site_idx))))
      vert_rgb[v_idx * 3] = rgb[0]
      vert_rgb[v_idx * 3 + 1] = rgb[1]
      vert_rgb[v_idx * 3 + 2] = rgb[2]
    }

    edge_at.fill(0, 0, n_verts * n_verts)
    let n_poly_edges = 0
    for (const face of faces) {
      // Indexed reads, not destructuring: this loop runs once per rendered triangle
      const vert_a = verts[face[0]]
      const vert_b = verts[face[1]]
      const vert_c = verts[face[2]]
      // Unit face normal (float64, unrounded input) for crease detection
      const side_1_x = vert_b[0] - vert_a[0]
      const side_1_y = vert_b[1] - vert_a[1]
      const side_1_z = vert_b[2] - vert_a[2]
      const side_2_x = vert_c[0] - vert_a[0]
      const side_2_y = vert_c[1] - vert_a[1]
      const side_2_z = vert_c[2] - vert_a[2]
      let normal_x = side_1_y * side_2_z - side_1_z * side_2_y
      let normal_y = side_1_z * side_2_x - side_1_x * side_2_z
      let normal_z = side_1_x * side_2_y - side_1_y * side_2_x
      const len = Math.hypot(normal_x, normal_y, normal_z)
      if (len > 0) {
        normal_x /= len
        normal_y /= len
        normal_z /= len
      }

      // Render normal replicating computeVertexNormals on the stored float32 positions:
      // (c - b) x (a - b), rounded to float32, then Vector3.normalize (length || 1) in float32
      const b_x = Math.fround(vert_b[0])
      const b_y = Math.fround(vert_b[1])
      const b_z = Math.fround(vert_b[2])
      const cb_x = Math.fround(vert_c[0]) - b_x
      const cb_y = Math.fround(vert_c[1]) - b_y
      const cb_z = Math.fround(vert_c[2]) - b_z
      const ab_x = Math.fround(vert_a[0]) - b_x
      const ab_y = Math.fround(vert_a[1]) - b_y
      const ab_z = Math.fround(vert_a[2]) - b_z
      const cross_x = Math.fround(cb_y * ab_z - cb_z * ab_y)
      const cross_y = Math.fround(cb_z * ab_x - cb_x * ab_z)
      const cross_z = Math.fround(cb_x * ab_y - cb_y * ab_x)
      const inv_len =
        // oxlint-disable-next-line eslint-plugin-unicorn/prefer-modern-math-apis -- matches Vector3.length bit for bit
        1 / (Math.sqrt(cross_x * cross_x + cross_y * cross_y + cross_z * cross_z) || 1)
      for (let corner = 0; corner < 3; corner++) {
        const vert = verts[face[corner]]
        const rgb = face[corner] * 3
        positions[offset] = vert[0]
        positions[offset + 1] = vert[1]
        positions[offset + 2] = vert[2]
        colors[offset] = vert_rgb[rgb]
        colors[offset + 1] = vert_rgb[rgb + 1]
        colors[offset + 2] = vert_rgb[rgb + 2]
        normals[offset] = cross_x * inv_len
        normals[offset + 1] = cross_y * inv_len
        normals[offset + 2] = cross_z * inv_len
        offset += 3
      }

      for (let side = 0; side < 3; side++) {
        const from = face[side]
        const target = face[(side + 1) % 3]
        const cell = from < target ? from * n_verts + target : target * n_verts + from
        let edge_idx = edge_at[cell] - 1
        if (edge_idx >= 0) {
          const dot =
            normal_x * edge_normals[edge_idx * 3] +
            normal_y * edge_normals[edge_idx * 3 + 1] +
            normal_z * edge_normals[edge_idx * 3 + 2]
          // the last face to reach an edge decides whether it is hidden
          edge_hidden[edge_idx] = dot < 1 - coplanar_tol ? 0 : 1
        } else {
          edge_idx = n_poly_edges++
          edge_at[cell] = edge_idx + 1
          edge_cells[edge_idx] = cell
          edge_hidden[edge_idx] = 0
          edge_normals[edge_idx * 3] = normal_x
          edge_normals[edge_idx * 3 + 1] = normal_y
          edge_normals[edge_idx * 3 + 2] = normal_z
        }
      }
    }

    // An edge is drawn unless both adjacent faces are coplanar (quad diagonal). Float32Array
    // drops out-of-range writes silently, so a polyhedron whose outline overflows the shared
    // 3F/2 pool is rewound whole, triangles included, else the buffers would gap.
    for (let edge_idx = 0; edge_idx < n_poly_edges; edge_idx++) {
      if (edge_hidden[edge_idx]) continue
      const cell = edge_cells[edge_idx]
      for (let end = 0; end < 2; end++) {
        const v_idx = end ? cell % n_verts : Math.floor(cell / n_verts)
        const vert = verts[v_idx]
        for (let axis = 0; axis < 3; axis++) {
          edge_positions[edge_offset + axis] = vert[axis]
          edge_colors[edge_offset + axis] = vert_rgb[v_idx * 3 + axis]
        }
        edge_offset += 3
      }
    }
    if (edge_offset > edge_positions.length) {
      skipped_sites.push(`site ${poly.center_site_idx} (${poly.center_element})`)
      offset = poly_offset
      edge_offset = poly_edge_offset
    }
  }

  // one unclosed hull exhausts the shared pool for every polyhedron behind it: one tally, not
  // one warning per victim
  if (skipped_sites.length > 0) {
    console.warn(
      `Edge buffer exhausted (${edge_positions.length / 6} edges): dropped ` +
        `polyhedra at ${skipped_sites.join(`, `)}`,
    )
  }
  // Trim only if a polyhedron was dropped: slice copies the whole buffer. Edge outputs are
  // views, not copies, since the pool is almost always larger than the drawn edge count.
  const dropped = offset < positions.length
  return {
    positions: dropped ? positions.slice(0, offset) : positions,
    normals: dropped ? normals.slice(0, offset) : normals,
    colors: dropped ? colors.slice(0, offset) : colors,
    edge_positions: edge_positions.subarray(0, edge_offset),
    edge_colors: edge_colors.subarray(0, edge_offset),
    triangle_count: offset / 9,
    edge_count: edge_offset / 6,
  }
}
