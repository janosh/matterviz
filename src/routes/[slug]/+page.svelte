<script lang="ts">
  import BohrAtom from '$lib/BohrAtom.svelte'
  import ElementHeading from '$lib/ElementHeading.svelte'
  import ElementPhoto from '$lib/ElementPhoto.svelte'
  import Icon from '$lib/Icon.svelte'
  import { element_property_labels, heatmap_labels, pretty_num } from '$lib/labels'
  import PeriodicTable from '$lib/PeriodicTable.svelte'
  import PrevNextElement from '$lib/PrevNextElement.svelte'
  import PropertySelect from '$lib/PropertySelect.svelte'
  import ScatterPlot from '$lib/ScatterPlot.svelte'
  import { active_element } from '$lib/stores'
  import type { ChemicalElement } from '$lib/types'
  import type { PageData } from './$types'

  export let data: PageData

  $: [$active_element, element] = [data.element, data.element]

  $: key_vals = Object.keys(element_property_labels)
    .filter((key) => element[key])
    .map((key) => {
      const [label, unit] = element_property_labels[key]
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
  let active_shell: number | null = null

  const icon_property_map = {
    'Atomic Mass': `mdi:weight`,
    'Atomic Number': `mdi:periodic-table`,
    'Atomic Radius': `mdi:atom`,
    'Atomic Volume': `mdi:cube-outline`,
    'Boiling Point': `mdi:gas-cylinder`,
    'Covalent Radius': `mdi:atom`,
    'Electron Affinity': `mdi:electron-framework`,
    'Electron Valency': `mdi:atom-variant`,
    'First Ionization Energy': `simple-line-icons:energy`,
    'Ionization Energies': `mdi:flash`,
    'Melting Point': `mdi:water-outline`,
    'Number of Shells': `ic:baseline-wifi-tethering`,
    'Specific Heat': `mdi:fire`,
    Density: `ion:scale-outline`,
    Electronegativity: `mdi:electron-framework`,
  }
</script>

<svelte:window bind:innerWidth={window_width} />

<svelte:head>
  <title>{head_title}</title>
  <meta property="og:title" content={head_title} />
</svelte:head>

<ElementHeading {element} />

{#if element?.discoverer && element?.year}
  <p class="discovery">
    Discovered by <strong>{element.discoverer}</strong> in
    <strong>{element.year}</strong>
  </p>
{/if}

<PropertySelect selected={[initial_heatmap]} />

<section class="viz">
  <ElementPhoto
    element_name={$active_element?.name}
    missing_msg={window_width < 900 ? `` : `No image for`}
  />

  <!-- on:mouseleave makes ScatterPlot always show current element unless user actively hovers another element -->
  <ScatterPlot
    ylim={[0, null]}
    on:mouseleave={() => ($active_element = element)}
    style="min-height: min(50vmin, 400px);"
  />
</section>

<p class="summary">{@html element.summary}</p>

<section class="flex-wrap">
  <PeriodicTable
    show_names={false}
    show_numbers={false}
    show_symbols={false}
    show_photo={false}
    disabled={true}
    style="width: 100%;  max-width: 350px;"
  />

  <table>
    <thead>
      <th><Icon icon="ic:outline-circle" />Shell</th>
      <th><Icon icon="mdi:atom-variant" />Electrons</th>
      <th><Icon icon="mdi:rotate-orbit" />Orbitals</th>
    </thead>

    {#each element.shells as shell_occu, shell_idx}
      {@const shell_orbitals = element.electron_configuration
        .split(` `)
        .filter((orbital) => orbital.startsWith(`${shell_idx + 1}`))
        .map((orbital) => `${orbital.substring(2)} in ${orbital.substring(0, 2)}`)}
      <tr
        on:mouseenter={() => (active_shell = shell_idx + 1)}
        on:mouseleave={() => (active_shell = null)}
      >
        <td>{shell_idx + 1}</td>
        <td>{shell_occu}</td>
        <td>{shell_orbitals.join(` + `)}</td>
      </tr>
    {/each}
  </table>

  <BohrAtom
    symbol={element.symbol}
    shells={element.shells}
    name={element.name}
    adapt_size={true}
    electron_speed={Number(orbiting)}
    highlight_shell={active_shell}
    on:click={() => (orbiting = !orbiting)}
    style="max-width: 300px;"
  />
</section>

<section class="properties">
  {#each key_vals as [label, value], idx}
    <!-- skip last item if index is uneven to avoid single dangling item on last row -->
    {#if idx % 2 === 1 || idx < key_vals.length - 1}
      <div>
        <strong>
          <Icon icon={icon_property_map[label]} />
          {@html value}
        </strong>
        <small>{label}</small>
      </div>
    {/if}
  {/each}
</section>

<PrevNextElement prev={data.prev_elem} next={data.next_elem} />

<style>
  section.viz {
    margin: 2em auto;
    display: grid;
    gap: 2em;
    place-items: center;
  }
  @media (min-width: 700px) {
    section.viz {
      grid-template-columns: 1fr 2fr;
    }
  }
  section.flex-wrap {
    margin: 3em auto;
    display: flex;
    flex-wrap: wrap;
    gap: 2em;
    place-items: center;
    place-content: center space-around;
  }
  p {
    text-align: center;
    max-width: 40em;
    margin: 3em auto;
    font-weight: 200;
  }
  section.properties {
    display: grid;
    grid-gap: 3em;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    background-color: rgba(0, 30, 100, 0.4);
    margin: 3em 0;
    padding: 2em 1em;
    border-radius: 4pt;
  }
  section.properties div {
    text-align: center;
    display: grid;
    place-content: center;
  }
  section.properties strong {
    font-size: 14pt;
  }
  section.properties small {
    display: block;
    font-size: 12pt;
    font-weight: lighter;
    opacity: 0.8;
    margin-top: 1ex;
  }
  table {
    border-collapse: collapse;
    text-align: center;
    font-size: clamp(9pt, 1.5vw, 12pt);
  }
  table thead th,
  table td {
    padding: 4pt 1ex;
  }
  table tr:nth-child(even) {
    background-color: rgba(255, 255, 255, 0.1);
  }
  table tr:hover {
    background-color: rgba(150, 150, 255, 0.2);
  }
</style>
