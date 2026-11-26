// Types, layout math and constants for Gizmo.svelte, so callers can type and size a gizmo
// without importing a .svelte module and the layout is testable without a Threlte context.
import { clamp } from 'svelte-widgets/utils'
import { AXIS_COLORS, NEG_AXIS_COLORS } from '#lib/colors/index'
import type { Vec3 } from '#lib/math'

export type GizmoAxisKey = `x` | `y` | `z` | `nx` | `ny` | `nz`

// Per-axis appearance (colors, label, opacity, and their hover overrides)
export type GizmoAxisStyle = {
  color?: string
  labelColor?: string
  opacity?: number
  label?: string // defaults to the uppercased axis letter; negative axes are unlabeled
  hover?: { color?: string; labelColor?: string; opacity?: number }
}

// Where the gizmo sits in its canvas; `fill` for a gizmo with its own CSS-placed <Canvas>
// (ConvexHullCanvas). Not GizmoPlacement, which #lib/convex-hull exports already.
type GizmoAnchor = `top-left` | `top-right` | `bottom-left` | `bottom-right` | `fill`

export type GizmoOptions = {
  // Hide without unmounting (remounting the surrounding OrbitControls resets the camera
  // rotation). Defaults to showing only while the enclosing viewer is hovered or focused.
  visible?: boolean
  placement?: GizmoAnchor
  size?: number // edge length in CSS px of the square the gizmo renders into
  offset?: { left?: number; right?: number; top?: number; bottom?: number }
  // Duration in ms of the camera fly-to when an axis handle is clicked. 0 snaps instantly.
  animation_duration?: number
  // Duration in ms of the opacity fade when `visible` flips. 0 appears/disappears instantly.
  fade_duration?: number
} & Partial<Record<GizmoAxisKey, GizmoAxisStyle>>

type GizmoRect = { x: number; y: number; width: number; height: number }

// Where the gizmo draws, in CSS px from the canvas's top-left (as viewports, scissors and
// pointers), inside the canvas: a viewport past the attachment fails WebGPU validation.
export function gizmo_rect(
  { placement = `bottom-left`, size, offset = {} }: GizmoOptions,
  width: number,
  height: number,
): GizmoRect {
  if (placement === `fill`) return { x: 0, y: 0, width, height }
  // Unsized gizmos scale with the viewport
  const responsive = clamp(0.18 * Math.min(width, height), 70, 100)
  const box = Math.min(size ?? responsive, width, height)
  const gap = 5
  const coord_x = placement.endsWith(`-left`)
    ? (offset.left ?? gap)
    : width - box - (offset.right ?? gap)
  const coord_y = placement.startsWith(`top`)
    ? (offset.top ?? gap)
    : height - box - (offset.bottom ?? gap)
  return {
    x: clamp(coord_x, 0, width - box),
    y: clamp(coord_y, 0, height - box),
    width: box,
    height: box,
  }
}

// Gizmo edge length for a multi-view pane: scales with its short side, clamped to stay legible
// when small and below the fixed single-view size when large.
export const responsive_gizmo_size = (width: number, height: number): number =>
  Math.round(clamp(Math.min(width, height) * 0.2, 34, 72))

export const GIZMO_AXES: readonly (readonly [GizmoAxisKey, Vec3, boolean])[] = [
  [`x`, [1, 0, 0], false],
  [`y`, [0, 1, 0], false],
  [`z`, [0, 0, 1], false],
  [`nx`, [-1, 0, 0], true],
  [`ny`, [0, -1, 0], true],
  [`nz`, [0, 0, -1], true],
] as const

// Default per-axis appearance (red/green/blue, negatives denser to read as pointing away),
// overridden per axis through GizmoOptions
export const GIZMO_DEFAULT_STYLES = Object.fromEntries(
  [...AXIS_COLORS, ...NEG_AXIS_COLORS].map(([axis, color, hover]) => [
    axis,
    {
      color,
      labelColor: `#111`,
      opacity: axis.startsWith(`n`) ? 0.9 : 0.8,
      hover: { color: hover, labelColor: `#222`, opacity: axis.startsWith(`n`) ? 1 : 0.9 },
    },
  ]),
) as Record<GizmoAxisKey, GizmoAxisStyle>

// Gizmo-space layout. The camera is orthographic with a fixed frustum, so these are
// effectively fractions of the rendered square.
export const GIZMO_LAYOUT = {
  frustum: 1.5, // half-height of the ortho frustum; handles sit at radius 1
  cam_distance: 4,
  handle_radius: 0.2,
  neg_handle_radius: 0.23,
  axis_line_radius: 0.045,
  // Letters fill a bit more of the smaller handle so they stay legible at ~90px gizmos
  label_scale: 0.46,
} as const
