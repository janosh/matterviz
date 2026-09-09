import type { ComponentProps } from 'svelte'
import type { HTMLAttributes } from 'svelte/elements'
import type ScatterPlot from './scatter/ScatterPlot.svelte'
import type BarPlot from './bar/BarPlot.svelte'
import type Histogram from './histogram/Histogram.svelte'
import type { BasePlotProps, PlotConfig } from './core/types'

// Public plot API. Chart families are exported wholesale; each folder has its own index.ts
// barrel re-exported here.
export * from './bar'
export * from './box'
export * from './histogram'
export * from './sankey'
export * from './scatter'
export * from './scatter-3d'
export * from './sunburst'
export * from './ternary'
export * from './treemap'

// core/ is deliberately NOT re-exported in bulk. It holds tick math, layout solvers,
// pan/zoom internals and decoration plumbing that must stay free to change, so only the
// prop-facing types and standalone components below are published. In-repo code that needs
// an internal symbol imports its `$lib/plot/core/...` module path directly.
export {
  ColorBar,
  ColorScaleSelect,
  FacetGrid,
  PlotControls,
  PlotLegend,
  PlotTooltip,
} from './core/components'
// Types every chart takes as props: series, axes, ticks, scales, styles, handlers,
// reference lines, fills and 3D variants.
export * from './core/types'
export {
  clean_multi_series,
  clean_series,
  clean_xyz,
  type CleaningConfig,
  type CleaningQuality,
  type CleaningResult,
  type InstabilityResult,
  type InvalidValueMode,
  type LocalOutlierConfig,
  type OscillationWeights,
  type PhysicalBounds,
  type SmoothingConfig,
  type TruncationMode,
} from './core/data-cleaning'
export type { DecorationSide, FreeAnnotationDecorationItem } from './core/decorations'
export type {
  FacetAxis,
  FacetAxisMode,
  FacetAxisModes,
  FacetAxisRanges,
  FacetAxisVisibility,
  FacetAxisVisibilityMode,
  FacetAxisVisibilityModes,
  FacetKey,
  FacetPanel,
  FacetPanelContext,
  FacetSharedBandContext,
  FacetSharedBandSizes,
} from './core/facets'
export type { Sides } from './core/layout'
export type {
  MarginalAxes,
  MarginalAxis,
  MarginalAxisBinding,
  MarginalConfig,
  MarginalCurve,
  MarginalNormalize,
  MarginalPlacement,
  MarginalSeriesInput,
  MarginalSide,
  MarginalSideInput,
  MarginalsProp,
  MarginalType,
} from './core/marginals'
// Hatch/texture fills: the `pattern` accepted by bars, hierarchy nodes, fill regions, …
export { PATTERN_SHAPES } from './core/patterns'
export type {
  FillPattern,
  PatternDash,
  PatternOptions,
  PatternShape,
  PatternShorthand,
  ResolvedPattern,
} from './core/patterns'
export * from './core/plot-title'
export type { TicksOption } from './core/scales'
// to_structure_entries shapes the headline prop of CoordinationBarPlot/BondAnglePlot
export {
  to_structure_entries,
  type StructureEntry,
  type StructureInput,
} from './core/structure-input'

type PlotElementOptions = Pick<
  HTMLAttributes<HTMLDivElement>,
  | 'id'
  | 'class'
  | 'style'
  | 'role'
  | 'tabindex'
  | 'aria-label'
  | 'aria-describedby'
  | 'onmouseleave'
> & { 'data-testid'?: string }

// Composite charts deliberately expose presentation and interaction options, never child data.
type PlotOptionKey =
  | keyof PlotConfig
  | Exclude<keyof BasePlotProps, 'hovered'>
  | 'legend'
  | 'show_legend'
  | 'pan'
  | 'marginals'
  | 'ref_lines'
  | 'on_ref_line_click'
  | 'on_ref_line_hover'
  | 'header_controls'
  | 'user_content'
  | 'hidden_series'
  | 'on_hidden_series_change'
  | 'on_axis_change'
  | 'axis_loading'
  | 'tooltip'
  | 'controls_extra'

export type ScatterPlotOptions = PlotElementOptions &
  Pick<
    ComponentProps<typeof ScatterPlot>,
    | PlotOptionKey
    | 'styles'
    | 'color_scale'
    | 'size_scale'
    | 'color_bar'
    | 'label_placement_config'
    | 'hover_config'
    | 'point_tween'
    | 'line_tween'
    | 'point_events'
    | 'on_point_click'
    | 'on_point_hover'
    | 'on_plot_click'
    | 'view'
    | 'resolved_padding'
    | 'marker_renderer'
    | 'error_bar_cap'
    | 'point_hit_padding'
    | 'on_select'
  >

export type BarPlotOptions = PlotElementOptions &
  Pick<
    ComponentProps<typeof BarPlot>,
    | PlotOptionKey
    | 'orientation'
    | 'mode'
    | 'bar'
    | 'line'
    | 'color_scale'
    | 'size_scale'
    | 'on_bar_click'
    | 'on_bar_hover'
    | 'on_point_click'
    | 'on_point_hover'
  >

export type HistogramOptions = PlotElementOptions &
  Pick<
    ComponentProps<typeof Histogram>,
    | PlotOptionKey
    | 'bins'
    | 'normalize'
    | 'bar'
    | 'mode'
    | 'on_bar_click'
    | 'on_bar_hover'
    | 'on_series_toggle'
  >

export { create_axis_loader } from './core/axis-utils'
