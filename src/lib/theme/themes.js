// Theme System - Single Source of Truth
// Base colors used across themes
const colors = {
  // Text colors
  txt_light: `#374151`, // Dark gray
  txt_dark: `#eee`, // Light gray
  txt_white: `#000000`, // Black
  txt_black: `#f5f5f5`, // Off-white

  // Page backgrounds
  bg_light: `#f1f3f5`, // Light gray
  bg_dark: `#090019`, // Very dark blue
  bg_white: `#ffffff`, // Pure white
  bg_black: `#000000`, // Pure black

  // Surfaces (cards, panels, etc.)
  surf_light: `#ffffff`, // White cards on light bg
  surf_dark: `#2a2a2a`, // Dark cards on dark bg
  surf_white: `#fafafa`, // Off-white cards on white bg
  surf_black: `#0f0f0f`, // Very dark cards on black bg

  // Borders
  border_light: `#d1d5db`, // Gray border
  border_dark: `#404040`, // Dark gray border
  border_white: `#f0f0f0`, // Light border
  border_black: `#202020`, // Dark border

  // Accents
  acc_light: `#4f46e5`, // Indigo
  acc_dark: `#60a5fa`, // Light blue
  acc_white: `#2563eb`, // Blue
  acc_black: `#7dd3fc`, // Cyan

  // Error colors
  error_text_light: `#dc2626`, // Red
  error_text_dark: `#fca5a5`, // Light red
  error_text_white: `#b91c1c`, // Dark red
  error_text_black: `#f87171`, // Pink-red

  error_border_light: `#fca5a5`, // Light red
  error_border_dark: `#dc2626`, // Red
  error_border_white: `#fecaca`, // Very light red
  error_border_black: `#991b1b`, // Dark red

  error_btn_light: `#dc2626`, // Red
  error_btn_dark: `#7f1d1d`, // Dark red
  error_btn_white: `#b91c1c`, // Dark red
  error_btn_black: `#991b1b`, // Dark red

  error_btn_hover_light: `#b91c1c`, // Dark red
  error_btn_hover_dark: `#991b1b`, // Darker red
  error_btn_hover_white: `#991b1b`, // Darker red
  error_btn_hover_black: `#7f1d1d`, // Very dark red
}

// Helper functions for common patterns
const btn_bg = (dark_op, light_op) => ({
  light: `rgba(0, 0, 0, ${light_op})`,
  dark: `rgba(255, 255, 255, ${dark_op})`,
  white: `rgba(0, 0, 0, ${light_op / 2})`,
  black: `rgba(255, 255, 255, ${dark_op / 2})`,
})

const tooltip_bg = (light_bg, dark_bg, light_op = 0.95, dark_op = 0.95) => ({
  light: `rgba(${light_bg}, ${light_op})`,
  dark: `rgba(${dark_bg}, ${dark_op})`,
  white: `rgba(255, 255, 255, 0.98)`,
  black: `rgba(20, 20, 20, 0.98)`,
})

const border_alpha = (alpha = 0.2) => ({
  light: `rgba(0, 0, 0, ${alpha})`,
  dark: `rgba(255, 255, 255, ${alpha})`,
  white: `rgba(0, 0, 0, ${alpha / 2})`,
  black: `rgba(255, 255, 255, ${alpha / 2})`,
})

