// Small geometry helpers every Threlte scene here repeats: building the two-point lines that
// axes, ticks, grids and bounding boxes are made of, and disposing derived geometry.
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

// Dispose the geometries a getter returns whenever it recomputes, and once more on unmount.
// Geometry built inside a $derived is otherwise leaked on every recompute: Threlte drops the
// object from the scene graph but never frees the GPU buffers behind it. Registers an $effect,
// so it has to be called during component init.
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
