<script lang="ts">
  import Select from 'svelte-multiselect'
  import { heatmap_labels } from '../lib/labels'
  import { heatmap_key } from '../lib/stores'
  import type { ChemicalElement } from '../lib/types'

  export let value: keyof ChemicalElement | null = null
  export let selected: string[] = []

  $: $heatmap_key = heatmap_labels[value ?? ``] ?? null
</script>

<Select
  options={Object.keys(heatmap_labels)}
  {selected}
  maxSelect={1}
  bind:value
  placeholder="Select a heat map"
/>
