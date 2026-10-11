<script lang="ts">
  import { XrdPlot } from '#lib'
  import type { XrdPattern, XrdPeak } from '#lib/xrd/index.js'
  import type { ComponentProps } from 'svelte'

  let {
    pattern,
    ...rest
  }: { pattern: XrdPattern | ComponentProps<typeof XrdPlot>[`patterns`] } & Omit<
    ComponentProps<typeof XrdPlot>,
    `patterns`
  > = $props()
  let orientation = $state<`vertical` | `horizontal`>(`vertical`)
  // Reactive owners for the peak bindings, read back through the component's exports
  let hovered_peak = $state<XrdPeak | null>(null)
  let selected_peak = $state<XrdPeak | null>(null)
  export const get_peaks = () => ({ hovered_peak, selected_peak })
</script>

<button class="change-xrd-orientation" onclick={() => (orientation = `horizontal`)}>
  Horizontal XRD
</button>
<XrdPlot
  {...rest}
  {orientation}
  patterns={pattern}
  style="width: 800px; height: 600px;"
  bind:hovered_peak
  bind:selected_peak
/>
