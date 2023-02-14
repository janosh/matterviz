<script lang="ts">
  import * as d3sc from 'd3-scale-chromatic'
  import Select from 'svelte-multiselect'
  import { ColorBar } from '.'

  export let value: string | null = null
  export let selected: string[] = [`Viridis`]
  export let minSelect: number = 0
  export let placeholder = `Select a color scale`

  const options = Object.keys(d3sc)
    .filter((key) => key.startsWith(`interpolate`))
    .map((key) => key.replace(`interpolate`, ``))
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
  <ColorBar slot="option" let:option text={option} />
  <ColorBar slot="selected" let:option text={option} />
</Select>
