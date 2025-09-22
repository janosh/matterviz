<script lang="ts">
  import { decompress_data } from '$lib/io/decompress'
  import { PhaseDiagram4D, type PymatgenEntry } from '$lib/phase-diagram'
  import { onMount } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'

  const quaternary_files = import.meta.glob(
    `../../../../static/phase-diagrams/quaternaries/*.json.gz`,
    { eager: false, query: `?url` },
  ) as Record<string, () => Promise<{ default: string }>>

  let entries_map = new SvelteMap()
  let loaded_data = new SvelteMap()

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
    <h2>Quaternary Phase Diagrams</h2>
    <div class="quaternary-grid">
      {#each [...loaded_data.entries()] as [path, data] (path)}
        {@const title = path.split(`/`).pop()?.split(`.`).shift()?.replace(`.json`, ``)}
        <PhaseDiagram4D
          entries={entries_map.get(path) || data}
          legend={{ title }}
          on_file_drop={handle_file_drop(path)}
        />
      {/each}
    </div>
  {:else}
    <div class="loading-state">
      <p>Loading phase diagrams...</p>
    </div>
  {/if}
</main>

<style>
  .quaternary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    width: 100%;
    margin: 0 auto;
  }
  .loading-state {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 200px;
    color: var(--text-color-muted);
  }
  @media (max-width: 1000px) {
    .quaternary-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
