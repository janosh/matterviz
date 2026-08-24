<script lang="ts">
  import { goto } from '$app/navigation'
  import type { ChemicalElement, ElementCategory, ElementSymbol } from '$lib'
  import { element_data, PeriodicTable } from '$lib'
  import { array_max, array_min, type Vec2 } from '$lib/math'
  import { TableInset } from '$lib/periodic-table'
  import { ColorBar } from '$lib/plot'
  import { MultiValueHeatmapDemo, PeriodicTableDemo } from '$site'

  // Quadrant heatmap: one color bar per quadrant, ranged over the elements that have a value
  const four_fold_quadrants = [
    [`Atomic Radius (pm)`, (el: ChemicalElement) => el.atomic_radius || 0],
    [`Electronegativity × 100`, (el: ChemicalElement) => (el.electronegativity || 0) * 100],
    [`Covalent Radius (pm)`, (el: ChemicalElement) => el.covalent_radius || 0],
    [
      `|Electron Affinity| (kJ/mol)`,
      (el: ChemicalElement) => Math.abs(el.electron_affinity || 0),
    ],
  ] as const
  const four_fold_data = element_data.map((el) =>
    four_fold_quadrants.map(([, value_of]) => value_of(el)),
  )
  const four_fold_ranges = four_fold_quadrants.map(([title], quadrant_idx): [string, Vec2] => {
    const values = four_fold_data.map((quadrants) => quadrants[quadrant_idx])
    return [title, [array_min(values.filter((val) => val > 0)), array_max(values)]]
  })

  const on_activate = (element: ChemicalElement) => {
    if (!element?.name) return
    goto(`/${element.name.toLowerCase()}`)
  }

  let window_width: number = $state(0)

  // Missing color demo periodic table
  let missing_heatmap_key: string | null = $state(`atomic_mass`)
  let missing_color: string = $state(`#666666`)
  let missing_use_category: boolean = $state(false)
  let missing_label: string = $state(``)
  let missing_opacity: number = $state(1)
  let missing_active_element: ChemicalElement | null = $state(null)
  let missing_active_category: ElementCategory | null = $state(null)

  // Missing color demo derived values (null = missing, distinct from a real 0)
  let missing_get_element_value = $derived((el: ChemicalElement): number | null => {
    if (!missing_heatmap_key) return null
    const value = el[missing_heatmap_key as keyof typeof el]
    return typeof value === `number` ? value : null
  })

  let missing_config = $derived({
    color: missing_use_category ? `element-category` : missing_color,
    label: missing_label || undefined,
    // dim missing tiles via the `style` escape hatch (opacity fades the whole tile)
    style: missing_opacity < 1 ? `opacity: ${missing_opacity}` : undefined,
  })
  let missing_heatmap_values = $derived.by(() => {
    if (!missing_heatmap_key) return []

    const full_values = element_data.map(missing_get_element_value)

    // only show every 3rd element so the rest demo the missing fallback
    return full_values.map((value, idx) => (idx % 3 === 0 ? value : null))
  })

  // Active elements border demo
  let active_elements: ElementSymbol[] = $state([`H`, `C`, `N`, `O`, `Fe`, `Cu`, `Au`, `Ag`])
  let active_tile_border = $state({ width: `2px`, style: `solid`, color: `#ff0000` })
</script>

<svelte:window bind:innerWidth={window_width} />

<h1>Periodic Table</h1>

<PeriodicTableDemo />

<MultiValueHeatmapDemo />

<h2>4-fold Split</h2>
<p>
  Each element shows four values as quadrants: <strong>top-left = atomic radius</strong>,
  <strong>top-right = electronegativity * 100</strong>,
  <strong>bottom-left = covalent radius</strong>,
  <strong>bottom-right = |electron affinity|</strong>.
</p>
<PeriodicTable
  tile_props={{ show_name: false, show_number: false }}
  heatmap_values={four_fold_data}
  color_scale="interpolateViridis"
  split_layout="quadrant"
  tooltip
  {on_activate}
