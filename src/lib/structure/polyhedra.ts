// Coordination polyhedra detection and mesh generation.
// Self-contained: vertices come from the rendered bond graph, hulls from a custom
// quickhull tailored to small point sets (CN 4-12), output as merged typed arrays
// so the whole scene renders in 1-2 draw calls regardless of supercell size.
// Hot paths use scalar math and per-element caches to scale to large structures.

import { rgb as parse_rgb } from 'd3-color'
import type { ElementSymbol } from '$lib/element'
import type { Vec3 } from '$lib/math'
import { DEFAULTS } from '$lib/settings'
import type { AnyStructure, BondPair } from '$lib/structure'
import { get_orig_site_idx } from './atom-properties'
import {
  element_lookup,
  get_majority_element,
  has_framework_potential,
  is_spectator_center,
} from './bonding'

export type PolyhedraColorMode = `vertex` | `center` | `uniform`

export interface PolyhedraOptions {
  min_neighbors?: number // min coordination number to form a polyhedron
  max_neighbors?: number // max CN - skips e.g. CN-12 cuboctahedra around A-site cations
  excluded_center_elements?: readonly string[] // per-element off-toggles
  included_center_elements?: readonly string[] // force-include (bypasses spectator/weak hiding + max_neighbors cap)
  electronegativity_margin?: number // vertex must be > center EN + margin
  distance_factor?: number // vertices kept within shortest-bond * (1 + factor)
  weak_bond_norm?: number // species with mean bond dist / covalent-radii sum above this
  // are hidden when a strongly-bound framework species exists (e.g. lone-pair Bi3+)
  volume_eps?: number // hulls below this volume (Å³) are skipped as degenerate
}

