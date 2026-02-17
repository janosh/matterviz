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
    create_temp_ternary_entries_li_fe_o,
    demo_temperatures,
    GAS_SPECIES,
    make_demo_phase,
    process_hull_for_stats,
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
  const quinary_files = (import.meta as unknown as {
    glob: (
      pattern: string,
      options: { eager: false; query: string },
    ) => Record<string, () => Promise<{ default: string }>>
  }).glob(
    `$site/convex-hull/quinaries/*.json.gz`,
    { eager: false, query: `?url` },
  )

  let entries_map = $state(new SvelteMap())
  let loaded_data = $state(new SvelteMap())

  // State for the 3D example with stats display
  let phase_stats = $state<PhaseStats | null>(null)
  let stable_entries = $state<ConvexHullEntry[]>([])
  let unstable_entries = $state<ConvexHullEntry[]>([])
  let max_hull_dist_show_phases = $state(0.5)

  // State for the side-by-side stats demo
  let side_phase_stats = $state<PhaseStats | null>(null)
  let side_stable = $state<ConvexHullEntry[]>([])
  let side_unstable = $state<ConvexHullEntry[]>([])
  let clicked_entry_id = $state<string | undefined>(undefined)
  let selected_quinary_path = $state<string>(``)

  onMount(async () => {
    const results = await Promise.allSettled(
      [...Object.entries(quaternary_files), ...Object.entries(quinary_files)].map(
        async ([path, loader]) => {
          const response = await fetch((await loader()).default)
          const enc = response.headers.get(`content-encoding`)?.toLowerCase() ?? ``
          const data = enc.includes(`gzip`)
            ? await response.json()
            : JSON.parse(await decompress_data(await response.arrayBuffer(), `gzip`))
          return [path, data] as const
        },
      ),
    )
    loaded_data = new SvelteMap(
      results.filter((res) => res.status === `fulfilled`).map((res) => res.value),
    )
    const quinary_paths = Object.keys(quinary_files).sort()
    if (quinary_paths.length > 0) selected_quinary_path = quinary_paths[0]
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
    filter: (entry: PhaseData) => boolean,
    count = 5,
  ) =>
    entries
      .filter((entry): entry is PhaseData & { entry_id: string } =>
        Boolean(entry.entry_id) && filter(entry)
      )
      .slice(0, count)
      .map((entry) => entry.entry_id)

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
  const ternary_examples = $derived([
    { title: `Na-Fe-O`, entries: na_fe_o_entries },
    { title: `Li-Co-O`, entries: li_co_ni_o_data },
  ])
  const marker_legend_primary = [
    `★ Selected`,
    `◆ Stable`,
    `△ High E<sub>hull</sub>`,
    `+ Medium E<sub>hull</sub>`,
    `● Default`,
  ]
  const marker_legend_binary = [`★ Selected`, `■ Stable`, `● Default`]
  const get_entry_href = (entry: ConvexHullEntry): string | null =>
    entry.entry_id ? `#${entry.entry_id}` : null
  const ternary_features = [
    `<b>Barycentric coordinates</b> — composition mapped to an equilateral triangle base`,
    `<b>Formation energy</b> on the z-axis, with convex hull faces between stable points`,
  ]
  const quaternary_features = [
    `<b>Tetrahedral projection</b> — 4D composition coordinates mapped into 3D space`,
    `<b>Color-coded stability</b> — each point colored by energy above hull`,
    `<b>Drag & drop</b> — load your own JSON data onto any diagram`,
  ]
  const binary_features = [
    `<b>Formation energy vs. composition</b> — stable phases lie on the lower convex hull`,
  ]
  const stats_features = [
    `<b>Live-bound stats</b> — phase counts, energy ranges, and hull distances update with the diagram`,
    `<b>Row highlighting</b> — click a table row to highlight it (<code>highlighted_entry_id</code> + <code>on_entry_click</code>)`,
    `<b>Clickable IDs</b> — <code>entry_href</code> callback turns the ID column into links`,
    `<b>Poly column</b> — shows polymorph count per reduced formula`,
    `<b>Polymorphs filter</b> — dropdown to isolate entries sharing a composition`,
    `<b>Subsystem coverage</b> — grid of binary element pairs with entry counts`,
    `<b>CSV/JSON export</b> — download table data`,
  ]
  const side_by_side_features = [
    `<b><code>layout="side-by-side"</code></b> — stats and table visible simultaneously, no toggle needed`,
  ]
  const highlighted_features = [
    `<b>Visual effects</b> — pulse, glow, or size changes on selected entries`,
    `<b>Tooltip badge</b> — hover to see "★ Highlighted" on marked entries`,
    `<b>Cross-dimensional</b> — works on 2D, 3D, and 4D diagrams`,
  ]
  const marker_features = [
    `<b>Custom shapes</b> — assign per-entry marker symbols (★ ◆ △ + ■ ●)`,
    `<b>Click to select</b> — selected entry shown as ★, updates dynamically`,
  ]
  const temp_features = [
    `<b>Temperature slider</b> — appears when entries include <code>temperatures</code> + <code>free_energies</code> arrays`,
    `<b>Live hull recomputation</b> — phase stability changes are visible as you drag the slider`,
    `<b>Order-disorder transitions</b> — high-entropy polymorphs stabilize at elevated temperatures`,
  ]
  const gas_features = [
    `<b>Chemical potential</b> — μ(T, P) = μ°(T) + RT·ln(P) for gas-phase elements (O, N, H, ...)`,
    `<b>Pressure controls</b> — adjust partial pressures to simulate reducing/oxidizing conditions`,
    `<b>Multi-gas support</b> — O<sub>2</sub>, N<sub>2</sub>, H<sub>2</sub>, CO, CO<sub>2</sub>, H<sub>2</sub>O, F<sub>2</sub>`,
  ]
  const quinary_stats_features = [
    `<b>Standalone stats</b> — use <code>ConvexHullStats</code> without rendering a hull`,
    `<b>High-dimensional support</b> — computed via <code>process_hull_for_stats()</code>, ideal for 5+ element systems`,
  ]
  const quinary_options = $derived(
    Object.keys(quinary_files)
      .sort()
      .map((path) => ({
        path,
        title: path.split(`/`).pop()?.replace(`.json.gz`, ``) ?? path,
      })),
  )
  const selected_quinary_entries = $derived(
    selected_quinary_path
      ? (loaded_data.get(selected_quinary_path) as PhaseData[] | undefined) ?? []
      : [],
  )
  const quinary_stats_result = $derived(
    selected_quinary_entries.length > 0
      ? process_hull_for_stats(selected_quinary_entries)
      : null,
  )

  // === Temperature-dependent G(T) synthetic data ===
  // G(T) ≈ E_0K + entropy_coef * T * 0.0001 - 0.00005 * T * ln(T)
  const temperatures = demo_temperatures // 300-1500K
  type Comp = Record<string, number>
  const make_phase = make_demo_phase

  // Binary Li-Fe: elements + 7 compositions at different x values
  const temp_binary_entries: PhaseData[] = [
    make_phase({ Li: 1 }, 1),
    make_phase({ Fe: 1 }, 2),
    ...[0.25, 0.33, 0.4, 0.5, 0.6, 0.67, 0.75].flatMap((x, idx) => [
      make_phase({ Li: x, Fe: 1 - x }, 10 + idx), // ordered
      make_phase({ Li: x, Fe: 1 - x }, 20 + idx, 2), // disordered (high entropy)
    ]),
  ]

  // Ternary Li-Fe-O: elements + binary edges + interior points + polymorphs
  const temp_ternary_entries = create_temp_ternary_entries_li_fe_o()

  // Quaternary Li-Fe-Ni-O: programmatic generation
  const temp_quaternary_entries: PhaseData[] = [
    // Pure elements
    ...[`Li`, `Fe`, `Ni`, `O`].map((el, idx) => make_phase({ [el]: 1 }, idx)),
    // All binary pairs
    ...[[`Li`, `Fe`], [`Li`, `Ni`], [`Li`, `O`], [`Fe`, `Ni`], [`Fe`, `O`], [
      `Ni`,
      `O`,
    ]]
      .flatMap(([a, b], idx) => [
        make_phase({ [a]: 0.5, [b]: 0.5 }, 500 + idx),
        make_phase({ [a]: 0.5, [b]: 0.5 }, 600 + idx, 2.5),
      ]),
    // Ternary faces (4 faces × 2 polymorphs)
    ...[[`Li`, `Fe`, `Ni`], [`Li`, `Fe`, `O`], [`Li`, `Ni`, `O`], [`Fe`, `Ni`, `O`]]
      .flatMap(([a, b, c], idx) => [
        make_phase({ [a]: 0.33, [b]: 0.33, [c]: 0.34 }, 700 + idx),
        make_phase({ [a]: 0.33, [b]: 0.33, [c]: 0.34 }, 800 + idx, 3.5),
      ]),
    // Quaternary interior with dramatic order-disorder transitions
    ...[
      { Li: 0.25, Fe: 0.25, Ni: 0.25, O: 0.25 },
      { Li: 0.4, Fe: 0.2, Ni: 0.2, O: 0.2 },
      { Li: 0.2, Fe: 0.4, Ni: 0.2, O: 0.2 },
      { Li: 0.2, Fe: 0.2, Ni: 0.4, O: 0.2 },
      { Li: 0.2, Fe: 0.2, Ni: 0.2, O: 0.4 },
    ].flatMap((comp, idx) => [
      make_phase(comp, 900 + idx), // ordered
      make_phase(comp, 1000 + idx, 5), // high-entropy (HEO)
    ]),
  ]

  // Gas pressure demo: configurable gas atmosphere control
  let selected_demo_gas = $state<GasSpecies>(`O2`)

  // Derive gas config from selected gas
  const gas_demo_config = $derived<GasThermodynamicsConfig>({
    enabled_gases: [selected_demo_gas],
  })

  // Bindable gas pressures for the demo
  let gas_demo_pressures = $state<Partial<Record<GasSpecies, number>>>({})

  // Gas demo helper: linear G(T) = E - S*(T - 300K)*0.001 for smooth T-dependence
  // Demo entropy values 30-80 (unitless scaling factor, not physical meV/K)
  const make_gas_phase = (
    comp: Comp,
    energy: number,
    entropy: number, // unitless scaling factor
  ): PhaseData => ({
    composition: comp,
    energy,
    temperatures,
    free_energies: temperatures.map((T) => energy - entropy * (T - 300) * 0.001),
  })

  // Gas demo: Fe-O binary - entropy increases with O content (oxides have higher S)
  const gas_demo_fe_o_entries: PhaseData[] = [
    make_gas_phase({ Fe: 1 }, 0, 30), // Fe metal, low entropy
    make_gas_phase({ O: 1 }, 0, 50), // O2 reference
    make_gas_phase({ Fe: 0.75, O: 0.25 }, -0.4, 45), // Fe-rich
    make_gas_phase({ Fe: 0.67, O: 0.33 }, -0.75, 55), // FeO (wüstite)
    make_gas_phase({ Fe: 0.6, O: 0.4 }, -0.85, 60), // Fe3O4-like
    make_gas_phase({ Fe: 0.5, O: 0.5 }, -0.7, 65), // intermediate
    make_gas_phase({ Fe: 0.43, O: 0.57 }, -0.95, 70), // Fe2O3 (hematite)
    make_gas_phase({ Fe: 0.33, O: 0.67 }, -0.55, 80), // O-rich
  ]

  // Gas demo: Fe-Ni-O ternary with consistent entropy trend
  const gas_demo_ternary_entries: PhaseData[] = [
    make_gas_phase({ Fe: 1 }, 0, 30),
    make_gas_phase({ Ni: 1 }, 0, 32),
    make_gas_phase({ O: 1 }, 0, 50),
    make_gas_phase({ Fe: 0.5, Ni: 0.5 }, -0.12, 40), // FeNi alloy
    make_gas_phase({ Fe: 0.5, O: 0.5 }, -0.8, 60), // FeO
    make_gas_phase({ Ni: 0.5, O: 0.5 }, -0.75, 58), // NiO
    make_gas_phase({ Fe: 0.33, Ni: 0.33, O: 0.34 }, -0.65, 55), // spinel
    make_gas_phase({ Fe: 0.4, Ni: 0.2, O: 0.4 }, -0.72, 58),
    make_gas_phase({ Fe: 0.2, Ni: 0.4, O: 0.4 }, -0.68, 56),
  ]
</script>

<svelte:head>
  <title>MatterViz Convex Hull Demo</title>
  <meta
    name="description"
    content="Interactive convex hull visualizations: quaternary, ternary, and binary systems"
  />
</svelte:head>

<main class="demo-container full-bleed">
  {#snippet feature_list(feature_items: string[])}
    <ul class="feature-list">
      {#each feature_items as feature_item (feature_item)}
        <li>{@html feature_item}</li>
      {/each}
    </ul>
  {/snippet}

  <h1>Convex Hulls</h1>

  <section class="demo-section">
    <h2>Ternary Chemical Systems</h2>
    {@render feature_list(ternary_features)}
    <div class="ternary-grid">
      {#each ternary_examples as { title, entries } (title)}
        <ConvexHull3D {entries} controls={{ title }} />
      {/each}
    </div>
  </section>

  <section class="demo-section">
    <h2>Quaternary Chemical Systems</h2>
    {@render feature_list(quaternary_features)}
    <div class="quaternary-grid">
      {#each [...loaded_data.entries()].filter(([p]) =>
          (p as string).includes(`quaternaries`)
        ) as
        [path, data]
        (path)
      }
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
  </section>

  <section class="demo-section">
    <h2>Binary Chemical Systems</h2>
    {@render feature_list(binary_features)}
    <div class="binary-grid">
      {#each binary_examples as { title, entries } (title)}
        <ConvexHull2D {entries} controls={{ title }} style="height: 500px" />
      {/each}
    </div>
  </section>

  <section class="demo-section">
    <h2>Statistics Panel</h2>
    {@render feature_list(stats_features)}
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
        <ConvexHullStats
          {phase_stats}
          {stable_entries}
          {unstable_entries}
          highlighted_entry_id={clicked_entry_id}
          on_entry_click={(entry) => clicked_entry_id = entry.entry_id}
          entry_href={get_entry_href}
          style="--hull-stats-max-height: var(--hull-height, 500px)"
        />
      {/if}
    </div>

    <h3>Side-by-Side Layout</h3>
    {@render feature_list(side_by_side_features)}
    <div class="side-by-side-example">
      <ConvexHull3D
        entries={li_co_ni_o_data}
        controls={{ title: `Li-Co-O` }}
        bind:phase_stats={side_phase_stats}
        bind:stable_entries={side_stable}
        bind:unstable_entries={side_unstable}
      />
      {#if side_phase_stats}
        <ConvexHullStats
          phase_stats={side_phase_stats}
          stable_entries={side_stable}
          unstable_entries={side_unstable}
          layout="side-by-side"
          entry_href={get_entry_href}
          style="--hull-stats-padding: 0"
        />
      {/if}
    </div>
  </section>

  <section class="demo-section">
    <h2>Highlighted Entries</h2>
    {@render feature_list(highlighted_features)}
    <div class="highlight-grid">
      <ConvexHull2D
        entries={binary_examples[1]?.entries ?? []}
        controls={{ title: `Fe-O (${highlighted_fe_o.length} highlighted)` }}
        highlighted_entries={highlighted_fe_o}
        highlight_style={{
          effect: `pulse`,
          color: `#22cc88`,
          size_multiplier: 2.5,
          pulse_speed: 4,
        }}
      />
      <ConvexHull3D
        entries={na_fe_o_entries}
        controls={{ title: `Na-Fe-O (${highlighted_na_fe_o.length} highlighted)` }}
        highlighted_entries={highlighted_na_fe_o}
        highlight_style={{
          effect: `pulse`,
          color: `#ff3333`,
          size_multiplier: 2,
          pulse_speed: 3,
        }}
      />
      <ConvexHull4D
        entries={li_co_ni_o_quaternary}
        controls={{ title: `Li-Co-Ni-O (${highlighted_li_co_ni_o.length} highlighted)` }}
        highlighted_entries={highlighted_li_co_ni_o}
        highlight_style={{ effect: `glow`, color: `#ff8800`, size_multiplier: 2 }}
      />
    </div>
  </section>

  <section class="demo-section">
    <h2>Marker Symbols</h2>
    {@render feature_list(marker_features)}
    <div class="ternary-grid">
      <div>
        <div class="marker-legend">
          {#each marker_legend_primary as legend_item (legend_item)}
            <span>{@html legend_item}</span>
          {/each}
        </div>
        <ConvexHull3D
          entries={marker_demo_entries}
          controls={{ title: `Na-Fe-O with Markers` }}
          bind:selected_entry={selected_marker_entry}
        />
      </div>
      <div>
        <div class="marker-legend">
          {#each marker_legend_binary as legend_item (legend_item)}
            <span>{@html legend_item}</span>
          {/each}
        </div>
        <ConvexHull2D
          entries={binary_marker_entries}
          controls={{ title: `Na-O with Markers` }}
          bind:selected_entry={selected_binary_entry}
          style="height: 100%"
        />
      </div>
    </div>

    <p class="section-note">
      <strong>Note:</strong> Missing pure element references are automatically added with
      E<sub>form</sub> = 0 eV/atom.
    </p>
  </section>

  <section class="demo-section">
    <h2>Temperature-Dependent Free Energies</h2>
    {@render feature_list(temp_features)}
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
  </section>

  <section class="demo-section">
    <h2>Gas Atmosphere Control</h2>
    {@render feature_list(gas_features)}
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
    <p class="section-note">
      <strong>Tip:</strong> Try very low pressure (10⁻⁶ bar) for reducing or high (1 bar)
      for oxidizing conditions.
    </p>
  </section>

  <section class="demo-section">
    <h2>Standalone Stats for Quinary Systems</h2>
    {@render feature_list(quinary_stats_features)}
    <div class="quinary-stats-controls">
      <label for="quinary-select">Quinary dataset:</label>
      <select id="quinary-select" bind:value={selected_quinary_path}>
        {#each quinary_options as option (option.path)}
          <option value={option.path}>{option.title}</option>
        {/each}
      </select>
    </div>
    {#if quinary_stats_result?.phase_stats}
      <div class="quinary-stats-example">
        <ConvexHullStats
          phase_stats={quinary_stats_result.phase_stats}
          stable_entries={quinary_stats_result.stable_entries}
          unstable_entries={quinary_stats_result.unstable_entries}
          layout="side-by-side"
          style="width: min(100%, 980px); margin: 0 auto"
        />
      </div>
    {/if}
  </section>
</main>

<style>
  .demo-section {
    padding-bottom: 2rem;
    margin-bottom: 2rem;
    border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
    text-align: center;
  }
  .demo-section:last-child {
    border-bottom: none;
    margin-bottom: 0;
  }
  .feature-list {
    color: var(--text-color-muted);
    margin: 0 auto 1.5rem auto;
    max-width: 800px;
    font-size: 0.92em;
    line-height: 1.6;
    padding-left: 0;
    list-style: none;
  }
  .section-note {
    color: var(--text-color-muted);
    font-size: 0.88em;
    text-align: center;
    margin-top: 1rem;
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
  .side-by-side-example {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    gap: 1rem;
    width: 100%;
    max-width: 100%;
    margin: 0 auto 3rem auto;
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
    justify-content: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .gas-selector label {
    font-weight: 500;
  }
  .gas-selector select {
    padding: 0.2rem 0.4rem;
    border-radius: 3px;
    border: 1px solid var(--border-color, #ccc);
    background: var(--page-bg, Canvas);
    color: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .quinary-stats-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin: 0 0 1rem 0;
  }
  .quinary-stats-controls label {
    font-weight: 500;
  }
  .quinary-stats-controls select {
    padding: 0.2rem 0.4rem;
    border-radius: 3px;
    border: 1px solid var(--border-color, #ccc);
    background: var(--page-bg, Canvas);
    color: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .quinary-stats-example {
    width: 100%;
    margin: 0 auto 2rem auto;
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
    .side-by-side-example {
      grid-template-columns: 1fr;
    }
    .marker-legend {
      flex-wrap: wrap;
    }
  }
</style>
