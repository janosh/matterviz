<script lang="ts">
  import { XrdPlot } from '$lib'
  import type { XrdPattern } from '$lib/xrd'

  let { pattern }: { pattern: XrdPattern } = $props()
  let orientation = $state<`vertical` | `horizontal`>(`vertical`)
</script>

<button class="change-xrd-orientation" onclick={() => (orientation = `horizontal`)}>
  Horizontal XRD
</button>
<XrdPlot {orientation} patterns={pattern} style="width: 800px; height: 600px;" />
