<script lang="ts">
  import * as d3sc from 'd3-scale-chromatic'
  import Select from 'svelte-multiselect'

  export let value: string | null = null
  export let selected: string[] = []

  const options = Object.keys(d3sc)
    .filter((key) => key.startsWith(`interpolate`))
    .map((key) => key.replace(`interpolate`, ``))
</script>

<Select
  {options}
  maxSelect={1}
  bind:value
  bind:selected
  placeholder="Select a color scale"
/>
