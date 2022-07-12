<script lang="ts">
  import { element_property_labels, heatmap_labels } from '../labels'
  import ElementPhoto from '../lib/ElementPhoto.svelte'
  import PropertySelect from '../lib/PropertySelect.svelte'
  import ScatterPlot from '../lib/ScatterPlot.svelte'
  import { active_element } from '../stores'
  import { ChemicalElement } from '../types'

  export let element: ChemicalElement

  $: $active_element = element

  $: key_vals = Object.entries(element_property_labels).map(([key, [label, unit]]) => {
    let value = element[key]
    if (typeof value === `number`) value = parseFloat(value.toFixed(2))
    if (Array.isArray(value)) value = value.join(`, `)
    if (unit) label = `${label} (${unit})`
    return [label, value]
  })

  // set atomic radius as initial heatmap
  const initial_heatmap = Object.keys(heatmap_labels)[1] as keyof ChemicalElement

  $: head_title = `${element.name} | Periodic Table`
</script>

<svelte:head>
  <title>{head_title}</title>
  <meta property="og:title" content={head_title} />
</svelte:head>

<h1>{element.name}</h1>
<h2>{element.category}</h2>

<PropertySelect selected={[initial_heatmap]} />

<section>
  <ElementPhoto style="border-radius: 4pt;" />

  <ScatterPlot />
</section>

{#if element.summary}
  <p class="description">{@html element.summary}</p>
{/if}

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
  section {
    margin: 2em 0;
    display: grid;
    gap: 2em;
    grid-template-columns: 1fr 2fr;
  }
  p.description {
    text-align: center;
    opacity: 0.9;
    margin: 3em auto;
    max-width: 50em;
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
