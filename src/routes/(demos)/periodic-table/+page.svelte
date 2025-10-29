<script lang="ts">
  import { goto } from '$app/navigation'
  import type { ChemicalElement, ElementCategory } from '$lib'
  import { element_data, PeriodicTable } from '$lib'
  import { TableInset } from '$lib/periodic-table'
  import { ColorBar } from '$lib/plot'
  import { PeriodicTableDemo } from '$site'

  let four_fold_data = $derived(
    element_data.map((el) => [
      el.atomic_radius || 0,
      (el.electronegativity || 0) * 100,
      el.covalent_radius || 0,
      Math.abs(el.electron_affinity || 0),
    ]),
  )

  const onenter = (element: ChemicalElement) => {
    if (!element?.name) return
    goto(`/${element.name.toLowerCase()}`)
  }

  let atomic_radius_range = $derived([
    Math.min(...element_data.map((el) => el.atomic_radius || 0).filter((r) => r > 0)),
    Math.max(...element_data.map((el) => el.atomic_radius || 0)),
  ] as [number, number])
  let electronegativity_range = $derived([
    Math.min(
      ...element_data.map((el) => (el.electronegativity || 0) * 100).filter((
        elec_neg,
      ) => elec_neg > 0),
    ),
    Math.max(...element_data.map((el) => (el.electronegativity || 0) * 100)),
  ] as [number, number])

  let covalent_radius_range = $derived([
    Math.min(
      ...element_data.map((el) => el.covalent_radius || 0).filter((r) => r > 0),
    ),
    Math.max(...element_data.map((el) => el.covalent_radius || 0)),
  ] as [number, number])

  let electron_affinity_range = $derived([
    Math.min(
      ...element_data
        .map((el) => Math.abs(el.electron_affinity || 0))
        .filter((elec_aff) => elec_aff > 0),
    ),
    Math.max(...element_data.map((el) => Math.abs(el.electron_affinity || 0))),
  ] as [number, number])

  let window_width: number = $state(0)

  // Missing color demo periodic table
  let missing_heatmap_key: string | null = $state(`atomic_mass`)
  let missing_color: string = $state(`#666666`)
  let missing_use_category: boolean = $state(false)
  let missing_active_element: ChemicalElement | null = $state(null)
  let missing_active_category: ElementCategory | null = $state(null)

  // Missing color demo derived values
  let missing_get_element_value = $derived((el: ChemicalElement) => {
    if (!missing_heatmap_key) return 0
    const value = el[missing_heatmap_key as keyof typeof el]
    return typeof value === `number` ? value : 0
  })

  let missing_computed_color = $derived(
    missing_use_category ? `element-category` : missing_color,
  )
  let missing_heatmap_values = $derived.by(() => {
    if (!missing_heatmap_key) return []

    const full_values = element_data.map(missing_get_element_value)

    // only show every 3rd element to demo missing color
    return full_values.map((value, idx) => (idx % 3 === 0 ? value : 0))
  })
</script>

<svelte:window bind:innerWidth={window_width} />

<h1>Periodic Table</h1>

<PeriodicTableDemo />

<h3>4-fold Split</h3>
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
  {onenter}
>
  {#snippet inset()}
    <TableInset
      style="display: grid; grid-template-columns: max-content max-content; gap: 2em; place-content: center"
    >
      <ColorBar
        title="Atomic Radius (pm)"
        color_scale="interpolateViridis"
        range={atomic_radius_range}
        orientation="horizontal"
        bar_style="width: 135px; height: 12px"
        tick_labels={3}
        title_side="top"
      />
      <ColorBar
        title="Electronegativity × 100"
        color_scale="interpolateViridis"
        range={electronegativity_range}
        orientation="horizontal"
        bar_style="width: 135px; height: 12px"
        tick_labels={3}
        title_side="top"
      />
      <ColorBar
        title="Covalent Radius (pm)"
        color_scale="interpolateViridis"
        range={covalent_radius_range}
        orientation="horizontal"
        bar_style="width: 135px; height: 12px"
        tick_labels={3}
        title_side="top"
      />
      <ColorBar
        title="|Electron Affinity| (kJ/mol)"
        color_scale="interpolateViridis"
        range={electron_affinity_range}
        orientation="horizontal"
        bar_style="width: 135px; height: 12px"
        tick_labels={3}
        title_side="top"
      />
    </TableInset>
  {/snippet}
</PeriodicTable>

<h2>Missing Color Demo</h2>
<p>
  The <code>missing_color</code> prop is used to control how missing values in heatmap
  data are displayed.
</p>

<PeriodicTable
  tile_props={{ show_name: window_width > 800 }}
  heatmap_values={missing_heatmap_values}
  missing_color={missing_computed_color}
  bind:active_element={missing_active_element}
  bind:active_category={missing_active_category}
  links="name"
  tooltip
  style="margin: 1em auto; max-width: 1000px"
  {onenter}
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
    </TableInset>
  {/snippet}
</PeriodicTable>

<h2>2×2 Grid Layout</h2>

<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2em">
  {#each [
      {
        title: `Atomic Mass`,
        property: `atomic_mass`,
        color_scale: `interpolateBlues`,
      },
      { title: `Density`, property: `density`, color_scale: `interpolateReds` },
      {
        title: `Melting Point`,
        property: `melting_point`,
        color_scale: `interpolateOranges`,
      },
      {
        title: `Boiling Point`,
        property: `boiling_point`,
        color_scale: `interpolateGreens`,
      },
    ] as const as
    { title, property, color_scale }
    (title)
  }
    <PeriodicTable
      tile_props={{ show_name: false, show_number: false }}
      heatmap_values={element_data.map((el) => el[property] || 0)}
      {color_scale}
      show_color_bar={false}
    >
      {#snippet inset()}
        <TableInset style="display: grid; place-content: center">
          <h4 style="margin: 0">{title}</h4>
        </TableInset>
      {/snippet}
    </PeriodicTable>
  {/each}
</div>
