<script lang="ts">
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
  import SubpageGrid from 'svelte-widgets/SubpageGrid.svelte'
  import { to_subpages, EquationOfStateIcon, LinkedBrushingIcon } from '#site/overview'

  // oxfmt-ignore
  const subpages = to_subpages([
    [`/plot/scatter-plot`, `Scatter Plot`, ScatterPlot, `2D scatter with multiple display modes, styling controls, and multi-series support.`],
    [`/plot/binned-scatter`, `Binned Scatter Plot`, BinnedScatterPlot, `Adaptive density rendering for crowded point clouds with point picking and structure popups.`],
    [`/plot/facet-grid`, `Facet Grid`, FacetGrid, `Coordinated plot panels with shared ranges, padding, linked interactions, outer axes, and shared chrome bands.`],
    [`/plot/linked-brushing`, `Linked Brushing`, LinkedBrushingIcon, `Alt+drag points in one plot to highlight the same items, keyed by point_ids, in other plots and a periodic table.`],
    [`/plot/scatter-plot-3d`, `3D Scatter Plot`, ScatterPlot3D, `Three.js-powered 3D scatter with instanced rendering, colored surfaces, and camera controls.`],
    [`/plot/eos`, `Equation of State`, EquationOfStateIcon, `Birch–Murnaghan, Murnaghan and Vinet fits of energy–volume scans, matching pymatgen.`],
    [`/plot/bar-plot`, `Bar Plot`, BarPlot, `Vertical/horizontal bars with rounded corners, borders, stacked/grouped modes, and grid display.`],
    [`/plot/histogram`, `Histogram`, Histogram, `Frequency distribution bars with configurable binning, border radius, and stroke styling.`],
    [`/plot/box-plot`, `Box Plot`, BoxPlot, `Distribution summaries with quartile boxes, medians, whiskers, and outliers from raw data.`],
    [`/plot/violin`, `Violin Plot`, ViolinPlot, `KDE density shapes (optionally with inner box): one-sided, two-sided, and split violins.`],
    [`/plot/sankey`, `Sankey`, Sankey, `Flow diagrams for weighted transitions between categories with horizontal/vertical layout and link highlighting.`],
    [`/plot/ternary`, `Ternary Plot`, TernaryPlot, `Three-component compositions in a barycentric triangle with grid, edge ticks, paths, and per-point coloring.`],
    [`/plot/sunburst`, `Sunburst & Icicle`, Sunburst, `Zoomable hierarchical rings or stacked rows with animated drill-down, e.g. crystal-system/spacegroup distributions.`],
    [`/plot/treemap`, `Treemap`, Treemap, `Zoomable squarified rectangles for hierarchical part-of-whole data, e.g. arity/chemical-system breakdowns.`],
    [`/plot/spacegroup-bar-plot`, `Spacegroup Bar Plot`, SpacegroupBarPlot, `Crystallographic space group distributions with automatic crystal system coloring.`],
    [`/plot/heatmap-matrix`, `Heatmap Matrix`, HeatmapMatrix, `Interactive pairwise heatmap with symmetric modes, search, axis ordering, and cell values.`],
    [`/plot/heatmap-table`, `Heatmap Table`, HeatmapTable, `Sortable data table with heatmap cell coloring, column grouping, and drag-and-drop reordering.`],
    [`/plot/color-bar`, `Color Bar`, ColorBar, `Standalone color scale legend with configurable tick labels, orientation, and scale types.`],
    [`/plot/color-scales`, `Color Scales`, ColorPalette, `Browse and compare D3 color scales with live previews on a periodic table.`],
    [`/plot/data-cleaning`, `Data Cleaning`, DataClean, `Utilities for filtering NaN/Infinity values, deduplication, and multi-series normalization.`],
  ])
</script>

<SubpageGrid
  title="Plot Components"
  subtitle="Interactive visualization components for scientific data."
  {subpages}
/>
