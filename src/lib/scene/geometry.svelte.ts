// Shared geometry construction and derived-geometry disposal for Threlte scenes.
import type { Vec3 } from '#lib/math.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { BufferAttribute, BufferGeometry, Line2NodeMaterial } from 'three/webgpu'

// Indexed triangle mesh from flat xyz positions and index triples (marching-cubes output,
// parsed Fermi sheets). The typed arrays are shared with the geometry, not copied; normals
// are taken when given and computed from the faces otherwise. Null when nothing is drawable.
export function indexed_mesh_geometry(
  positions: Float32Array,
  indices: Uint32Array,
  normals?: Float32Array,
): BufferGeometry | null {
  if (positions.length === 0 || indices.length === 0) return null
  const geometry = new BufferGeometry()
  geometry.setAttribute(`position`, new BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  if (normals) geometry.setAttribute(`normal`, new BufferAttribute(normals, 3))
  else geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

// Non-indexed geometry from flat xyz positions (triangle soup for meshes, vertex pairs for
// LineSegments)
export const positions_geometry = (positions: ArrayLike<number>): BufferGeometry =>
  new BufferGeometry().setAttribute(
    `position`,
    new BufferAttribute(new Float32Array(positions), 3),
  )

export const line_geometry = (start: Vec3, end: Vec3): BufferGeometry =>
  positions_geometry([...start, ...end])

// Vertex index of each corner of triangle `face`, for indexed and non-indexed geometry alike
export const corner_vertex = (
  geometry: BufferGeometry,
  face: number,
  corner: number,
): number => (geometry.index ? geometry.index.getX(3 * face + corner) : 3 * face + corner)

// Mean corner of the triangles `faces` (indices into the source's triangles): a point on a
// surface patch, e.g. where a KeyWalk points the tooltip at it
export function faces_centroid(geometry: BufferGeometry, faces: readonly number[]): Vec3 {
  const source = geometry.getAttribute(`position`)
  const sum: Vec3 = [0, 0, 0]
  for (const face of faces) {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = corner_vertex(geometry, face, corner)
      sum[0] += source.getX(vertex)
      sum[1] += source.getY(vertex)
      sum[2] += source.getZ(vertex)
    }
  }
  const n_corners = 3 * faces.length
  return [sum[0] / n_corners, sum[1] / n_corners, sum[2] / n_corners]
}

// Non-indexed copy of the triangles `faces` (indices into the source's triangles)
export function triangle_subset(
  geometry: BufferGeometry,
  faces: readonly number[],
): BufferGeometry {
  const source = geometry.getAttribute(`position`)
  const positions = new Float32Array(9 * faces.length)
  for (const [face_pos, face] of faces.entries()) {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = corner_vertex(geometry, face, corner)
      const offset = 9 * face_pos + 3 * corner
      positions[offset] = source.getX(vertex)
      positions[offset + 1] = source.getY(vertex)
      positions[offset + 2] = source.getZ(vertex)
    }
  }
  return new BufferGeometry().setAttribute(`position`, new BufferAttribute(positions, 3))
}

