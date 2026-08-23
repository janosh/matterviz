// Types, layout math and constants for Gizmo.svelte, kept out of the component so callers
// (SceneControlProps, StructureViewport) can type and size a gizmo without importing a .svelte
// module, and so the layout is unit-testable without a Threlte context.
import { AXIS_COLORS, NEG_AXIS_COLORS } from '$lib/colors'
import { clamp, type Vec3 } from '$lib/math'

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

// Where the gizmo sits inside its canvas. `fill` uses the whole canvas, for callers that give
// the gizmo its own <Canvas> and place that element with CSS (ConvexHullCanvas). Not named
// GizmoPlacement because $lib/convex-hull exports that already (its CSS-level corner).
type GizmoAnchor = `top-left` | `top-right` | `bottom-left` | `bottom-right` | `fill`

export type GizmoOptions = {
  // Hide without unmounting. Callers that reveal the gizmo on hover (Structure) must keep it
  // mounted, since remounting the surrounding OrbitControls resets the camera rotation.
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

// Where the gizmo draws, in CSS px from the canvas's top-left — the origin WebGPU viewports,
// Renderer.setViewport/setScissor and pointer coordinates all share. Kept inside the canvas:
// a viewport poking past the attachment fails WebGPU validation and drops the render pass.
export function gizmo_rect(
  { placement = `bottom-left`, size, offset = {} }: GizmoOptions,
  width: number,
  height: number,
): GizmoRect {
  if (placement === `fill`) return { x: 0, y: 0, width, height }
  // Unsized gizmos scale with the viewport, as the old DOM gizmo did via CSS clamp()
  const responsive = Math.min(100, Math.max(70, 0.18 * Math.min(width, height)))
  const box = Math.min(size ?? responsive, width, height)
  const gap = 5
  const x = placement.endsWith(`-left`)
    ? (offset.left ?? gap)
    : width - box - (offset.right ?? gap)
  const y = placement.startsWith(`top`)
    ? (offset.top ?? gap)
    : height - box - (offset.bottom ?? gap)
  return { x: clamp(x, 0, width - box), y: clamp(y, 0, height - box), width: box, height: box }
}

// Gizmo edge length for a multi-view pane. Panes are ~half the viewer, so the fixed
// single-view size would dominate them: scale with the pane's short side instead, clamped to
// stay legible when small and below the single-view size when large.
export const responsive_gizmo_size = (width: number, height: number): number => {
  const fifth_of_short_side = Math.min(width, height) * 0.2
  return Math.round(Math.max(34, Math.min(72, fifth_of_short_side)))
}

export const GIZMO_AXES: readonly (readonly [GizmoAxisKey, Vec3, boolean])[] = [
  [`x`, [1, 0, 0], false],
  [`y`, [0, 1, 0], false],
  [`z`, [0, 0, 1], false],
  [`nx`, [-1, 0, 0], true],
  [`ny`, [0, -1, 0], true],
  [`nz`, [0, 0, -1], true],
] as const

// Per-axis appearance every gizmo starts from, so a bare `gizmo` renders the familiar
// red/green/blue axes. Negatives sit denser to read as pointing away. Callers override
// individual axes through GizmoOptions.
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
