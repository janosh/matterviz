<script lang="ts">
  import { page } from '$app/state'
  import type { ChemicalElement } from '$lib'
  import {
    BohrAtom,
    ColorScaleSelect,
    ElementHeading,
    ElementPhoto,
    ElementScatter,
    ElementTile,
    Icon,
    PeriodicTable,
    PropertySelect,
    element_data,
  } from '$lib'
  import { pretty_num, property_labels } from '$lib/labels'
  import { selected } from '$lib/state.svelte'
  import { PrevNext } from 'svelte-zoo'

  let { data } = $props()
  let { element } = $derived(data)
  $effect(() => {
    selected.element = element
  })

  let key_vals = $derived(
    Object.keys(property_labels)
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
      }),
  )

  // set atomic radius as default heatmap_key
  $effect.pre(() => {
    if (!selected.heatmap_key) selected.heatmap_key = `atomic_radius`
  })

  let head_title = $derived(`${element.name} &bull; Periodic Table`)

  let orbiting = $state(true)
  let window_width: number = $state(0)
  let active_shell: number | null = $state(null)

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

  let scatter_plot_values = $derived(
    element_data.map((el) => (selected.heatmap_key ? el[selected.heatmap_key] : null)),
  )
  let [y_label, y_unit] = $derived(
    selected.heatmap_key ? (property_labels[selected.heatmap_key] ?? []) : [],
  )
  let color_scale: string = $state(`Viridis`)

  export const snapshot = {
    capture: () => ({ color_scale }),
    restore: (values) => ({ color_scale } = values),
  }
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

  <form>
    <PropertySelect minSelect={1} />
    <ColorScaleSelect bind:value={color_scale} selected={[color_scale]} minSelect={1} />
  </form>
  <section class="viz">
    <ElementPhoto {element} missing_msg={window_width < 900 ? `` : `No image for`} />

    <!-- onmouseleave makes ElementScatter always show current element unless user actively hovers another element -->
    <ElementScatter
      y={scatter_plot_values}
      {y_label}
      {y_unit}
      {color_scale}
      y_lim={[0, null]}
      onmouseleave={() => (selected.element = element)}
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
      active_element={element}
    />

    <table>
      <thead>
        <tr>
          <th><Icon icon="ic:outline-circle" />Shell</th>
          <th><Icon icon="mdi:atom-variant" />Electrons</th>
          <th><Icon icon="mdi:rotate-orbit" />Orbitals</th>
        </tr>
      </thead>

      <tbody>
        {#each element.shells as shell_occu, shell_idx (shell_occu + shell_idx)}
          {@const shell_orbitals = element.electron_configuration
            .split(` `)
            .filter((orbital) => orbital.startsWith(`${shell_idx + 1}`))
            .map((orbital) => `${orbital.substring(2)} in ${orbital.substring(0, 2)}`)}
          <tr
            onmouseenter={() => (active_shell = shell_idx + 1)}
            onmouseleave={() => (active_shell = null)}
          >
            <td>{shell_idx + 1}</td>
            <td>{shell_occu}</td>
            <td>{shell_orbitals.join(` + `)}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <BohrAtom
      symbol={element.symbol}
      shells={element.shells}
      name={element.name}
      adapt_size={true}
      orbital_period={orbiting ? 3 : 0}
      highlight_shell={active_shell}
      onclick={() => (orbiting = !orbiting)}
      style="max-width: 300px;"
    />
  </section>

  <section class="properties">
    {#each key_vals as [label, value], idx (label + value)}
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

  <PrevNext
    items={element_data.map((elem) => [elem.name.toLowerCase(), elem])}
    current={page.url.pathname.slice(1)}
  >
    {#snippet children({ item, kind })}
      <a href={item.name.toLowerCase()} style="display: flex; flex-direction: column;">
        <h3>
          {@html kind == `next` ? `Next &rarr;` : `&larr; Previous`}
        </h3>
        <ElementPhoto element={item} style="width: 200px; border-radius: 4pt;" />
        <ElementTile
          element={item}
          style="width: 70px; position: absolute; bottom: 0;"
          --elem-tile-hover-border="1px solid transparent"
        />
      </a>
    {/snippet}
  </PrevNext>
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
  form {
    display: flex;
    place-content: center;
    gap: 1em;
  }
</style>
