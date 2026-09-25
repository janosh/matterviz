import type { Vec3 } from '$lib/math'
import {
  Color,
  InstancedMesh,
  type Material,
  Matrix4,
  type SphereGeometry,
} from 'three/webgpu'

// One instance of a shared unit sphere: scene position, uniform scale and color
export interface PointInstanceSpec {
  position: Vec3
  radius: number
  color: string
}

// Scratch shared by synchronous writes
const scratch_matrix = new Matrix4()
const scratch_color = new Color()

// Grow capacity geometrically so a slowly growing point count doesn't rebuild every update
const grow_capacity = (capacity: number, needed: number): number =>
  Math.max(needed, Math.ceil(capacity * 1.5))

// Write every instance into one InstancedMesh, reusing `mesh` while it has room. Buffers
// upload only here, on data change, so an idle on-demand scene stops rendering. Returns the
// mesh to keep (a fresh one when capacity grew, the old one disposed) or null for no items.
export function sync_point_mesh(
  mesh: InstancedMesh | null,
  geometry: SphereGeometry,
  material: Material,
  items: readonly PointInstanceSpec[],
): InstancedMesh | null {
  if (items.length === 0) {
    mesh?.dispose()
    return null
  }
  let target = mesh
  if (!target || target.instanceMatrix.count < items.length) {
    mesh?.dispose()
    target = new InstancedMesh(
      geometry,
      material,
      grow_capacity(mesh?.instanceMatrix.count ?? 0, items.length),
    )
  }
  target.geometry = geometry
  target.material = material
  for (let idx = 0; idx < items.length; idx++) {
    const { position, radius, color } = items[idx]
    scratch_matrix.makeScale(radius, radius, radius).setPosition(...position)
    target.setMatrixAt(idx, scratch_matrix)
    target.setColorAt(idx, scratch_color.set(color))
  }
  target.count = items.length
  target.instanceMatrix.needsUpdate = true
  if (target.instanceColor) target.instanceColor.needsUpdate = true
  // Bounds follow the uploaded instances, so frustum culling and raycasting stay exact
  target.computeBoundingSphere()
  return target
}
