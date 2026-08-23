// Three.js geometry construction for Fermi isosurfaces
import type { D3InterpolateName } from '$lib/colors'
import { scalars_to_vertex_colors } from '$lib/isosurface/coloring'
import type { Vec2, Vec3 } from '$lib/math'
import { BufferAttribute, BufferGeometry } from 'three/webgpu'
import type { FermiIsosurface } from './types'

export interface VertexColorSpec {
  colormap: D3InterpolateName
  color_range: Vec2
}

// Wrap a surface's typed arrays in an indexed BufferGeometry. The buffers are shared, not
// copied: the surface already stores exactly the layout the GPU wants. Returns null when
// nothing is drawable.
export function build_isosurface_geometry(surface: FermiIsosurface): BufferGeometry | null {
  const { positions, normals, indices } = surface
  if (positions.length === 0 || indices.length === 0) return null
  const geometry = new BufferGeometry()
  geometry.setAttribute(`position`, new BufferAttribute(positions, 3))
  geometry.setAttribute(`normal`, new BufferAttribute(normals, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()
  return geometry
}

// Set, refresh or remove the per-vertex colour attribute without touching positions or the
// index, so colormap/range changes never rebuild the geometry. Colours are looked up once per
// vertex through a 256-entry colormap LUT; the existing attribute's buffer is reused in place.
export function apply_vertex_colors(
  geometry: BufferGeometry,
  surface: FermiIsosurface,
  spec: VertexColorSpec | null,
): void {
  const existing = geometry.getAttribute(`color`) as BufferAttribute | undefined
  if (!spec || surface.properties?.length !== surface.positions.length / 3) {
    if (existing) geometry.deleteAttribute(`color`)
    return
  }
  const colors = scalars_to_vertex_colors(
    surface.properties,
    spec,
    existing?.array instanceof Float32Array ? existing.array : undefined,
  )
  if (existing?.array === colors) existing.needsUpdate = true
  else geometry.setAttribute(`color`, new BufferAttribute(colors, 3))
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
