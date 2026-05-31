<script lang="ts">
  import { goto } from '$app/navigation'
  import type { ChemicalElement } from '$lib'
  import { element_data, PeriodicTable } from '$lib'
  import type { Vec2 } from '$lib/math'
  import { TableInset } from '$lib/periodic-table'
  import { ColorBar } from '$lib/plot'

  // Each element shows two values as diagonal triangles (atomic mass + density)
  const two_fold_data = element_data.map((el) => [el.atomic_mass, el.density || 0])

  const atomic_mass_range = [
    Math.min(...element_data.map((el) => el.atomic_mass)),
    Math.max(...element_data.map((el) => el.atomic_mass)),
  ] as Vec2

  const density_range = [
    Math.min(...element_data.map((el) => el.density || 0).filter((dens) => dens > 0)),
    Math.max(...element_data.map((el) => el.density || 0)),
  ] as Vec2

  const onenter = (element: ChemicalElement) => {
    if (!element?.name) return
    goto(`/${element.name.toLowerCase()}`)
  }
</script>

<h2 style="margin-top: 3em">Multi-value Heatmap</h2>
The periodic table supports multiple values per element with different visual layouts:

<h3>2-fold Split (Diagonal)</h3>
<p>
  Each element shows two values as diagonal triangles:
  <strong>top-left = atomic mass</strong>,
  <strong>bottom-right = density</strong>.
</p>
<PeriodicTable
  tile_props={{ show_name: false, show_number: false }}
  heatmap_values={two_fold_data}
  color_scale="interpolateRdYlBu"
  tooltip
  {onenter}
>
  {#snippet inset()}
    <TableInset
      style="display: flex; gap: 0 2em; justify-content: center; align-items: center; flex-wrap: wrap; padding: 0.5em"
    >
      <ColorBar
        title="Atomic Mass (u)"
        color_scale="interpolateRdYlBu"
        range={atomic_mass_range}
        orientation="horizontal"
        bar_style="width: 180px; height: 12px"
        tick_labels={3}
        title_side="top"
      />
      <ColorBar
        title="Density (g/cm³)"
        color_scale="interpolateRdYlBu"
        range={density_range}
        orientation="horizontal"
        bar_style="width: 180px; height: 12px"
        tick_labels={3}
        title_side="top"
      />
    </TableInset>
  {/snippet}
</PeriodicTable>
