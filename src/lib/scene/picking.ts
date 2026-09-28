import type { Plane, Vector3 } from 'three/webgpu'

// interactivity() `filter` keeping only the front-most hit: Threlte dispatches pointer events to
// every hit under the cursor, nearest first, so a hover handler that stores its target ends up
// reporting the farthest one. Raycasts ignore clipping, so hits on the cut-away side of
// `clip_plane` are skipped first, else an invisible, clipped-off surface would win the pick.
export const front_hit = <Hit extends { point: Vector3 }>(
  hits: Hit[],
  clip_plane?: Plane | null,
): Hit[] =>
  hits.filter(({ point }) => (clip_plane?.distanceToPoint(point) ?? 0) >= 0).slice(0, 1)
