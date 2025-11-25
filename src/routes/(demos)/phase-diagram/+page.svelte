<script lang="ts">
  import type { ElementSymbol } from '$lib'
  import { decompress_data } from '$lib/io/decompress'
  import type {
    MarkerSymbol,
    PhaseDiagramEntry,
    PhaseStats,
    PymatgenEntry,
  } from '$lib/phase-diagram'
  import {
    PhaseDiagram2D,
    PhaseDiagram3D,
    PhaseDiagram4D,
    PhaseDiagramStats,
  } from '$lib/phase-diagram'
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

  // State for the 3D example with stats display
  let phase_stats = $state<PhaseStats | null>(null)
  let stable_entries = $state<PhaseDiagramEntry[]>([])
  let unstable_entries = $state<PhaseDiagramEntry[]>([])
  let max_hull_dist_show_phases = $state(0.5)

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
      const present_elements = elements.filter((el) =>
        (entry.composition?.[el] ?? 0) > 0
      )

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
      const present_elements = elements.filter((el) =>
        (entry.composition?.[el] ?? 0) > 0
      )
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

  // Full quaternary data for Li-Co-Ni-O
  const li_co_ni_o_quaternary = $derived(
    loaded_data.get(
      `/src/site/phase-diagrams/quaternaries/Li-Co-Ni-O.json.gz`,
    ) as PymatgenEntry[] | undefined ?? [],
  )

  // Helper to pick entries for highlighting demos
  const pick_entries = (
    entries: PymatgenEntry[],
    filter: (e: PymatgenEntry) => boolean,
    count = 5,
  ) =>
    entries.filter((e) => e.entry_id && filter(e)).slice(0, count).map((e) =>
      e.entry_id!
    )

  // Highlight demo: visible unstable entries (ternary) and stable entries (quaternary)
  const highlighted_na_fe_o = $derived(
    pick_entries(
      na_fe_o_entries,
      (e) => (e.e_above_hull ?? 0) > 0.05 && (e.e_above_hull ?? 1) < 0.5,
    ),
  )
  const highlighted_li_co_ni_o = $derived(
    pick_entries(
      li_co_ni_o_quaternary,
      (e) => e.is_stable || (e.e_above_hull ?? 1) < 0.01,
    ),
  )

  // Helper to assign marker based on entry properties
  const get_marker = (
    entry: PymatgenEntry,
    selected_id?: string,
    stable_marker: MarkerSymbol = `diamond`,
  ): MarkerSymbol => {
    if (entry.entry_id === selected_id) return `star`
    if (entry.is_stable || (entry.e_above_hull ?? 1) < 0.01) return stable_marker
    if ((entry.e_above_hull ?? 0) > 0.3) return `triangle`
    if ((entry.e_above_hull ?? 0) > 0.1) return `cross`
    return `circle`
  }

  // Marker symbol demo state
  let selected_marker_entry = $state<PhaseDiagramEntry | null>(null)
  const marker_demo_entries = $derived(
    na_fe_o_entries.map((e) => ({
      ...e,
      marker: get_marker(e, selected_marker_entry?.entry_id),
    })),
  )

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

  // Binary marker demo
  let selected_binary_entry = $state<PhaseDiagramEntry | null>(null)
  const binary_marker_entries = $derived(
    (binary_examples[0]?.entries ?? []).map((e) => ({
      ...e,
      marker: get_marker(e, selected_binary_entry?.entry_id, `square`),
    })),
  )
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

    <h2>3D Phase Diagram with Statistics</h2>
    <p class="section-description">
      Example of a 3D ternary phase diagram displayed alongside its computed statistics.
      The stats are bound to the diagram and update automatically when the data changes.
    </p>
    <div class="stats-example-grid">
      <PhaseDiagram3D
        entries={na_fe_o_entries}
        controls={{ title: `Na-Fe-O with Stats` }}
        bind:phase_stats
        bind:stable_entries
        bind:unstable_entries
        bind:max_hull_dist_show_phases
      />
      {#if phase_stats}
        <PhaseDiagramStats {phase_stats} {stable_entries} {unstable_entries} />
      {/if}
    </div>

    <h2>Highlighted Entries</h2>
    <p class="section-description">
      Highlight specific entries with customizable visual effects. Left: pulsating
      highlight on high-energy entries (ternary). Right: subtle glow on stable phases
      (quaternary). Double-click entries to toggle highlighting.
    </p>
    <div class="ternary-grid">
      <div>
        <details style="margin-bottom: 1em; font-size: 0.9em">
          <summary style="cursor: pointer">
            Highlighted: {highlighted_na_fe_o.length} entries
          </summary>
          <div style="margin: 0.5em 0">
            <strong>IDs:</strong> {highlighted_na_fe_o.join(`, `) || `none`}
          </div>
          <pre
            style="overflow: auto; max-height: 200px"
          >
{JSON.stringify(
              na_fe_o_entries
                .filter((e) => e.entry_id && highlighted_na_fe_o.includes(e.entry_id))
                .map((e) => ({
                  id: e.entry_id,
                  formula: e.reduced_formula,
                  e_hull: e.e_above_hull,
                })),
              null,
              2,
            )}</pre>
        </details>
        <PhaseDiagram3D
          entries={na_fe_o_entries}
          controls={{ title: `High Energy Phases (Pulse)` }}
          highlighted_entries={highlighted_na_fe_o}
          highlight_style={{
            effect: `pulse`,
            color: `#ff3333`,
            size_multiplier: 2,
            opacity: 0.9,
            pulse_speed: 3,
          }}
        />
      </div>
      <div>
        <details style="margin-bottom: 1em; font-size: 0.9em">
          <summary style="cursor: pointer">
            Highlighted: {highlighted_li_co_ni_o.length} entries
          </summary>
          <div style="margin: 0.5em 0">
            <strong>IDs:</strong> {highlighted_li_co_ni_o.join(`, `) || `none`}
          </div>
          <pre
            style="overflow: auto; max-height: 200px"
          >
{JSON.stringify(
              li_co_ni_o_quaternary
                .filter((e) => e.entry_id && highlighted_li_co_ni_o.includes(e.entry_id))
                .map((e) => ({
                  id: e.entry_id,
                  formula: e.reduced_formula,
                  e_hull: e.e_above_hull,
                })),
              null,
              2,
            )}</pre>
        </details>
        <PhaseDiagram4D
          entries={li_co_ni_o_quaternary}
          controls={{ title: `Stable Phases (Glow)` }}
          highlighted_entries={highlighted_li_co_ni_o}
          highlight_style={{ effect: `glow`, color: `#ff8800`, size_multiplier: 2, opacity: 0.85 }}
        />
      </div>
    </div>

    <h2>Marker Symbols</h2>
    <p class="section-description">
      Customize marker shapes to distinguish different entry types. Click an entry to
      select it (shown as ★). Stable phases use ◆, high-energy phases use △, medium-energy
      use +.
    </p>
    <div class="ternary-grid">
      <div>
        <div class="marker-legend">
          <span>★ Selected</span>
          <span>◆ Stable</span>
          <span>△ High E<sub>hull</sub></span>
          <span>+ Medium E<sub>hull</sub></span>
          <span>● Default</span>
        </div>
        <PhaseDiagram3D
          entries={marker_demo_entries}
          controls={{ title: `Na-Fe-O with Markers` }}
          bind:selected_entry={selected_marker_entry}
        />
      </div>
      <div>
        <div class="marker-legend">
          <span>★ Selected</span>
          <span>■ Stable</span>
          <span>● Default</span>
        </div>
        <PhaseDiagram2D
          entries={binary_marker_entries}
          controls={{ title: `Na-O with Markers` }}
          bind:selected_entry={selected_binary_entry}
        />
      </div>
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
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    width: 100%;
    margin: 0 auto 3rem auto;
  }
  .quaternary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    width: 100%;
    margin: 0 auto;
  }
  .binary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    width: 100%;
    margin: 2rem auto 0 auto;
  }
  .stats-example-grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 1rem;
    width: 100%;
    margin: 2rem auto 0 auto;
    align-items: start;
  }
  .loading-state {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 200px;
    color: var(--text-color-muted);
  }
  .marker-legend {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin-bottom: 0.5rem;
    font-size: 0.85em;
    color: var(--text-color-muted);
  }
  .marker-legend span {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  @media (max-width: 1100px) {
    .ternary-grid,
    .quaternary-grid,
    .binary-grid {
      grid-template-columns: 1fr;
    }
    .stats-example-grid {
      grid-template-columns: 1fr;
    }
    .marker-legend {
      flex-wrap: wrap;
    }
  }
</style>
