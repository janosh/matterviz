<script lang="ts">
  import LazyDemo from '$site/LazyDemo.svelte'
  import { sanitize_html } from '$lib/sanitize'
  import type { ElementSymbol } from '$lib'
  import type {
    ConvexHullEntry,
    EntryCategoryConfig,
    GasSpecies,
    GasThermodynamicsConfig,
    MagneticOrdering,
    PhaseData,
  } from '$lib/convex-hull'
  import {
    ConvexHull,
    ConvexHullStats,
    GAS_SPECIES,
    process_hull_for_stats,
  } from '$lib/convex-hull'
  import {
    create_temp_ternary_entries_li_fe_o,
    demo_temperatures,
    make_demo_phase,
  } from '$site/convex-hull/demo-temperature'
  import {
    filter_by_elements,
    hull_system_name,
    quaternary_files,
    quaternary_loader,
    quinary_files,
  } from '$site/convex-hull'
  import { onMount } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'

  // Dropped replacements stay separate from the fixtures used by the subset demos.
  const entries_map = new SvelteMap<string, PhaseData[]>()
  const primary_data = new SvelteMap<string, PhaseData[]>()
  const primary_errors = new SvelteMap<string, string>()
  const primary_systems = [`Na-Fe-P-O`, `Li-Co-Ni-O`]

  // State for the 3D example with stats display
  let stats_hull = $state<ReturnType<typeof ConvexHull>>()
  const model = $derived(stats_hull?.get_model())
  let max_hull_dist_show_phases = $state(0.5)

  // State for the side-by-side stats demo
  let side_hull = $state<ReturnType<typeof ConvexHull>>()
  const side_model = $derived(side_hull?.get_model())
  let clicked_entry_id = $state<string | undefined>(undefined)
  const quinary_paths = Object.keys(quinary_files).toSorted()
  let selected_quinary_path = $state(quinary_paths[0])

  onMount(() => {
    for (const system of primary_systems) {
      void quaternary_loader(system)()
        .then(({ default: entries }) => primary_data.set(system, entries))
        .catch((error) => primary_errors.set(system, String(error)))
    }
  })

  // Create ternary subsets from quaternary data
  const na_fe_o_entries = $derived(
    filter_by_elements(primary_data.get(`Na-Fe-P-O`) ?? [], [`Na`, `Fe`, `O`]),
  )

  const li_co_ni_o_data = $derived(
    filter_by_elements(primary_data.get(`Li-Co-Ni-O`) ?? [], [`Li`, `Co`, `O`]),
  )

  // Full quaternary data for Li-Co-Ni-O
  const li_co_ni_o_quaternary = $derived(primary_data.get(`Li-Co-Ni-O`) ?? [])

  // Helper to pick entries for highlighting demos
  const pick_entries = (
    entries: PhaseData[],
    filter: (entry: PhaseData) => boolean,
    count = 5,
  ) =>
    entries
      .filter(
        (entry): entry is PhaseData & { entry_id: string } =>
          Boolean(entry.entry_id) && filter(entry),
      )
      .slice(0, count)
      .map((entry) => entry.entry_id)

  // Highlight demo: visible unstable entries (ternary) and stable entries (quaternary)
  const highlighted_na_fe_o = $derived(
    pick_entries(
      na_fe_o_entries,
      (entry) => (entry.e_above_hull ?? 0) > 0.05 && (entry.e_above_hull ?? 1) < 0.5,
    ),
  )
  const highlighted_li_co_ni_o = $derived(
    pick_entries(
      li_co_ni_o_quaternary,
      (entry) => entry.is_stable || (entry.e_above_hull ?? 1) < 0.01,
    ),
  )

  // Create four binary examples from the two quaternary datasets
  const binary_examples = $derived(
    [
      [`Na-O`, `Na-Fe-P-O`],
      [`Fe-O`, `Na-Fe-P-O`],
      [`Co-O`, `Li-Co-Ni-O`],
      [`Ni-O`, `Li-Co-Ni-O`],
    ].map(([title, system]) => ({
      title,
      entries: filter_by_elements(primary_data.get(system) ?? [], title.split(`-`)),
    })),
  )

  // Highlight demo for 2D binary: highlight stable phases
  const highlighted_fe_o = $derived(
    pick_entries(
      binary_examples[1]?.entries ?? [],
      (entry) => entry.is_stable || (entry.e_above_hull ?? 1) < 0.02,
      8,
    ),
  )

  // === Magnetic states demo ===
  // Assign synthetic magnetic orderings deterministically by entry-ID hash (real data
  // would carry magnetic_ordering from DFT, e.g. Materials Project's `ordering` field)
  const magnetic_ternary_entries = $derived(
    na_fe_o_entries.map((entry) => {
      const has_magnetic_elem = [`Fe`, `Co`, `Ni`].some(
        (elem) => (entry.composition[elem as ElementSymbol] ?? 0) > 0,
      )
      const id_hash = [...(entry.entry_id ?? ``)].reduce(
        (acc, char) => acc + char.charCodeAt(0),
        0,
      )
      const magnetic_ordering: MagneticOrdering = has_magnetic_elem
        ? ([`FM`, `FiM`, `AFM`] as const)[id_hash % 3]
        : `NM`
      return { ...entry, magnetic_ordering }
    }),
  )
  // oxfmt-ignore
  const magnetic_marker_legend = [`△ FM (ferromagnetic)`, `◆ FiM (ferrimagnetic)`, `■ AFM (antiferromagnetic)`, `● NM (non-magnetic)`]

  // Custom category demo: synthetic crystallinity labels on the Co-O binary show the
  // generic entry_category API; the magnetic preset uses the exact same machinery
  const crystallinity_category: EntryCategoryConfig = {
    label: `Structure`,
    property: `crystallinity`,
    markers: { crystalline: `circle`, amorphous: `cross`, glass: `star` },
  }
  const crystallinity_entries = $derived(
    (binary_examples[2]?.entries ?? []).map((entry, idx) => ({
      ...entry,
      crystallinity: [`crystalline`, `amorphous`, `glass`][idx % 3],
    })),
  )
  const crystallinity_marker_legend = [`● crystalline`, `✚ amorphous`, `★ glass`]

  const ternary_examples = $derived([
    { title: `Na-Fe-O`, entries: na_fe_o_entries },
    { title: `Li-Co-O`, entries: li_co_ni_o_data },
  ])
  const get_entry_href = (entry: ConvexHullEntry): string | null =>
    entry.entry_id ? `#${entry.entry_id}` : null
  const quaternary_features = [
    `<b>Drag & drop</b>: load your own JSON data onto the quaternary diagrams`,
  ]
  const stats_features = [
    `<b>Shared model</b>: <code>get_model()</code> exposes the current numerical hull for <code>ConvexHullStats model={model}</code>; display thresholds and categories do not change the model`,
    `<b>Headless computation</b>: <code>compute_hull_model(entries)</code> builds the same model without mounting a diagram`,
    `<b>Row highlighting</b>: click a table row to highlight it (<code>highlighted_entry_id</code> + <code>on_entry_click</code>)`,
    `<b>Clickable IDs</b>: <code>entry_href</code> callback turns the ID column into links`,
    `<b>Poly column</b>: shows polymorph count per reduced formula`,
    `<b>Polymorphs filter</b>: dropdown to isolate entries sharing a composition`,
    `<b>Subsystem coverage</b>: grid of binary element pairs with entry counts`,
    `<b>CSV/JSON export</b>: download table data`,
  ]
  const side_by_side_features = [
    `<b><code>layout="side-by-side"</code></b>: stats and table visible simultaneously, no toggle needed`,
  ]
  const highlighted_features = [
    `<b>API</b>: <code>highlighted_entries</code> + <code>highlight_style</code> (pulse/glow effect, color, size multiplier) on 2D, 3D and 4D`,
  ]
  const magnetic_features = [
    `<b>Shape-coded orderings</b>: entries with <code>magnetic_ordering</code> render as △ FM, ◆ FiM, ■ AFM, ● NM (built-in default <code>entry_category</code>)`,
    `<b>Filter toggles</b>: show/hide magnetic subsets via the controls pane (bindable <code>hidden_categories</code>)`,
    `<b>Generic API</b>: pass a custom <code>EntryCategoryConfig</code> to shape-code any classification (right plot: crystallinity; works equally for metal/semiconductor/insulator, defect types, ...)`,
    `<b>Manual override</b>: a per-entry <code>marker</code> field always takes precedence over category shapes`,
  ]
  const temp_features = [
    `<b>Temperature slider</b>: appears when entries include <code>temperatures</code> + <code>free_energies</code> arrays`,
    `<b>Synthetic G(T) data</b>: every composition has an ordered and a high-entropy polymorph, so hull membership shifts with temperature`,
  ]
  const gas_features = [
    `<b>Chemical potential</b>: gas-forming elements (O, N, H, C, F) use μ(T, P) = μ°(T) + k<sub>B</sub>T·ln(P/P₀) / n<sub>atoms</sub> (per-atom convention, P in bar, P₀ = 1 bar)`,
    `<b>Multi-gas support</b>: O<sub>2</sub>, N<sub>2</sub>, H<sub>2</sub>, CO, CO<sub>2</sub>, H<sub>2</sub>O, F<sub>2</sub>`,
  ]
  const quinary_stats_features = [
    `<b>Standalone stats</b>: use <code>ConvexHullStats</code> without rendering a hull`,
    `<b>High-dimensional support</b>: computed via <code>process_hull_for_stats()</code> for systems with 5+ elements`,
  ]

  // === Temperature-dependent G(T) synthetic data ===
  // G(T) ≈ E_0K + entropy_coef * T * 0.0001 - 0.00005 * T * ln(T)
  const temperatures = demo_temperatures // 300-1500K
  type Comp = Record<string, number>
  const make_phase = make_demo_phase

  // Binary Li-Fe: elements + 7 compositions at different x values
  const temp_binary_entries: PhaseData[] = [
    make_phase({ Li: 1 }, 1),
    make_phase({ Fe: 1 }, 2),
    ...[0.25, 0.33, 0.4, 0.5, 0.6, 0.67, 0.75].flatMap((li_fraction, idx) => [
      make_phase({ Li: li_fraction, Fe: 1 - li_fraction }, 10 + idx), // ordered
      make_phase({ Li: li_fraction, Fe: 1 - li_fraction }, 20 + idx, 2), // disordered (high entropy)
    ]),
  ]

  // Ternary Li-Fe-O: elements + binary edges + interior points + polymorphs
  const temp_ternary_entries = create_temp_ternary_entries_li_fe_o()

  // Quaternary Li-Fe-Ni-O: programmatic generation
  const temp_quaternary_entries: PhaseData[] = [
    // Pure elements
    ...[`Li`, `Fe`, `Ni`, `O`].map((element, idx) => make_phase({ [element]: 1 }, idx)),
    // All binary pairs
    ...[
      [`Li`, `Fe`],
      [`Li`, `Ni`],
      [`Li`, `O`],
      [`Fe`, `Ni`],
      [`Fe`, `O`],
      [`Ni`, `O`],
    ].flatMap(([value_a, value_b], idx) => [
      make_phase({ [value_a]: 0.5, [value_b]: 0.5 }, 500 + idx),
      make_phase({ [value_a]: 0.5, [value_b]: 0.5 }, 600 + idx, 2.5),
    ]),
    // Ternary faces (4 faces × 2 polymorphs)
    ...[
      [`Li`, `Fe`, `Ni`],
      [`Li`, `Fe`, `O`],
      [`Li`, `Ni`, `O`],
      [`Fe`, `Ni`, `O`],
    ].flatMap(([value_a, value_b, value_c], idx) => [
      make_phase({ [value_a]: 0.33, [value_b]: 0.33, [value_c]: 0.34 }, 700 + idx),
      make_phase({ [value_a]: 0.33, [value_b]: 0.33, [value_c]: 0.34 }, 800 + idx, 3.5),
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
    free_energies: temperatures.map(
      (temperature_2) => energy - entropy * (temperature_2 - 300) * 0.001,
    ),
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

<h1 id="convex-hulls">Convex Hulls</h1>
{#each primary_systems as system (system)}
  {#if primary_errors.has(system)}
    <p role="alert">Failed to load {system} subset examples: {primary_errors.get(system)}</p>
  {:else if !primary_data.has(system)}
    <p role="status">Loading {system} subset examples…</p>
  {/if}
{/each}

<div class="full-bleed">
  {#snippet feature_list(feature_items: string[])}
    <ul class="feature-list">
      {#each feature_items as feature_item (feature_item)}
        <li>
          <!-- svelte-ignore hydration_html_changed -->
          {@html sanitize_html(feature_item)}
        </li>
      {/each}
    </ul>
  {/snippet}

  <section class="demo-section">
    <h2 id="ternary-chemical-systems">Ternary Chemical Systems</h2>
    <LazyDemo label="Ternary Chemical Systems">
      <div class="ternary-grid">
        {#each ternary_examples as { title, entries } (title)}
          <ConvexHull {entries} controls={{ title }} />
        {/each}
      </div>
    </LazyDemo>
  </section>

  <section class="demo-section">
    <h2 id="quaternary-chemical-systems">Quaternary Chemical Systems</h2>
    {@render feature_list(quaternary_features)}
    <div class="quaternary-grid">
      {#each Object.entries(quaternary_files) as [path, loader] (path)}
        {@const title = hull_system_name(path)}
        <LazyDemo label={title}>
          {#await loader()}
            <p role="status">Loading {title}…</p>
          {:then { default: entries }}
            <ConvexHull
              entries={entries_map.get(path) ?? entries}
              controls={{ title }}
              on_file_drop={(dropped) => entries_map.set(path, dropped)}
            />
          {:catch error}
            <p role="alert">Failed to load {title}: {String(error)}</p>
          {/await}
        </LazyDemo>
      {/each}
    </div>
  </section>

  <section class="demo-section">
    <h2 id="binary-chemical-systems">Binary Chemical Systems</h2>
    <div class="binary-grid">
      {#each binary_examples as { title, entries } (title)}
        {#if entries.length}
          <LazyDemo label={title}>
            <ConvexHull {entries} controls={{ title }} style="height: 500px" />
          </LazyDemo>
        {/if}
      {/each}
    </div>
  </section>

  <section class="demo-section">
    <h2 id="statistics-panel">Statistics Panel</h2>
    <p>
      Use <code>bind:this</code> to access the renderer, then derive
      <code>renderer?.get_model()</code> for an external statistics panel. The model contains all
      phases; the built-in info pane follows the plot’s visibility threshold.
    </p>
    {@render feature_list(stats_features)}
    <LazyDemo label="Statistics Panel">
      <div class="stats-example-grid">
        <ConvexHull
          entries={na_fe_o_entries}
          controls={{ title: `Na-Fe-O with Stats` }}
          bind:this={stats_hull}
          bind:max_hull_dist_show_phases
          style="height: 100%"
        />
        {#if model}
          <ConvexHullStats
            {model}
            highlighted_entry_id={clicked_entry_id}
            on_entry_click={(entry) => (clicked_entry_id = entry.entry_id)}
            entry_href={get_entry_href}
            style="--hull-stats-max-height: var(--hull-height, 500px)"
          />
        {/if}
      </div>
    </LazyDemo>

    <h3 id="side-by-side-layout">Side-by-Side Layout</h3>
    {@render feature_list(side_by_side_features)}
    <LazyDemo label="Side-by-Side Layout">
      <div class="side-by-side-example">
        <ConvexHull
          entries={li_co_ni_o_data}
          controls={{ title: `Li-Co-O` }}
          bind:this={side_hull}
        />
        {#if side_model}
          <ConvexHullStats
            model={side_model}
            layout="side-by-side"
            entry_href={get_entry_href}
            style="--hull-stats-padding: 0"
          />
        {/if}
      </div>
    </LazyDemo>
  </section>

  <section class="demo-section">
    <h2 id="highlighted-entries">Highlighted Entries</h2>
    {@render feature_list(highlighted_features)}
    <div class="highlight-grid">
      <LazyDemo label="Highlighted Entries">
        <ConvexHull
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
      </LazyDemo>
      <LazyDemo label="Highlighted Entries">
        <ConvexHull
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
      </LazyDemo>
      <LazyDemo label="Highlighted Entries">
        <ConvexHull
          entries={li_co_ni_o_quaternary}
          controls={{ title: `Li-Co-Ni-O (${highlighted_li_co_ni_o.length} highlighted)` }}
          highlighted_entries={highlighted_li_co_ni_o}
          highlight_style={{ effect: `glow`, color: `#ff8800`, size_multiplier: 2 }}
        />
      </LazyDemo>
    </div>
  </section>

  <section class="demo-section">
    <h2 id="magnetic-states-custom-categories">Magnetic States & Custom Categories</h2>
    {@render feature_list(magnetic_features)}
    <p class="section-note">
      Synthetic orderings are assigned by entry-ID hash. Missing pure-element references are
      added with E<sub>form</sub> = 0 eV/atom.
    </p>
    <LazyDemo label="Magnetic States & Custom Categories">
      <div class="ternary-grid">
        <div>
          <div class="marker-legend">
            {#each magnetic_marker_legend as item (item)}<span>{item}</span>{/each}
          </div>
          <ConvexHull
            entries={magnetic_ternary_entries}
            controls={{ title: `Na-Fe-O Magnetic Orderings` }}
          />
        </div>
        <div>
          <div class="marker-legend">
            {#each crystallinity_marker_legend as item (item)}<span>{item}</span>{/each}
          </div>
          <ConvexHull
            entries={crystallinity_entries}
            entry_category={crystallinity_category}
            controls={{ title: `Co-O Crystallinity (custom entry_category)` }}
            style="height: 100%"
          />
        </div>
      </div>
    </LazyDemo>
  </section>

  <section class="demo-section">
    <h2 id="temperature-dependent-free-energies">Temperature-Dependent Free Energies</h2>
    {@render feature_list(temp_features)}
    <div class="temp-grid">
      <LazyDemo label="Temperature-Dependent Free Energies">
        <ConvexHull
          entries={temp_binary_entries}
          controls={{ title: `Li-Fe with G(T)` }}
          style="height: 500px"
        />
      </LazyDemo>
      <LazyDemo label="Temperature-Dependent Free Energies">
        <ConvexHull entries={temp_ternary_entries} controls={{ title: `Li-Fe-O with G(T)` }} />
      </LazyDemo>
      <LazyDemo label="Temperature-Dependent Free Energies">
        <ConvexHull
          entries={temp_quaternary_entries}
          controls={{ title: `Li-Fe-Ni-O with G(T)` }}
        />
      </LazyDemo>
    </div>
  </section>

  <section class="demo-section">
    <h2 id="gas-atmosphere-control">Gas Atmosphere Control</h2>
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
      <LazyDemo label="Gas Atmosphere Control">
        <ConvexHull
          entries={gas_demo_fe_o_entries}
          controls={{ title: `Fe-O with ${selected_demo_gas} Pressure` }}
          gas_config={gas_demo_config}
          bind:gas_pressures={gas_demo_pressures}
          style="height: 500px"
        />
      </LazyDemo>
      <LazyDemo label="Gas Atmosphere Control">
        <ConvexHull
          entries={gas_demo_ternary_entries}
          controls={{ title: `Fe-Ni-O with ${selected_demo_gas} Pressure` }}
          gas_config={gas_demo_config}
          bind:gas_pressures={gas_demo_pressures}
        />
      </LazyDemo>
    </div>
  </section>

  <section class="demo-section">
    <h2 id="standalone-stats-for-quinary-systems">Standalone Stats for Quinary Systems</h2>
    {@render feature_list(quinary_stats_features)}
    <div class="quinary-stats-controls">
      <label for="quinary-select">Quinary dataset:</label>
      <select id="quinary-select" bind:value={selected_quinary_path}>
        {#each quinary_paths as path (path)}
          <option value={path}>{hull_system_name(path)}</option>
        {/each}
      </select>
    </div>
    <LazyDemo label="Quinary statistics">
      {#await quinary_files[selected_quinary_path]()}
        <p role="status">Loading quinary data…</p>
      {:then { default: entries }}
        {@const quinary_model = process_hull_for_stats(entries)}
        {#if quinary_model}
          <ConvexHullStats
            model={quinary_model}
            layout="side-by-side"
            style="width: min(100%, 980px); margin: 0 auto 2rem"
          />
        {/if}
      {:catch error}
        <p role="alert">Failed to load {selected_quinary_path}: {String(error)}</p>
      {/await}
    </LazyDemo>
  </section>
</div>

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
