<script lang="ts">
  import { format_num } from '#lib/labels.js'
  import { TooltipValue } from '#lib/tooltip/index.js'
  import type { ChartSegment } from './chart'
  import { format_amount } from './format'

  let { segment }: { segment: ChartSegment } = $props()

  // rounded like segment_title, so float noise stays out and the noun matches the shown number
  const shown_amount = $derived(format_amount(segment.amount))
</script>

<TooltipValue
  label={segment.element}
  value={shown_amount}
  unit={shown_amount === `1` ? `atom` : `atoms`}
/>
(<TooltipValue value={format_num(segment.fraction, `.1~%`)} />)
