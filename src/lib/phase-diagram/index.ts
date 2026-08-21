export { build_diagram } from './build-diagram'
export * from './colors'
export type * from './diagram-input'
export { default as IsobaricBinaryPhaseDiagram } from './IsobaricBinaryPhaseDiagram.svelte'
export * from './parse'
export { default as PhaseDiagramControls } from './PhaseDiagramControls.svelte'
export { default as PhaseDiagramEditorPane } from './PhaseDiagramEditorPane.svelte'
export { default as PhaseDiagramExportPane } from './PhaseDiagramExportPane.svelte'
export { default as PhaseDiagramTooltip } from './PhaseDiagramTooltip.svelte'
export { parse_phase_diagram_svg } from './svg-to-diagram'
export { default as TdbInfoPanel } from './TdbInfoPanel.svelte'
export * from './ternary'
export type * from './types'
// Rendering internals (SVG path/label/gradient helpers, config merging, formula markup)
// stay module-private; these are the pieces a custom tooltip or hover handler needs.
export {
  calculate_lever_rule,
  calculate_vertical_lever_rule,
  convert_temp,
  find_phase_at_point,
  format_composition,
  format_hover_info_text,
  format_temperature,
  get_phase_color,
  PHASE_DIAGRAM_DEFAULTS,
} from './utils'
