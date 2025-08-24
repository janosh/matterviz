// MatterViz color themes.
// Note: This file needs to be symlinked into static/ to be importable by app.html before initial page render to prevent flashing colors before client-side JS kicks in. It also needs to be in src/lib so it gets packaged and shipped to NPM for use by the anywidgets in pymatviz.
// Can't use exports in this file as would then require type="module" in app.html to import which would defer until after HTML is ready (module files are always deferred).

// Text colors
const txt_light = `#374151` // Dark gray
const txt_dark = `#eee` // Light gray
const txt_white = `#000000` // Black
const txt_black = `#f5f5f5` // Off-white

// Page backgrounds
const page_bg_light = `#f1f3f5` // Light gray
const page_bg_dark = `#18171c` // Very dark blue
const page_bg_white = `#ffffff` // Pure white
const page_bg_black = `#000000` // Pure black

// Borders
const border_light = `#d1d5db` // Gray border
const border_dark = `#404040` // Dark gray border
const border_white = `#f0f0f0` // Light border
const border_black = `#202020` // Dark border

// Accents
const acc_light = `#4f46e5` // Indigo
const acc_dark = `cornflowerblue` // Light blue
const acc_white = `#2563eb` // Blue
const acc_black = `cornflowerblue`

// Helper functions for common patterns
const btn_bg = (dark_op, light_op) => ({
  light: `rgba(0, 0, 0, ${light_op})`,
  dark: `rgba(255, 255, 255, ${dark_op})`,
  white: `rgba(0, 0, 0, ${light_op})`,
  black: `rgba(255, 255, 255, ${dark_op})`,
})

const tooltip_bg = (light_bg, dark_bg, light_op = 0.95, dark_op = 0.95) => ({
  light: `rgba(${light_bg}, ${light_op})`,
  dark: `rgba(${dark_bg}, ${dark_op})`,
  white: `rgba(255, 255, 255, 0.98)`,
  black: `rgba(20, 20, 20, 0.98)`,
})

const themes = {
  // Core colors
  'page-bg': {
    light: page_bg_light,
    dark: page_bg_dark,
    white: page_bg_white,
    black: page_bg_black,
  },
  'text-color': { light: txt_light, dark: txt_dark, white: txt_white, black: txt_black },
  'surface-bg': {
    light: `rgb(237, 238, 239)`,
    dark: `rgb(33, 36, 43)`,
    white: `rgb(250, 250, 250)`,
    black: `rgb(19, 19, 19)`,
  },
  'border-color': {
    light: border_light,
    dark: border_dark,
    white: border_white,
    black: border_black,
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
  'btn-bg': btn_bg(0.1, 0.12),
  'btn-bg-hover': btn_bg(0.2, 0.25),
  'btn-disabled-bg': btn_bg(0.1, 0.05),

  // Tooltips
  'tooltip-bg': tooltip_bg(`243, 244, 246`, `0, 40, 60`),
  'tooltip-border': {
    light: `1px solid rgba(0, 0, 0, 0.15)`,
    dark: `1px solid rgba(255, 255, 255, 0.15)`,
    white: `1px solid rgba(0, 0, 0, 0.075)`,
    black: `1px solid rgba(255, 255, 255, 0.075)`,
  },

  // Structure-specific
  'struct-bg': {
    light: `rgba(0, 0, 0, 0.04)`,
    dark: `rgba(255, 255, 255, 0.07)`,
    white: `rgba(0, 0, 0, 0.02)`,
    black: `rgba(255, 255, 255, 0.1)`,
  },

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
  'plot-legend-background-color': {
    light: `rgba(255, 255, 255, 0.95)`,
    dark: `rgba(0, 0, 0, 0.2)`,
    white: `rgba(255, 255, 255, 0.98)`,
    black: `rgba(0, 0, 0, 0.3)`,
  },
  'plot-legend-border': {
    light: `1px solid rgba(0, 0, 0, 0.2)`,
    dark: `1px solid rgba(255, 255, 255, 0.2)`,
    white: `1px solid rgba(0, 0, 0, 0.1)`,
    black: `1px solid rgba(255, 255, 255, 0.1)`,
  },
  'plot-legend-item-color': {
    light: txt_light,
    dark: txt_dark,
    white: txt_white,
    black: txt_black,
  },
  'plot-legend-item-hover-background-color': btn_bg(0.1, 0.1),

  // Svelte MultiSelect
  'sms-options-bg': {
    light: `rgba(255, 255, 255, 0.95)`,
    dark: `rgb(20, 18, 36)`,
    white: `rgba(255, 255, 255, 0.98)`,
    black: `rgba(15, 15, 15, 0.95)`,
  },
  'sms-border': {
    light: `1px dotted #6b7280`,
    dark: `1px dotted teal`,
    white: `1px dotted #9ca3af`,
    black: `1px dotted teal`,
  },
  'sms-focus-border': {
    light: `1px dotted ${acc_light}`,
    dark: `1px dotted cornflowerblue`,
    white: `1px dotted ${acc_white}`,
    black: `1px dotted ${acc_black}`,
  },
  'sms-active-color': {
    light: acc_light,
    dark: `cornflowerblue`,
    white: acc_white,
    black: acc_black,
  },

  'github-corner-color': {
    light: page_bg_light,
    dark: page_bg_dark,
    white: page_bg_white,
    black: page_bg_black,
  },
  'github-corner-bg': {
    light: txt_light,
    dark: txt_dark,
    white: txt_white,
    black: txt_black,
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
