<script lang="ts">
  import LazyDemo from '#site/LazyDemo.svelte'
  import { goto } from '$app/navigation'
  import type { ChemicalElement, ElementSymbol } from '#lib'
  import { element_data, PeriodicTable } from '#lib'
  import { array_max, array_min, type Vec2 } from '#lib/math.js'
  import { TableInset } from '#lib/periodic-table/index.js'
  import { ColorBar } from '#lib/plot/index.js'
  import MultiValueHeatmapDemo from '#site/MultiValueHeatmapDemo.svelte'

  // Quadrant heatmap: one color bar per quadrant, ranged over the elements that have a value.
  // Unknown values are NaN, which the table draws as a missing (gray) segment rather than
  // coloring them like a real 0.
  const four_fold_quadrants = [
    [`Atomic Radius (Å)`, (element: ChemicalElement) => element.atomic_radius ?? NaN],
    [
      `Electronegativity × 100`,
      (element: ChemicalElement) => (element.electronegativity ?? NaN) * 100,
    ],
    [`Covalent Radius (Å)`, (element: ChemicalElement) => element.covalent_radius ?? NaN],
    [
      `|Electron Affinity| (kJ/mol)`,
      (element: ChemicalElement) => Math.abs(element.electron_affinity ?? NaN),
    ],
  ] as const
  const four_fold_data = element_data.map((element) =>
    four_fold_quadrants.map(([, value_of]) => value_of(element)),
  )
  const four_fold_ranges = four_fold_quadrants.map(([title], quadrant_idx): [string, Vec2] => {
    const values = four_fold_data
      .map((quadrants) => quadrants[quadrant_idx])
      .filter(Number.isFinite)
    return [title, [array_min(values), array_max(values)]]
  })

  const on_activate = (element: ChemicalElement) => {
    if (!element?.name) return
    goto(`/${element.name.toLowerCase()}`)
  }

  let window_width: number = $state(0)

  // Missing color demo periodic table
  let missing_color: string = $state(`#666666`)
  let missing_use_category: boolean = $state(false)
  let missing_label: string = $state(``)
  let missing_opacity: number = $state(1)

  let missing_config = $derived({
    color: missing_use_category ? `element-category` : missing_color,
    label: missing_label || undefined,
    // dim missing tiles via the `style` escape hatch (opacity fades the whole tile)
    style: missing_opacity < 1 ? `opacity: ${missing_opacity}` : undefined,
  })
  // only every 3rd element gets an atomic mass so the rest demo the missing fallback
  // (null = missing, distinct from a real 0)
  const missing_heatmap_values = element_data.map((element, idx) =>
    idx % 3 === 0 ? element.atomic_mass : null,
  )

  // One heatmap per property, for the auto color bar and 2×2 grids
  type Property = `atomic_mass` | `density` | `melting_point` | `boiling_point`
  const heatmap = (property: Property) => element_data.map((element) => element[property] || 0)
  const auto_color_bar_tables = [
    [`Atomic Mass`, `atomic_mass`, `interpolatePlasma`],
    [`Density`, `density`, `interpolateCividis`],
    [`Boiling Point`, `boiling_point`, `interpolateTurbo`],
  ] as const
  const grid_tables = [
    [`Atomic Mass`, `atomic_mass`, `interpolateBlues`],
    [`Density`, `density`, `interpolateReds`],
    [`Melting Point`, `melting_point`, `interpolateOranges`],
    [`Boiling Point`, `boiling_point`, `interpolateGreens`],
  ] as const

  // Active elements border demo
  let active_elements: ElementSymbol[] = $state([`H`, `C`, `N`, `O`, `Fe`, `Cu`, `Au`, `Ag`])
  let active_tile_border = $state({ width: `2px`, style: `solid`, color: `#ff0000` })
</script>

<svelte:window bind:innerWidth={window_width} />

<h1 id="periodic-table">Periodic Table</h1>

<LazyDemo
  label="Periodic table"
  load={() => import('#site/PeriodicTableDemo.svelte')}
  props={{}}
/>

<MultiValueHeatmapDemo />

<h2 id="4-fold-split">4-fold Split</h2>
<p>
  Each element shows four values as quadrants: <strong>top-left = atomic radius</strong>,
  <strong>top-right = electronegativity * 100</strong>,
  <strong>bottom-left = covalent radius</strong>,
  <strong>bottom-right = |electron affinity|</strong>.
