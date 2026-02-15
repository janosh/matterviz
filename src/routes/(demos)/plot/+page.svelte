<script lang="ts">
  const subpages = [
    {
      href: `/plot/scatter-plot`,
      title: `Scatter Plot`,
      description:
        `2D scatter with multiple display modes, styling controls, and multi-series support.`,
      // scattered dots
      icon:
        `<circle cx="5" cy="16" r="1.8"/><circle cx="9" cy="8" r="1.8"/><circle cx="14" cy="14" r="1.8"/><circle cx="11" cy="4" r="1.8"/><circle cx="19" cy="7" r="1.8"/><circle cx="17" cy="17" r="1.8"/>`,
    },
    {
      href: `/plot/scatter-plot-3d`,
      title: `3D Scatter Plot`,
      description:
        `Three.js-powered 3D scatter with instanced rendering, colored surfaces, and camera controls.`,
      // 3 axes + dots
      icon:
        `<g stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"><line x1="3" y1="21" x2="3" y2="5"/><line x1="3" y1="21" x2="21" y2="21"/><line x1="3" y1="21" x2="9" y2="15"/></g><circle cx="11" cy="11" r="1.5"/><circle cx="16" cy="15" r="1.5"/><circle cx="8" cy="16" r="1.5"/><circle cx="15" cy="8" r="1.5"/>`,
    },
    {
      href: `/plot/bar-plot`,
      title: `Bar Plot`,
      description:
        `Vertical/horizontal bars with rounded corners, borders, stacked/grouped modes, and grid display.`,
      // 3 bars
      icon:
        `<rect x="3" y="13" width="5" height="8" rx="1"/><rect x="10" y="5" width="5" height="16" rx="1"/><rect x="17" y="9" width="5" height="12" rx="1"/>`,
    },
    {
      href: `/plot/histogram`,
      title: `Histogram`,
      description:
        `Frequency distribution bars with configurable binning, border radius, and stroke styling.`,
      // bell-shaped adjacent bars
      icon:
        `<rect x="2" y="16" width="3.3" height="5"/><rect x="5.3" y="11" width="3.3" height="10"/><rect x="8.6" y="5" width="3.3" height="16"/><rect x="11.9" y="8" width="3.3" height="13"/><rect x="15.2" y="13" width="3.3" height="8"/><rect x="18.5" y="17" width="3.3" height="4"/>`,
    },
    {
      href: `/plot/spacegroup-bar-plot`,
      title: `Spacegroup Bar Plot`,
      description:
        `Crystallographic space group distributions with automatic crystal system coloring.`,
      // bars with diamond crystal marker
      icon:
        `<rect x="2" y="13" width="3.5" height="8"/><rect x="7" y="7" width="3.5" height="14"/><rect x="12" y="10" width="3.5" height="11"/><rect x="17" y="5" width="3.5" height="16"/><path d="M21 2l1.5 2.5h-3z" opacity="0.5"/>`,
    },
    {
      href: `/plot/heatmap-matrix`,
      title: `Heatmap Matrix`,
      description:
        `Interactive pairwise heatmap with symmetric modes, search, axis ordering, and cell values.`,
      // 3x3 grid with varying opacity
      icon:
        `<rect x="2" y="2" width="5.5" height="5.5" rx="0.8" opacity="0.9"/><rect x="9.2" y="2" width="5.5" height="5.5" rx="0.8" opacity="0.4"/><rect x="16.5" y="2" width="5.5" height="5.5" rx="0.8" opacity="0.15"/><rect x="2" y="9.2" width="5.5" height="5.5" rx="0.8" opacity="0.5"/><rect x="9.2" y="9.2" width="5.5" height="5.5" rx="0.8" opacity="0.8"/><rect x="16.5" y="9.2" width="5.5" height="5.5" rx="0.8" opacity="0.35"/><rect x="2" y="16.5" width="5.5" height="5.5" rx="0.8" opacity="0.2"/><rect x="9.2" y="16.5" width="5.5" height="5.5" rx="0.8" opacity="0.65"/><rect x="16.5" y="16.5" width="5.5" height="5.5" rx="0.8"/>`,
    },
    {
      href: `/plot/heatmap-table`,
      title: `Heatmap Table`,
      description:
        `Sortable data table with heatmap cell coloring, column grouping, and drag-and-drop reordering.`,
      // table with header + colored rows
      icon:
        `<rect x="2" y="2" width="20" height="4" rx="1" opacity="0.25"/><rect x="2" y="8" width="9" height="3.5" rx="0.5" opacity="0.6"/><rect x="13" y="8" width="9" height="3.5" rx="0.5" opacity="0.35"/><rect x="2" y="13.5" width="9" height="3.5" rx="0.5" opacity="0.85"/><rect x="13" y="13.5" width="9" height="3.5" rx="0.5" opacity="0.5"/><rect x="2" y="19" width="9" height="3.5" rx="0.5" opacity="0.3"/><rect x="13" y="19" width="9" height="3.5" rx="0.5" opacity="0.9"/>`,
    },
    {
      href: `/plot/color-bar`,
      title: `Color Bar`,
      description:
        `Standalone color scale legend with configurable tick labels, orientation, and scale types.`,
      // gradient bar with tick marks
      icon:
        `<rect x="6" y="2" width="5" height="20" rx="2.5" opacity="0.15"/><rect x="6" y="2" width="5" height="15" rx="2.5" opacity="0.4"/><rect x="6" y="2" width="5" height="10" rx="2.5" opacity="0.7"/><rect x="6" y="2" width="5" height="5" rx="2.5"/><g stroke="currentColor" stroke-width="1.2" opacity="0.5"><line x1="13" y1="4" x2="16" y2="4"/><line x1="13" y1="12" x2="16" y2="12"/><line x1="13" y1="20" x2="16" y2="20"/></g>`,
    },
    {
      href: `/plot/color-scales`,
      title: `Color Scales`,
      description:
        `Browse and compare D3 color scales with live previews on a periodic table.`,
      // palette circles
      icon:
        `<circle cx="5" cy="7" r="3.5" opacity="0.2"/><circle cx="12" cy="7" r="3.5" opacity="0.55"/><circle cx="19" cy="7" r="3.5" opacity="0.9"/><circle cx="5" cy="16" r="3.5" opacity="0.75"/><circle cx="12" cy="16" r="3.5" opacity="0.4"/><circle cx="19" cy="16" r="3.5"/>`,
    },
    {
      href: `/plot/data-cleaning`,
      title: `Data Cleaning`,
      description:
        `Utilities for filtering NaN/Infinity values, deduplication, and multi-series normalization.`,
      // funnel/filter
      icon: `<path d="M2 4h20L14 12v6l-4 2V12z"/>`,
    },
  ]
</script>

<h1>Plot Components</h1>
<p class="subtitle">Interactive visualization components for scientific data.</p>

<nav class="grid">
  {#each subpages as { href, title, description, icon } (href)}
    <a {href} class="card">
      <svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        {@html icon}
      </svg>
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
    &:hover .icon {
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
  .icon {
    width: 2em;
    height: 2em;
    flex-shrink: 0;
    margin-top: 0.1em;
    opacity: 0.6;
    transition: opacity 0.15s;
  }
</style>
