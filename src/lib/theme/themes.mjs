// MatterViz color themes.
// Note: This file needs to be symlinked into static/ to be importable by app.html before initial page render to prevent flashing colors before client-side JS kicks in. It also needs to be in src/lib so it gets packaged and shipped to NPM for use by the anywidgets in pymatviz.
// Can't use exports in this file as would then require type="module" in app.html to import which would defer until after HTML is ready (module files are always deferred).

// Text colors (also GitHub corner bg + plot legend item color)
const txt = {
  light: `#374151`, // Dark gray
  dark: `#eee`, // Light gray
  white: `#000000`, // Black
  black: `#f5f5f5`, // Off-white
}

// Page backgrounds (also fullscreen structure bg + GitHub corner fg)
const page_bg = {
  light: `#f1f3f5`, // Light gray
  dark: `#18171c`, // Very dark blue
  white: `#ffffff`, // Pure white
  black: `#000000`, // Pure black
}

// Accents
const acc_light = `#4f46e5` // Indigo
const acc_dark = `cornflowerblue` // Light blue
const acc_white = `#2563eb` // Blue
const acc_black = `cornflowerblue`

// Helper for common button-like background patterns
const btn_bg = (dark_op, light_op) => ({
  light: `rgba(0, 0, 0, ${light_op})`,
  dark: `rgba(255, 255, 255, ${dark_op})`,
  white: `rgba(0, 0, 0, ${light_op})`,
  black: `rgba(255, 255, 255, ${dark_op})`,
})

// Slight contrast shading drawn behind plot SVGs and structure canvases so they read
// as panels sitting on top of the page background. Shared so a plot and a structure
// shown side by side (e.g. trajectory view) get an identical tint. Kept subtle; light
// modes darken, dark modes lighten.
const canvas_bg = {
  light: `rgba(0, 0, 0, 0.03)`,
  dark: `rgba(255, 255, 255, 0.07)`,
  white: `rgba(0, 0, 0, 0.025)`,
  black: `rgba(255, 255, 255, 0.1)`,
}

