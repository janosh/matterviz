<script lang="ts">
  import Select from 'svelte-multiselect'
  import { heatmap_labels } from './labels'
  import { heatmap } from './stores'
  import type { ChemicalElement } from './types'
  export let selected: (keyof ChemicalElement)[] = []

  $: $heatmap = heatmap_labels[selected[0]] ?? null
</script>

<Select
  options={Object.keys(heatmap_labels)}
  maxSelect={1}
  bind:selected
  placeholder="Select a heat map"
/>
