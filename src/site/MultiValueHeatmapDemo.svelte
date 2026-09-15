<script lang="ts">
  import LazyDemo from './LazyDemo.svelte'
  import { goto } from '$app/navigation'
  import type { ChemicalElement } from '$lib'
  import element_data from '$lib/element/data'
  import { array_extent, array_max, array_min, type Vec2 } from '$lib/math'
  import TableInset from '$lib/periodic-table/TableInset.svelte'

  // Each element shows two values as diagonal triangles (atomic mass + density)
  const two_fold_data = element_data.map((element) => [
    element.atomic_mass,
    element.density || 0,
  ])

  const atomic_mass_range = array_extent(element_data.map((element) => element.atomic_mass))

  const densities = element_data.map((element) => element.density || 0)
  const density_range: Vec2 = [
    array_min(densities.filter((dens) => dens > 0)),
    array_max(densities),
  ]

  const on_activate = (element: ChemicalElement) => {
    if (!element?.name) return
    goto(`/${element.name.toLowerCase()}`)
  }
</script>

<h2 id="multi-value-heatmap" style="margin-top: 3em">Multi-value Heatmap</h2>
The periodic table supports multiple values per element with different visual layouts:

<h3 id="2-fold-split-diagonal">2-fold Split (Diagonal)</h3>
<p>
  Each element shows two values as diagonal triangles:
  <strong>top-left = atomic mass</strong>,
  <strong>bottom-right = density</strong>.
</p>
<LazyDemo label="Multi-value heatmap" height="400px">
  {#await Promise.all( [import('$lib/periodic-table/PeriodicTable.svelte'), import('$lib/plot/core/components/ColorBar.svelte')] )}
    <p role="status">Loading multi-value heatmap…</p>
  {:then [{ default: PeriodicTable }, { default: ColorBar }]}
    <PeriodicTable
      tile_props={{ show_name: false, show_number: false }}
      heatmap_values={two_fold_data}
      color_scale="interpolateRdYlBu"
      tooltip
      {on_activate}
    >
      {#snippet inset()}
        <TableInset
          style="display: flex; gap: 0 2em; justify-content: center; align-items: center; flex-wrap: wrap; padding: 0.5em"
        >
          {#each [[`Atomic Mass (u)`, atomic_mass_range], [`Density (g/cm³)`, density_range]] as const as [title, range] (title)}
            <ColorBar
              {title}
              scale="interpolateRdYlBu"
              {range}
              orientation="horizontal"
              bar_style="width: 180px; height: 12px"
              tick_labels={3}
              title_side="top"
            />
          {/each}
        </TableInset>
      {/snippet}
    </PeriodicTable>
  {:catch error}
    <p role="alert">Failed to load multi-value heatmap: {String(error)}</p>
  {/await}
</LazyDemo>
