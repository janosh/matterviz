<script lang="ts">
  import type { IconName } from '$lib/icons'
  import { SubpageGrid } from '$lib/layout'

  const subpages: {
    href: string
    title: string
    description: string
    icon: IconName
  }[] = [
    {
      href: `/plot/scatter-plot`,
      title: `Scatter Plot`,
      description:
        `2D scatter with multiple display modes, styling controls, and multi-series support.`,
      icon: `ScatterPlot`,
    },
    {
      href: `/plot/scatter-plot-3d`,
      title: `3D Scatter Plot`,
      description:
        `Three.js-powered 3D scatter with instanced rendering, colored surfaces, and camera controls.`,
      icon: `ScatterPlot3D`,
    },
    {
      href: `/plot/bar-plot`,
      title: `Bar Plot`,
      description:
        `Vertical/horizontal bars with rounded corners, borders, stacked/grouped modes, and grid display.`,
      icon: `Graph`,
    },
    {
      href: `/plot/histogram`,
      title: `Histogram`,
      description:
        `Frequency distribution bars with configurable binning, border radius, and stroke styling.`,
      icon: `Histogram`,
    },
    {
      href: `/plot/spacegroup-bar-plot`,
      title: `Spacegroup Bar Plot`,
      description:
        `Crystallographic space group distributions with automatic crystal system coloring.`,
      icon: `SpacegroupBarPlot`,
    },
    {
      href: `/plot/heatmap-matrix`,
      title: `Heatmap Matrix`,
      description:
        `Interactive pairwise heatmap with symmetric modes, search, axis ordering, and cell values.`,
      icon: `HeatmapMatrix`,
    },
    {
      href: `/plot/heatmap-table`,
      title: `Heatmap Table`,
      description:
        `Sortable data table with heatmap cell coloring, column grouping, and drag-and-drop reordering.`,
      icon: `HeatmapTable`,
    },
    {
      href: `/plot/color-bar`,
      title: `Color Bar`,
      description:
        `Standalone color scale legend with configurable tick labels, orientation, and scale types.`,
      icon: `ColorBar`,
    },
    {
      href: `/plot/color-scales`,
      title: `Color Scales`,
      description:
        `Browse and compare D3 color scales with live previews on a periodic table.`,
      icon: `ColorPalette`,
    },
    {
      href: `/plot/data-cleaning`,
      title: `Data Cleaning`,
      description:
        `Utilities for filtering NaN/Infinity values, deduplication, and multi-series normalization.`,
      icon: `Filter`,
    },
  ]
</script>

<SubpageGrid
  title="Plot Components"
  subtitle="Interactive visualization components for scientific data."
  {subpages}
/>
