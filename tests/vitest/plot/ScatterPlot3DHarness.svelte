<script lang="ts">
  import ScatterPlot3D from '$lib/plot/ScatterPlot3D.svelte'
  import type { DataSeries3D } from '$lib/plot/types'

  const make_series = (offset: number, with_ids: boolean): DataSeries3D[] =>
    [0, 1].map((idx) => ({
      ...(with_ids && { id: `stable-${idx}` }),
      x: [idx + offset],
      y: [idx + offset],
      z: [idx + offset],
    }))

  interface Props {
    use_explicit_ids?: boolean
  }

  let { use_explicit_ids = false }: Props = $props()
  let series = $derived(make_series(0, use_explicit_ids))
</script>

<button
  type="button"
  data-testid="replace-series"
  onclick={() => (series = make_series(2, use_explicit_ids))}
>
  Replace series
</button>
<ScatterPlot3D {series} />
