import type { Intersection, Object3D, Plane, Raycaster, Sphere } from 'three/webgpu'
import { InstancedMesh, Matrix4, Mesh, Ray, Vector3 } from 'three/webgpu'

// interactivity() `filter` keeping one hit, the front-most of the highest `userData.pick_rank`
// (default 0): Threlte dispatches to every hit, nearest first, so hover handlers ended on the
// farthest. Positive ranks let thin or nested targets (k-paths, rods behind a cutting plane)
// win, negative ones keep catch-all planes from shadowing. Hits clipped by `clip_plane` are
// skipped first.
export function front_hit<Hit extends { point: Vector3; object: Object3D }>(
  hits: Hit[],
  clip_plane?: Plane | null,
): Hit[] {
  let [best, best_rank]: [Hit | null, number] = [null, -Infinity]
  for (const hit of hits) {
    if (clip_plane && clip_plane.distanceToPoint(hit.point) < 0) continue
    const rank = hit.object.userData.pick_rank ?? 0
    if (rank > best_rank) [best, best_rank] = [hit, rank]
  }
  return best ? [best] : []
}

// Indices of packed sphere instances `ray` may hit (mesh-local): an analytic ray-sphere pass
// over `values`, `stride` floats per instance, xyz at `position_at`, bounding `sphere` scale
// at `scale_at`. Conservative: callers run the exact triangle test on these.
export function ray_sphere_candidates(
  ray: Ray,
  sphere: Sphere,
  values: ArrayLike<number>,
  count: number,
  { stride, position_at, scale_at }: { stride: number; position_at: number; scale_at: number },
  out: number[] = [],
): number[] {
  const { origin, direction } = ray
  out.length = 0
  for (let idx = 0; idx < count; idx++) {
    const offset = idx * stride
    const pos_offset = offset + position_at
    const scale = values[offset + scale_at]
    const delta_x = values[pos_offset] + scale * sphere.center.x - origin.x
    const delta_y = values[pos_offset + 1] + scale * sphere.center.y - origin.y
    const delta_z = values[pos_offset + 2] + scale * sphere.center.z - origin.z
    const radius = Math.abs(scale) * sphere.radius
    const along = delta_x * direction.x + delta_y * direction.y + delta_z * direction.z
    // Residual components avoid cancellation in distance² - along² for far-away rays.
    const perp_x = delta_x - along * direction.x
    const perp_y = delta_y - along * direction.y
    const perp_z = delta_z - along * direction.z
    if (along < -radius || perp_x ** 2 + perp_y ** 2 + perp_z ** 2 > radius ** 2) continue
    out.push(idx)
  }
  return out
}

// Scratch shared by the instanced pickers (also atom-instances), safe because raycasts run
// synchronously, like Three's native mesh picking
export const local_ray = new Ray()
export const scratch_matrix = new Matrix4()
export const candidate = new Mesh()
export const candidate_hits: Intersection[] = []
export const candidate_indices: number[] = []
const [world_center, world_offset] = [new Vector3(), new Vector3()]
// makeScale(r).setPosition(p) instance matrices: column-major scale at 0, translation at 12
const SCALED_TRANSLATION = { stride: 16, position_at: 12, scale_at: 0 }

// Uniformly scaled, translated sphere instances picking exactly like native instancing,
// testing triangles only where the ray-sphere pass can't rule an instance out.
export class SphereInstances extends InstancedMesh {
  // Report only the front-most hit, for hosts whose filter keeps one anyway (front_hit without
  // a clip plane): candidates are visited nearest first, stopping once none can come closer.
  nearest_only = false

  override raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    if (this.material === undefined || this.count === 0) return
    if (!this.geometry.boundingSphere) this.geometry.computeBoundingSphere()
    if (this.boundingSphere === null) this.computeBoundingSphere()
    const sphere = this.geometry.boundingSphere
    if (!sphere || !this.boundingSphere) return
    local_ray.copy(raycaster.ray).applyMatrix4(scratch_matrix.copy(this.matrixWorld).invert())
    if (!local_ray.intersectsSphere(this.boundingSphere)) return
    const { array } = this.instanceMatrix
    ray_sphere_candidates(
      local_ray,
      sphere,
      array,
      this.count,
      SCALED_TRANSLATION,
      candidate_indices,
    )
    candidate.geometry = this.geometry
    candidate.material = this.material
    if (this.nearest_only) {
      const front = this.#front_hit(raycaster, sphere)
      if (front) intersects.push(front)
      return
    }
    for (const idx of candidate_indices) {
      this.getMatrixAt(idx, scratch_matrix)
      candidate.matrixWorld.multiplyMatrices(this.matrixWorld, scratch_matrix)
      candidate.raycast(raycaster, candidate_hits)
      for (const hit of candidate_hits) {
        hit.instanceId = idx
        hit.object = this
        intersects.push(hit)
      }
      candidate_hits.length = 0
    }
  }

  // The candidates' nearest hit, ties to the lowest instance like the stable distance sort.
  // A hit inside an instance's world-space sphere lies no nearer than its centre's distance
  // along the ray minus its radius, so candidates are tested in that order until the next
  // bound passes the best hit.
  #front_hit(raycaster: Raycaster, sphere: Sphere): Intersection | null {
    const { origin, direction } = raycaster.ray
    const max_scale = this.matrixWorld.getMaxScaleOnAxis()
    const { array } = this.instanceMatrix
    const order = candidate_indices.map((idx): [number, number] => {
      const scale = array[idx * 16]
      world_center
        .copy(sphere.center)
        .multiplyScalar(scale)
        .add(world_offset.fromArray(array, idx * 16 + 12))
        .applyMatrix4(this.matrixWorld)
      // slack keeps rounding in the bound from skipping a hit right at it
      const radius = Math.abs(scale) * sphere.radius * max_scale * (1 + 1e-6)
      return [world_center.sub(origin).dot(direction) - radius, idx]
    })
    order.sort(([bound_a, idx_a], [bound_b, idx_b]) => bound_a - bound_b || idx_a - idx_b)
    let best: Intersection | null = null
    for (const [bound, idx] of order) {
      if (best && bound > best.distance) break
      this.getMatrixAt(idx, scratch_matrix)
      candidate.matrixWorld.multiplyMatrices(this.matrixWorld, scratch_matrix)
      candidate.raycast(raycaster, candidate_hits)
      for (const hit of candidate_hits) {
        const better =
          !best ||
          hit.distance < best.distance ||
          (hit.distance === best.distance && idx < (best.instanceId ?? idx))
        if (!better) continue
        hit.instanceId = idx
        hit.object = this
        best = hit
      }
      candidate_hits.length = 0
    }
    return best
  }
}
