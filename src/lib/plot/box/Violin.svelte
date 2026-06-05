<script lang="ts">
  // Thin wrapper around BoxPlot with violin defaults. A violin is the same chart as a box
  // plot (per-series raw distribution on a categorical axis), so all the scaffolding is shared.
  import type { ComponentProps } from 'svelte'
  import BoxPlot from '$lib/plot/box/BoxPlot.svelte'

  let {
    series = $bindable([]),
    kind = $bindable(`violin`),
    ...rest
  }: ComponentProps<typeof BoxPlot> = $props()
</script>

<BoxPlot bind:series bind:kind {...rest} />
