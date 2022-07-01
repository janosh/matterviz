<script lang="ts">
  import { onMount } from 'svelte'
  import Select from 'svelte-multiselect'
  import { element_property_labels, heatmap_labels } from '../labels'
  import ElementPhoto from '../lib/ElementPhoto.svelte'
  import ScatterPlot from '../lib/ScatterPlot.svelte'
  import { active_element, heatmap } from '../stores'
  import { Element } from '../types'

  export let element: Element

  $: $active_element = element

  $: key_vals = Object.entries(element_property_labels).map(([key, [label, unit]]) => {
    let value = element[key]
    if (typeof value === `number`) value = parseFloat(value.toFixed(2))
    if (Array.isArray(value)) value = value.join(`, `)
    if (unit) label = `${label} (${unit})`
    return [label, value]
  })
  let selected: string[] = []
  onMount(() => {
    // set atomic radius as initial scatter plot data (note order in JS objects not guaranteed)
    selected = [Object.keys(heatmap_labels)[1]]
    $heatmap = Object.values(heatmap_labels)[1]
  })
  $: $heatmap = heatmap_labels[selected[0]]
</script>

<h1>{element.name}</h1>
<h2>{element.category}</h2>

<Select
  options={Object.keys(heatmap_labels)}
  maxSelect={1}
  bind:selected
  placeholder="Select a heat map"
/>

<main>
  <ElementPhoto style="border-radius: 4pt;" />

  <ScatterPlot />
</main>

<div class="properties">
  {#each key_vals as [label, value]}
    {#if value}<div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    {/if}
  {/each}
</div>

<style>
  h1,
  h2 {
    text-align: center;
  }
  h2 {
    font-weight: lighter;
    opacity: 0.7;
  }
  main {
    margin: 2em 0;
    display: grid;
    gap: 2em;
    grid-template-columns: 1fr 2fr;
  }
  div.properties {
    display: grid;
    grid-gap: 3em;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    background-color: rgba(0, 30, 100, 0.4);
    margin: 3em 0;
    padding: 2em 1em;
    border-radius: 4pt;
  }
  div.properties div {
    text-align: center;
    display: grid;
    place-content: center;
  }
  div.properties strong {
    font-size: 14pt;
  }
  div.properties small {
    display: block;
    font-size: 12pt;
    font-weight: lighter;
    opacity: 0.8;
  }
</style>
