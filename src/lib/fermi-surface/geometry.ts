// Three.js geometry construction for Fermi isosurfaces
import { set_vertex_colors, type VertexColorOptions } from '$lib/isosurface/coloring'
import { indexed_mesh_geometry } from '$lib/scene/geometry.svelte'
import type { HitFace } from '$lib/scene/props.svelte'
import type { BufferGeometry } from 'three/webgpu'
import type { FermiIsosurface } from './types'

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
  spec: VertexColorOptions | null,
): void {
  if (spec && has_vertex_properties(surface))
    set_vertex_colors(geometry, surface.properties, spec)
  else if (geometry.hasAttribute(`color`)) geometry.deleteAttribute(`color`)
}

// Index of the hit triangle's corner nearest to `point` (local geometry space): three distance
// checks against the Float32 position buffer instead of a scan over every vertex of the sheet
export function nearest_face_vertex(
  geometry: BufferGeometry,
  face: HitFace,
  point: { x: number; y: number; z: number },
): number {
  const positions = geometry.getAttribute(`position`).array
  const dist_sq = (vertex_idx: number) =>
    (positions[vertex_idx * 3] - point.x) ** 2 +
    (positions[vertex_idx * 3 + 1] - point.y) ** 2 +
    (positions[vertex_idx * 3 + 2] - point.z) ** 2
  return [face.a, face.b, face.c].reduce((best, idx) =>
    dist_sq(idx) < dist_sq(best) ? idx : best,
  )
}
