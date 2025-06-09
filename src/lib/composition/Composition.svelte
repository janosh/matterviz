<script lang="ts">
  import type { CompositionType } from '$lib'
  import { element_color_schemes } from '$lib/colors'
  import type { Snippet } from 'svelte'
  import BarChart from './BarChart.svelte'
  import BubbleChart from './BubbleChart.svelte'
  import { parse_composition_input } from './parse'
  import PieChart from './PieChart.svelte'

  interface Props {
    input: string | CompositionType
    mode?: `pie` | `bubble` | `bar`
    size?: number
    width?: number
    height?: number
    inner_radius?: number
    show_labels?: boolean
    show_amounts?: boolean
    show_percentages?: boolean
    color_scheme?: keyof typeof element_color_schemes
    interactive?: boolean
    on_composition_change?: (composition: CompositionType) => void
    center_content?: Snippet<[{ composition: CompositionType; total_atoms: number }]>
    style?: string
    class?: string
    [key: string]: unknown
  }
  let {
    input,
    mode = `pie`,
    size = 100,
    width = 300,
    height = 60,
    inner_radius = 0,
    show_labels = true,
    show_amounts = true,
    show_percentages = false,
    color_scheme = `Vesta`,
    interactive = true,
    on_composition_change,
    center_content,
    style = ``,
    class: class_name = ``,
    ...rest
  }: Props = $props()

  let composition: CompositionType = $derived.by(() => {
    try {
      const parsed = parse_composition_input(input)
      return parsed
    } catch (error) {
      console.error(`Failed to parse composition:`, error)
      return {}
    }
  })

  // Call the composition change callback in an effect, not in the derived
  $effect(() => {
    on_composition_change?.(composition)
  })
</script>

<div class="composition-container {class_name}" {style} {...rest}>
  <div class="visualization">
    {#if mode === `pie`}
      <PieChart
        {composition}
        {size}
        {inner_radius}
        {show_labels}
        {show_amounts}
        {show_percentages}
        {color_scheme}
        {interactive}
        {center_content}
      />
    {:else if mode === `bubble`}
      <BubbleChart
        {composition}
        {size}
        {show_labels}
        {show_amounts}
        {color_scheme}
        {interactive}
      />
    {:else if mode === `bar`}
      <BarChart
        {composition}
        {width}
        {height}
        {show_labels}
        {show_amounts}
        {show_percentages}
        {color_scheme}
        {interactive}
      />
    {/if}
  </div>
</div>

<style>
  .composition-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .visualization {
    display: flex;
    justify-content: center;
  }
</style>
