import type { D3InterpolateName } from '$lib/colors'
import type { HTMLAttributes } from 'svelte/elements'
import type {
  HighlightStyle,
  HoverData3D,
  PDControlsType,
  PhaseData,
  PhaseDiagramConfig,
  PhaseStats,
} from './types'

export * from './barycentric-coords'
export { default as PhaseDiagram } from './PhaseDiagram.svelte'
export { default as PhaseDiagram2D } from './PhaseDiagram2D.svelte'
export { default as PhaseDiagram3D } from './PhaseDiagram3D.svelte'
export { default as PhaseDiagram4D } from './PhaseDiagram4D.svelte'
export { default as PhaseDiagramControls } from './PhaseDiagramControls.svelte'
export { default as PhaseDiagramInfoPane } from './PhaseDiagramInfoPane.svelte'
export { default as PhaseDiagramStats } from './PhaseDiagramStats.svelte'
export * from './thermodynamics'
export * from './types'

// Base props shared across all phase diagram components (2D, 3D, 4D)
export interface BasePhaseDiagramProps<AnyDimEntry = PhaseData>
  extends Omit<HTMLAttributes<HTMLDivElement>, `entries`> {
  entries: PhaseData[]
  controls?: Partial<PDControlsType>
  config?: Partial<PhaseDiagramConfig>
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
  // Enable structure preview overlay when hovering over entries with structure data
  enable_structure_preview?: boolean
  energy_source_mode?: `precomputed` | `on-the-fly`
  // Bindable phase diagram statistics - computed internally but exposed for external use
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
}

// Additional props specific to 3D and 4D phase diagrams
export interface Hull3DProps {
  show_hull_faces?: boolean
  hull_face_opacity?: number
}

// Configuration result from merging user controls with defaults
export interface MergedPDConfig {
  controls: PDControlsType
  config: PhaseDiagramConfig
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
export const default_controls: PDControlsType = {
  title: ``,
  show: true,
  position: `top-right`,
  width: 280,
  show_counts: true,
  show_color_toggle: true,
  show_label_controls: true,
}

// Phase diagram defaults shared by 2D, 3D, and 4D
export const default_pd_config: PhaseDiagramConfig = {
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

// Shared PD styles (single source of truth shared by 2D, 3D, and 4D)
export const PD_STYLE = Object.freeze({
  structure_line: Object.freeze({
    color: `rgba(128, 128, 128, 0.6)`,
    dash: [3, 3] as [number, number],
    line_width: 2,
  }),
  z_index: Object.freeze({
    tooltip: 6000,
    copy_feedback: 10000,
  }),
})
