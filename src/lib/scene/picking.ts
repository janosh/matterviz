// Hit filtering for Threlte interactivity.
import type { Plane, Vector3 } from 'three/webgpu'

// Threlte dispatches a pointer event to every hit under the cursor, nearest first, so a hover
// handler that just stores its target ends up reporting the farthest one (an outer sheet behind
// the inner one the cursor is on). Passed as the interactivity() `filter`, this keeps only the
// front-most hit. Raycasts ignore clipping, so hits on the cut-away side of a clip plane are
// skipped first: otherwise an invisible, clipped-off surface would win the pick.
export function front_hit<Hit extends { point: Vector3 }>(
  hits: Hit[],
  clip_plane?: Plane | null,
): Hit[] {
  const hit = clip_plane
    ? hits.find(({ point }) => clip_plane.distanceToPoint(point) >= 0)
    : hits[0]
  return hit ? [hit] : []
}
