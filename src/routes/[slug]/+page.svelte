<script lang="ts">
  import type { ChemicalElement } from '$lib'
  import {
    BohrAtom,
    ElementHeading,
    ElementPhoto,
    ElementScatter,
    element_data,
    Icon,
    PeriodicTable,
    PropertySelect,
  } from '$lib'
  import { pretty_num, property_labels } from '$lib/labels'
  import { active_element, heatmap_key } from '$lib/stores'
  import { PrevNextElement } from '$site'
  import { extent } from 'd3-array'
  import { scaleLinear } from 'd3-scale'
  import type { PageData } from './$types'

  export let data: PageData

  $: [$active_element, element] = [data.element, data.element]

  $: key_vals = Object.keys(property_labels)
    .filter((key) => element[key])
    .map((key) => {
      const [label, unit] = property_labels[key]
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

  // set atomic radius as default heatmap_key
  $: if (!$heatmap_key) $heatmap_key = `atomic_radius`

  $: head_title = `${element.name} &bull; Periodic Table`

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

  $: scatter_plot_values = element_data.map((el) => el[$heatmap_key])
  $: color_scale = scaleLinear()
    .domain(extent(scatter_plot_values))
    .range([`blue`, `red`])

  $: [y_label, y_unit] = property_labels[$heatmap_key] ?? []
</script>

<svelte:window bind:innerWidth={window_width} />

<svelte:head>
  <title>{head_title}</title>
  <meta property="og:title" content={head_title} />
</svelte:head>

<main>
  <ElementHeading {element} />

  {#if (element?.discoverer && !element.discoverer.startsWith(`unknown`)) || element?.year}
    <p class="discovery">
      Discovered
      {#if element?.discoverer && !element.discoverer.startsWith(`unknown`)}
        by <strong>{element.discoverer}</strong>
      {/if}
      {#if typeof element?.year}
        in <strong>{element.year}</strong>
      {/if}
    </p>
  {/if}

  <PropertySelect />

  <section class="viz">
    <ElementPhoto
      element={$active_element}
      missing_msg={window_width < 900 ? `` : `No image for`}
    />

    <!-- on:mouseleave makes ElementScatter always show current element unless user actively hovers another element -->
    <ElementScatter
      y={scatter_plot_values}
      {y_label}
      {y_unit}
      {color_scale}
      y_lim={[0, null]}
      on:mouseleave={() => ($active_element = element)}
      style="min-height: min(50vmin, 400px);"
    />
  </section>

  <p class="summary">{@html element.summary}</p>

  <section class="flex-wrap">
    <PeriodicTable
      tile_props={{ show_name: false, show_number: false }}
      show_photo={false}
      disabled={true}
      style="width: 100%;  max-width: 350px;"
      links="name"
      active_element={$active_element}
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
      orbital_period={orbiting ? 3 : 0}
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
</main>

<style>
  main {
    margin: auto;
    max-width: 75em;
  }
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
