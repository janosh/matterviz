<script lang="ts">
  import { XrdPlot } from '#lib'
  import type { XrdPeak } from '#lib/xrd/index.js'
  import type { ComponentProps } from 'svelte'

  let props: ComponentProps<typeof XrdPlot> = $props()
  let orientation = $state<`vertical` | `horizontal`>(`vertical`)
  // Reactive owners for the peak bindings, read back through the export
  let hovered_peak = $state<XrdPeak | null>(null)
  let selected_peak = $state<XrdPeak | null>(null)
  export const get_peaks = () => ({ hovered_peak, selected_peak })
</script>

<button class="change-xrd-orientation" onclick={() => (orientation = `horizontal`)}>
  Horizontal XRD
</button>
<XrdPlot
  {...props}
  {orientation}
  style="width: 800px; height: 600px;"
  bind:hovered_peak
  bind:selected_peak
/>
