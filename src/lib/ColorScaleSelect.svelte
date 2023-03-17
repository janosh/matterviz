<script lang="ts">
  import * as d3sc from 'd3-scale-chromatic'
  import Select from 'svelte-multiselect'
  import { ColorBar } from '.'

  export let value: string | null = null
  export let selected: string[] = [`Viridis`]
  export let minSelect: number = 0
  export let placeholder = `Select a color scale`
  export let cbar_props: Record<string, unknown> = {}

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
  {...$$props}
>
  <ColorBar slot="option" let:option text={option} {...cbar_props} {wrapper_style} />
  <ColorBar slot="selected" let:option text={option} {...cbar_props} {wrapper_style} />
</Select>
