<script lang="ts">
  import { Sunburst } from '#lib/plot/index.js'
  import type { PositionedArc, SunburstNode } from '#lib/plot/index.js'
  import TestSection from '../TestSection.svelte'

  const data: SunburstNode[] = [
    { label: `A`, value: 10 },
    { label: `B`, value: 20 },
    { label: `C`, value: 30 },
  ]
  const color_bar_sides = [`left`, `right`] as const
  const padding = { t: 10, b: 10, l: 40, r: 24 }
</script>

<h1>Sunburst colorbar test page</h1>

{#each color_bar_sides as color_bar_side (color_bar_side)}
  <TestSection
    title="Vertical colorbar ({color_bar_side})"
    id="vertical-colorbar-{color_bar_side}"
  >
    <Sunburst
      {data}
      color_values={(arc: PositionedArc) => arc.value}
      color_bar={{ orientation: `vertical`, tick_format: `.2e` }}
      {color_bar_side}
      {padding}
      style="width: 600px; height: 360px"
    />
  </TestSection>
{/each}
