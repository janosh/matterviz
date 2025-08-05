<script lang="ts">
  import { page } from '$app/state'
  import type { ChemicalElement } from '$lib'
  import {
    BohrAtom,
    ColorScaleSelect,
    element_data,
    ElementHeading,
    ElementPhoto,
    ElementScatter,
    ElementTile,
    PeriodicTable,
    PropertySelect,
  } from '$lib'
  import Icon from '$lib/Icon.svelte'
  import { format_num, property_labels } from '$lib/labels'
  import { selected } from '$lib/state.svelte'
  import pkg from '$root/package.json'
  import { error } from '@sveltejs/kit'
  import { PrevNext } from 'svelte-multiselect'

  let element = $derived.by(() => {
    const data = element_data.find((elem) =>
      elem.name.toLowerCase() === page.params.slug
    )
    if (!data) throw error(404, `Page '${page.params.slug}' not found`)
    return data
  })
  $effect(() => {
    selected.element = element
  })

  const icon_property_map = {
    'Atomic Mass': `Weight`,
    'Atomic Number': `Info`,
    'Atomic Radius': `Atom`,
    'Atomic Volume': `Solid`,
    'Boiling Point': `Gas`,
    'Covalent Radius': `Orbit`,
    'Electron Affinity': `Atom`,
    'Electron Valency': `Atom`,
    'First Ionization Energy': `ArrowUp`,
    'Ionization Energies': `ArrowUp`,
    'Melting Point': `Liquid`,
    'Number of Shells': `ElectronShells`,
    'Specific Heat': `ArrowUp`,
    Density: `Scale`,
    Electronegativity: `Atom`,
  } as const

  let key_vals = $derived(
    Object.keys(property_labels)
      .filter((key) => element[key as keyof ChemicalElement])
      .map((key) => {
        const [label, unit] = property_labels[key as keyof ChemicalElement] ?? []
        let value = element[key as keyof ChemicalElement]
        // if value is number, pretty format it
        if (typeof value === `number`) value = format_num(value)
        // array to string
        if (Array.isArray(value)) value = value.join(`, `)
        // if value has a unit, append it
        if (unit) value = `${value} &thinsp;${unit}`

        const icon = label && (label in icon_property_map)
          ? icon_property_map[label as keyof typeof icon_property_map]
          : `Info`
        return [label, value, icon] as const
      }),
  )

  // set atomic radius as default heatmap_key
  $effect.pre(() => {
    if (!selected.heatmap_key) selected.heatmap_key = `atomic_radius`
  })

  let head_title = $derived(`${element.name} • ${pkg.name}`)

  let orbiting = $state(true)
  let window_width: number = $state(0)
  let active_shell: number | null = $state(null)

  let scatter_plot_values = $derived(
    element_data
      .map((el) => (selected.heatmap_key ? el[selected.heatmap_key] : null))
      .filter((val): val is number => typeof val === `number`),
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

<ElementHeading {element} />

{#if (element?.discoverer && !element.discoverer.startsWith(`unknown`)) ||
    element?.year}
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
  <ElementPhoto {element} />

  <!-- onmouseleave makes ElementScatter always show current element unless user actively hovers another element -->
  <ElementScatter
    y={scatter_plot_values}
    {y_label}
    {y_unit}
    {color_scale}
    y_lim={[0, null]}
    onmouseleave={() => (selected.element = element)}
    style="min-height: min(50vmin, 400px)"
  />
</section>

<p class="summary">{@html element.summary}</p>

<section class="flex-wrap">
  <PeriodicTable
    tile_props={{ show_name: false, show_number: false }}
    show_photo={false}
    disabled
    style="width: 100%; max-width: 300px"
    links="name"
    active_element={element}
  />

  <table>
    <thead>
      <tr>
        <th><Icon icon="Circle" />&nbsp;Shell</th>
        <th><Icon icon="Atom" />&nbsp;Electrons</th>
        <th><Icon icon="Orbit" />&nbsp;Orbitals</th>
      </tr>
    </thead>

    <tbody>
      {#each element.shells as shell_occu, shell_idx (shell_occu + shell_idx)}
        {@const shell_orbitals = element.electron_configuration
          .split(` `)
          .filter((orbital) => orbital.startsWith(`${shell_idx + 1}`))
          .map((orbital) =>
            `${orbital.substring(2)} in ${orbital.substring(0, 2)}`
          )}
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
    adapt_size
    orbital_period={orbiting ? 3 : 0}
    highlight_shell={active_shell}
    onclick={() => (orbiting = !orbiting)}
    style="max-width: 300px"
  />
</section>

<section class="properties">
  {#each key_vals as [label, value, icon], idx ([label, value, icon])}
    <!-- skip last item if index is uneven to avoid single dangling item on last row -->
    {#if idx % 2 === 1 || idx < key_vals.length - 1}
      <div>
        <strong>
          <Icon {icon} />
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
    {@const element = item[1] as ChemicalElement}
    <a
      href={element.name.toLowerCase()}
      style="display: flex; flex-direction: column; position: relative"
    >
      <h3>
        {@html kind == `next` ? `Next &rarr;` : `&larr; Previous`}
      </h3>
      <ElementPhoto {element} style="width: 200px; border-radius: 4pt" />
      <ElementTile
        {element}
        style="width: 70px; position: absolute; bottom: 0"
        --elem-tile-hover-border="1px solid transparent"
      />
    </a>
  {/snippet}
</PrevNext>

<style>
  section.viz {
    margin: 2em auto;
    display: grid;
    gap: 1em;
    grid-template-columns: 1fr 2fr;
  }
  section.flex-wrap {
    margin: 3em auto;
    display: flex;
    flex-wrap: wrap;
    gap: 1em;
    place-items: center;
    place-content: center space-around;
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
