// Three.js geometry construction for Fermi isosurfaces
import type { D3InterpolateName } from '$lib/colors'
import { scalars_to_vertex_colors } from '$lib/isosurface/coloring'
import { compute_vertex_normals } from '$lib/marching-cubes'
import type { Vec2, Vec3 } from '$lib/math'
import { BufferAttribute, BufferGeometry } from 'three/webgpu'
import type { FermiIsosurface } from './types'

export interface VertexColorSpec {
  colormap: D3InterpolateName
  color_range: Vec2
}

// Build an indexed BufferGeometry: one position/normal (and optional colour) per mesh vertex
// plus a Uint32 triangle index. N-gon faces are fan-triangulated; faces with out-of-range
// indices (malformed JSON) are dropped. Returns null when nothing is drawable.
export function build_isosurface_geometry(
  surface: FermiIsosurface,
  vertex_colors?: VertexColorSpec,
): BufferGeometry | null {
  const { vertices, faces } = surface
  const n_vertices = vertices.length
  if (n_vertices === 0 || faces.length === 0) return null

  // Count triangles first so the index buffer is allocated once
  let n_triangles = 0
  for (const face of faces) if (face.length >= 3) n_triangles += face.length - 2
  const indices = new Uint32Array(3 * n_triangles)
  let n_indices = 0
  for (const face of faces) {
    if (face.length < 3) continue
    const idx0 = face[0]
    if (idx0 < 0 || idx0 >= n_vertices) continue
    for (let fan_idx = 1; fan_idx < face.length - 1; fan_idx++) {
      const idx1 = face[fan_idx]
      const idx2 = face[fan_idx + 1]
      if (idx1 < 0 || idx1 >= n_vertices || idx2 < 0 || idx2 >= n_vertices) continue
      indices[n_indices++] = idx0
      indices[n_indices++] = idx1
      indices[n_indices++] = idx2
    }
  }
  if (n_indices === 0) return null

  const positions = new Float32Array(3 * n_vertices)
  for (let idx = 0; idx < n_vertices; idx++) positions.set(vertices[idx], 3 * idx)

  const normals = new Float32Array(3 * n_vertices)
  const has_normals = surface.normals.length === n_vertices
  const normal_source = has_normals ? surface.normals : compute_vertex_normals(vertices, faces)
  for (let idx = 0; idx < n_vertices; idx++) normals.set(normal_source[idx], 3 * idx)

  const geometry = new BufferGeometry()
  geometry.setAttribute(`position`, new BufferAttribute(positions, 3))
  geometry.setAttribute(`normal`, new BufferAttribute(normals, 3))
  geometry.setIndex(
    new BufferAttribute(
      n_indices === indices.length ? indices : indices.slice(0, n_indices),
      1,
    ),
  )

  // Colours are looked up once per vertex through a 256-entry colormap LUT (not once per
  // triangle corner through a CSS string parse as a non-indexed build would need)
  if (vertex_colors && surface.properties?.length === n_vertices) {
    const scalars = Float32Array.from(surface.properties)
    const colors = scalars_to_vertex_colors(scalars, vertex_colors)
    geometry.setAttribute(`color`, new BufferAttribute(colors, 3))
  }

  geometry.computeBoundingSphere()
  return geometry
}

// Index of the mesh vertex nearest to `point` (local geometry space), read straight from the
// Float32 position buffer so hover lookups need no Vec3 allocation
export function nearest_vertex_index(geometry: BufferGeometry, point: Vec3): number {
  const positions = geometry.getAttribute(`position`).array
  const [px, py, pz] = point
  let nearest_idx = 0
  let min_dist_sq = Infinity
  for (let idx = 0; idx < positions.length; idx += 3) {
    const dx = positions[idx] - px
    const dy = positions[idx + 1] - py
    const dz = positions[idx + 2] - pz
    const dist_sq = dx * dx + dy * dy + dz * dz
    if (dist_sq < min_dist_sq) {
      min_dist_sq = dist_sq
      nearest_idx = idx / 3
    }
  }
  return nearest_idx
}
