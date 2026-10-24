import type { BondData } from './bond-rendering'
import { BondFrame, bond_site_1, bond_site_2 } from './bond-rendering'
import { get_orig_site_idx, get_site, numeric_sites, site_count } from './site'
import { element_from_atomic_number } from '#lib/element/helpers.js'
import { get_element_counts } from './density'
// Coordination polyhedra detection: vertices come from the rendered bond graph, hulls from a
// custom quickhull tailored to small point sets (CN 4-12). Three-free, so image-atom completion
// (pbc.ts) can run it; polyhedra-render.ts builds the meshes. Hot paths use scalar math and
// per-element caches to scale to large structures.

import type { ElementSymbol } from '#lib/element/index.js'
import { element_by_symbol } from '#lib/element/data.js'
import type { Vec3 } from '#lib/math.js'
import { array_extent, array_max, same_position } from '#lib/math.js'
import { DEFAULTS } from '#lib/settings.js'
import type { DefaultSettings } from '#lib/settings.js'
import type { AnyStructure } from '#lib/structure/index.js'
import { get_majority_element, has_framework_potential, is_spectator_center } from './bonding'

export type PolyhedraColorMode = `vertex` | `center` | `uniform`

export type PolyhedraNeighborMode = `anion` | `bonded`

export interface PolyhedraOptions {
  neighbor_mode?: PolyhedraNeighborMode // bonded includes covalent and metallic shells
  min_neighbors?: number // min coordination number to form a polyhedron
  max_neighbors?: number // max CN - skips e.g. CN-12 cuboctahedra around A-site cations
  excluded_center_elements?: readonly string[] // per-element off-toggles
  included_center_elements?: readonly string[] // force-include (bypasses spectator/weak hiding + max_neighbors cap)
  electronegativity_margin?: number // vertex must be > center EN + margin
}

// A viewer's polyhedra_* settings as detection options, shared by the scene, the trajectory
// worker and image-atom completion. The CN sliders' ranges overlap, so crossed sliders widen
// the cap rather than render nothing. Element lists are copied to survive structured cloning.
export type PolyhedraSettings = Partial<
  Pick<
    DefaultSettings['structure'],
    | 'polyhedra_neighbor_mode'
    | 'polyhedra_min_neighbors'
    | 'polyhedra_max_neighbors'
    | 'polyhedra_excluded_elements'
    | 'polyhedra_included_elements'
  >
>
export type ResolvedPolyhedraOptions = Required<
  Omit<PolyhedraOptions, 'electronegativity_margin'>
>
export const polyhedra_options_from = (
  settings: PolyhedraSettings,
): ResolvedPolyhedraOptions => {
  const min_neighbors =
    settings.polyhedra_min_neighbors ?? DEFAULTS.structure.polyhedra_min_neighbors
  return {
    neighbor_mode:
      settings.polyhedra_neighbor_mode ?? DEFAULTS.structure.polyhedra_neighbor_mode,
    min_neighbors,
    max_neighbors: Math.max(
      min_neighbors,
      settings.polyhedra_max_neighbors ?? DEFAULTS.structure.polyhedra_max_neighbors,
    ),
    excluded_center_elements: [...(settings.polyhedra_excluded_elements ?? [])],
    included_center_elements: [...(settings.polyhedra_included_elements ?? [])],
  }
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
export function convex_hull_3d(points: readonly Vec3[]): ConvexHullResult {
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
  const eps = 1e-7 * Math.max(1, diag)

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
    const site_idx_1 = bond_site_1(bonds, idx)
    const site_idx_2 = bond_site_2(bonds, idx)
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
// boundary-truncated copies are skipped (pass 3). Corners are displayed atoms for
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
  // Two site indices name one physical neighbor only through a shifted bond, or as split
  // partial-occupancy sites (O 0.5 and F 0.5 stored as two sites on one position). Numeric
  // playback columns hold whole atoms, so only record sites can be split.
  const may_repeat_positions =
    (bond_data instanceof BondFrame
      ? bond_data.columns.images.some((value, idx) => idx % 7 >= 4 && value !== 0)
      : bond_data.some((bond) => bond.cell_shift?.some((val) => val !== 0))) ||
    (!columns && structure.sites.some(({ species }) => species.some(({ occu }) => occu < 1)))
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
      if (may_repeat_positions && vertex_positions.some((prev) => same_position(prev, pos)))
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

  // Pass 3: boundary completeness - copies truncated at the cell faces are skipped. Image
  // completion stamps which copies it completed (polyhedron_center), so only the rest are
  // skipped and a bond edit or hidden corner shrinks a polyhedron instead of deleting it.
  // Unstamped copies render only at the max vertex count among copies of the same original
  // site, which misses sites whose every displayed copy is truncated.
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
    const stamped = get_site(structure, site_idx)?.provenance?.polyhedron_center
    const n_vertices = vertex_site_idxs.length
    if (stamped === false) continue
    if (stamped === undefined && n_vertices !== max_cn_by_orig.get(orig_idx)) continue
    if (n_vertices > max_neighbors && !included.has(element)) continue

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
