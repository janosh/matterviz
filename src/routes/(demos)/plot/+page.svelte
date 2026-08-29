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
    [
      `Scatter Plot`,
      `/plot/scatter-plot`,
      `2D scatter with multiple display modes, styling controls, and multi-series support.`,
      ScatterPlot,
    ],
    [
      `Binned Scatter Plot`,
      `/plot/binned-scatter`,
      `Adaptive density rendering for crowded point clouds with point picking and structure popups.`,
      BinnedScatterPlot,
    ],
    [
      `Facet Grid`,
      `/plot/facet-grid`,
      `Coordinated plot panels with shared ranges, padding, linked interactions, outer axes, and shared chrome bands.`,
      FacetGrid,
    ],
    [
      `3D Scatter Plot`,
      `/plot/scatter-plot-3d`,
      `Three.js-powered 3D scatter with instanced rendering, colored surfaces, and camera controls.`,
      ScatterPlot3D,
    ],
    [
      `Bar Plot`,
      `/plot/bar-plot`,
      `Vertical/horizontal bars with rounded corners, borders, stacked/grouped modes, and grid display.`,
      BarPlot,
    ],
    [
      `Histogram`,
      `/plot/histogram`,
      `Frequency distribution bars with configurable binning, border radius, and stroke styling.`,
      Histogram,
    ],
    [
      `Box Plot`,
      `/plot/box-plot`,
      `Distribution summaries with quartile boxes, medians, whiskers, and outliers from raw data.`,
      BoxPlot,
    ],
    [
      `Violin Plot`,
      `/plot/violin`,
      `KDE density shapes (optionally with inner box): one-sided, two-sided, and split violins.`,
      ViolinPlot,
    ],
    [
      `Sankey`,
      `/plot/sankey`,
      `Flow diagrams for weighted transitions between categories with horizontal/vertical layout and link highlighting.`,
      Sankey,
    ],
    [
      `Ternary Plot`,
      `/plot/ternary`,
      `Three-component compositions in a barycentric triangle with grid, edge ticks, paths, and per-point coloring.`,
      TernaryPlot,
    ],
    [
      `Sunburst & Icicle`,
      `/plot/sunburst`,
      `Zoomable hierarchical rings or stacked rows with animated drill-down, e.g. crystal-system/spacegroup distributions.`,
      Sunburst,
    ],
    [
      `Treemap`,
      `/plot/treemap`,
      `Zoomable squarified rectangles for hierarchical part-of-whole data, e.g. arity/chemical-system breakdowns.`,
      Treemap,
    ],
    [
      `Spacegroup Bar Plot`,
      `/plot/spacegroup-bar-plot`,
      `Crystallographic space group distributions with automatic crystal system coloring.`,
      SpacegroupBarPlot,
    ],
    [
      `Heatmap Matrix`,
      `/plot/heatmap-matrix`,
      `Interactive pairwise heatmap with symmetric modes, search, axis ordering, and cell values.`,
      HeatmapMatrix,
    ],
    [
      `Heatmap Table`,
      `/plot/heatmap-table`,
      `Sortable data table with heatmap cell coloring, column grouping, and drag-and-drop reordering.`,
      HeatmapTable,
    ],
    [
      `Color Bar`,
      `/plot/color-bar`,
      `Standalone color scale legend with configurable tick labels, orientation, and scale types.`,
      ColorBar,
    ],
    [
      `Color Scales`,
      `/plot/color-scales`,
      `Browse and compare D3 color scales with live previews on a periodic table.`,
      ColorPalette,
    ],
    [
      `Data Cleaning`,
      `/plot/data-cleaning`,
      `Utilities for filtering NaN/Infinity values, deduplication, and multi-series normalization.`,
      DataClean,
    ],
  ]
</script>

<SubpageGrid
  title="Plot Components"
  subtitle="Interactive visualization components for scientific data."
  {subpages}
/>