const themes = {
  // Core colors
  'page-bg': {
    light: colors.bg_light,
    dark: colors.bg_dark,
    white: colors.bg_white,
    black: colors.bg_black,
  },
  'text-color': {
    light: colors.txt_light,
    dark: colors.txt_dark,
    white: colors.txt_white,
    black: colors.txt_black,
  },
  'surface-bg': {
    light: colors.surf_light,
    dark: colors.surf_dark,
    white: colors.surf_white,
    black: colors.surf_black,
  },
  'border-color': {
    light: colors.border_light,
    dark: colors.border_dark,
    white: colors.border_white,
    black: colors.border_black,
  },
  'accent-color': {
    light: colors.acc_light,
    dark: colors.acc_dark,
    white: colors.acc_white,
    black: colors.acc_black,
  },

  // Hover states
  'surface-hover-bg': {
    light: `#e5e7eb`,
    dark: `#3a3a3a`,
    white: `#fafafa`,
    black: `#1a1a1a`,
  },
  'accent-hover-color': {
    light: `#3730a3`,
    dark: `#3b82f6`,
    white: `#1d4ed8`,
    black: `#0ea5e9`,
  },

  // Code/pre backgrounds
  'code-bg': {
    light: `#e5e7eb`,
    dark: `#000000`,
    white: `#fafafa`,
    black: `#0a0a0a`,
  },
  'pre-bg': {
    light: `#fcfcfc`,
    dark: `rgba(255, 255, 255, 0.05)`,
    white: `#fafafa`,
    black: `rgba(255, 255, 255, 0.02)`,
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
  'text-color-muted': {
    light: `#6b7280`,
    dark: `#9ca3af`,
    white: `#374151`,
    black: `#d1d5db`,
  },

  // Interactive elements (buttons, etc.)
  'btn-bg': btn_bg(0.2, 0.12),
  'btn-hover-bg': btn_bg(0.3, 0.25),

  // Tooltips
  'tooltip-bg': tooltip_bg(`243, 244, 246`, `0, 40, 60`),
  'tooltip-border': border_alpha(0.15),

  // Structure-specific
  'struct-bg': {
    light: `rgba(0, 0, 0, 0.02)`,
    dark: `rgba(255, 255, 255, 0.05)`,
    white: `rgba(0, 0, 0, 0.01)`,
    black: `rgba(255, 255, 255, 0.02)`,
  },
  'struct-dragover-bg': {
    light: `rgba(0, 0, 0, 0.15)`,
    dark: `rgba(0, 0, 0, 0.7)`,
    white: `rgba(0, 0, 0, 0.05)`,
    black: `rgba(0, 0, 0, 0.8)`,
  },

  // Panel backgrounds (DraggablePanel, etc.)
  'panel-bg': {
    light: `rgba(229, 231, 235, 0.95)`,
    dark: `rgba(15, 23, 42, 0.95)`,
    white: `rgba(248, 250, 252, 0.98)`,
    black: `rgba(26, 26, 26, 0.98)`,
  },
  'panel-border': border_alpha(0.15),

  // Traj-specific
  'traj-surface': {
    light: `rgba(241, 243, 245, 0.95)`,
    dark: `rgba(45, 55, 72, 0.95)`,
    white: `rgba(255, 255, 255, 0.98)`,
    black: `rgba(15, 15, 15, 0.98)`,
  },
  'traj-border-color': {
    light: colors.border_light,
    dark: `#4a5568`,
    white: colors.border_white,
    black: colors.border_black,
  },
  'traj-accent': {
    light: colors.acc_light,
    dark: `#63b3ed`,
    white: colors.acc_white,
    black: colors.acc_black,
  },

  // Trajectory component variables (used directly)
  'traj-text-color': {
    light: colors.txt_light,
    dark: `#e2e8f0`,
    white: colors.txt_white,
    black: `#f1f5f9`,
  },
  'traj-heading-color': {
    light: colors.txt_light,
    dark: `#e2e8f0`,
    white: colors.txt_white,
    black: `#f1f5f9`,
  },
  'traj-error-color': {
    light: colors.error_text_light,
    dark: colors.error_text_dark,
    white: colors.error_text_white,
    black: colors.error_text_black,
  },
  'traj-error-border': {
    light: colors.error_border_light,
    dark: colors.error_border_dark,
    white: colors.error_border_white,
    black: colors.error_border_black,
  },
  'traj-error-button-bg': {
    light: colors.error_btn_light,
    dark: colors.error_btn_dark,
    white: colors.error_btn_white,
    black: colors.error_btn_black,
  },
  'traj-error-button-hover-bg': {
    light: colors.error_btn_hover_light,
    dark: colors.error_btn_hover_dark,
    white: colors.error_btn_hover_white,
    black: colors.error_btn_hover_black,
  },
  'traj-border': border_alpha(0.15),
  'traj-dropzone-border': {
    light: `#9ca3af`,
    dark: `#4a5568`,
    white: `#e5e7eb`,
    black: `#374151`,
  },
  'traj-dragover-border': {
    light: colors.acc_light,
    dark: `#007acc`,
    white: colors.acc_white,
    black: `#0ea5e9`,
  },
  'traj-dragover-bg': {
    light: `rgba(79, 70, 229, 0.1)`,
    dark: `rgba(0, 122, 204, 0.1)`,
    white: `rgba(37, 99, 235, 0.05)`,
    black: `rgba(14, 165, 233, 0.05)`,
  },

  // Dropzone states
  'dropzone-border': {
    light: `#9ca3af`,
    dark: `#4a5568`,
    white: `#e5e7eb`,
    black: `#374151`,
  },
  'dropzone-bg': {
    light: `rgba(0, 0, 0, 0.02)`,
    dark: `rgba(45, 55, 72, 0.5)`,
    white: `rgba(0, 0, 0, 0.01)`,
    black: `rgba(15, 15, 15, 0.7)`,
  },
  'dragover-border': {
    light: colors.acc_light,
    dark: `#007acc`,
    white: colors.acc_white,
    black: `#0ea5e9`,
  },
  'dragover-bg': {
    light: `rgba(79, 70, 229, 0.1)`,
    dark: `rgba(0, 122, 204, 0.1)`,
    white: `rgba(37, 99, 235, 0.05)`,
    black: `rgba(14, 165, 233, 0.05)`,
  },

  // Theme control
  'theme-control-bg': {
    light: `rgba(241, 243, 245, 0.9)`,
    dark: `rgba(15, 23, 42, 0.9)`,
    white: `rgba(255, 255, 255, 0.95)`,
    black: `rgba(0, 0, 0, 0.95)`,
  },
  'theme-control-border': border_alpha(0.25),
  'theme-control-hover-bg': {
    light: `rgba(241, 243, 245, 0.95)`,
    dark: `rgba(15, 23, 42, 0.95)`,
    white: `rgba(255, 255, 255, 0.98)`,
    black: `rgba(15, 15, 15, 0.98)`,
  },

  // Navigation links
  'nav-link-bg': btn_bg(0.1, 0.08),
  'nav-link-hover-bg': btn_bg(0.15, 0.15),
  'nav-link-active-color': {
    light: `#dc2626`,
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
    light: colors.txt_light,
    dark: colors.txt_dark,
    white: colors.txt_white,
    black: colors.txt_black,
  },
  'plot-legend-item-hover-background-color': btn_bg(0.1, 0.1),

  // Non-color theming (filters, etc.)
  'legend-filter': {
    light: `grayscale(10%) brightness(0.8) saturate(0.9)`,
    dark: `grayscale(10%) brightness(0.8) saturate(0.8)`,
    white: `grayscale(2%) brightness(0.9) saturate(1.2)`,
    black: `grayscale(15%) brightness(0.7) saturate(0.7)`,
  },

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
    light: `1px dotted ${colors.acc_light}`,
    dark: `1px dotted cornflowerblue`,
    white: `1px dotted ${colors.acc_white}`,
    black: `1px dotted ${colors.acc_black}`,
  },
  'sms-active-color': {
    light: colors.acc_light,
    dark: `cornflowerblue`,
    white: colors.acc_white,
    black: colors.acc_black,
  },

  'copy-btn-color': {
    light: colors.txt_light,
    dark: colors.txt_dark,
    white: colors.txt_white,
    black: colors.txt_black,
  },
  'github-corner-color': {
    light: colors.bg_light,
    dark: colors.bg_dark,
    white: colors.bg_white,
    black: colors.bg_black,
  },
  'github-corner-bg': {
    light: colors.txt_light,
    dark: colors.txt_dark,
    white: colors.txt_white,
    black: colors.txt_black,
  },

  // VSCode-specific
  'vscode-editor-background': {
    light: colors.bg_white,
    dark: `#1e1e1e`,
    white: colors.bg_white,
    black: colors.bg_black,
  },
  'vscode-editor-foreground': {
    light: `#333333`,
    dark: `#d4d4d4`,
    white: colors.txt_white,
    black: colors.txt_black,
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
globalThis.MATTERVIZ_THEME_SOURCE = themes
globalThis.MATTERVIZ_SSR_PROPS = Object.keys(themes)
