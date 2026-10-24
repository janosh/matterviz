<script lang="ts">
  import LazyDemo from './LazyDemo.svelte'
  import element_data from '#lib/element/data.js'
  import { array_extent, array_max, array_min, type Vec2 } from '#lib/math.js'
  import TableInset from '#lib/periodic-table/TableInset.svelte'
  import { open_element_page } from '#site/state.svelte.js'

  // Each element shows two values as diagonal triangles (atomic mass + density)
  const densities = element_data.map((element) => element.density || 0)
  const two_fold_data = element_data.map((element, idx) => [
    element.atomic_mass,
    densities[idx],
  ])
  const atomic_mass_range = array_extent(element_data.map((element) => element.atomic_mass))
  const density_range: Vec2 = [
    array_min(densities.filter((dens) => dens > 0)),
    array_max(densities),
  ]
  const color_bars = [
    [`Atomic Mass (u)`, atomic_mass_range],
    [`Density (g/cm³)`, density_range],
  ] as const
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
  {#await Promise.all( [import('#lib/periodic-table/PeriodicTable.svelte'), import('#lib/plot/core/components/ColorBar.svelte')] )}
    <p role="status">Loading multi-value heatmap…</p>
  {:then [{ default: PeriodicTable }, { default: ColorBar }]}
    <PeriodicTable
      tile_props={{ show_name: false, show_number: false }}
      heatmap_values={two_fold_data}
      color_scale="interpolateRdYlBu"
      on_activate={open_element_page}
    >
      {#snippet inset()}
        <TableInset>
          <div class="color-bars">
            {#each color_bars as [title, range] (title)}
              <ColorBar
                {title}
                color_scale={{ scheme: `interpolateRdYlBu`, value_range: [...range] }}
                orientation="horizontal"
                bar_style="width: 180px; height: 12px"
                tick_labels={3}
                title_side="top"
              />
            {/each}
          </div>
        </TableInset>
      {/snippet}
    </PeriodicTable>
  {:catch error}
    <p role="alert">Failed to load multi-value heatmap: {String(error)}</p>
  {/await}
</LazyDemo>

<style>
  .color-bars {
    display: flex;
    flex-wrap: wrap;
    place-content: center;
    align-items: center;
    gap: 1.5em 2em;
    padding: 0.5em;
  }
</style>
