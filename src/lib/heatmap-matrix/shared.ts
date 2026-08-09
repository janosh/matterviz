// Shared helpers/constants used by HeatmapMatrix module pieces.

// Key format for color_overrides lookups: `${x_key}\0${y_key}`.
export const COLOR_OVERRIDE_KEY_SEPARATOR = `\0`

export const make_color_override_key = (x_key: string, y_key: string): string =>
  `${x_key}${COLOR_OVERRIDE_KEY_SEPARATOR}${y_key}`

// Pick the items of one axis that fall inside the scrolled viewport, given a uniform track
// stride. The window is computed in grid-track space, which only coincides with position in
// `visible` when every item gets a track: under hide_empty="gaps" the grid keeps a track per
// item while `visible` lists only the non-empty ones, so items have to be selected by their
// own index. Slicing by track position there shifts the window right by the number of hidden
// items preceding it and leaves the near edge of the viewport blank.
export function window_axis_tracks(
  visible: number[],
  {
    track_count,
    stride,
    scroll,
    grid_offset,
    viewport_extent,
    overscan,
    keeps_empty_tracks,
  }: {
    track_count: number
    stride: number
    scroll: number
    grid_offset: number
    viewport_extent: number
    overscan: number
    keeps_empty_tracks: boolean
  },
): number[] {
  const start = Math.max(0, Math.floor((scroll - grid_offset) / stride) - overscan)
  const end = Math.min(
    track_count,
    Math.ceil((scroll - grid_offset + viewport_extent) / stride) + overscan,
  )
  return keeps_empty_tracks
    ? visible.filter((item_idx) => item_idx >= start && item_idx < end)
    : visible.slice(start, end)
}
