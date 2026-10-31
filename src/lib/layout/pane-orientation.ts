// Split direction of two-pane viewers (Trajectory, ElectronicStructure's 3D scenes)

// Side-by-side panes keep the full height at half the width, so a nearly square container
// yields tall narrow panes a step-series plot reads badly in (~900x800 gave the plot 450x800).
// Only split side by side while panes stay no more than this much taller than wide.
const MAX_PANE_TALLNESS = 1.4
// Smallest readable pane for a structure, plot or Fermi surface: a scatter spends ~80px on its
// y-axis labels plus ~10em of legend, and below ~180px height the x-axis labels eat the data.
export const MIN_PANE_SIZE = { width: 320, height: 180 }

// Which way to split a container into two equal panes. When only one split clears
// MIN_PANE_SIZE it wins regardless of shape (stacking a 490x500 chat sidebar card whose
// 245px-wide panes leave a plot no room for its axes); otherwise pane shape decides.
export function pick_pane_orientation(
  width: number,
  height: number,
): `horizontal` | `vertical` {
  if (!(width > 0 && height > 0)) return `horizontal` // not measured yet
  const side_by_side_fits = width / 2 >= MIN_PANE_SIZE.width
  const stacked_fits = height / 2 >= MIN_PANE_SIZE.height
  if (side_by_side_fits !== stacked_fits) return side_by_side_fits ? `horizontal` : `vertical`
  // a side-by-side pane is half the width and the container's full height
  return height <= (width / 2) * MAX_PANE_TALLNESS ? `horizontal` : `vertical`
}
