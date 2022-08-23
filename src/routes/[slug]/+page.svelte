<script lang="ts">
  import BohrAtom from '$lib/BohrAtom.svelte'
  import ElementPhoto from '$lib/ElementPhoto.svelte'
  import ElementStats from '$lib/ElementStats.svelte'
  import { element_property_labels, heatmap_labels, pretty_num } from '$lib/labels'
  import PropertySelect from '$lib/PropertySelect.svelte'
  import ScatterPlot from '$lib/ScatterPlot.svelte'
  import { active_element } from '$lib/stores'
  import type { ChemicalElement } from '$lib/types'
  import type { PageData } from './$types'

  export let data: PageData

  $: [$active_element, element] = [data.element, data.element]

  $: key_vals = Object.entries(element_property_labels).map(([key, [label, unit]]) => {
    let value = element[key as keyof ChemicalElement]
    if (typeof value === `number`) {
      value = pretty_num(value)
    }
    if (Array.isArray(value)) value = value.join(`, `)
    if (unit) {
      value = `${value} &thinsp;${unit}`
    }
    return [label, value]
  })

  // set atomic radius as initial heatmap
  const initial_heatmap = Object.keys(heatmap_labels)[1] as keyof ChemicalElement

  $: head_title = `${element.name} | Periodic Table`

  let orbiting = true
  let window_width: number
</script>

<svelte:window bind:innerWidth={window_width} />

<svelte:head>
  <title>{head_title}</title>
  <meta property="og:title" content={head_title} />
</svelte:head>

<PropertySelect selected={[initial_heatmap]} />

<section>
  <ElementPhoto />

  <!-- on:mouseleave makes ScatterPlot always show current element unless user actively hovers another element -->
  <ScatterPlot ylim={[0, null]} on:mouseleave={() => ($active_element = element)} />
</section>

<section>
  {#if window_width > 900}
    <ElementStats />
  {/if}

  <div on:click={() => (orbiting = !orbiting)}>
    <BohrAtom {...element} adapt_size={true} {orbiting} />
  </div>

  <p style="flex: 1">{@html element.summary}</p>
</section>

<div class="properties">
  {#each key_vals as [label, value]}
    {#if value}<div>
        <strong>{@html value}</strong>
        <small>{label}</small>
      </div>
    {/if}
  {/each}
</div>

<style>
  section:nth-child(even) {
    margin: 2em 0;
    display: grid;
    gap: 2em;
    grid-template-columns: 1fr 2fr;
  }
  section:nth-child(odd) {
    margin: 2em 0;
    display: flex;
    gap: 2em;
    place-items: center;
  }
  section p {
    text-align: center;

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
