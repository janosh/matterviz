export * from './treemap'
export type { TreemapLabelFit, TreemapLabelFormatter, TreemapLabelLine } from './labels'
export { default as Treemap } from './Treemap.svelte'
// Shared with Sunburst; pass chart="treemap"
export { default as TreemapControls } from '$lib/plot/core/components/HierarchyControls.svelte'