export interface ConvexHullResult {
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

export interface MergedPolyhedraBuffers {
  positions: Float32Array // 9 floats per triangle (non-indexed, flat-shaded)
  colors: Float32Array // per-vertex rgb matching positions
  edge_positions: Float32Array // 6 floats per crease edge for LineSegments
  triangle_count: number
  edge_count: number
}

// --- Convex hull (quickhull) ---

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
  const [ax, ay, az] = points[vert_a]
  const abx = points[vert_b][0] - ax
  const aby = points[vert_b][1] - ay
  const abz = points[vert_b][2] - az
  const acx = points[vert_c][0] - ax
  const acy = points[vert_c][1] - ay
  const acz = points[vert_c][2] - az
  let nx = aby * acz - abz * acy
  let ny = abz * acx - abx * acz
  let nz = abx * acy - aby * acx
  const len = Math.hypot(nx, ny, nz)
  if (len > 0) {
    nx /= len
    ny /= len
    nz /= len
  } else [nx, ny, nz] = [0, 0, 1]
  return {
    vert_a,
    vert_b,
    vert_c,
    nx,
    ny,
    nz,
    offset: nx * ax + ny * ay + nz * az,
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
    const [px, py, pz] = points[p_idx]
    let is_dup = false
    for (const other of unique) {
      const dx = px - other[0]
      const dy = py - other[1]
      const dz = pz - other[2]
      if (dx * dx + dy * dy + dz * dz < 1e-12) {
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
  for (const [px, py, pz] of unique) {
    if (px < min_x) min_x = px
    if (px > max_x) max_x = px
    if (py < min_y) min_y = py
    if (py > max_y) max_y = py
    if (pz < min_z) min_z = pz
    if (pz > max_z) max_z = pz
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
    const dx = unique[hi_idx][0] - unique[lo_idx][0]
    const dy = unique[hi_idx][1] - unique[lo_idx][1]
    const dz = unique[hi_idx][2] - unique[lo_idx][2]
    const dist = Math.hypot(dx, dy, dz)
    if (dist > max_dist) [max_dist, pt_0, pt_1] = [dist, lo_idx, hi_idx]
  }
  if (max_dist < eps) return degenerate // all points coincide

  const [ox, oy, oz] = unique[pt_0]
  let dir_x = unique[pt_1][0] - ox
  let dir_y = unique[pt_1][1] - oy
  let dir_z = unique[pt_1][2] - oz
  const dir_len = Math.hypot(dir_x, dir_y, dir_z)
  dir_x /= dir_len
  dir_y /= dir_len
  dir_z /= dir_len
  let pt_2 = -1
  max_dist = eps
  for (let idx = 0; idx < unique.length; idx++) {
    const rx = unique[idx][0] - ox
    const ry = unique[idx][1] - oy
    const rz = unique[idx][2] - oz
    const proj = rx * dir_x + ry * dir_y + rz * dir_z
    const perp_sq = rx * rx + ry * ry + rz * rz - proj * proj
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
      for (const [from, to] of [
        [face.vert_a, face.vert_b],
        [face.vert_b, face.vert_c],
        [face.vert_c, face.vert_a],
      ]) {
        const reverse_key = to * 65536 + from
        if (edge_set.has(reverse_key))
          edge_set.delete(reverse_key) // internal edge
        else edge_set.add(from * 65536 + to)
      }
    }

    // Horizon edges (directed, so new faces inherit outward winding)
    const new_faces: HullFace[] = []
    for (const packed of edge_set) {
      const from = Math.floor(packed / 65536)
      const to = packed % 65536
      const face = face_of(unique, from, to, eye)
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
  let [cx, cy, cz] = [0, 0, 0]
  for (const [vx, vy, vz] of vertices) {
    cx += vx
    cy += vy
    cz += vz
  }
  cx /= vertices.length
  cy /= vertices.length
  cz /= vertices.length
  let volume = 0
  for (const [idx_a, idx_b, idx_c] of remapped) {
    const ax = vertices[idx_a][0] - cx
    const ay = vertices[idx_a][1] - cy
    const az = vertices[idx_a][2] - cz
    const bx = vertices[idx_b][0] - cx
    const by = vertices[idx_b][1] - cy
    const bz = vertices[idx_b][2] - cz
    const dx = vertices[idx_c][0] - cx
    const dy = vertices[idx_c][1] - cy
    const dz = vertices[idx_c][2] - cz
    volume +=
      (ax * (by * dz - bz * dy) + ay * (bz * dx - bx * dz) + az * (bx * dy - by * dx)) / 6
  }

  return { vertices, input_idxs, faces: remapped, volume: Math.abs(volume) }
}

// --- Bond graph adjacency ---

// Symmetric site_idx -> neighbor site_idx set from rendered bond pairs.
export function build_adjacency(bonds: readonly BondPair[]): Map<number, Set<number>> {
  const adjacency = new Map<number, Set<number>>()
  const link = (from: number, to: number) => {
    const neighbors = adjacency.get(from)
    if (neighbors) neighbors.add(to)
    else adjacency.set(from, new Set([to]))
  }
  for (const { site_idx_1, site_idx_2 } of bonds) {
    if (site_idx_1 === site_idx_2) continue
    link(site_idx_1, site_idx_2)
    link(site_idx_2, site_idx_1)
  }
  return adjacency
}

// --- Center selection ---

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
  const n_data = element_lookup.get(neighbor_element)
  if (n_data?.metal) return false
  const n_en = n_data?.electronegativity ?? null
  if (center_en !== null && n_en !== null) {
    return n_en > center_en + electronegativity_margin
  }
  // EN data missing: only metal centers with nonmetal neighbors qualify
  return center_is_metal && n_data?.nonmetal === true
}

// --- Top-level polyhedra computation ---

// Detect coordination polyhedra from the rendered bond graph, VESTA-style:
// vertices are anion-former neighbors (nonmetals/metalloids more electronegative
// than the center) within `1 + distance_factor` of the shortest such bond, so
// over-long bond-graph noise doesn't inflate e.g. PO4 tetrahedra. Spectator A-site
// cations (alkali, heavy alkaline-earth) are skipped when framework cations exist,
// CN > max_neighbors hulls (e.g. CN-12 cuboctahedra) are skipped, and
// boundary-truncated copies only render when their vertex count matches the max
// among all copies of the same original site. Every polyhedron corner is a
// displayed atom (boundary shells are completed upstream by bond-completing image
// atoms - see find_image_atoms in pbc.ts).
export function compute_polyhedra(
  structure: AnyStructure,
  bonds: readonly BondPair[],
  options: PolyhedraOptions = {},
): Polyhedron[] {
  const {
    // Neighbor-count fallbacks derive from DEFAULTS.structure so they can't drift
    // from the polyhedra_min/max_neighbors settings defaults
    min_neighbors = DEFAULTS.structure.polyhedra_min_neighbors,
    max_neighbors = DEFAULTS.structure.polyhedra_max_neighbors,
    excluded_center_elements = [],
    included_center_elements = [],
    electronegativity_margin = 0,
    distance_factor = 0.3,
    weak_bond_norm = 1.15,
    volume_eps = 1e-3,
  } = options
  const sites = structure?.sites
  if (!sites?.length || bonds.length === 0) return []

  const adjacency = build_adjacency(bonds)
  const excluded = new Set(excluded_center_elements)
  const included = new Set(included_center_elements)
  const site_elements = sites.map((site) => get_majority_element(site))
  const unique_elements = [
    ...new Set(site_elements.filter((el): el is ElementSymbol => el !== null)),
  ]

  // Per-center-element caches: which neighbor elements qualify as vertices and
  // their covalent-radii sums. Avoids repeated element-data lookups in the hot
  // loop (one entry per element, shared by all centers of that element).
  type CenterInfo = {
    accepts: Set<ElementSymbol>
    radii_sums: Map<ElementSymbol, number | null>
  }
  const center_info_cache = new Map<ElementSymbol, CenterInfo>()
  const center_info = (element: ElementSymbol): CenterInfo => {
    let info = center_info_cache.get(element)
    if (!info) {
      const data = element_lookup.get(element)
      const center_en = data?.electronegativity ?? null
      const r_center = data?.covalent_radius ?? null
      const accepts = new Set(
        unique_elements.filter((n_elem) =>
          is_anion_vertex(center_en, data?.metal === true, n_elem, electronegativity_margin),
        ),
      )
      const radii_sums = new Map(
        unique_elements.map((n_elem) => {
          const r_n = element_lookup.get(n_elem)?.covalent_radius ?? null
          return [n_elem, r_center !== null && r_n !== null ? r_center + r_n : null] as const
        }),
      )
      info = { accepts, radii_sums }
      center_info_cache.set(element, info)
    }
    return info
  }

  // Pass 1: candidate centers with their anion-vertex sets
  type Candidate = {
    site_idx: number
    orig_idx: number
    element: ElementSymbol
    vertex_site_idxs: number[]
    mean_norm_dist: number | null // mean bond dist / covalent-radii sum (bond softness)
  }
  const candidates: Candidate[] = []
  for (const [site_idx, neighbors] of adjacency) {
    if (neighbors.size < min_neighbors) continue
    const element = site_elements[site_idx]
    if (!element || excluded.has(element)) continue
    const { accepts, radii_sums } = center_info(element)
    if (accepts.size === 0) continue
    const [cx, cy, cz] = sites[site_idx].xyz

    // Bonded anion vertices (parallel arrays to avoid per-vertex object churn)
    const vert_idxs: number[] = []
    const vert_dists: number[] = []
    let min_dist = Infinity
    for (const idx of neighbors) {
      const n_elem = site_elements[idx]
      if (!n_elem || !accepts.has(n_elem)) continue
      const [nx, ny, nz] = sites[idx].xyz
      const dist = Math.hypot(nx - cx, ny - cy, nz - cz)
      vert_idxs.push(idx)
      vert_dists.push(dist)
      if (dist < min_dist) min_dist = dist
    }
    if (vert_idxs.length < min_neighbors) continue

    // Trim over-long bonds relative to the shortest anion bond (VESTA-like local
    // cutoff): keeps distorted/Jahn-Teller octahedra intact but rejects e.g. a 5th
    // oxygen at 2.5 Å around P whose true tetrahedron has 1.5 Å bonds
    const cutoff = min_dist * (1 + distance_factor)
    const vertex_site_idxs: number[] = []
    let [norm_sum, norm_count] = [0, 0]
    for (let pos = 0; pos < vert_idxs.length; pos++) {
      if (vert_dists[pos] > cutoff) continue
      const idx = vert_idxs[pos]
      vertex_site_idxs.push(idx)
      // Bond softness: how stretched the kept bonds are vs the covalent-radii sum
      const n_elem = site_elements[idx]
      const r_sum = n_elem ? (radii_sums.get(n_elem) ?? null) : null
      if (r_sum !== null) {
        norm_sum += vert_dists[pos] / r_sum
        norm_count++
      }
    }
    if (vertex_site_idxs.length < min_neighbors) continue

    candidates.push({
      site_idx,
      orig_idx: get_orig_site_idx(sites[site_idx], site_idx),
      element,
      vertex_site_idxs,
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
  const species_norm = (el: ElementSymbol): number | null => {
    const entry = norm_by_species.get(el)
    return entry ? entry.sum / entry.count : null
  }
  const has_strong_species = [...norm_by_species.keys()].some(
    (el) => (species_norm(el) ?? Infinity) <= weak_bond_norm && !is_spectator_center(el),
  )
  const is_weak_species = (el: ElementSymbol): boolean =>
    has_strong_species && (species_norm(el) ?? 0) > weak_bond_norm

  const visible = candidates.filter(({ element }) => {
    if (included.has(element)) return true
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
  for (const { site_idx, orig_idx, element, vertex_site_idxs } of visible) {
    if (vertex_site_idxs.length !== max_cn_by_orig.get(orig_idx)) continue
    if (vertex_site_idxs.length > max_neighbors && !included.has(element)) continue

    const [px, py, pz] = sites[site_idx].xyz
    const pos_key = `${Math.round(px * 1e3)},${Math.round(py * 1e3)},${Math.round(pz * 1e3)}`
    if (seen_positions.has(pos_key)) continue
    seen_positions.add(pos_key)

    const hull = convex_hull_3d(vertex_site_idxs.map((idx) => sites[idx].xyz))
    if (hull.faces.length === 0 || hull.volume < volume_eps) continue

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

// --- Merged render buffers ---

// Merge all polyhedra into single non-indexed position/color arrays (one draw call)
// plus crease-edge segments for outlines. Edges interior to coplanar face groups
// (e.g. quad diagonals on a cube) are omitted. `get_vertex_color` resolves the
// color of each hull vertex (e.g. the vertex atom's element color, the center
// atom's color, or a uniform custom color) - parsed colors are cached by string.
export function merge_polyhedra_buffers(
  polyhedra: readonly Polyhedron[],
  get_vertex_color: (poly: Polyhedron, vertex_idx: number) => string,
  coplanar_tol = 1e-3,
): MergedPolyhedraBuffers {
  let triangle_count = 0
  for (const poly of polyhedra) triangle_count += poly.faces.length
  const positions = new Float32Array(triangle_count * 9)
  const colors = new Float32Array(triangle_count * 9)
  // A closed triangulated surface has at most 3F/2 unique edges
  const edge_positions = new Float32Array(Math.ceil(triangle_count * 1.5) * 6)
  const rgb_cache = new Map<string, [number, number, number]>()

  let offset = 0
  let edge_offset = 0
  // Per-polyhedron scratch: crease detection tracks the first face normal seen
  // per undirected edge (packed vert_a * 2^16 + vert_b key)
  const edge_normals = new Map<
    number,
    { nx: number; ny: number; nz: number; crease: boolean; shared: boolean }
  >()
  for (const poly of polyhedra) {
    const verts = poly.vertices
    // Resolve per-hull-vertex colors once
    const vert_rgb = new Float32Array(verts.length * 3)
    for (let v_idx = 0; v_idx < verts.length; v_idx++) {
      const color = get_vertex_color(poly, v_idx)
      let channels = rgb_cache.get(color)
      if (!channels) {
        // d3-color handles hex, rgb()/rgba() (d3 property-color scales) and named colors
        const { r, g, b } = parse_rgb(color)
        channels = Number.isFinite(r) ? [r / 255, g / 255, b / 255] : [0.5, 0.5, 0.5]
        rgb_cache.set(color, channels)
      }
      vert_rgb[v_idx * 3] = channels[0]
      vert_rgb[v_idx * 3 + 1] = channels[1]
      vert_rgb[v_idx * 3 + 2] = channels[2]
    }

    edge_normals.clear()
    for (const [idx_a, idx_b, idx_c] of poly.faces) {
      const [ax, ay, az] = verts[idx_a]
      const [bx, by, bz] = verts[idx_b]
      const [px, py, pz] = verts[idx_c]
      // Scalar face normal for crease detection
      let nx = (by - ay) * (pz - az) - (bz - az) * (py - ay)
      let ny = (bz - az) * (px - ax) - (bx - ax) * (pz - az)
      let nz = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
      const len = Math.hypot(nx, ny, nz)
      if (len > 0) {
        nx /= len
        ny /= len
        nz /= len
      }

      for (const v_idx of [idx_a, idx_b, idx_c]) {
        const vert = verts[v_idx]
        positions[offset] = vert[0]
        positions[offset + 1] = vert[1]
        positions[offset + 2] = vert[2]
        colors[offset] = vert_rgb[v_idx * 3]
        colors[offset + 1] = vert_rgb[v_idx * 3 + 1]
        colors[offset + 2] = vert_rgb[v_idx * 3 + 2]
        offset += 3
      }

      for (const [from, to] of [
        [idx_a, idx_b],
        [idx_b, idx_c],
        [idx_c, idx_a],
      ]) {
        const key = from < to ? from * 65536 + to : to * 65536 + from
        const entry = edge_normals.get(key)
        if (entry) {
          entry.shared = true
          entry.crease = nx * entry.nx + ny * entry.ny + nz * entry.nz < 1 - coplanar_tol
        } else edge_normals.set(key, { nx, ny, nz, crease: false, shared: false })
      }
    }

    // Draw an edge unless both adjacent faces are coplanar (quad diagonal)
    for (const [key, entry] of edge_normals) {
      if (entry.shared && !entry.crease) continue
      const from = verts[Math.floor(key / 65536)]
      const to = verts[key % 65536]
      edge_positions[edge_offset] = from[0]
      edge_positions[edge_offset + 1] = from[1]
      edge_positions[edge_offset + 2] = from[2]
      edge_positions[edge_offset + 3] = to[0]
      edge_positions[edge_offset + 4] = to[1]
      edge_positions[edge_offset + 5] = to[2]
      edge_offset += 6
    }
  }

  return {
    positions,
    colors,
    edge_positions: edge_positions.slice(0, edge_offset),
    triangle_count,
    edge_count: edge_offset / 6,
  }
}
