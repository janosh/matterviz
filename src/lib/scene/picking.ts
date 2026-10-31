import type { Intersection, Object3D, Plane, Raycaster, Sphere } from 'three/webgpu'
import { InstancedMesh, Matrix4, Mesh, Ray, Vector3 } from 'three/webgpu'

// interactivity() `filter` keeping a single hit: the front-most one among those whose object has
// the highest `userData.pick_rank` (default 0). Threlte dispatches pointer events to every hit
// under the cursor, nearest first, so a hover handler that stores its target ends up reporting
// the farthest one. A positive rank lets thin or nested targets win over surfaces in front of
// them (k-paths through a zone, rods behind a cutting plane), a negative one keeps catch-all
// planes from shadowing the objects behind them. Raycasts ignore clipping, so hits on the
// cut-away side of `clip_plane` are skipped first, else an invisible, clipped-off surface would
// win the pick.
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

// Indices of packed sphere instances `ray` may hit, all in the mesh's local space: one
// analytic ray-sphere pass over `values`, `stride` floats per instance with its xyz at
// `position_at` and a uniform scale of the shared geometry's bounding `sphere` at `scale_at`.
// Conservative (triangles lie inside the bounding sphere), so callers run Three's exact
// triangle test only on these candidates.
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

// InstancedMesh whose instance matrices are uniform scales plus translations (spheres). Picks
// like Three's native instancing (same hits, distances and instanceIds) but runs the matrix
// products and triangle tests only for instances the analytic ray-sphere pass can't rule out.
export class SphereInstances extends InstancedMesh {
  // Report only the front-most hit (the one Raycaster's distance sort puts first), for hosts
  // whose pointer filter keeps one hit per object anyway (scene_interactivity's front_hit
  // without a clip plane). A dense cloud hands the triangle test hundreds of candidates under
  // the cursor; this visits them nearest first and stops once none can come closer.
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
