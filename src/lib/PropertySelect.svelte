<script lang="ts">
  import Select from 'svelte-multiselect'
  import { heatmap_labels } from './labels'
  import { heatmap } from './stores'
  import type { ChemicalElement } from './types'

  export let value: keyof ChemicalElement | null = null
  export let selected: keyof ChemicalElement[] = []

  $: $heatmap = heatmap_labels[value ?? ``] ?? null
</script>

<Select
  options={Object.keys(heatmap_labels)}
  {selected}
  maxSelect={1}
  bind:value
  placeholder="Select a heat map"
/>
