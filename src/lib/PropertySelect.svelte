<script lang="ts">
  import type { ChemicalElement } from '$lib'
  import { heatmap_labels } from '$lib/labels'
  import { heatmap_key } from '$lib/stores'
  import Select from 'svelte-multiselect'

  export let value: keyof ChemicalElement | null = null
  const options = Object.keys(heatmap_labels)
  export let empty: boolean = false
  export let selected: string[] = empty ? [] : [options[0]]
  export let minSelect: number = 0

  $: $heatmap_key = heatmap_labels[value ?? ``] ?? null
</script>

<Select
  {options}
  {selected}
  maxSelect={1}
  {minSelect}
  bind:value
  placeholder="Select a heat map"
/>
