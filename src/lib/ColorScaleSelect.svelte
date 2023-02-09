<script lang="ts">
  import * as d3sc from 'd3-scale-chromatic'
  import Select from 'svelte-multiselect'

  export let value: string | null = null
  export let selected: string[] = [`Viridis`]
  export let minSelect: number = 0

  const options = Object.keys(d3sc)
    .filter((key) => key.startsWith(`interpolate`))
    .map((key) => key.replace(`interpolate`, ``))

  const ramp_color_scale = (name: string) =>
    [...Array(10).keys()].map((idx) => d3sc[`interpolate${name}`](idx / 10))
</script>

<Select
  {options}
  maxSelect={1}
  {minSelect}
  bind:value
  bind:selected
  placeholder="Select a color scale"
>
  <div slot="option" let:option>
    {option}
    <span style:background="linear-gradient(to right, {ramp_color_scale(option)})" />
  </div>
  <div slot="selected" let:option>
    {option}
    <span style:background="linear-gradient(to right, {ramp_color_scale(option)})" />
  </div>
</Select>

<style>
  div {
    display: flex;
    justify-content: space-between;
    gap: 5pt;
  }
  span {
    border-radius: 2pt;
    min-height: 1em;
    min-width: 8em;
  }
</style>
