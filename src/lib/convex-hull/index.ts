import type { D3InterpolateName } from '$lib/colors'
import type { Snippet } from 'svelte'
import type { HTMLAttributes } from 'svelte/elements'
import type {
  ConvexHullConfig,
  ConvexHullControlsType,
  HighlightStyle,
  HoverData3D,
  PhaseData,
  PhaseStats,
} from './types'

export * from './barycentric-coords'
export { default as ConvexHull } from './ConvexHull.svelte'
export { default as ConvexHull2D } from './ConvexHull2D.svelte'
export { default as ConvexHull3D } from './ConvexHull3D.svelte'
export { default as ConvexHull4D } from './ConvexHull4D.svelte'
export { default as ConvexHullControls } from './ConvexHullControls.svelte'
export { default as ConvexHullInfoPane } from './ConvexHullInfoPane.svelte'
export { default as ConvexHullStats } from './ConvexHullStats.svelte'
export { default as ConvexHullTooltip } from './ConvexHullTooltip.svelte'
export * from './thermodynamics'
export * from './types'

export interface BaseConvexHullChildrenProps<AnyDimEntry = PhaseData> {
  stable_entries: AnyDimEntry[]
  unstable_entries: AnyDimEntry[]
  highlighted_entries: (string | AnyDimEntry)[]
  selected_entry: AnyDimEntry | null
}

// Props passed to tooltip snippet for custom tooltip rendering
export interface TooltipSnippetProps<AnyDimEntry = PhaseData> {
  entry: AnyDimEntry
  highlight_style?: HighlightStyle
}

// Tooltip configuration object for prefix/suffix content
// Values can be static strings or functions that receive the entry for dynamic content
export interface TooltipConfig<AnyDimEntry = PhaseData> {
  prefix?: string | ((entry: AnyDimEntry) => string)
  suffix?: string | ((entry: AnyDimEntry) => string)
}

// Union type for tooltip prop - can be a snippet or config object
export type TooltipProp<AnyDimEntry = PhaseData> =
  | Snippet<[TooltipSnippetProps<AnyDimEntry>]>
  | TooltipConfig<AnyDimEntry>

// Base props shared across all convex hull components (2D, 3D, 4D)
export interface BaseConvexHullProps<AnyDimEntry = PhaseData>
  extends Omit<HTMLAttributes<HTMLDivElement>, `entries` | `children`> {
  entries: PhaseData[]
  controls?: Partial<ConvexHullControlsType>
  config?: Partial<ConvexHullConfig>
  on_point_click?: (entry: AnyDimEntry) => void
  on_point_hover?: (data: HoverData3D<AnyDimEntry> | null) => void
  fullscreen?: boolean
  enable_fullscreen?: boolean
  enable_info_pane?: boolean
  wrapper?: HTMLDivElement
  // Smart label defaults - hide labels if more than this many entries
  label_threshold?: number
  // Visibility
  show_stable?: boolean
  show_unstable?: boolean
  color_mode?: `stability` | `energy`
  color_scale?: D3InterpolateName
  info_pane_open?: boolean
  // Legend pane visibility
  legend_pane_open?: boolean
  // Energy threshold for showing unstable entries (eV/atom above hull)
  max_hull_dist_show_phases?: number
  max_hull_dist_show_labels?: number
  show_stable_labels?: boolean
  show_unstable_labels?: boolean
  // Callback for when JSON files are dropped
  on_file_drop?: (entries: PhaseData[]) => void
  // Enable click selection/highlighting of entries (default: true)
  // When false, clicking entries won't set selected_entry
  enable_click_selection?: boolean
  // Enable structure preview popup when clicking entries with structure data
  enable_structure_preview?: boolean
  energy_source_mode?: `precomputed` | `on-the-fly`
  // Bindable convex hull statistics - computed internally but exposed for external use
  phase_stats?: PhaseStats | null
  // Display configuration for grid lines and other visual elements
  display?: { x_grid?: boolean; y_grid?: boolean }
  // Bindable stable and unstable entries - computed internally but exposed for external use
  stable_entries?: AnyDimEntry[]
  unstable_entries?: AnyDimEntry[]
  // Highlighted entries with customizable visual effects
  highlighted_entries?: (string | AnyDimEntry)[]
  highlight_style?: HighlightStyle
  selected_entry?: AnyDimEntry | null
  children?: Snippet<[BaseConvexHullChildrenProps<AnyDimEntry>]>
  // Custom tooltip - can be a snippet (replaces default) or config object (adds prefix/suffix)
  tooltip?: TooltipProp<AnyDimEntry>
}

// Additional props specific to 3D and 4D convex hulls
export interface Hull3DProps {
  show_hull_faces?: boolean
  hull_face_opacity?: number
}

// Configuration result from merging user controls with defaults
export interface MergedCHConfig {
  controls: ConvexHullControlsType
  config: ConvexHullConfig
}

// Energy source mode determination result
export interface EnergyModeInfo {
  has_precomputed_e_form: boolean
  has_precomputed_hull: boolean
  can_compute_e_form: boolean
  can_compute_hull: boolean
  energy_mode: `precomputed` | `on-the-fly`
  unary_refs: Record<string, PhaseData>
}

// Default legend configuration shared by 3D and 4D diagrams
export const default_controls: ConvexHullControlsType = {
  title: ``,
  show: `hover`,
  position: `top-right`,
  width: 280,
  show_counts: true,
  show_color_toggle: true,
  show_label_controls: true,
}

// Convex hull defaults shared by 2D, 3D, and 4D
export const default_hull_config: ConvexHullConfig = {
  width: 600,
  height: 600,
  unstable_threshold: 0.2,
  show_labels: true,
  show_hull: true,
  point_size: 8,
  line_width: 2,
  font_size: 12,
  colors: {
    stable: `#0072B2`,
    unstable: `#E69F00`,
    hull_line: `var(--accent-color, #1976D2)`,
    background: `transparent`,
    text: `var(--text-color, #212121)`,
    edge: `var(--text-color, #212121)`,
    tooltip_bg: `var(--tooltip-bg, rgba(0, 0, 0, 0.85))`,
    tooltip_text: `var(--tooltip-text, white)`,
    annotation: `var(--text-color, #212121)`,
  },
}

// Shared convex hull styles (single source of truth shared by 2D, 3D, and 4D)
export const CONVEX_HULL_STYLE = Object.freeze({
  structure_line: Object.freeze({
    color: `rgba(128, 128, 128, 0.6)`,
    dash: [3, 3],
    line_width: 2,
  }),
  z_index: Object.freeze({ tooltip: 6, copy_feedback: 10 }),
})
