<script lang="ts">
  import elements from '../periodic-table-data.ts'
  import { active_element, color_scale, heatmap, last_element } from '../stores'
  import BohrAtom from './BohrAtom.svelte'
  import ElementPhoto from './ElementPhoto.svelte'
  import ElementStats from './ElementStats.svelte'
  import ElementTile from './ElementTile.svelte'
  import ScatterPlot from './ScatterPlot.svelte'
  import TableInset from './TableInset.svelte'

  export let show_names = true
  export let show_active_elem_stats = true
  export let show_active_elem_bohr_model = true

  let window_width: number
</script>

<svelte:window bind:innerWidth={window_width} />

<div class="periodic-table">
  <TableInset>
    {#if $heatmap}
      <ScatterPlot on:hover={(e) => ($active_element = e.detail.element)} />
    {:else if show_active_elem_stats}
      <ElementStats />
    {/if}
  </TableInset>

  {#if show_active_elem_bohr_model && $last_element && window_width > 1300}
    {@const { shells, name, symbol } = $last_element}
    <div class="bohr-atom">
      <BohrAtom {shells} name="Bohr Model of {name}" {symbol} />
    </div>
  {/if}

  {#each elements as element}
    {@const value = element[$heatmap]}
    {@const heatmap_color = value ? $color_scale?.(value) : `transparent`}
    {@const bg_color = $heatmap ? heatmap_color : null}
    <a
      href={element.name.toLowerCase()}
      style="grid-column: {element.column}; grid-row: {element.row};"
      on:mouseenter={() => ($active_element = element)}
      on:mouseleave={() => ($active_element = null)}
    >
      <ElementTile {element} show_name={show_names} {value} {bg_color} />
    </a>
  {/each}
  <!-- provide vertical offset for lathanices + actinides -->
  <div class="spacer" />

  <ElementPhoto style="grid-column: 1 / span 2; grid-row: 9 / span 2;" />
</div>

<style>
  div.periodic-table {
    display: grid;
    grid-template-columns: repeat(18, 1fr);
    gap: min(0.2vw, 3pt);
    min-width: 600px;
    position: relative;
    margin: 2em auto 4em;
  }
  div.spacer {
    height: 24pt;
    grid-row: 8;
  }
  div.bohr-atom {
    position: absolute;
    bottom: 90%;
    right: 10%;
  }
</style>
