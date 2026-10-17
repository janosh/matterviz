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
const n_triangles = (geometry: BufferGeometry): number =>
  (geometry.index?.count ?? geometry.getAttribute(`position`).count) / 3

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
  const face_count = faces?.length ?? n_triangles(geometry)
  const welded_of_vertex = new Int32Array(source.count).fill(-1)
  const welded_ids = new Map<string, number>()
  const corners = new Int32Array(3 * face_count) // source vertex per corner
  const welded = new Int32Array(3 * face_count) // welded vertex per corner
  for (let face_pos = 0; face_pos < face_count; face_pos++) {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = corner_vertex(geometry, faces?.[face_pos] ?? face_pos, corner)
      if (welded_of_vertex[vertex] === -1) {
        const key = [source.getX(vertex), source.getY(vertex), source.getZ(vertex)]
          .map((coord) => Math.round(coord * 1e4))
          .join(`,`)
        let id = welded_ids.get(key)
        if (id === undefined) welded_ids.set(key, (id = welded_ids.size))
        welded_of_vertex[vertex] = id
      }
      corners[3 * face_pos + corner] = vertex
      welded[3 * face_pos + corner] = welded_of_vertex[vertex]
    }
  }
  const next_corner = (slot: number) => (slot % 3 === 2 ? slot - 2 : slot + 1)
  // edge key -> the corner starting its only use, or -1 once a second triangle shares it
  const first_use = new Map<number, number>()
  for (let slot = 0; slot < corners.length; slot++) {
    const [id_a, id_b] = [welded[slot], welded[next_corner(slot)]]
    if (id_a === id_b) continue // collapsed edge of a degenerate triangle
    const key = Math.min(id_a, id_b) * welded_ids.size + Math.max(id_a, id_b)
    first_use.set(key, first_use.has(key) ? -1 : slot)
  }
  const edges: number[] = []
  for (const slot of first_use.values()) {
    if (slot === -1) continue
    for (const vertex of [corners[slot], corners[next_corner(slot)]])
      edges.push(source.getX(vertex), source.getY(vertex), source.getZ(vertex))
  }
  return Float32Array.from(edges)
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
