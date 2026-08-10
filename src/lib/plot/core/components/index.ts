// Components reached through this barrel. The rest of core/components (AxisLabel,
// Hierarchy{ColorBar,Controls,Shell}, InteractiveAxisLabel, PlotTitle, PortalSelect,
// ReferenceLine{,3D} and ReferencePlane) are imported from their .svelte path by the
// few files that use them.
export { default as ColorBar } from './ColorBar.svelte'
export { default as ColorScaleSelect } from './ColorScaleSelect.svelte'
export { default as FacetGrid } from './FacetGrid.svelte'
export { default as FillArea } from './FillArea.svelte'
export { default as Line } from './Line.svelte'
export { default as PlotAxis } from './PlotAxis.svelte'
export { default as PlotControls } from './PlotControls.svelte'
export { default as PlotLegend } from './PlotLegend.svelte'
export { default as PlotMarginals } from './PlotMarginals.svelte'
export { default as PlotTooltip } from './PlotTooltip.svelte'
export { default as ZeroLines } from './ZeroLines.svelte'
export { default as ZoomRect } from './ZoomRect.svelte'
