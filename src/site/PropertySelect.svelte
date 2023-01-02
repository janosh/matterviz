<script lang="ts">
  import type { ChemicalElement } from '$lib'
  import Select from 'svelte-multiselect'
  import { heatmap_labels } from '../lib/labels'
  import { heatmap_key } from '../lib/stores'

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
