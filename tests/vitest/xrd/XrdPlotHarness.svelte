<script lang="ts">
  import { XrdPlot } from '#lib'
  import type { XrdPeak } from '#lib/xrd/index.js'
  import type { ComponentProps } from 'svelte'

  let { patterns: initial_patterns, ...props }: ComponentProps<typeof XrdPlot> = $props()
  // Writable, so a test can swap the patterns under the peak bindings
  let patterns = $derived(initial_patterns)
  export const set_patterns = (next: typeof patterns) => (patterns = next)
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
  {patterns}
  {orientation}
  style="width: 800px; height: 600px;"
  bind:hovered_peak
  bind:selected_peak
/>
