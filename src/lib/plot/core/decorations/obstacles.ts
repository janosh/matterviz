import type { Rect } from '$lib/plot/core/layout'
import type { DecorationPoint } from './types'

export { build_obstacles_norm, clip_bar } from '$lib/plot/core/auto-place'

// Project a decoration-independent normalized obstacle field into the final plot rectangle.
export const project_obstacles = (
  obstacles_norm: readonly DecorationPoint[],
  plot_bounds: Rect,
): DecorationPoint[] =>
  obstacles_norm.map(({ x, y }) => ({
    x: plot_bounds.x + x * plot_bounds.width,
    y: plot_bounds.y + y * plot_bounds.height,
  }))
