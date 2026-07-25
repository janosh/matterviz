// Types + geometry constants for Gizmo.svelte, our WebGPU-compatible orientation gizmo.
// Kept out of the component so build_gizmo_props (props.svelte.ts) can type its return
// value without importing a .svelte module into plain .ts consumers.
import { AXIS_COLORS, NEG_AXIS_COLORS } from '$lib/colors'
import type { Vec3 } from '$lib/math'

export type GizmoAxisKey = `x` | `y` | `z` | `nx` | `ny` | `nz`

// Per-axis appearance. Mirrors the subset of three-viewport-gizmo's axis options the
// library actually set, so existing call sites keep passing the same objects.
export type GizmoAxisStyle = {
  color?: string
  labelColor?: string
  opacity?: number
  label?: string // defaults to the uppercased axis letter; negative axes are unlabeled
  hover?: { color?: string; labelColor?: string; opacity?: number }
}

// Where the gizmo sits inside its canvas. `fill` uses the whole canvas, for callers that
// already give the gizmo its own <Canvas> and position that element with CSS (ConvexHull3D).
// Named GizmoAnchor rather than GizmoPlacement because $lib/convex-hull already exports a
// GizmoPlacement (its CSS-level corner) and both barrels are re-exported from $lib.
export type GizmoAnchor = `top-left` | `top-right` | `bottom-left` | `bottom-right` | `fill`

export type GizmoOptions = {
  // Hide without unmounting. Callers that reveal the gizmo on hover (Structure) must keep it
  // mounted, since remounting the surrounding OrbitControls resets the camera rotation.
  visible?: boolean
  placement?: GizmoAnchor
  size?: number // edge length in CSS px of the square the gizmo renders into
  offset?: { left?: number; right?: number; top?: number; bottom?: number }
  // color accepts anything THREE.Color.set() takes, so callers can pass 0xrrggbb or `#rrggbb`
  background?: { enabled?: boolean; color?: string | number; opacity?: number }
  // Duration in ms of the camera fly-to when an axis handle is clicked. 0 snaps instantly.
  animation_duration?: number
} & Partial<Record<GizmoAxisKey, GizmoAxisStyle>>

export const GIZMO_AXES: readonly (readonly [GizmoAxisKey, Vec3, boolean])[] = [
  [`x`, [1, 0, 0], false],
  [`y`, [0, 1, 0], false],
  [`z`, [0, 0, 1], false],
  [`nx`, [-1, 0, 0], true],
  [`ny`, [0, -1, 0], true],
  [`nz`, [0, 0, -1], true],
] as const

// Fallback palette so a bare `gizmo` (no per-axis config) still renders the familiar
// red/green/blue axes rather than flat grey. build_gizmo_props sets these explicitly;
// callers like ScatterPlot3D that pass only layout options rely on these.
export const GIZMO_DEFAULT_COLORS = Object.fromEntries(
  [...AXIS_COLORS, ...NEG_AXIS_COLORS].map(([axis, color, hover]) => [axis, { color, hover }]),
) as Record<GizmoAxisKey, { color: string; hover: string }>

// Gizmo-space layout. The camera is orthographic with a fixed frustum, so these are
// effectively fractions of the rendered square.
export const GIZMO_LAYOUT = {
  frustum: 1.5, // half-height of the ortho frustum; handles sit at radius 1
  cam_distance: 4,
  handle_radius: 0.34,
  neg_handle_radius: 0.26,
  axis_line_radius: 0.045,
  label_scale: 0.5,
} as const
