// Kept out of picking.ts so its pure raycast helpers (atom-instances) don't load @threlte/extras
import * as extras from '@threlte/extras'
import type { Plane } from 'three/webgpu'
import { front_hit } from './picking'

// Threlte interactivity() for a 3D scene, dispatching each pointer event to the one object
// front_hit picks, so handlers never need stopPropagation() to fend off the objects behind.
// `clip_plane` is read per event, so pass a getter of reactive state. Call during component
// init, like interactivity() itself.
export const scene_interactivity = ({
  clip_plane,
}: { clip_plane?: () => Plane | null } = {}) =>
  extras.interactivity({ filter: (hits) => front_hit(hits, clip_plane?.()) })