// Boundary of a set of triangles (`faces`, default all) as flat xyz vertex pairs: the edges
// used by exactly one of them. Corners weld by position rounded to 1e-4, so triangle soups and
// vertices reached along different paths (~1e-12 apart) share their edges.
export function boundary_edges(
  geometry: BufferGeometry,
  faces?: readonly number[],
): Float32Array {
  const source = geometry.getAttribute(`position`)
  const face_count = faces?.length ?? (geometry.index?.count ?? source.count) / 3
  const n_corners = 3 * face_count
  // Both lookups are open-addressing hash tables over typed arrays: string-keyed (position)
  // and number-keyed (edge) Maps took 0.45 s for a 260k-vertex sheet, a stall on every hover
  const weld_mask = hash_capacity(Math.min(source.count, n_corners)) - 1
  const weld_ids = new Int32Array(weld_mask + 1).fill(-1)
  const weld_keys = new Float64Array(3 * (weld_mask + 1)) // rounded xyz per occupied slot
  let n_welded = 0
  const welded_of_vertex = new Int32Array(source.count).fill(-1)
  const corners = new Int32Array(n_corners) // source vertex per corner
  const welded = new Int32Array(n_corners) // welded vertex per corner
  for (let face_pos = 0; face_pos < face_count; face_pos++) {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = corner_vertex(geometry, faces?.[face_pos] ?? face_pos, corner)
      if (welded_of_vertex[vertex] === -1) {
        const key_x = Math.round(source.getX(vertex) * 1e4)
        const key_y = Math.round(source.getY(vertex) * 1e4)
        const key_z = Math.round(source.getZ(vertex) * 1e4)
        let slot = hash_ints(key_x, key_y, key_z) & weld_mask
        while (
          weld_ids[slot] !== -1 &&
          (weld_keys[3 * slot] !== key_x ||
            weld_keys[3 * slot + 1] !== key_y ||
            weld_keys[3 * slot + 2] !== key_z)
        )
          slot = (slot + 1) & weld_mask
        if (weld_ids[slot] === -1) {
          weld_ids[slot] = n_welded++
          weld_keys[3 * slot] = key_x
          weld_keys[3 * slot + 1] = key_y
          weld_keys[3 * slot + 2] = key_z
        }
        welded_of_vertex[vertex] = weld_ids[slot]
      }
      corners[3 * face_pos + corner] = vertex
      welded[3 * face_pos + corner] = welded_of_vertex[vertex]
    }
  }
  const next_corner = (slot: number) => (slot % 3 === 2 ? slot - 2 : slot + 1)
  // per edge (welded id pair): the corner starting its only use, -1 once a second triangle
  // shares it, -2 for an empty slot; `edge_order` lists the edges in first-use order
  const edge_mask = hash_capacity(n_corners) - 1
  const edge_use = new Int32Array(edge_mask + 1).fill(-2)
  const edge_low = new Int32Array(edge_mask + 1)
  const edge_high = new Int32Array(edge_mask + 1)
  const edge_order = new Int32Array(n_corners)
  let n_edges = 0
  for (let slot = 0; slot < n_corners; slot++) {
    const [id_a, id_b] = [welded[slot], welded[next_corner(slot)]]
    if (id_a === id_b) continue // collapsed edge of a degenerate triangle
    const [low, high] = id_a < id_b ? [id_a, id_b] : [id_b, id_a]
    let entry = hash_ints(low, high, 0) & edge_mask
    while (edge_use[entry] !== -2 && (edge_low[entry] !== low || edge_high[entry] !== high))
      entry = (entry + 1) & edge_mask
    if (edge_use[entry] === -2) {
      edge_low[entry] = low
      edge_high[entry] = high
      edge_use[entry] = slot
      edge_order[n_edges++] = entry
    } else edge_use[entry] = -1
  }
  const edges: number[] = []
  for (let edge_idx = 0; edge_idx < n_edges; edge_idx++) {
    const slot = edge_use[edge_order[edge_idx]]
    if (slot === -1) continue
    for (const vertex of [corners[slot], corners[next_corner(slot)]])
      edges.push(source.getX(vertex), source.getY(vertex), source.getZ(vertex))
  }
  return Float32Array.from(edges)
}

// Power-of-two table size at most half full for `count` keys
const hash_capacity = (count: number): number =>
  2 ** Math.ceil(Math.log2(Math.max(16, 2 * count)))

// 32-bit mix of three integers (murmur3 finalizer), for the linear-probing tables above.
// Math.imul wraps each argument to int32 itself; equality is checked on the full keys.
const hash_ints = (first: number, second: number, third: number): number => {
  let hash =
    Math.imul(first, 0x9e3779b1) ^ Math.imul(second, 0x85ebca77) ^ Math.imul(third, 0xc2b2ae3d)
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  return hash >>> 0
}

// Line segments (flat xyz vertex pairs) at a fixed screen width: GPU APIs ignore `linewidth`
// on basic lines. Opaque, so round caps overlapping at shared corners stay invisible. The
// caller owns the geometry and material (dispose_on_change).
export const fat_lines = (positions: ArrayLike<number>, color: string): LineSegments2 =>
  new LineSegments2(
    new LineSegmentsGeometry().setPositions(Float32Array.from(positions)),
    new Line2NodeMaterial({ color, linewidth: 2.5 }),
  )

// Dispose geometries (or materials) on dependency changes and unmount to release their GPU
// buffers. The getter transfers ownership: do not return ones still used outside this effect.
export function dispose_on_change(
  get_disposables: () => ({ dispose: () => void } | null | undefined)[],
): void {
  $effect(() => {
    const disposables = get_disposables()
    return () => {
      for (const disposable of disposables) disposable?.dispose()
    }
  })
}

// Radius of a hovered or selected sphere's translucent shell, as a multiple of the sphere's:
// just outside it, so the shell outlines the sphere rather than a bulkier one around it
export const HOVER_SHELL_SCALE = 1.04

// Material props of a translucent mesh's depth-only pre-pass. One translucent mesh draws its
// triangles in index order, not back to front, so with depth writes on, a far layer of it shows
// through a near one only where it happens to draw first (stripes along a marching-cubes or
// surface grid). Drawing its depth first leaves just the front-most layer to blend. transparent
// keeps it in the colour pass's sort list; one pass suffices for depth (three otherwise splits a
// translucent DoubleSide material into back and front draws). Its polygon offset should sit a
// few units behind its colour pass's, so that pass's front layer passes the depth test whatever
// the rounding between the two materials' vertex shaders.
export const depth_prepass_props = (polygon_offset_units: number) => ({
  colorWrite: false,
  transparent: true,
  forceSinglePass: true,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: polygon_offset_units,
})
