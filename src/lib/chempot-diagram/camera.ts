// Camera framing rules for ChemPotDiagram3D. Kept out of the component so the two decisions
// that govern when the auto-fit stops applying are testable without a WebGPU canvas.
import type { Vec3 } from '$lib/math'

// zoom is null for a perspective camera, which dollies instead of zooming
export type CameraView = { position: Vec3; target: Vec3; zoom: number | null }

// Pinning the view is what stops the diagram re-fitting itself, so only a gesture that actually
// moved the camera may earn it — a bare click must leave the derived defaults in charge.
// Damping is off on these controls, so a motionless gesture is bit-identical: no tolerance.
// A null view means no gesture is in flight (auto-rotation drives `change` without a `start`),
// which must never count as movement.
export const camera_view_changed = (
  before: CameraView | null,
  after: CameraView | null,
): boolean => {
  if (!before || !after) return false
  return (
    // an orthographic wheel moves nothing but zoom, so a pose-only check is blind to it
    after.zoom !== before.zoom ||
    after.position.some((coord, idx) => coord !== before.position[idx]) ||
    after.target.some((coord, idx) => coord !== before.target[idx])
  )
}

// Hold a pinned zoom at a constant ratio to the auto-fit, which folds in both of its inputs:
// a change in data extent and a viewport resize. Unclamped on purpose — the diagram sets no
// min/max zoom, and $lib/scene's get_orthographic_zoom_bounds would turn the fit into a
// zoom-out floor. A non-positive fit (mid-layout, zero-width container) leaves zoom untouched.
export const rescale_zoom_to_fit = (
  zoom: number | null,
  last_fit_zoom: number | null,
  next_fit_zoom: number,
): number | null =>
  // An unchanged fit short-circuits rather than multiplying by 1: that product differs from
  // `zoom` by an ulp for ~10% of values, and every such write re-runs the framing effect.
  zoom !== null && last_fit_zoom !== null && last_fit_zoom > 0 && next_fit_zoom > 0 &&
    last_fit_zoom !== next_fit_zoom
    ? (zoom * next_fit_zoom) / last_fit_zoom
    : zoom
