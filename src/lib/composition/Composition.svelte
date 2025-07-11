<script lang="ts">
  import type { CompositionType } from '$lib'
  import { BarChart, BubbleChart, PieChart } from './index'
  import { parse_composition } from './parse'

  interface Props {
    composition: string | CompositionType
    mode?: `pie` | `bubble` | `bar`
    on_composition_change?: (composition: CompositionType) => void
    [key: string]: unknown
  }
  let { composition, mode = `pie`, on_composition_change, ...rest }: Props = $props()

  let Component = $derived(
    { pie: PieChart, bubble: BubbleChart, bar: BarChart }[mode],
  )
  let parsed: CompositionType = $derived.by(() => {
    try {
      return parse_composition(composition)
    } catch (error) {
      console.error(`Failed to parse composition:`, error)
      return {}
    }
  })
  // Call the composition change callback in an effect, not in the derived
  $effect(() => on_composition_change?.(parsed))
</script>

<Component composition={parsed} {...rest} class="composition {rest.class ?? ``}" />
