<script lang="ts">
  import { Sunburst } from '$lib/plot'
  import type { PositionedArc, SunburstNode } from '$lib/plot'

  const data: SunburstNode[] = [
    { label: `A`, value: 10 },
    { label: `B`, value: 20 },
    { label: `C`, value: 30 },
  ]
  const colorbar_sides = [`left`, `right`] as const
  const padding = { t: 10, b: 10, l: 40, r: 24 }
</script>

<svelte:head>
  <title>Sunburst Vertical Colorbar Tests</title>
</svelte:head>

<h1>Sunburst Vertical Colorbar Tests</h1>

{#each colorbar_sides as colorbar_side}
  <section id="vertical-colorbar-{colorbar_side}">
    <h2>{colorbar_side}</h2>
    <Sunburst
      {data}
      color_values={(arc: PositionedArc) => arc.value}
      colorbar={{ orientation: `vertical`, tick_format: `.2e` }}
      {colorbar_side}
      {padding}
      style="width: 600px; height: 360px"
    />
  </section>
{/each}
