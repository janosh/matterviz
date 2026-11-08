export {
  boundary_description,
  BOUNDARY_STYLES,
  diagram_errors,
  diagram_hit,
  diagram_name,
  diagram_points,
  format_hover_info_text,
  model_phase_keys,
  observation_markers,
  phase_colors,
  phase_labeler,
  provenance_caption,
  region_label,
  status_color,
  status_label,
  temperature_extent,
} from './diagram'
export { default as IsobaricBinaryPhaseDiagram } from './IsobaricBinaryPhaseDiagram.svelte'
export { default as PhaseDiagramControls } from './PhaseDiagramControls.svelte'
export { default as PhaseDiagramEditorPane } from './PhaseDiagramEditorPane.svelte'
export { default as PhaseDiagramExportPane } from './PhaseDiagramExportPane.svelte'
export { default as PhaseDiagramTooltip } from './PhaseDiagramTooltip.svelte'
export * from './pressure-temperature'
export { parse_phase_diagram_svg } from './svg-to-diagram'
export * from './ternary'
export { BINARY_DIAGRAM_FORMAT } from './types'
export type * from './types'
// Rendering internals (SVG path/label helpers, config merging, formula markup) stay
// module-private; these are the pieces a custom tooltip or hover handler needs.
export {
  calculate_lever_rule,
  convert_temp,
  find_region_at,
  format_composition,
  format_temperature,
  PHASE_DIAGRAM_DEFAULTS,
} from './utils'
