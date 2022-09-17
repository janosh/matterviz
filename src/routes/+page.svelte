<script lang="ts">
  import BohrAtom from '$lib/BohrAtom.svelte'
  import ColorCustomizer from '$lib/ColorCustomizer.svelte'
  import EasterEgg from '$lib/EasterEgg.svelte'
  import ElementStats from '$lib/ElementStats.svelte'
  import PeriodicTable from '$lib/PeriodicTable.svelte'
  import PropertySelect from '$lib/PropertySelect.svelte'
  import ScatterPlot from '$lib/ScatterPlot.svelte'
  import { active_element, heatmap, last_element } from '$lib/stores'
  import TableInset from '$lib/TableInset.svelte'
  import '../app.css'

  let window_width: number
  let x_angle = 0
  let y_angle = 0
  let auto_rotate: 'x' | 'y' | 'both' | 'none' = `none`
</script>

<svelte:head>
  <title>Periodic Table</title>
  <meta property="og:title" content="Periodic Table" />
</svelte:head>

<svelte:window bind:innerWidth={window_width} />

<h1>Periodic Table of Elements</h1>

<PropertySelect />

<div
  style:transform="rotateX({x_angle}deg) rotateY({y_angle}deg)"
  class="auto-rotate-{auto_rotate}"
>
  {#if $last_element && window_width > 1300}
    {@const { shells, name, symbol } = $last_element}
    <a href="/bohr-atoms">
      <BohrAtom {shells} name="Bohr Model of {name}" {symbol} style="width: 250px" />
    </a>
  {/if}
  <PeriodicTable
    show_names={window_width > 1000}
    heatmap={$heatmap}
    style="margin: 2em auto 4em;"
  >
    <TableInset slot="inset">
      {#if $heatmap}
        <ScatterPlot
          ylim={[0, null]}
          on_hover_point={(point) => ($active_element = point[2])}
          x_label_y={42}
        />
      {:else}
        <ElementStats --font-size="1vw" />
      {/if}
    </TableInset>
  </PeriodicTable>

  {#if !$heatmap}
    <ColorCustomizer collapsible={false} />
  {/if}
</div>

<EasterEgg bind:x_angle bind:y_angle bind:auto_rotate />

<style>
  h1 {
    text-align: center;
    line-height: 1.1;
    font-size: clamp(20pt, 5.5vw, 50pt);
    margin: 0 1em 2em;
  }
  div.auto-rotate-x {
    animation: spin-x 30s linear infinite;
  }
  div.auto-rotate-y {
    animation: spin-y 30s linear infinite;
  }
  div.auto-rotate-both {
    animation: spin-both 30s linear infinite;
  }
  @keyframes spin-x {
    100% {
      transform: rotateX(360deg);
    }
  }
  @keyframes spin-y {
    100% {
      transform: rotateY(360deg);
    }
  }
  @keyframes spin-both {
    100% {
      transform: rotateX(360deg) rotateY(360deg);
    }
  }
  a[href='/bohr-atoms'] {
    position: absolute;
    bottom: 94%;
    right: 10%;
  }
</style>
