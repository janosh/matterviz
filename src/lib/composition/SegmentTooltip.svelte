<script lang="ts">
  import { format_num } from '$lib/labels'
  import { TooltipValue } from '$lib/tooltip'
  import type { ChartSegment } from './chart'

  let { segment }: { segment: ChartSegment } = $props()
</script>

<TooltipValue
  label={segment.element}
  value={segment.amount}
  unit={segment.amount === 1 ? 'atom' : 'atoms'}
/>
(<TooltipValue value={format_num(segment.fraction, '.1~%')} />)
