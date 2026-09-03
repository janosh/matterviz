// Coordination polyhedra detection and mesh generation.
// Self-contained: vertices come from the rendered bond graph, hulls from a custom
// quickhull tailored to small point sets (CN 4-12), output as merged typed arrays
// so the whole scene renders in 1-2 draw calls regardless of supercell size.
// Hot paths use scalar math and per-element caches to scale to large structures.

import type { ElementSymbol } from '$lib/element'
import { element_by_symbol } from '$lib/element/data'
import type { Vec3 } from '$lib/math'
import { array_extent, array_max } from '$lib/math'
import { DEFAULTS } from '$lib/settings'
import type { AnyStructure, BondPair } from '$lib/structure'
import { css_to_linear_rgb } from '$lib/scene/colors'
import { get_orig_site_idx } from './site'
import { get_majority_element, has_framework_potential, is_spectator_center } from './bonding'

export type PolyhedraColorMode = `vertex` | `center` | `uniform`

interface PolyhedraOptions {
  min_neighbors?: number // min coordination number to form a polyhedron
  max_neighbors?: number // max CN - skips e.g. CN-12 cuboctahedra around A-site cations
  excluded_center_elements?: readonly string[] // per-element off-toggles
  included_center_elements?: readonly string[] // force-include (bypasses spectator/weak hiding + max_neighbors cap)
  electronegativity_margin?: number // vertex must be > center EN + margin
}

// Species whose mean bond dist / covalent-radii sum exceeds this are hidden when a
// strongly-bound framework species exists (e.g. lone-pair Bi3+)
const WEAK_BOND_NORM = 1.15
// A hull is degenerate when it is FLAT, not when it is small, so this is a fraction of the
// hull's own extent cubed. An absolute A^3 cutoff would both keep near-planar environments in
// A (a CN-6 puckering by 1 mA across 3 A has a volume of 9e-3 A^3, nine times an absolute
// 1e-3) and drop perfectly good ones whenever the coordinates are not in A.
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
  colors: Float32Array // per-vertex rgb matching positions
  edge_positions: Float32Array // 6 floats per crease edge for LineSegments
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

// === Bond graph adjacency ===

interface PolyhedronNeighbor {
  site_idx: number // index into the displayed structure's sites
  // Displacement from the center to this neighbor, non-null only for bonds carrying a
  // periodic cell_shift. Such a bond ends at a lattice image of sites[site_idx], not at
  // its in-cell position, so the vertex has to be placed at center + offset. Left null
  // for the common (proximity-perceived) case so vertices stay the exact site positions.
  offset: Vec3 | null
}

