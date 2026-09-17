<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import {
    BarPlot,
    BinnedScatterPlot,
    BoxPlot,
    ColorBar,
    ColorPalette,
    DataClean,
    FacetGrid,
    HeatmapMatrix,
    HeatmapTable,
    Histogram,
    Sankey,
    ScatterPlot,
    ScatterPlot3D,
    SpacegroupBarPlot,
    Sunburst,
    TernaryPlot,
    Treemap,
    ViolinPlot,
  } from 'svelte-widgets/icons'
  import { SubpageGrid } from 'svelte-widgets'

  const subpages: ComponentProps<typeof SubpageGrid>[`subpages`] = [
    {
      label: `Scatter Plot`,
      href: `/plot/scatter-plot`,
      description: `2D scatter with multiple display modes, styling controls, and multi-series support.`,
      icon: ScatterPlot,
    },
    {
      label: `Binned Scatter Plot`,
      href: `/plot/binned-scatter`,
      description: `Adaptive density rendering for crowded point clouds with point picking and structure popups.`,
      icon: BinnedScatterPlot,
    },
    {
      label: `Facet Grid`,
      href: `/plot/facet-grid`,
      description: `Coordinated plot panels with shared ranges, padding, linked interactions, outer axes, and shared chrome bands.`,
      icon: FacetGrid,
    },
    {
      label: `3D Scatter Plot`,
      href: `/plot/scatter-plot-3d`,
      description: `Three.js-powered 3D scatter with instanced rendering, colored surfaces, and camera controls.`,
      icon: ScatterPlot3D,
    },
    {
      label: `Bar Plot`,
      href: `/plot/bar-plot`,
      description: `Vertical/horizontal bars with rounded corners, borders, stacked/grouped modes, and grid display.`,
      icon: BarPlot,
    },
    {
      label: `Histogram`,
      href: `/plot/histogram`,
      description: `Frequency distribution bars with configurable binning, border radius, and stroke styling.`,
      icon: Histogram,
    },
    {
      label: `Box Plot`,
      href: `/plot/box-plot`,
      description: `Distribution summaries with quartile boxes, medians, whiskers, and outliers from raw data.`,
      icon: BoxPlot,
    },
    {
      label: `Violin Plot`,
      href: `/plot/violin`,
      description: `KDE density shapes (optionally with inner box): one-sided, two-sided, and split violins.`,
      icon: ViolinPlot,
    },
    {
      label: `Sankey`,
      href: `/plot/sankey`,
      description: `Flow diagrams for weighted transitions between categories with horizontal/vertical layout and link highlighting.`,
      icon: Sankey,
    },
    {
      label: `Ternary Plot`,
      href: `/plot/ternary`,
      description: `Three-component compositions in a barycentric triangle with grid, edge ticks, paths, and per-point coloring.`,
      icon: TernaryPlot,
    },
    {
      label: `Sunburst & Icicle`,
      href: `/plot/sunburst`,
      description: `Zoomable hierarchical rings or stacked rows with animated drill-down, e.g. crystal-system/spacegroup distributions.`,
      icon: Sunburst,
    },
    {
      label: `Treemap`,
      href: `/plot/treemap`,
      description: `Zoomable squarified rectangles for hierarchical part-of-whole data, e.g. arity/chemical-system breakdowns.`,
      icon: Treemap,
    },
    {
      label: `Spacegroup Bar Plot`,
      href: `/plot/spacegroup-bar-plot`,
      description: `Crystallographic space group distributions with automatic crystal system coloring.`,
      icon: SpacegroupBarPlot,
    },
    {
      label: `Heatmap Matrix`,
      href: `/plot/heatmap-matrix`,
      description: `Interactive pairwise heatmap with symmetric modes, search, axis ordering, and cell values.`,
      icon: HeatmapMatrix,
    },
    {
      label: `Heatmap Table`,
      href: `/plot/heatmap-table`,
      description: `Sortable data table with heatmap cell coloring, column grouping, and drag-and-drop reordering.`,
      icon: HeatmapTable,
    },
    {
      label: `Color Bar`,
      href: `/plot/color-bar`,
      description: `Standalone color scale legend with configurable tick labels, orientation, and scale types.`,
      icon: ColorBar,
    },
    {
      label: `Color Scales`,
      href: `/plot/color-scales`,
      description: `Browse and compare D3 color scales with live previews on a periodic table.`,
      icon: ColorPalette,
    },
    {
      label: `Data Cleaning`,
      href: `/plot/data-cleaning`,
      description: `Utilities for filtering NaN/Infinity values, deduplication, and multi-series normalization.`,
      icon: DataClean,
    },
  ]
</script>

<SubpageGrid
  title="Plot Components"
  subtitle="Interactive visualization components for scientific data."
  {subpages}
/>
