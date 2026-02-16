<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import type { IconName } from '$lib/icons'

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

<h1>Plot Components</h1>
<p class="subtitle">Interactive visualization components for scientific data.</p>

<nav class="grid">
  {#each subpages as { href, title, description, icon } (href)}
    <a {href} class="card">
      <Icon {icon} class="icon" />
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </a>
  {/each}
</nav>

<style>
  h1 {
    text-align: center;
    margin-bottom: 0.3em;
  }
  .subtitle {
    text-align: center;
    color: var(--text-color-muted);
    margin: 0 auto 2em;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1.2em;
    max-width: 1100px;
    margin: 0 auto;
    padding: 0;
  }
  .card {
    display: flex;
    gap: 1em;
    align-items: flex-start;
    padding: 1.2em 1.4em;
    border-radius: var(--border-radius, 5pt);
    border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s, box-shadow 0.15s;
    &:hover {
      border-color: color-mix(in srgb, currentColor 35%, transparent);
      box-shadow: 0 2px 12px color-mix(in srgb, currentColor 8%, transparent);
    }
    &:hover :global(.icon) {
      opacity: 1;
    }
    h2 {
      margin: 0 0 0.4em;
      font-size: 1.1em;
    }
    p {
      margin: 0;
      font-size: 0.88em;
      color: var(--text-color-muted);
      line-height: 1.5;
    }
  }
  .card :global(.icon) {
    width: 2em;
    height: 2em;
    flex-shrink: 0;
    margin-top: 0.1em;
    opacity: 0.6;
    transition: opacity 0.15s;
  }
</style>
