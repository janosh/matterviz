<script lang="ts">
  import { Sunburst } from '$lib/plot'
  import type { PositionedArc, SunburstNode } from '$lib/plot'

  const data: SunburstNode[] = [
    { label: `A`, value: 10 },
    { label: `B`, value: 20 },
    { label: `C`, value: 30 },
  ]
  const color_bar_sides = [`left`, `right`] as const
  const padding = { t: 10, b: 10, l: 40, r: 24 }
</script>

<svelte:head>
  <title>Sunburst Vertical Colorbar Tests</title>
</svelte:head>

<h1>Sunburst Vertical Colorbar Tests</h1>

{#each color_bar_sides as color_bar_side}
  <section id="vertical-colorbar-{color_bar_side}">
    <h2>{color_bar_side}</h2>
    <Sunburst
      {data}
      color_values={(arc: PositionedArc) => arc.value}
      color_bar={{ orientation: `vertical`, tick_format: `.2e` }}
      {color_bar_side}
      {padding}
      style="width: 600px; height: 360px"
    />
  </section>
{/each}
