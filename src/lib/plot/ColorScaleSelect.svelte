<script lang="ts">
  import { ColorBar } from '$lib'
  import * as d3sc from 'd3-scale-chromatic'
  import type { ComponentProps } from 'svelte'
  import Select from 'svelte-multiselect'

  export let value: string | null = null
  export let selected: string[] = [`Viridis`]
  export let minSelect: number = 0
  export let placeholder = `Select a color scale`
  export let cbar_props: ComponentProps<ColorBar> = {}

  const options = Object.keys(d3sc)
    .filter((key) => key.startsWith(`interpolate`))
    .map((key) => key.replace(`interpolate`, ``))
  const wrapper_style = `justify-content: space-between;`
</script>

<Select
  {options}
  maxSelect={1}
  {minSelect}
  bind:value
  bind:selected
  {placeholder}
  {...$$restProps}
  let:option
>
  <ColorBar label={option} color_scale={option} {...cbar_props} {wrapper_style} />
</Select>
