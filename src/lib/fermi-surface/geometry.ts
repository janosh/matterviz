// Three.js geometry construction for Fermi isosurfaces
import {
  compute_scalar_range,
  set_vertex_colors,
  type VertexColorOptions,
} from '#lib/isosurface/coloring.js'
import type { Vec2 } from '#lib/math.js'
import { indexed_mesh_geometry } from '#lib/scene/geometry.svelte.js'
import type { HitFace } from '#lib/scene/props.svelte.js'
import type { BufferGeometry } from 'three/webgpu'
import type { BandGridData, FermiIsosurface, FermiSurfaceData } from './types'
import { vertex_count } from './types'

// Wrap a surface's typed arrays in an indexed BufferGeometry (buffers shared, not copied:
// the surface already stores exactly the layout the GPU wants). Null when nothing is drawable.
export const build_isosurface_geometry = (surface: FermiIsosurface): BufferGeometry | null =>
  indexed_mesh_geometry(surface.positions, surface.indices, surface.normals)

// Values of the named property on a surface when it holds one per vertex, i.e. when the
// surface can be vertex-coloured by it
export const vertex_property = (
  surface: FermiIsosurface,
  name: string | undefined,
): Float32Array | undefined => {
  const values = name === undefined ? undefined : surface.properties?.[name]
  return values?.length === vertex_count(surface) ? values : undefined
}

// Names of the per-vertex properties the surfaces carry, in first-seen order
export const property_names = (surfaces: readonly FermiIsosurface[]): string[] => [
  ...new Set(surfaces.flatMap((surface) => Object.keys(surface.properties ?? {}))),
]

// Properties a viewer can colour by. A band grid names them up front (every sheet gets all of
// them), so the list neither empties while extraction is pending nor when mu crosses no band.
export const available_property_names = (
  fermi_data?: FermiSurfaceData,
  band_data?: Pick<BandGridData, `properties`>,
): string[] =>
  band_data
    ? Object.keys(band_data.properties ?? {})
    : property_names(fermi_data?.isosurfaces ?? [])

// [min, max] of a property's finite values over the surfaces (NaN marks vertices without one)
export const property_value_range = (
  surfaces: readonly FermiIsosurface[],
  name: string | undefined,
): Vec2 =>
  compute_scalar_range(
    surfaces.flatMap((surface) => vertex_property(surface, name) ?? []),
    { symmetric: false },
  )

// Set, refresh or remove the per-vertex colour attribute so colormap/range changes never
// rebuild the geometry (see set_vertex_colors). `values` is the colouring property's
// per-vertex array (see vertex_property); without it the attribute is removed.
export function apply_vertex_colors(
  geometry: BufferGeometry,
  values: Float32Array | undefined,
  spec: VertexColorOptions | null,
): void {
  if (spec && values) set_vertex_colors(geometry, values, spec)
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
