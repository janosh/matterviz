// Shared two-point line construction and derived-geometry disposal for Threlte scenes.
import type { Vec3 } from '$lib/math'
import { BufferAttribute, BufferGeometry } from 'three/webgpu'

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
