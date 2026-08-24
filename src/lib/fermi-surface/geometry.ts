// Three.js geometry construction for Fermi isosurfaces
import type { D3InterpolateName } from '$lib/colors'
import { set_vertex_colors } from '$lib/isosurface/coloring'
import type { Vec2, Vec3 } from '$lib/math'
import { indexed_mesh_geometry } from '$lib/scene/geometry.svelte'
import type { BufferGeometry } from 'three/webgpu'
import type { FermiIsosurface } from './types'

export interface VertexColorSpec {
  colormap: D3InterpolateName
  color_range: Vec2
}

// Wrap a surface's typed arrays in an indexed BufferGeometry (buffers shared, not copied:
// the surface already stores exactly the layout the GPU wants). Null when nothing is drawable.
export const build_isosurface_geometry = (surface: FermiIsosurface): BufferGeometry | null =>
  indexed_mesh_geometry(surface.positions, surface.indices, surface.normals)

// Whether a surface carries one scalar per vertex, i.e. can be vertex-coloured at all
export const has_vertex_properties = (
  surface: FermiIsosurface,
): surface is FermiIsosurface & { properties: Float32Array } =>
  surface.properties?.length === surface.positions.length / 3

// Set, refresh or remove the per-vertex colour attribute so colormap/range changes never
// rebuild the geometry (see set_vertex_colors)
export function apply_vertex_colors(
  geometry: BufferGeometry,
  surface: FermiIsosurface,
  spec: VertexColorSpec | null,
): void {
  if (spec && has_vertex_properties(surface))
    set_vertex_colors(geometry, surface.properties, spec)
  else if (geometry.hasAttribute(`color`)) geometry.deleteAttribute(`color`)
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
