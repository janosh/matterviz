<script lang="ts">
  import type { ElementSymbol } from '$lib'
  import type {
    ConvexHullEntry,
    GasSpecies,
    GasThermodynamicsConfig,
    MarkerSymbol,
    PhaseData,
    PhaseStats,
  } from '$lib/convex-hull'
  import {
    ConvexHull2D,
    ConvexHull3D,
    ConvexHull4D,
    ConvexHullStats,
    GAS_SPECIES,
  } from '$lib/convex-hull'
  import { decompress_data } from '$lib/io/decompress'
  import { onMount } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'

  const quaternary_files = (import.meta as unknown as {
    glob: (
      pattern: string,
      options: { eager: false; query: string },
    ) => Record<string, () => Promise<{ default: string }>>
  }).glob(
    `$site/convex-hull/quaternaries/*.json.gz`,
    { eager: false, query: `?url` },
  )

  let entries_map = $state(new SvelteMap())
  let loaded_data = $state(new SvelteMap())

  // State for the 3D example with stats display
  let phase_stats = $state<PhaseStats | null>(null)
  let stable_entries = $state<ConvexHullEntry[]>([])
  let unstable_entries = $state<ConvexHullEntry[]>([])
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

  const handle_file_drop = (path: string) => (entries: PhaseData[]) => {
    entries_map.set(path, entries)
    entries_map = new SvelteMap(entries_map)
  }

  // Filter entries to only include those with compositions from target elements
  const filter_by_elements = (entries: PhaseData[], elements: string[]) => {
    const element_set = new Set(elements)
    return entries.filter((entry) =>
      (Object.keys(entry.composition) as ElementSymbol[])
        .filter((el) => (entry.composition?.[el] ?? 0) > 0)
        .every((el) => element_set.has(el))
    )
  }

  // Create ternary subsets from quaternary data
  const na_fe_o_entries = $derived(filter_by_elements(
    (loaded_data.get(`/src/site/convex-hull/quaternaries/Na-Fe-P-O.json.gz`) ??
      []) as PhaseData[],
    [`Na`, `Fe`, `O`],
  ))

  const li_co_ni_o_data = $derived(filter_by_elements(
    (loaded_data.get(`/src/site/convex-hull/quaternaries/Li-Co-Ni-O.json.gz`) ??
      []) as PhaseData[],
    [`Li`, `Co`, `O`],
  ))

  // Full quaternary data for Li-Co-Ni-O
  const li_co_ni_o_quaternary = $derived(
    (loaded_data.get(`/src/site/convex-hull/quaternaries/Li-Co-Ni-O.json.gz`) ??
      []) as PhaseData[],
  )

  // Helper to pick entries for highlighting demos
  const pick_entries = (
    entries: PhaseData[],
    filter: (e: PhaseData) => boolean,
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
    entry: PhaseData,
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
  let selected_marker_entry = $state<ConvexHullEntry | null>(null)
  const marker_demo_entries = $derived(
    na_fe_o_entries.map((e) => ({
      ...e,
      marker: get_marker(e, selected_marker_entry?.entry_id),
    })),
  )

  // Create four binary examples from the two quaternary datasets
  const binary_examples = $derived.by(() => {
    const na_fe_p_o = loaded_data.get(
      `/src/site/convex-hull/quaternaries/Na-Fe-P-O.json.gz`,
    ) as PhaseData[] | undefined
    const li_co_ni_o = loaded_data.get(
      `/src/site/convex-hull/quaternaries/Li-Co-Ni-O.json.gz`,
    ) as PhaseData[] | undefined
    if (!na_fe_p_o || !li_co_ni_o) return []

    return [
      { title: `Na-O`, entries: filter_by_elements(na_fe_p_o, [`Na`, `O`]) },
      { title: `Fe-O`, entries: filter_by_elements(na_fe_p_o, [`Fe`, `O`]) },
      { title: `Co-O`, entries: filter_by_elements(li_co_ni_o, [`Co`, `O`]) },
      { title: `Ni-O`, entries: filter_by_elements(li_co_ni_o, [`Ni`, `O`]) },
    ]
  })

  // Highlight demo for 2D binary: highlight stable phases
  const highlighted_fe_o = $derived(
    pick_entries(
      binary_examples[1]?.entries ?? [],
      (e) => e.is_stable || (e.e_above_hull ?? 1) < 0.02,
      8,
    ),
  )

  // Binary marker demo
  let selected_binary_entry = $state<ConvexHullEntry | null>(null)
  const binary_marker_entries = $derived(
    (binary_examples[0]?.entries ?? []).map((e) => ({
      ...e,
      marker: get_marker(e, selected_binary_entry?.entry_id, `square`),
    })),
  )

  // Synthetic G(T) data: G(T) ≈ E_0K + a*T - b*T*ln(T)
  const temperatures = [300, 600, 900, 1200, 1500]

  type BaseEntry = {
    composition: Record<string, number>
    energy: number
    entropy_coef: number
  }
  const with_temp_data = (
    { composition, energy, entropy_coef }: BaseEntry,
  ): PhaseData => ({
    composition,
    energy,
    temperatures,
    free_energies: temperatures.map((T) =>
      energy + entropy_coef * T * 0.0001 - 0.00005 * T * Math.log(T)
    ),
  })

  // Binary Li-Fe system with temperature-dependent G(T)
  const temp_binary_entries = [
    { composition: { Li: 1 }, energy: 0, entropy_coef: 0.5 },
    { composition: { Fe: 1 }, energy: 0, entropy_coef: 0.8 },
    { composition: { Li: 0.5, Fe: 0.5 }, energy: -0.3, entropy_coef: 1.2 },
    { composition: { Li: 0.33, Fe: 0.67 }, energy: -0.25, entropy_coef: 1.5 },
    { composition: { Li: 0.67, Fe: 0.33 }, energy: -0.22, entropy_coef: 0.9 },
    { composition: { Li: 0.25, Fe: 0.75 }, energy: -0.15, entropy_coef: 1.8 },
    { composition: { Li: 0.75, Fe: 0.25 }, energy: -0.12, entropy_coef: 0.6 },
    { composition: { Li: 0.4, Fe: 0.6 }, energy: -0.1, entropy_coef: 2.0 },
    { composition: { Li: 0.6, Fe: 0.4 }, energy: -0.08, entropy_coef: 1.1 },
  ].map(with_temp_data)

  // Ternary Li-Fe-O system with temperature-dependent G(T)
  const temp_ternary_entries = [
    { composition: { Li: 1 }, energy: 0, entropy_coef: 0.4 },
    { composition: { Fe: 1 }, energy: 0, entropy_coef: 0.6 },
    { composition: { O: 1 }, energy: 0, entropy_coef: 0.5 },
    { composition: { Li: 0.5, Fe: 0.5 }, energy: -0.35, entropy_coef: 1.3 },
    { composition: { Fe: 0.5, O: 0.5 }, energy: -0.28, entropy_coef: 1.6 },
    { composition: { Li: 0.5, O: 0.5 }, energy: -0.32, entropy_coef: 1.1 },
    {
      composition: { Li: 0.33, Fe: 0.33, O: 0.34 },
      energy: -0.45,
      entropy_coef: 1.8,
    },
    { composition: { Li: 0.5, Fe: 0.25, O: 0.25 }, energy: -0.38, entropy_coef: 1.4 },
    { composition: { Li: 0.25, Fe: 0.5, O: 0.25 }, energy: -0.36, entropy_coef: 1.5 },
    { composition: { Li: 0.25, Fe: 0.25, O: 0.5 }, energy: -0.34, entropy_coef: 1.2 },
    { composition: { Li: 0.4, Fe: 0.4, O: 0.2 }, energy: -0.2, entropy_coef: 2.2 },
    { composition: { Li: 0.2, Fe: 0.4, O: 0.4 }, energy: -0.18, entropy_coef: 2.0 },
  ].map(with_temp_data)

  // Quaternary Li-Fe-Ni-O system with temperature-dependent G(T)
  const temp_quaternary_entries = [
    { composition: { Li: 1 }, energy: 0, entropy_coef: 0.3 },
    { composition: { Fe: 1 }, energy: 0, entropy_coef: 0.5 },
    { composition: { Ni: 1 }, energy: 0, entropy_coef: 0.4 },
    { composition: { O: 1 }, energy: 0, entropy_coef: 0.6 },
    { composition: { Li: 0.5, Fe: 0.5 }, energy: -0.3, entropy_coef: 1.2 },
    { composition: { Ni: 0.5, O: 0.5 }, energy: -0.28, entropy_coef: 1.4 },
    {
      composition: { Li: 0.33, Fe: 0.33, Ni: 0.34 },
      energy: -0.4,
      entropy_coef: 1.6,
    },
    {
      composition: { Fe: 0.33, Ni: 0.33, O: 0.34 },
      energy: -0.38,
      entropy_coef: 1.7,
    },
    {
      composition: { Li: 0.25, Fe: 0.25, Ni: 0.25, O: 0.25 },
      energy: -0.5,
      entropy_coef: 2.0,
    },
    {
      composition: { Li: 0.4, Fe: 0.2, Ni: 0.2, O: 0.2 },
      energy: -0.42,
      entropy_coef: 1.8,
    },
    {
      composition: { Li: 0.2, Fe: 0.4, Ni: 0.2, O: 0.2 },
      energy: -0.4,
      entropy_coef: 1.9,
    },
    {
      composition: { Li: 0.3, Fe: 0.3, Ni: 0.3, O: 0.1 },
      energy: -0.25,
      entropy_coef: 2.5,
    },
    {
      composition: { Li: 0.1, Fe: 0.3, Ni: 0.3, O: 0.3 },
      energy: -0.22,
      entropy_coef: 2.3,
    },
  ].map(with_temp_data)

  // Gas pressure demo: configurable gas atmosphere control
  let selected_demo_gas = $state<GasSpecies>(`O2`)

  // Derive gas config from selected gas
  const gas_demo_config = $derived<GasThermodynamicsConfig>({
    enabled_gases: [selected_demo_gas],
  })

  // Bindable gas pressures for the demo
  let gas_demo_pressures = $state<Partial<Record<GasSpecies, number>>>({})

  // Synthetic Fe-O data with temperature dependence for gas demo
  const gas_demo_fe_o_entries = ([
    { composition: { Fe: 1 }, energy: 0, entropy_coef: 0.6 },
    { composition: { O: 1 }, energy: 0, entropy_coef: 0.5 },
    { composition: { Fe: 0.67, O: 0.33 }, energy: -0.85, entropy_coef: 1.2 }, // FeO
    { composition: { Fe: 0.6, O: 0.4 }, energy: -0.95, entropy_coef: 1.4 }, // Fe3O4
    { composition: { Fe: 0.4, O: 0.6 }, energy: -1.05, entropy_coef: 1.6 }, // Fe2O3
    { composition: { Fe: 0.5, O: 0.5 }, energy: -0.78, entropy_coef: 1.3 },
    { composition: { Fe: 0.75, O: 0.25 }, energy: -0.45, entropy_coef: 0.9 },
    { composition: { Fe: 0.33, O: 0.67 }, energy: -0.68, entropy_coef: 1.8 },
  ] as BaseEntry[]).map(with_temp_data)

  // Ternary Fe-Ni-O system for gas demo
  const gas_demo_ternary_entries = ([
    { composition: { Fe: 1 }, energy: 0, entropy_coef: 0.6 },
    { composition: { Ni: 1 }, energy: 0, entropy_coef: 0.5 },
    { composition: { O: 1 }, energy: 0, entropy_coef: 0.5 },
    { composition: { Fe: 0.5, O: 0.5 }, energy: -0.9, entropy_coef: 1.3 },
    { composition: { Ni: 0.5, O: 0.5 }, energy: -0.85, entropy_coef: 1.2 },
    { composition: { Fe: 0.5, Ni: 0.5 }, energy: -0.15, entropy_coef: 1.0 },
    {
      composition: { Fe: 0.33, Ni: 0.33, O: 0.34 },
      energy: -0.72,
      entropy_coef: 1.5,
    },
    { composition: { Fe: 0.4, Ni: 0.2, O: 0.4 }, energy: -0.82, entropy_coef: 1.6 },
    { composition: { Fe: 0.2, Ni: 0.4, O: 0.4 }, energy: -0.78, entropy_coef: 1.4 },
    { composition: { Fe: 0.25, Ni: 0.25, O: 0.5 }, energy: -0.68, entropy_coef: 1.7 },
  ] as BaseEntry[]).map(with_temp_data)
</script>

<svelte:head>
  <title>MatterViz Convex Hull Demo</title>
  <meta
    name="description"
    content="Interactive convex hull visualizations: quaternary, ternary, and binary systems"
  />
</svelte:head>

<main class="demo-container full-bleed">
  <h1>Convex Hulls</h1>

  <h2>Ternary Chemical Systems</h2>
  <p class="section-description">
    3D ternary convex hulls show composition on an equilateral triangle base with
    formation energy as the z-axis. Convex hull faces are rendered between stable points.
  </p>
  <div class="ternary-grid">
    {#each [
        { title: `Na-Fe-O`, entries: na_fe_o_entries },
        { title: `Li-Co-O`, entries: li_co_ni_o_data },
      ] as
      { title, entries }
      (title)
    }
      <ConvexHull3D {entries} controls={{ title }} />
    {/each}
  </div>

  <h2>Quaternary Chemical Systems</h2>
  <p class="section-description">
    4D quaternary convex hulls project tetrahedral composition coordinates into 3D space.
    Each point represents a compound with its stability indicated by color.
  </p>
  <div class="quaternary-grid">
    {#each [...loaded_data.entries()] as [path, data] (path)}
      {@const title = (path as string).split(`/`).pop()?.split(`.`).shift()?.replace(
        `.json`,
        ``,
      )}
      <ConvexHull4D
        entries={(entries_map.get(path as string) as PhaseData[] | undefined) ||
        (data as PhaseData[])}
        controls={{ title }}
        on_file_drop={handle_file_drop(path as string)}
      />
    {/each}
  </div>

  <h2>Binary Chemical Systems</h2>
  <p class="section-description">
    2D binary convex hulls show formation energy versus composition. Stable phases lie on
    the convex hull.
  </p>
  <div class="binary-grid">
    {#each binary_examples as { title, entries } (title)}
      <ConvexHull2D {entries} controls={{ title }} style="height: 500px" />
    {/each}
  </div>

  <h2>3D Convex Hull with Statistics</h2>
  <p class="section-description">
    Example of a 3D ternary convex hull displayed alongside its computed statistics. The
    stats are bound to the diagram and update automatically when the data changes.
  </p>
  <div class="stats-example-grid">
    <ConvexHull3D
      entries={na_fe_o_entries}
      controls={{ title: `Na-Fe-O with Stats` }}
      bind:phase_stats
      bind:stable_entries
      bind:unstable_entries
      bind:max_hull_dist_show_phases
      style="height: 100%"
    />
    {#if phase_stats}
      <ConvexHullStats {phase_stats} {stable_entries} {unstable_entries} />
    {/if}
  </div>

  <h2>Highlighted Entries</h2>
  <p class="section-description">
    Highlight specific entries with customizable visual effects. Hover over highlighted
    entries to see the "★ Highlighted" badge in the tooltip.
  </p>
  <div class="highlight-grid">
    <ConvexHull2D
      entries={binary_examples[1]?.entries ?? []}
      controls={{ title: `Fe-O (${highlighted_fe_o.length} highlighted)` }}
      highlighted_entries={highlighted_fe_o}
      highlight_style={{ effect: `pulse`, color: `#22cc88`, size_multiplier: 2.5, pulse_speed: 4 }}
    />
    <ConvexHull3D
      entries={na_fe_o_entries}
      controls={{ title: `Na-Fe-O (${highlighted_na_fe_o.length} highlighted)` }}
      highlighted_entries={highlighted_na_fe_o}
      highlight_style={{ effect: `pulse`, color: `#ff3333`, size_multiplier: 2, pulse_speed: 3 }}
    />
    <ConvexHull4D
      entries={li_co_ni_o_quaternary}
      controls={{ title: `Li-Co-Ni-O (${highlighted_li_co_ni_o.length} highlighted)` }}
      highlighted_entries={highlighted_li_co_ni_o}
      highlight_style={{ effect: `glow`, color: `#ff8800`, size_multiplier: 2 }}
    />
  </div>

  <h2>Marker Symbols</h2>
  <p class="section-description">
    Customize marker shapes to distinguish different entry types. Click an entry to select
    it (shown as ★). Stable phases use ◆, high-energy phases use △, medium-energy use +.
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
      <ConvexHull3D
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
      <ConvexHull2D
        entries={binary_marker_entries}
        controls={{ title: `Na-O with Markers` }}
        bind:selected_entry={selected_binary_entry}
        style="height: 100%"
      />
    </div>
  </div>

  <p class="section-description">
    <strong>Note:</strong> If pure element references are missing from the data, they are
    automatically added with formation energy = 0 eV/atom (the thermodynamic definition).
  </p>

  <h2>Temperature-Dependent Free Energies</h2>
  <p class="section-description">
    When entries include <code>temperatures</code> and <code>free_energies</code> arrays,
    a temperature slider appears allowing dynamic visualization of G(T) at different
    temperatures. The hull is recomputed at each temperature, showing how phase stability
    changes.
  </p>
  <div class="temp-grid">
    <ConvexHull2D
      entries={temp_binary_entries}
      controls={{ title: `Li-Fe with G(T)` }}
      style="height: 500px"
    />
    <ConvexHull3D
      entries={temp_ternary_entries}
      controls={{ title: `Li-Fe-O with G(T)` }}
    />
    <ConvexHull4D
      entries={temp_quaternary_entries}
      controls={{ title: `Li-Fe-Ni-O with G(T)` }}
    />
  </div>

  <h2>Gas Atmosphere Control</h2>
  <p class="section-description">
    For systems containing elements from gaseous species (O, N, H, etc.), the chemical
    potential depends on both temperature and partial pressure: μ(T, P) = μ°(T) +
    RT·ln(P). Use the gas pressure controls (left side) to simulate different atmospheric
    conditions.
  </p>
  <div class="gas-selector">
    <label for="gas-select">Gas species:</label>
    <select id="gas-select" bind:value={selected_demo_gas}>
      {#each GAS_SPECIES as gas (gas)}
        <option value={gas}>{gas}</option>
      {/each}
    </select>
  </div>
  <div class="gas-grid">
    <ConvexHull2D
      entries={gas_demo_fe_o_entries}
      controls={{ title: `Fe-O with ${selected_demo_gas} Pressure` }}
      gas_config={gas_demo_config}
      bind:gas_pressures={gas_demo_pressures}
      style="height: 500px"
    />
    <ConvexHull3D
      entries={gas_demo_ternary_entries}
      controls={{ title: `Fe-Ni-O with ${selected_demo_gas} Pressure` }}
      gas_config={gas_demo_config}
      bind:gas_pressures={gas_demo_pressures}
    />
  </div>
  <p class="section-description" style="margin-top: 1rem">
    <strong>Tip:</strong> Try setting pressure to very low values (10⁻⁶ bar) to simulate
    reducing conditions, or high values (1 bar) for oxidizing conditions. Observe how the
    relative stability of phases changes.
  </p>
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
  .highlight-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
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
  @media (max-width: 1400px) {
    .highlight-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
  .temp-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    width: 100%;
    max-width: 900px;
    margin: 0 auto 3rem auto;
  }
  .gas-selector {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .gas-selector label {
    font-weight: 500;
  }
  .gas-selector select {
    padding: 0.4rem 0.8rem;
    border-radius: 4px;
    border: 1px solid var(--border-color, #ccc);
    background: var(--bg-color, white);
    font-size: 1rem;
    cursor: pointer;
  }
  .gas-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    width: 100%;
    margin: 0 auto 1rem auto;
  }
  @media (max-width: 1100px) {
    .ternary-grid,
    .quaternary-grid,
    .binary-grid,
    .highlight-grid,
    .temp-grid,
    .gas-grid {
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
