// Camera framing rule for ChemPotDiagram3D. Kept out of the component so the arithmetic that
// keeps a pinned view tracking the auto-fit is testable without a WebGPU canvas.

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
  zoom !== null &&
  last_fit_zoom !== null &&
  last_fit_zoom > 0 &&
  next_fit_zoom > 0 &&
  last_fit_zoom !== next_fit_zoom
    ? (zoom * next_fit_zoom) / last_fit_zoom
    : zoom