const themes = {
  // Core colors
  'page-bg': page_bg,
  'text-color': txt,
  'surface-bg': {
    light: `rgb(237, 238, 239)`,
    dark: `rgb(33, 36, 43)`,
    white: `rgb(250, 250, 250)`,
    black: `rgb(19, 19, 19)`,
  },
  'border-color': {
    light: `#d1d5db`, // Gray border
    dark: `#404040`, // Dark gray border
    white: `#d1d5db`,
    black: `#404040`,
  },
  'accent-color': {
    light: acc_light,
    dark: acc_dark,
    white: acc_white,
    black: acc_black,
  },

  // Hover states
  'surface-bg-hover': {
    light: `#e5e7eb`,
    dark: `#3a3a3a`,
    white: `#f3f3f3`,
    black: `#1f1f1f`,
  },
  'accent-hover-color': {
    light: `#3730a3`,
    dark: `#3b82f6`,
    white: `#1d4ed8`,
    black: `#0ea5e9`,
  },

  // Code/pre backgrounds
  'code-bg': {
    light: `rgba(0, 0, 0, 0.05)`,
    dark: `rgba(255, 255, 255, 0.1)`,
    white: `rgba(0, 0, 0, 0.02)`,
    black: `rgba(255, 255, 255, 0.1)`,
  },
  'pre-bg': {
    light: `rgba(0, 0, 0, 0.03)`,
    dark: `rgba(255, 255, 255, 0.05)`,
    white: `rgba(0, 0, 0, 0.02)`,
    black: `rgba(255, 255, 255, 0.1)`,
  },

  // Semantic colors (same across themes)
  'success-color': {
    light: `#10b981`,
    dark: `#10b981`,
    white: `#059669`,
    black: `#34d399`,
  },
  'warning-color': {
    light: `#f59e0b`,
    dark: `#f59e0b`,
    white: `#d97706`,
    black: `#fbbf24`,
  },
  'error-color': {
    light: `#ef4444`,
    dark: `#ef4444`,
    white: `#dc2626`,
    black: `#f87171`,
  },
  'error-btn-bg': {
    light: `#dc2626`,
    dark: `#7f1d1d`,
    white: `#b91c1c`,
    black: `#991b1b`,
  },
  'error-btn-bg-hover': {
    light: `#b91c1c`,
    dark: `#991b1b`,
    white: `#991b1b`,
    black: `#7f1d1d`,
  },
  'error-border': {
    light: `1px solid #fca5a5`,
    dark: `1px solid #dc2626`,
    white: `1px solid #fecaca`,
    black: `1px solid #991b1b`,
  },
  'text-color-muted': {
    light: `#6b7280`,
    dark: `#9ca3af`,
    white: `#374151`,
    black: `#d1d5db`,
  },

  // Interactive elements (buttons, etc.)
  'btn-bg': btn_bg(0.3, 0.12),
  'btn-bg-hover': btn_bg(0.2, 0.25),
  'btn-disabled-bg': btn_bg(0.1, 0.05),

  // Tooltips
  'tooltip-bg': {
    light: `rgba(243, 244, 246, 0.95)`,
    dark: `rgba(0, 40, 60, 0.95)`,
    white: `rgba(255, 255, 255, 0.98)`,
    black: `rgba(20, 20, 20, 0.98)`,
  },
  'canvas-tooltip-bg': {
    light: `rgba(226, 232, 240, 0.96)`,
    dark: `rgba(15, 23, 42, 0.96)`,
    white: `rgba(241, 245, 249, 0.98)`,
    black: `rgba(20, 20, 20, 0.98)`,
  },
  'canvas-tooltip-text-color': {
    light: `#0f172a`,
    dark: `#f8fafc`,
    white: `#0f172a`,
    black: `#f8fafc`,
  },
  'tooltip-border': {
    light: `1px solid rgba(0, 0, 0, 0.15)`,
    dark: `1px solid rgba(255, 255, 255, 0.15)`,
    white: `1px solid rgba(0, 0, 0, 0.075)`,
    black: `1px solid rgba(255, 255, 255, 0.075)`,
  },

  // Plot & structure canvas backgrounds (shared subtle panel shading)
  'plot-bg': canvas_bg,
  'struct-bg': canvas_bg,
  'struct-bg-fullscreen': page_bg,

  // Pane backgrounds (DraggablePane, etc.)
  'pane-bg': {
    light: `rgb(229, 231, 235)`,
    dark: `rgb(28 29 33)`,
    white: `rgb(248, 250, 252)`,
    black: `rgb(26, 26, 26)`,
  },
  'pane-border': {
    light: `1px solid rgba(0, 0, 0, 0.15)`,
    dark: `1px solid rgba(255, 255, 255, 0.15)`,
    white: `1px solid rgba(0, 0, 0, 0.075)`,
    black: `1px solid rgba(255, 255, 255, 0.075)`,
  },
  'pane-bg-hover': {
    light: `rgba(0, 0, 0, 0.06)`,
    dark: `rgba(255, 255, 255, 0.1)`,
    white: `rgba(0, 0, 0, 0.03)`,
    black: `rgba(255, 255, 255, 0.1)`,
  },

  // Dropzone states
  'dropzone-border': {
    light: `1px solid #9ca3af`,
    dark: `1px solid #4a5568`,
    white: `1px solid #e5e7eb`,
    black: `1px solid #374151`,
  },
  'dropzone-bg': {
    light: `rgba(0, 0, 0, 0.02)`,
    dark: `rgba(45, 55, 72, 0.5)`,
    white: `rgba(0, 0, 0, 0.01)`,
    black: `rgba(15, 15, 15, 0.7)`,
  },
  'dragover-border': {
    light: `1px solid ${acc_light}`,
    dark: `1px solid #007acc`,
    white: `1px solid ${acc_white}`,
    black: `1px solid #0ea5e9`,
  },
  'dragover-bg': {
    light: `rgba(79, 70, 229, 0.1)`,
    dark: `rgba(0, 122, 204, 0.1)`,
    white: `rgba(37, 99, 235, 0.05)`,
    black: `rgba(14, 165, 233, 0.05)`,
  },

  // Navigation links
  'nav-link-bg': btn_bg(0.15, 0.05),
  'nav-link-bg-hover': btn_bg(0.2, 0.1),
  'nav-link-active-color': {
    light: `darkseagreen`,
    dark: `mediumseagreen`,
    white: `coral`,
    black: `lightseagreen`,
  },

  // Plot legend
  'plot-legend-bg-color': {
    light: `rgba(255, 255, 255, 0.6)`,
    dark: `rgba(0, 0, 0, 0.2)`,
    white: `rgba(255, 255, 255, 0.9)`,
    black: `rgba(0, 0, 0, 0.3)`,
  },
  'plot-legend-border': {
    light: `1px solid rgba(0, 0, 0, 0.2)`,
    dark: `1px solid rgba(255, 255, 255, 0.2)`,
    white: `1px solid rgba(0, 0, 0, 0.1)`,
    black: `1px solid rgba(255, 255, 255, 0.1)`,
  },
  'plot-legend-item-color': txt,
  'plot-legend-item-hover-bg-color': btn_bg(0.1, 0.1),

  'github-corner-color': page_bg,
  'github-corner-bg': txt,
  'github-corner-bg-hover': {
    light: `#1e40af`, // Darker, more modest blue for light mode
    dark: `#60a5fa`, // Lighter blue for dark mode
    white: `#1e3a8a`, // Deep navy blue for white mode
    black: `#38bdf8`, // Cyan-blue for black mode
  },
}

// Generate flattened themes and export
const light = {}
const dark = {}
const white = {}
const black = {}
for (const [key, values] of Object.entries(themes)) {
  light[key] = values.light
  dark[key] = values.dark
  white[key] = values.white
  black[key] = values.black
}

// Export for global access
globalThis.MATTERVIZ_THEMES = { light, dark, white, black }
globalThis.MATTERVIZ_CSS_MAP = Object.fromEntries(
  Object.keys(themes).map((key) => [key, `--${key}`]),
)