// Symmetric site_idx -> neighbor list from rendered bond pairs. Self-bonds are dropped:
// even a periodic one (an image of the center itself) shares the center's element and so
// can never clear the strictly-higher-electronegativity test in is_anion_vertex.
export function build_adjacency(
  bonds: readonly BondPair[],
): Map<number, PolyhedronNeighbor[]> {
  const adjacency = new Map<number, PolyhedronNeighbor[]>()
  const link = (from: number, to: number, offset: Vec3 | null) => {
    let neighbors = adjacency.get(from)
    if (!neighbors) adjacency.set(from, (neighbors = []))
    // The same site can appear twice through different periodic images, so dedupe on
    // (site, image) rather than site alone. Coordination shells are tiny (CN 4-12), so
    // this linear scan beats building a string key for every bond in a supercell.
    const is_dup = neighbors.some(
      (nbr) =>
        nbr.site_idx === to &&
        (nbr.offset === null
          ? offset === null
          : offset !== null &&
            nbr.offset[0] === offset[0] &&
            nbr.offset[1] === offset[1] &&
            nbr.offset[2] === offset[2]),
    )
    if (!is_dup) neighbors.push({ site_idx: to, offset })
  }
  for (const { site_idx_1, site_idx_2, pos_1, pos_2, cell_shift } of bonds) {
    if (site_idx_1 === site_idx_2) continue
    if (cell_shift === undefined || cell_shift.every((val) => val === 0)) {
      link(site_idx_1, site_idx_2, null)
      link(site_idx_2, site_idx_1, null)
    } else {
      // pos_2 already carries the lattice translation (structure_bond_to_bond_pair), so
      // the bond vector is the center -> neighbor displacement; the reverse is its negation
      const [dx, dy, dz] = [pos_2[0] - pos_1[0], pos_2[1] - pos_1[1], pos_2[2] - pos_1[2]]
      const flip = (val: number) => (val === 0 ? 0 : -val) // no -0, matching negate_cell_shift
      link(site_idx_1, site_idx_2, [dx, dy, dz])
      link(site_idx_2, site_idx_1, [flip(dx), flip(dy), flip(dz)])
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
// vertices are every bonded anion-former neighbor (nonmetals/metalloids more
// electronegative than the center) - rejecting an over-long contact is the bond
// detector's job, so there is no extra distance trim here. Spectator A-site
// cations (alkali, heavy alkaline-earth) are skipped when framework cations exist,
// CN > max_neighbors hulls (e.g. CN-12 cuboctahedra) are skipped, and
// boundary-truncated copies only render when their vertex count matches the max
// among all copies of the same original site. Corners are displayed atoms for
// proximity-perceived bonds (boundary shells are completed upstream by
// bond-completing image atoms - see find_image_atoms in pbc.ts); explicit bonds
// carrying a cell_shift put the corner at the lattice image the bond points to.
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
  } = options
  const { sites } = structure
  if (sites.length === 0 || bonds.length === 0) return []

  // Only bonds carrying a cell_shift can name a neighbor the graph already reaches under
  // another site index (an explicit record against the base atom vs a proximity match
  // against its image copy). Absent those, positions are unique by construction and the
  // coincidence scan below is skipped so large supercells don't pay for it.
  const has_shifted_bonds = bonds.some((bond) => bond.cell_shift?.some((val) => val !== 0))
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
        unique_elements.filter((n_elem) =>
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
  for (const [site_idx, neighbors] of adjacency) {
    if (neighbors.length < min_neighbors) continue
    const element = site_elements[site_idx]
    if (!element || excluded.has(element)) continue
    const { accepts, radii_sums } = center_info(element)
    if (accepts.size === 0) continue
    const [cx, cy, cz] = sites[site_idx].xyz

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
        offset === null ? sites[idx].xyz : [cx + offset[0], cy + offset[1], cz + offset[2]]
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
        norm_sum += Math.hypot(pos[0] - cx, pos[1] - cy, pos[2] - cz) / r_sum
        norm_count++
      }
    }
    if (vertex_site_idxs.length < min_neighbors) continue

    candidates.push({
      site_idx,
      orig_idx: get_orig_site_idx(sites[site_idx], site_idx),
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
  const species_norm = (el: ElementSymbol): number | null => {
    const entry = norm_by_species.get(el)
    return entry ? entry.sum / entry.count : null
  }
  const has_strong_species = [...norm_by_species.keys()].some(
    (el) => (species_norm(el) ?? Infinity) <= WEAK_BOND_NORM && !is_spectator_center(el),
  )
  const is_weak_species = (el: ElementSymbol): boolean =>
    has_strong_species && (species_norm(el) ?? 0) > WEAK_BOND_NORM

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
  for (const { site_idx, orig_idx, element, vertex_site_idxs, vertex_positions } of visible) {
    if (vertex_site_idxs.length !== max_cn_by_orig.get(orig_idx)) continue
    if (vertex_site_idxs.length > max_neighbors && !included.has(element)) continue

    const [px, py, pz] = sites[site_idx].xyz
    const pos_key = `${Math.round(px * 1e3)},${Math.round(py * 1e3)},${Math.round(pz * 1e3)}`
    if (seen_positions.has(pos_key)) continue
    seen_positions.add(pos_key)

    const hull = convex_hull_3d(vertex_positions)
    if (hull.faces.length === 0) continue
    const spans = [0, 1, 2].map((axis) => {
      const [lo, hi] = array_extent(hull.vertices.map((vert) => vert[axis]))
      return hi - lo
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

  let offset = 0
  let edge_offset = 0
  const skipped_sites: string[] = []
  // Per-polyhedron scratch: crease detection tracks the first face normal seen
  // per undirected edge (packed vert_a * 2^16 + vert_b key)
  const edge_normals = new Map<
    number,
    { nx: number; ny: number; nz: number; crease: boolean; shared: boolean }
  >()
  for (const poly of polyhedra) {
    // Rewind mark, in case this polyhedron turns out not to fit the shared edge pool below
    const poly_offset = offset
    const verts = poly.vertices
    // Resolve per-hull-vertex colors once
    const vert_rgb = new Float32Array(verts.length * 3)
    for (let v_idx = 0; v_idx < verts.length; v_idx++) {
      const channels = css_to_linear_rgb(get_vertex_color(poly, v_idx))
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

    // An edge is drawn unless both adjacent faces are coplanar (quad diagonal). Float32Array
    // drops out-of-range writes SILENTLY, so a polyhedron whose outline no longer fits the
    // shared 3F/2 pool is dropped WHOLE, triangles included, or the buffers would gap.
    let n_edges = 0
    for (const entry of edge_normals.values()) if (!entry.shared || entry.crease) n_edges++
    if (edge_offset + n_edges * 6 > edge_positions.length) {
      skipped_sites.push(`site ${poly.center_site_idx} (${poly.center_element})`)
      offset = poly_offset
      continue
    }
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

  // The 3F/2 pool is shared, so one hull convex_hull_3d failed to close exhausts it for the
  // valid polyhedra behind it: report the whole tally once, not one warning per victim
  if (skipped_sites.length > 0) {
    console.warn(
      `Edge buffer exhausted (${edge_positions.length / 6} edges): dropped ` +
        `polyhedra at ${skipped_sites.join(`, `)}`,
    )
  }
  // Trim only if a polyhedron was dropped: slice copies the whole buffer
  const dropped = offset < positions.length
  return {
    positions: dropped ? positions.slice(0, offset) : positions,
    colors: dropped ? colors.slice(0, offset) : colors,
    edge_positions: edge_positions.slice(0, edge_offset),
    triangle_count: offset / 9,
    edge_count: edge_offset / 6,
  }
}