</p>
<LazyDemo label="4-fold Split" height="400px">
  <PeriodicTable
    tile_props={{ show_name: false, show_number: false }}
    heatmap_values={four_fold_data}
    color_scale="interpolateViridis"
    split_layout="quadrant"
    {on_activate}
  >
    {#snippet inset()}
      <TableInset
        style="display: grid; grid-template-columns: max-content max-content; gap: 2em; place-content: center"
      >
        {#each four_fold_ranges as [title, range] (title)}
          <ColorBar
            {title}
            color_scale={{ scheme: `interpolateViridis`, value_range: range }}
            orientation="horizontal"
            bar_style="width: 135px; height: 12px"
            tick_labels={3}
            title_side="top"
          />
        {/each}
      </TableInset>
    {/snippet}
  </PeriodicTable>
</LazyDemo>

<h2 id="missing-color-demo">Missing Color Demo</h2>
<p>
  The <code>missing</code> prop (<code>{`{ color, label, style }`}</code>) styles tiles with no
  heatmap value. <code>color</code> takes any CSS color or
  <code>'element-category'</code> (default: category colors for a plain table, gray for a
  heatmap); <code>label</code> and <code>style</code> further decorate missing tiles (e.g.
  <code>style="opacity: 0.4"</code> to dim them). Note <code>0</code> is a real value mapped
  through the color scale. Only absent / <code>null</code> entries count as missing.
</p>

<LazyDemo label="Missing Color Demo">
  <PeriodicTable
    tile_props={{ show_name: window_width > 800 }}
    heatmap_values={missing_heatmap_values}
    missing={missing_config}
    links="name"
    style="margin: 1em auto; max-width: 1000px"
  >
    {#snippet inset()}
      <TableInset style="display: flex; gap: 1em; justify-content: center; flex-wrap: wrap">
        <label>
          <input type="checkbox" bind:checked={missing_use_category} />
          Use element category colors
        </label>

        <label>
          Missing color:
          <input type="color" bind:value={missing_color} disabled={missing_use_category} />
        </label>

        <label>
          Missing label:
          <input
            type="text"
            placeholder="e.g. N/A"
            bind:value={missing_label}
            style="width: 5em"
          />
        </label>

        <label>
          Missing opacity: {missing_opacity}
          <input type="range" min="0.1" max="1" step="0.1" bind:value={missing_opacity} />
        </label>
      </TableInset>
    {/snippet}
  </PeriodicTable>
</LazyDemo>

<h2 id="active-elements-border-styling">Active Elements Border Styling</h2>
<p>
  Customize active element borders with CSS custom property <code
    >--elem-tile-active-border</code
  >.
</p>

<LazyDemo label="Active Elements Border Styling">
  <PeriodicTable
    tile_props={{ show_name: window_width > 800 }}
    {active_elements}
    style={`--elem-tile-active-border: ${active_tile_border.width} ${active_tile_border.style} ${active_tile_border.color}`}
    {on_activate}
  >
    {#snippet inset()}
      <TableInset
        style="display: flex; gap: 1em; place-content: center; flex-wrap: wrap; align-items: center"
      >
        <select bind:value={active_tile_border.width}>
          <option>1px</option>
          <option>2px</option>
          <option>3px</option>
        </select>
        <select bind:value={active_tile_border.style}>
          <option>solid</option>
          <option>dashed</option>
          <option>dotted</option>
        </select>
        <input type="color" bind:value={active_tile_border.color} style="height: 1.5em" />
        <code style="padding: 4px 8px; border-radius: 4px">
          {active_tile_border.width}
          {active_tile_border.style}
          {active_tile_border.color}
        </code>
      </TableInset>
    {/snippet}
  </PeriodicTable>
</LazyDemo>

<h2 id="auto-scaling-color-bar">Auto-Scaling Color Bar</h2>
<p>
  Unless <code>color_bar</code> is <code>null</code> or a custom inset is provided, the periodic
  table automatically displays a color bar that scales with the table size. The color bar font and
  bar width adapt to container width using container queries.
</p>

<!-- the color bar names each table, so no heading above it -->
<div class="table-grid bleed-1400">
  {#each auto_color_bar_tables as [title, property, color_scale] (title)}
    <LazyDemo label={title} height="220px">
      <PeriodicTable
        tile_props={{ show_name: false, show_number: false, show_symbol: false }}
        heatmap_values={heatmap(property)}
        {color_scale}
        color_bar={{ title }}
        gap="1px"
        style="--ptable-inner-transition-offset: 0.3"
      />
    </LazyDemo>
  {/each}
</div>

<h2 id="2-2-grid-layout">2×2 Grid Layout</h2>

<div class="table-grid two-by-two bleed-1400">
  {#each grid_tables as [title, property, color_scale] (title)}
    <LazyDemo label={title} height="220px">
      <PeriodicTable
        tile_props={{ show_name: false, show_number: false }}
        heatmap_values={heatmap(property)}
        {color_scale}
        color_bar={null}
      >
        {#snippet inset()}
          <TableInset style="display: grid; place-content: center">
            <h3 style="margin: 0">{title}</h3>
          </TableInset>
        {/snippet}
      </PeriodicTable>
    </LazyDemo>
  {/each}
</div>

<style>
  /* tables at least 300px wide, as many per row as the page margins allow */
  .table-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
    gap: 2em;
    /* stays a 2×2 square at any width the page margins allow, one column on phones */
    &.two-by-two {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      @media (max-width: 700px) {
        grid-template-columns: 1fr;
      }
    }
  }
</style>
