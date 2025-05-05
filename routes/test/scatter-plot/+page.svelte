<script lang="ts">
  import { ScatterPlot } from '$lib'
  import type { DataSeries, Point } from '$lib/plot'
  import { pretty_print } from '$lib/utils'
  import Example from './Example.svelte'

  const plot_data = {
    x: Array(10)
      .fill(0)
      .map((_, idx) => idx),
    y: [10, 15, 12, 18, 25, 22, 28, 20, 30, 24],
    metadata: { label: `Basic Example` },
  }

  let last_basic_change_data: (Point & { series: DataSeries }) | null = $state(null)

  function handle_basic_change(data: (Point & { series: DataSeries }) | null): void {
    last_basic_change_data = data
  }
</script>

<Example title="Basic Example" id="basic-example">
  <ScatterPlot
    data={plot_data}
    change={handle_basic_change}
    hover_config={{ threshold_px: 100 }}
  />
  <pre id="basic-change-output">
    {pretty_print(last_basic_change_data)}
  </pre>
</Example>

<Example title="Marker Types" id="marker-types">// ... existing code ...</Example>
