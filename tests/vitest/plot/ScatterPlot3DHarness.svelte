<script lang="ts">
  import ScatterPlot3D from '$lib/plot/scatter-3d/ScatterPlot3D.svelte'
  import type { DataSeries3D } from '$lib/plot/core/types'

  type IdMode = `none` | `unique` | `duplicate` | `duplicate_collision`

  const make_series = (offset: number, id_mode: IdMode): DataSeries3D[] =>
    Array.from({ length: id_mode === `duplicate_collision` ? 3 : 2 }, (_, idx) => ({
      ...(id_mode === `unique` && { id: `stable-${idx}` }),
      ...(id_mode === `duplicate` && { id: `duplicate` }),
      ...(id_mode === `duplicate_collision` && {
        id: idx < 2 ? `duplicate` : `id:0:duplicate`,
      }),
      x: [idx + offset],
      y: [idx + offset],
      z: [idx + offset],
    }))

  interface Props {
    id_mode?: IdMode
  }

  let { id_mode = `none` }: Props = $props()
  let series = $derived(make_series(0, id_mode))
</script>

<button
  type="button"
  data-testid="replace-series"
  onclick={() => (series = make_series(2, id_mode))}
>
  Replace series
</button>
<ScatterPlot3D {series} />
