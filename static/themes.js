// Theme System - Single Source of Truth
const themes = {
  'page-bg': {
    light: `#f1f3f5`,
    dark: `#090019`,
    white: `#ffffff`,
    black: `#000000`,
  },
  'text-color': {
    light: `#374151`,
    dark: `#eee`,
    white: `#000000`,
    black: `#f5f5f5`,
  },
  'code-bg': {
    light: `#e5e7eb`,
    dark: `#000000`,
    white: `#fafafa`,
    black: `#0a0a0a`,
  },
  'pre-bg': {
    light: `#e5e7eb`,
    dark: `rgba(255, 255, 255, 0.05)`,
    white: `#fafafa`,
    black: `rgba(255, 255, 255, 0.02)`,
  },
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
  'struct-text-color': {
    light: `#374151`,
    dark: `#e5e5e5`,
    white: `#000000`,
    black: `#f0f0f0`,
  },
  'struct-border': {
    light: `#d1d5db`,
    dark: `#404040`,
    white: `#f0f0f0`,
    black: `#202020`,
  },
  'struct-accent': {
    light: `#4f46e5`,
    dark: `#60a5fa`,
    white: `#2563eb`,
    black: `#7dd3fc`,
  },
  'legend-filter': {
    light: `grayscale(10%) brightness(0.8) saturate(0.9)`,
    dark: `grayscale(10%) brightness(0.8) saturate(0.8)`,
    white: `grayscale(2%) brightness(0.9) saturate(1.2)`,
    black: `grayscale(15%) brightness(0.7) saturate(0.7)`,
  },
  'copy-btn-bg': {
    light: `rgba(0, 0, 0, 0.12)`,
    dark: `rgba(255, 255, 255, 0.1)`,
    white: `rgba(0, 0, 0, 0.05)`,
    black: `rgba(255, 255, 255, 0.05)`,
  },
  'copy-btn-hover-bg': {
    light: `rgba(0, 0, 0, 0.25)`,
    dark: `rgba(255, 255, 255, 0.2)`,
    white: `rgba(0, 0, 0, 0.1)`,
    black: `rgba(255, 255, 255, 0.15)`,
  },
  'copy-btn-color': {
    light: `#374151`,
    dark: `#eee`,
    white: `#000000`,
    black: `#f5f5f5`,
  },
  'home-btn-bg': {
    light: `rgba(0, 0, 0, 0.08)`,
    dark: `rgba(255, 255, 255, 0.1)`,
    white: `rgba(0, 0, 0, 0.05)`,
    black: `rgba(255, 255, 255, 0.05)`,
  },
  'home-btn-hover-bg': {
    light: `rgba(0, 0, 0, 0.15)`,
    dark: `rgba(255, 255, 255, 0.2)`,
    white: `rgba(0, 0, 0, 0.1)`,
    black: `rgba(255, 255, 255, 0.15)`,
  },
  'github-corner-color': {
    light: `#f1f3f5`,
    dark: `#090019`,
    white: `#ffffff`,
    black: `#000000`,
  },
  'github-corner-bg': {
    light: `#374151`,
    dark: `#eee`,
    white: `#000000`,
    black: `#f5f5f5`,
  },
  'histogram-axis-color': {
    light: `#4b5563`,
    dark: `#e5e5e5`,
    white: `#000000`,
    black: `#f0f0f0`,
  },
  'histogram-text-color': {
    light: `#374151`,
    dark: `#e5e5e5`,
    white: `#000000`,
    black: `#f0f0f0`,
  },
  'histogram-tooltip-bg': {
    light: `rgba(243, 244, 246, 0.95)`,
    dark: `rgba(60, 60, 60, 0.95)`,
    white: `rgba(255, 255, 255, 0.98)`,
    black: `rgba(20, 20, 20, 0.98)`,
  },
  'histogram-tooltip-color': {
    light: `#374151`,
    dark: `white`,
    white: `#000000`,
    black: `#f5f5f5`,
  },
  'histogram-tooltip-border': {
    light: `rgba(0, 0, 0, 0.15)`,
    dark: `rgba(255, 255, 255, 0.2)`,
    white: `rgba(0, 0, 0, 0.05)`,
    black: `rgba(255, 255, 255, 0.1)`,
  },
  'surface-bg': {
    light: `#f1f3f5`,
    dark: `#2a2a2a`,
    white: `#ffffff`,
    black: `#0f0f0f`,
  },
  'surface-hover-bg': {
    light: `#e5e7eb`,
    dark: `#3a3a3a`,
    white: `#fafafa`,
    black: `#1a1a1a`,
  },
  'border-color': {
    light: `#d1d5db`,
    dark: `#404040`,
    white: `#f0f0f0`,
    black: `#202020`,
  },
  'accent-color': {
    light: `#4f46e5`,
    dark: `#60a5fa`,
    white: `#2563eb`,
    black: `#7dd3fc`,
  },
  'accent-hover-color': {
    light: `#3730a3`,
    dark: `#3b82f6`,
    white: `#1d4ed8`,
    black: `#0ea5e9`,
  },
  'muted-text-color': {
    light: `#6b7280`,
    dark: `#9ca3af`,
    white: `#374151`,
    black: `#d1d5db`,
  },
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
  // Sidebar colors
  'sidebar-bg': {
    light: `rgba(241, 243, 245, 0.96)`,
    dark: `rgba(15, 23, 42, 0.96)`,
    white: `rgba(255, 255, 255, 0.98)`,
    black: `rgba(0, 0, 0, 0.98)`,
  },
  'sidebar-border': {
    light: `rgba(209, 213, 219, 0.8)`,
    dark: `rgba(71, 85, 105, 0.3)`,
    white: `rgba(240, 240, 240, 0.9)`,
    black: `rgba(32, 32, 32, 0.5)`,
  },
  'sidebar-header-bg': {
    light: `rgba(243, 244, 246, 0.9)`,
    dark: `rgba(30, 41, 59, 0.8)`,
    white: `rgba(255, 255, 255, 0.95)`,
    black: `rgba(15, 15, 15, 0.9)`,
  },
  'sidebar-header-border': {
    light: `rgba(209, 213, 219, 0.5)`,
    dark: `rgba(71, 85, 105, 0.2)`,
    white: `rgba(240, 240, 240, 0.7)`,
    black: `rgba(32, 32, 32, 0.3)`,
  },
  'sidebar-title-color': {
    light: `#374151`,
    dark: `#f1f5f9`,
    white: `#000000`,
    black: `#f8fafc`,
  },
  'sidebar-close-color': {
    light: `#6b7280`,
    dark: `#94a3b8`,
    white: `#374151`,
    black: `#cbd5e1`,
  },
  'sidebar-close-hover-bg': {
    light: `rgba(209, 213, 219, 0.5)`,
    dark: `rgba(71, 85, 105, 0.3)`,
    white: `rgba(240, 240, 240, 0.7)`,
    black: `rgba(32, 32, 32, 0.5)`,
  },
  'sidebar-close-hover-color': {
    light: `#4b5563`,
    dark: `#f1f5f9`,
    white: `#000000`,
    black: `#f8fafc`,
  },
  'sidebar-scrollbar-thumb': {
    light: `rgba(107, 114, 128, 0.7)`,
    dark: `rgba(71, 85, 105, 0.5)`,
    white: `rgba(107, 114, 128, 0.5)`,
    black: `rgba(32, 32, 32, 0.7)`,
  },
  'sidebar-scrollbar-thumb-hover': {
    light: `rgba(75, 85, 99, 0.9)`,
    dark: `rgba(71, 85, 105, 0.7)`,
    white: `rgba(55, 65, 81, 0.7)`,
    black: `rgba(55, 65, 81, 0.9)`,
  },
  'sidebar-section-title-color': {
    light: `#4b5563`,
    dark: `#cbd5e1`,
    white: `#000000`,
    black: `#e2e8f0`,
  },
  'sidebar-item-bg': {
    light: `rgba(243, 244, 246, 0.6)`,
    dark: `rgba(30, 41, 59, 0.4)`,
    white: `rgba(255, 255, 255, 0.8)`,
    black: `rgba(15, 15, 15, 0.6)`,
  },
  'sidebar-item-border': {
    light: `rgba(209, 213, 219, 0.4)`,
    dark: `rgba(71, 85, 105, 0.2)`,
    white: `rgba(240, 240, 240, 0.6)`,
    black: `rgba(32, 32, 32, 0.3)`,
  },
  'sidebar-item-hover-bg': {
    light: `rgba(229, 231, 235, 0.8)`,
    dark: `rgba(30, 41, 59, 0.6)`,
    white: `rgba(250, 250, 250, 0.9)`,
    black: `rgba(26, 26, 26, 0.8)`,
  },
  'sidebar-item-hover-border': {
    light: `rgba(156, 163, 175, 0.6)`,
    dark: `rgba(71, 85, 105, 0.4)`,
    white: `rgba(229, 231, 235, 0.8)`,
    black: `rgba(55, 65, 81, 0.6)`,
  },
  'sidebar-site-item-bg': {
    light: `rgba(219, 234, 254, 0.6)`,
    dark: `rgba(30, 41, 59, 0.2)`,
    white: `rgba(248, 250, 252, 0.8)`,
    black: `rgba(15, 23, 42, 0.4)`,
  },
  'sidebar-site-border': {
    light: `rgba(79, 70, 229, 0.6)`,
    dark: `rgba(99, 179, 237, 0.6)`,
    white: `rgba(37, 99, 235, 0.8)`,
    black: `rgba(125, 211, 252, 0.8)`,
  },
  'sidebar-label-color': {
    light: `#6b7280`,
    dark: `#94a3b8`,
    white: `#374151`,
    black: `#cbd5e1`,
  },
  'sidebar-value-color': {
    light: `#374151`,
    dark: `#f1f5f9`,
    white: `#000000`,
    black: `#f8fafc`,
  },
  'sidebar-shadow': {
    light: `4px 0 20px rgba(0, 0, 0, 0.08)`,
    dark: `-4px 0 20px rgba(0, 0, 0, 0.15)`,
    white: `4px 0 20px rgba(0, 0, 0, 0.02)`,
    black: `-4px 0 20px rgba(0, 0, 0, 0.3)`,
  },
  // Demo nav colors
  'demo-nav-link-bg': {
    light: `rgba(0, 0, 0, 0.08)`,
    dark: `rgba(255, 255, 255, 0.1)`,
    white: `rgba(0, 0, 0, 0.02)`,
    black: `rgba(255, 255, 255, 0.05)`,
  },
  'demo-nav-link-hover-bg': {
    light: `rgba(0, 0, 0, 0.15)`,
    dark: `rgba(255, 255, 255, 0.15)`,
    white: `rgba(0, 0, 0, 0.05)`,
    black: `rgba(255, 255, 255, 0.1)`,
  },
  'demo-nav-link-active-color': {
    light: `#dc2626`,
    dark: `mediumseagreen`,
    white: `coral`,
    black: `lightseagreen`,
  },
  // Theme control colors
  'theme-control-bg': {
    light: `rgba(241, 243, 245, 0.9)`,
    dark: `rgba(15, 23, 42, 0.9)`,
    white: `rgba(255, 255, 255, 0.95)`,
    black: `rgba(0, 0, 0, 0.95)`,
  },
  'theme-control-border': {
    light: `rgba(0, 0, 0, 0.25)`,
    dark: `rgba(255, 255, 255, 0.1)`,
    white: `rgba(0, 0, 0, 0.1)`,
    black: `rgba(255, 255, 255, 0.05)`,
  },
  'theme-control-hover-bg': {
    light: `rgba(241, 243, 245, 0.95)`,
    dark: `rgba(15, 23, 42, 0.95)`,
    white: `rgba(255, 255, 255, 0.98)`,
    black: `rgba(15, 15, 15, 0.98)`,
  },
  'theme-control-hover-border': {
    light: `rgba(0, 0, 0, 0.3)`,
    dark: `rgba(255, 255, 255, 0.2)`,
    white: `rgba(0, 0, 0, 0.15)`,
    black: `rgba(255, 255, 255, 0.1)`,
  },
  'theme-control-select-bg': {
    light: `rgba(241, 243, 245, 0.95)`,
    dark: `rgba(30, 41, 59, 0.9)`,
    white: `rgba(255, 255, 255, 0.98)`,
    black: `rgba(15, 15, 15, 0.95)`,
  },
  'theme-control-select-border': {
    light: `rgba(0, 0, 0, 0.3)`,
    dark: `rgba(255, 255, 255, 0.2)`,
    white: `rgba(0, 0, 0, 0.15)`,
    black: `rgba(255, 255, 255, 0.1)`,
  },
  'theme-control-select-hover-bg': {
    light: `rgba(229, 231, 235, 1)`,
    dark: `rgba(51, 65, 85, 1)`,
    white: `rgba(255, 255, 255, 1)`,
    black: `rgba(26, 26, 26, 1)`,
  },
  'theme-control-select-hover-border': {
    light: `rgba(0, 0, 0, 0.4)`,
    dark: `rgba(255, 255, 255, 0.3)`,
    white: `rgba(0, 0, 0, 0.2)`,
    black: `rgba(255, 255, 255, 0.15)`,
  },
  'theme-control-label-color': {
    light: `#4b5563`,
    dark: `#e2e8f0`,
    white: `#000000`,
    black: `#f1f5f9`,
  },
  // Control panel colors
  'controls-bg': {
    light: `rgba(241, 243, 245, 0.95)`,
    dark: `rgba(15, 23, 42, 0.95)`,
    white: `rgba(255, 255, 255, 0.98)`,
    black: `rgba(0, 0, 0, 0.98)`,
  },
  'controls-text-color': {
    light: `#374151`,
    dark: `#eee`,
    white: `#000000`,
    black: `#f5f5f5`,
  },
  'controls-border': {
    light: `rgba(0, 0, 0, 0.15)`,
    dark: `rgba(255, 255, 255, 0.1)`,
    white: `rgba(0, 0, 0, 0.05)`,
    black: `rgba(255, 255, 255, 0.05)`,
  },
  'controls-btn-bg': {
    light: `rgba(0, 0, 0, 0.12)`,
    dark: `rgba(255, 255, 255, 0.1)`,
    white: `rgba(0, 0, 0, 0.05)`,
    black: `rgba(255, 255, 255, 0.05)`,
  },
  'controls-btn-hover-bg': {
    light: `rgba(0, 0, 0, 0.25)`,
    dark: `rgba(255, 255, 255, 0.2)`,
    white: `rgba(0, 0, 0, 0.1)`,
    black: `rgba(255, 255, 255, 0.15)`,
  },
  'controls-hr-bg': {
    light: `rgba(0, 0, 0, 0.15)`,
    dark: `rgba(255, 255, 255, 0.1)`,
    white: `rgba(0, 0, 0, 0.05)`,
    black: `rgba(255, 255, 255, 0.05)`,
  },
  // Trajectory colors
  'traj-surface': {
    light: `rgba(241, 243, 245, 0.95)`,
    dark: `rgba(45, 55, 72, 0.95)`,
    white: `rgba(255, 255, 255, 0.98)`,
    black: `rgba(15, 15, 15, 0.98)`,
  },
  'traj-text': {
    light: `#374151`,
    dark: `#e2e8f0`,
    white: `#000000`,
    black: `#f1f5f9`,
  },
  'traj-border': {
    light: `rgba(0, 0, 0, 0.15)`,
    dark: `rgba(74, 85, 104, 0.5)`,
    white: `rgba(0, 0, 0, 0.05)`,
    black: `rgba(255, 255, 255, 0.05)`,
  },
  'traj-accent': {
    light: `#4f46e5`,
    dark: `#63b3ed`,
    white: `#2563eb`,
    black: `#7dd3fc`,
  },
  'traj-muted': {
    light: `#6b7280`,
    dark: `rgba(148, 163, 184, 0.8)`,
    white: `#374151`,
    black: `rgba(209, 213, 219, 0.9)`,
  },
  'traj-bg': {
    light: `rgba(241, 243, 245, 0.9)`,
    dark: `rgba(26, 32, 44, 0.8)`,
    white: `rgba(255, 255, 255, 0.95)`,
    black: `rgba(10, 10, 10, 0.9)`,
  },
  'traj-surface-hover': {
    light: `rgba(0, 0, 0, 0.08)`,
    dark: `rgba(74, 85, 104, 0.3)`,
    white: `rgba(0, 0, 0, 0.02)`,
    black: `rgba(255, 255, 255, 0.05)`,
  },
  'traj-border-bg': {
    light: `#d1d5db`,
    dark: `#4a5568`,
    white: `#f0f0f0`,
    black: `#202020`,
  },
  'traj-text-muted': {
    light: `#9ca3af`,
    dark: `#a0aec0`,
    white: `#6b7280`,
    black: `#cbd5e1`,
  },
  'traj-accent-text': {
    light: `#3730a3`,
    dark: `#a8d8f0`,
    white: `#1d4ed8`,
    black: `#bae6fd`,
  },
  'traj-plot-bg': {
    light: `rgba(245, 242, 242, 0.8)`,
    dark: `rgba(26, 32, 44, 0.8)`,
    white: `rgba(255, 255, 255, 0.95)`,
    black: `rgba(10, 10, 10, 0.9)`,
  },
  'trajectory-dragover-border': {
    light: `#4f46e5`,
    dark: `#007acc`,
    white: `#2563eb`,
    black: `#0ea5e9`,
  },
  'trajectory-dragover-bg': {
    light: `rgba(79, 70, 229, 0.1)`,
    dark: `rgba(0, 122, 204, 0.1)`,
    white: `rgba(37, 99, 235, 0.05)`,
    black: `rgba(14, 165, 233, 0.05)`,
  },
  'trajectory-text-color': {
    light: `#374151`,
    dark: `#e2e8f0`,
    white: `#000000`,
    black: `#f1f5f9`,
  },
  'trajectory-border': {
    light: `rgba(0, 0, 0, 0.15)`,
    dark: `rgba(255, 255, 255, 0.1)`,
    white: `rgba(0, 0, 0, 0.05)`,
    black: `rgba(255, 255, 255, 0.05)`,
  },
  'trajectory-dropzone-border': {
    light: `#9ca3af`,
    dark: `#4a5568`,
    white: `#e5e7eb`,
    black: `#374151`,
  },
  'trajectory-dropzone-bg': {
    light: `#f3f4f6`,
    dark: `rgba(45, 55, 72, 0.5)`,
    white: `#ffffff`,
    black: `rgba(15, 15, 15, 0.7)`,
  },
  'trajectory-heading-color': {
    light: `#374151`,
    dark: `#e2e8f0`,
    white: `#000000`,
    black: `#f1f5f9`,
  },
  'trajectory-text-muted': {
    light: `#6b7280`,
    dark: `#a0aec0`,
    white: `#374151`,
    black: `#cbd5e1`,
  },
  'trajectory-display-mode-bg': {
    light: `rgba(0, 0, 0, 0.08)`,
    dark: `rgba(255, 255, 255, 0.05)`,
    white: `rgba(0, 0, 0, 0.02)`,
    black: `rgba(255, 255, 255, 0.02)`,
  },
  'trajectory-display-mode-hover-bg': {
    light: `rgba(0, 0, 0, 0.15)`,
    dark: `#6b7280`,
    white: `rgba(0, 0, 0, 0.05)`,
    black: `rgba(255, 255, 255, 0.1)`,
  },
  'trajectory-fullscreen-bg': {
    light: `rgba(0, 0, 0, 0.08)`,
    dark: `rgba(255, 255, 255, 0.05)`,
    white: `rgba(0, 0, 0, 0.02)`,
    black: `rgba(255, 255, 255, 0.02)`,
  },
  'trajectory-fullscreen-hover-bg': {
    light: `rgba(0, 0, 0, 0.15)`,
    dark: `rgba(255, 255, 255, 0.1)`,
    white: `rgba(0, 0, 0, 0.05)`,
    black: `rgba(255, 255, 255, 0.05)`,
  },
  'trajectory-info-bg': {
    light: `#d1d5db`,
    dark: `#4b5563`,
    white: `#f0f0f0`,
    black: `#374151`,
  },
  'trajectory-info-hover-bg': {
    light: `#9ca3af`,
    dark: `#6b7280`,
    white: `#e5e7eb`,
    black: `#4b5563`,
  },
  'trajectory-info-active-bg': {
    light: `#4f46e5`,
    dark: `#3b82f6`,
    white: `#2563eb`,
    black: `#60a5fa`,
  },
  'trajectory-play-button-bg': {
    light: `#d1d5db`,
    dark: `#6b7280`,
    white: `#f0f0f0`,
    black: `#4b5563`,
  },
  'trajectory-play-button-hover-bg': {
    light: `#9ca3af`,
    dark: `#7f8793`,
    white: `#e5e7eb`,
    black: `#6b7280`,
  },
  'trajectory-pause-button-bg': {
    light: `#d1d5db`,
    dark: `#6b7280`,
    white: `#f0f0f0`,
    black: `#4b5563`,
  },
  'trajectory-pause-button-hover-bg': {
    light: `#9ca3af`,
    dark: `#9ca3af`,
    white: `#e5e7eb`,
    black: `#9ca3af`,
  },
  'trajectory-view-mode-bg': {
    light: `rgba(0, 0, 0, 0.08)`,
    dark: `rgba(255, 255, 255, 0.05)`,
    white: `rgba(0, 0, 0, 0.02)`,
    black: `rgba(255, 255, 255, 0.02)`,
  },
  'trajectory-view-mode-hover-bg': {
    light: `rgba(0, 0, 0, 0.15)`,
    dark: `#6b7280`,
    white: `rgba(0, 0, 0, 0.05)`,
    black: `rgba(255, 255, 255, 0.1)`,
  },
  'trajectory-view-mode-active-bg': {
    light: `rgba(0, 0, 0, 0.15)`,
    dark: `#4b5563`,
    white: `rgba(0, 0, 0, 0.05)`,
    black: `rgba(255, 255, 255, 0.05)`,
  },
  // VSCode-specific theme variables
  'vscode-editor-background': {
    light: `#ffffff`,
    dark: `#1e1e1e`,
    white: `#ffffff`,
    black: `#000000`,
  },
  'vscode-editor-foreground': {
    light: `#333333`,
    dark: `#d4d4d4`,
    white: `#000000`,
    black: `#ffffff`,
  },
  'vscode-error-foreground': {
    light: `#e51400`,
    dark: `#f85149`,
    white: `#cc0000`,
    black: `#ff6b6b`,
  },
}

// Auto-generate CSS variables - theme keys now match CSS variable names exactly
const special_mappings = {
  'copy-btn-bg': `--zoo-copy-btn-bg`,
  'copy-btn-hover-bg': `--zoo-copy-btn-hover-bg`,
  'copy-btn-color': `--zoo-copy-btn-color`,
  'github-corner-color': `--zoo-github-corner-color`,
  'github-corner-bg': `--zoo-github-corner-bg`,
  'vscode-editor-background': `--vscode-editor-background`,
  'vscode-editor-foreground': `--vscode-editor-foreground`,
  'vscode-error-foreground': `--vscode-errorForeground`,
}

const css_vars = Object.fromEntries(
  Object.keys(themes).map((key) => [
    key,
    special_mappings[key] || `--${key}`,
  ]),
)

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
globalThis.MATTERVIZ_CSS_MAP = css_vars
globalThis.MATTERVIZ_THEME_SOURCE = themes
globalThis.MATTERVIZ_SSR_PROPS = Object.keys(themes)
