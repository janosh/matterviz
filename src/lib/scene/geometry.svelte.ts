// Shared geometry construction and derived-geometry disposal for Threlte scenes.
import type { Vec3 } from '$lib/math'
import { BufferAttribute, BufferGeometry } from 'three/webgpu'

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

export function line_geometry(start: Vec3, end: Vec3): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    `position`,
    new BufferAttribute(new Float32Array([...start, ...end]), 3),
  )
  return geometry
}

// Dispose geometries on dependency changes and unmount to release their GPU buffers.
// The getter transfers ownership: do not return geometries still used outside this effect.
export function dispose_on_change(
  get_geometries: () => (BufferGeometry | null | undefined)[],
): void {
  $effect(() => {
    const geometries = get_geometries()
    return () => {
      for (const geometry of geometries) geometry?.dispose()
    }
  })
}
