// Shared helpers/constants used by HeatmapMatrix module pieces.

// Key format for color_overrides lookups: `${x_key}\0${y_key}`.
export const COLOR_OVERRIDE_KEY_SEPARATOR = `\0`

export const make_color_override_key = (x_key: string, y_key: string): string =>
  `${x_key}${COLOR_OVERRIDE_KEY_SEPARATOR}${y_key}`
