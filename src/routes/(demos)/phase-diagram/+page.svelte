<script lang="ts">
  import type { ElementSymbol } from '$lib'
  import { decompress_data } from '$lib/io/decompress'
  import { PhaseDiagram2D, PhaseDiagram3D, PhaseDiagram4D } from '$lib/phase-diagram'
  import type { PymatgenEntry } from '$lib/phase-diagram/types'
  import { onMount } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'

  const quaternary_files = (import.meta as unknown as {
    glob: (
      pattern: string,
      options: { eager: false; query: string },
    ) => Record<string, () => Promise<{ default: string }>>
  }).glob(
    `$site/phase-diagrams/quaternaries/*.json.gz`,
    { eager: false, query: `?url` },
  )

  let entries_map = $state(new SvelteMap())
  let loaded_data = $state(new SvelteMap())

  onMount(async () => {
    const results = await Promise.allSettled(
      Object.entries(quaternary_files).map(async ([path, loader]) => {
        const response = await fetch((await loader()).default)
        const enc = response.headers.get(`content-encoding`)?.toLowerCase() ?? ``
        const data = enc.includes(`gzip`)
          ? await response.json()
          : JSON.parse(await decompress_data(await response.arrayBuffer(), `gzip`))
        return [path, data] as const
      }),
    )
    loaded_data = new SvelteMap(
      results.filter((res) => res.status === `fulfilled`).map((res) => res.value),
    )
  })

  const handle_file_drop = (path: string) => (entries: PymatgenEntry[]) => {
    entries_map.set(path, entries)
    entries_map = new SvelteMap(entries_map)
  }

  // Function to create ternary subset from quaternary data
  function create_ternary_subset(
    entries: PymatgenEntry[],
    ternary_elements: string[],
  ): PymatgenEntry[] {
    const element_set = new Set(ternary_elements)

    return entries.filter((entry) => {
      const elements = Object.keys(entry.composition) as ElementSymbol[]
      const present_elements = elements.filter((el) => entry.composition[el] > 0)

      // Include entries that contain only our target elements
      return present_elements.every((el) => element_set.has(el))
    })
  }

  // Function to create binary subset from quaternary data
  function create_binary_subset(
    entries: PymatgenEntry[],
    binary_elements: [string, string],
  ): PymatgenEntry[] {
    const element_set = new Set(binary_elements)
    return entries.filter((entry) => {
      const elements = Object.keys(entry.composition) as ElementSymbol[]
      const present_elements = elements.filter((el) => entry.composition[el] > 0)
      // Include entries that contain only our target elements (unaries allowed)
      return present_elements.every((el) => element_set.has(el))
    })
  }

  // Create some ternary examples from quaternary data
  const na_fe_o_entries = $derived(create_ternary_subset(
    loaded_data.get(
      `/src/site/phase-diagrams/quaternaries/Na-Fe-P-O.json.gz`,
    ) as PymatgenEntry[] | undefined ?? [],
    [`Na`, `Fe`, `O`],
  ))

  const li_co_ni_o_data = $derived(create_ternary_subset(
    loaded_data.get(
      `/src/site/phase-diagrams/quaternaries/Li-Co-Ni-O.json.gz`,
    ) as PymatgenEntry[] | undefined ?? [],
    [`Li`, `Co`, `O`],
  ))

  // Create four binary examples from the two quaternary datasets
  const binary_examples = $derived.by(() => {
    const li_fe_p_o = loaded_data.get(
      `/src/site/phase-diagrams/quaternaries/Na-Fe-P-O.json.gz`,
    ) as PymatgenEntry[] | undefined
    const li_co_ni_o = loaded_data.get(
      `/src/site/phase-diagrams/quaternaries/Li-Co-Ni-O.json.gz`,
    ) as PymatgenEntry[] | undefined
    if (!li_fe_p_o || !li_co_ni_o) return []

    return [
      { title: `Na-O`, entries: create_binary_subset(li_fe_p_o, [`Na`, `O`]) },
      { title: `Fe-O`, entries: create_binary_subset(li_fe_p_o, [`Fe`, `O`]) },
      { title: `Co-O`, entries: create_binary_subset(li_co_ni_o, [`Co`, `O`]) },
      { title: `Ni-O`, entries: create_binary_subset(li_co_ni_o, [`Ni`, `O`]) },
    ]
  })
</script>

<svelte:head>
  <title>MatterViz Phase Diagram Demo</title>
  <meta
    name="description"
    content="Interactive phase diagram visualizations: quaternary, ternary, and binary systems"
  />
</svelte:head>

<main class="demo-container full-bleed">
  <h1>Phase Diagrams</h1>

  {#if loaded_data.size > 0}
    <h2>Ternary Chemical Systems</h2>
    <p class="section-description">
      3D ternary phase diagrams show composition on an equilateral triangle base with
      formation energy as the z-axis. Convex hull faces are rendered between stable
      points.
    </p>
    <div class="ternary-grid">
      {#each [
        { title: `Na-Fe-O`, entries: na_fe_o_entries },
        { title: `Li-Co-O`, entries: li_co_ni_o_data },
      ] as
        { title, entries }
        (title)
      }
        <PhaseDiagram3D {entries} controls={{ title }} />
      {/each}
    </div>

    <h2>Quaternary Chemical Systems</h2>
    <p class="section-description">
      4D quaternary phase diagrams project tetrahedral composition coordinates into 3D
      space. Each point represents a compound with its stability indicated by color.
    </p>
    <div class="quaternary-grid">
      {#each [...loaded_data.entries()] as [path, data] (path)}
        {@const title = (path as string).split(`/`).pop()?.split(`.`).shift()?.replace(
        `.json`,
        ``,
      )}
        <PhaseDiagram4D
          entries={(entries_map.get(path as string) as PymatgenEntry[] | undefined) ||
          (data as PymatgenEntry[])}
          controls={{ title }}
          on_file_drop={handle_file_drop(path as string)}
        />
      {/each}
    </div>

    <h2>Binary Chemical Systems</h2>
    <p class="section-description">
      2D binary phase diagrams show formation energy versus composition. Stable phases lie
      on the convex hull.
    </p>
    <div class="binary-grid">
      {#each binary_examples as { title, entries } (title)}
        <PhaseDiagram2D {entries} controls={{ title }} />
      {/each}
    </div>
  {:else}
    <div class="loading-state">
      <p>Loading phase diagrams...</p>
    </div>
  {/if}
</main>

<style>
  .section-description {
    color: var(--text-color-muted);
    margin-bottom: 1.5rem;
    font-size: 0.95em;
    line-height: 1.5;
    text-align: center;
  }
  .ternary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
    gap: 1rem;
    width: 100%;
    margin: 0 auto 3rem auto;
  }
  .quaternary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
    gap: 1rem;
    width: 100%;
    margin: 0 auto;
  }
  .binary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
    gap: 1rem;
    width: 100%;
    margin: 2rem auto 0 auto;
  }
  .loading-state {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 200px;
    color: var(--text-color-muted);
  }
  @media (max-width: 1000px) {
    .ternary-grid,
    .quaternary-grid,
    .binary-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