>
  {#snippet inset()}
    <TableInset
      style="display: grid; grid-template-columns: max-content max-content; gap: 2em; place-content: center"
    >
      {#each four_fold_ranges as [title, range] (title)}
        <ColorBar
          {title}
          scale="interpolateViridis"
          {range}
          orientation="horizontal"
          bar_style="width: 135px; height: 12px"
          tick_labels={3}
          title_side="top"
        />
      {/each}
    </TableInset>
  {/snippet}
</PeriodicTable>

<h2>Missing Color Demo</h2>
<p>
  The <code>missing</code> prop (<code>{`{ color, label, style }`}</code>) styles tiles with no
  heatmap value. <code>color</code> takes any CSS color or
  <code>'element-category'</code> (default: category colors for a plain table, gray for a
  heatmap); <code>label</code> and <code>style</code> further decorate missing tiles (e.g.
  <code>style="opacity: 0.4"</code> to dim them). Note <code>0</code> is a real value mapped
  through the color scale. Only absent / <code>null</code> entries count as missing.
</p>

<PeriodicTable
  tile_props={{ show_name: window_width > 800 }}
  heatmap_values={missing_heatmap_values}
  missing={missing_config}
  bind:active_element={missing_active_element}
  bind:active_category={missing_active_category}
  links="name"
  tooltip
  style="margin: 1em auto; max-width: 1000px"
  {on_activate}
>
  {#snippet inset()}
    {@const style = `display: flex; align-items: center; gap: 3pt;`}
    <TableInset style="display: flex; gap: 1em; justify-content: center; flex-wrap: wrap">
      <label {style}>
        <input
          type="checkbox"
          bind:checked={missing_use_category}
          disabled={!missing_heatmap_values?.length}
        />
        Use element category colors
      </label>

      <label {style}>
        Missing color:
        <input
          type="color"
          bind:value={missing_color}
          disabled={missing_use_category || !missing_heatmap_values?.length}
        />
      </label>

      <label {style}>
        Missing label:
        <input
          type="text"
          placeholder="e.g. N/A"
          bind:value={missing_label}
          disabled={!missing_heatmap_values?.length}
          style="width: 5em"
        />
      </label>

      <label {style}>
        Missing opacity: {missing_opacity}
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.1"
          bind:value={missing_opacity}
          disabled={!missing_heatmap_values?.length}
        />
      </label>
    </TableInset>
  {/snippet}
</PeriodicTable>

<h2>Active Elements Border Styling</h2>
<p>
  Customize active element borders with CSS custom property <code
    >--elem-tile-active-border</code
  >.
</p>

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
      <code style="background: var(--sms-ui-bg); padding: 4px 8px; border-radius: 4px">
        {active_tile_border.width}
        {active_tile_border.style}
        {active_tile_border.color}
      </code>
    </TableInset>
  {/snippet}
</PeriodicTable>

<h2>Auto-Scaling Color Bar</h2>
<p>
  When <code>show_color_bar</code> is enabled (the default) and no custom inset is provided, the
  periodic table automatically displays a color bar that scales with the table size. The color bar
  font and bar width adapt to container width using container queries.
</p>

<div class="auto-colorbar-grid">
  {#each [{ title: `Atomic Mass`, property: `atomic_mass`, color_scale: `interpolatePlasma` }, { title: `Density`, property: `density`, color_scale: `interpolateCividis` }, { title: `Boiling Point`, property: `boiling_point`, color_scale: `interpolateTurbo` }] as const as { title, property, color_scale } (title)}
    <div>
      <h3 style="margin: 0 0 0.5em; text-align: center; font-size: 0.9em">{title}</h3>
      <PeriodicTable
        tile_props={{ show_name: false, show_number: false, show_symbol: false }}
        heatmap_values={element_data.map((el) => el[property] || 0)}
        {color_scale}
        gap="1px"
        style="--ptable-inner-transition-offset: 0.3"
      />
    </div>
  {/each}
</div>

<h2>2×2 Grid Layout</h2>

<div class="two-by-two-grid">
  {#each [{ title: `Atomic Mass`, property: `atomic_mass`, color_scale: `interpolateBlues` }, { title: `Density`, property: `density`, color_scale: `interpolateReds` }, { title: `Melting Point`, property: `melting_point`, color_scale: `interpolateOranges` }, { title: `Boiling Point`, property: `boiling_point`, color_scale: `interpolateGreens` }] as const as { title, property, color_scale } (title)}
    <PeriodicTable
      tile_props={{ show_name: false, show_number: false }}
      heatmap_values={element_data.map((el) => el[property] || 0)}
      {color_scale}
      show_color_bar={false}
    >
      {#snippet inset()}
        <TableInset style="display: grid; place-content: center">
          <h3 style="margin: 0">{title}</h3>
        </TableInset>
      {/snippet}
    </PeriodicTable>
  {/each}
</div>

<style>
  .auto-colorbar-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5em;
  }
  /* two columns on desktop (main is 50em wide), one below ~640px */
  .two-by-two-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
    gap: 2em;
  }
</style>
