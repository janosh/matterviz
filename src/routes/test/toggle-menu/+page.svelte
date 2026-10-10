<script lang="ts">
  import { HeatmapTable, ToggleMenu } from '#lib/table/index.js'
  import type { Column } from '#lib/table/index.js'

  // === Example 1: Basic flat list (no groups) ===
  let basic_columns: Column[] = $state([
    { id: `name`, label: `Name`, description: `Person's full name` },
    { id: `age`, label: `Age`, description: `Age in years` },
    { id: `email`, label: `Email`, description: `Contact email address` },
    { id: `phone`, label: `Phone`, description: `Phone number` },
    { id: `address`, label: `Address`, description: `Home address` },
  ])
  let basic_open = $state(false)

  // Grouped columns get id `${key} (${group})`
  const group_cols = (group: string, entries: [string, string, string?][]): Column[] =>
    entries.map(([key, label, description]) => ({
      id: `${key} (${group})`,
      key,
      label,
      group,
      description,
    }))

  // === Example 2: Grouped columns ===
  let grouped_columns: Column[] = $state([
    ...group_cols(`Personal`, [
      [`name`, `Name`, `Full name`],
      [`age`, `Age`, `Age in years`],
      [`gender`, `Gender`, `Gender identity`],
    ]),
    ...group_cols(`Contact`, [
      [`email`, `Email`, `Email address`],
      [`phone`, `Phone`, `Phone number`],
    ]),
    ...group_cols(`Work`, [
      [`company`, `Company`, `Employer name`],
      [`title`, `Title`, `Job title`],
      [`salary`, `Salary`, `Annual salary`],
    ]),
    { id: `notes`, label: `Notes`, description: `Additional notes (ungrouped)` },
  ])
  let grouped_open = $state(false)
  let grouped_collapsed: string[] = $state([])

  // === Example 3: With disabled items ===
  let disabled_columns: Column[] = $state([
    { id: `enabled1`, label: `Enabled 1`, description: `This toggle is enabled` },
    {
      id: `disabled1`,
      key: `disabled1`,
      label: `Disabled 1`,
      description: `This toggle is disabled`,
      disabled: true,
    },
    { id: `enabled2`, label: `Enabled 2`, description: `Another enabled toggle` },
    {
      id: `disabled2`,
      key: `disabled2`,
      label: `Disabled 2`,
      description: `Another disabled toggle`,
      disabled: true,
      visible: false,
    },
    {
      id: `enabled3`,
      key: `enabled3`,
      label: `Enabled 3`,
      description: `Yet another enabled toggle`,
    },
  ])
  let disabled_open = $state(false)

  // === Example 4: HTML labels with subscripts/superscripts ===
  let html_columns: Column[] = $state([
    ...group_cols(`Chemistry`, [
      [`h2o`, `H<sub>2</sub>O`, `Water molecule`],
      [`co2`, `CO<sub>2</sub>`, `Carbon dioxide`],
    ]),
    ...group_cols(`Physics`, [[`emc2`, `E=mc<sup>2</sup>`, `Mass-energy equivalence`]]),
    ...group_cols(`Math`, [[`x2y2`, `x<sup>2</sup>+y<sup>2</sup>`, `Pythagorean components`]]),
  ])
  let html_open = $state(false)
  let html_collapsed: string[] = $state([])

  // === Example 5: Many groups with pre-collapsed ===
  let many_groups_columns: Column[] = $state(
    Object.entries({ A: 2, B: 3, C: 1, D: 2 }).flatMap(([letter, count]) =>
      group_cols(
        `Group ${letter}`,
        Array.from({ length: count }, (_, idx): [string, string] => [
          `${letter.toLowerCase()}${idx + 1}`,
          `${letter}${idx + 1}`,
        ]),
      ),
    ),
  )
  let many_groups_open = $state(false)
  let many_groups_collapsed: string[] = $state([`Group B`, `Group D`])

  // === Example 6: Multi-column sections ===
  let multicolumn_columns: Column[] = $state(
    Object.entries({
      'Alkali Metals': `Li Lithium,Na Sodium,K Potassium,Rb Rubidium,Cs Cesium,Fr Francium`,
      'Alkaline Earth': `Be Beryllium,Mg Magnesium,Ca Calcium,Sr Strontium,Ba Barium,Ra Radium`,
      'Transition Metals': `Sc Scandium,Ti Titanium,V Vanadium,Cr Chromium,Mn Manganese,Fe Iron,Co Cobalt,Ni Nickel,Cu Copper,Zn Zinc`,
    }).flatMap(([group, elements]) =>
      group_cols(
        group,
        elements.split(`,`).map((entry): [string, string] => {
          const [symbol, name] = entry.split(` `)
          return [symbol.toLowerCase(), name]
        }),
      ),
    ),
  )
  let multicolumn_open = $state(false)
  let multicolumn_collapsed: string[] = $state([])

  let table_columns: Column[] = $state([
    { id: `Name`, label: `Name` },
    { id: `Score`, label: `Score`, color_scale: `interpolateViridis` },
  ])
  let show_heatmap = $state(false)
  let heatmap_opacity = $state(0.5)
  let show_row_numbers = $state(true)
  let column_prefs = $state({ Score: { color_scale: null, width: 120 } })

  // Derive visibility counts for display (reactive without effects)
  let basic_visible = $derived(
    basic_columns
      .filter((col) => col.visible !== false)
      .map((col) => col.label)
      .join(`, `) || `none`,
  )

  // e2e waits on this: SSR buttons are clickable before their handlers exist
  let hydrated = $state(false)
  $effect(() => {
    hydrated = true
  })
</script>

<svelte:head>
  <title>ToggleMenu Demo</title>
</svelte:head>

<h1 id="togglemenu-component-demo" data-hydrated={hydrated}>ToggleMenu Component Demo</h1>
<p>
  A flexible toggle menu supporting grouped sections, collapsible headers, and disabled states.
</p>

<section id="table-controls">
  <h2>Table controls</h2>
  <HeatmapTable
    data={[
      { Name: `Alpha`, Score: 3 },
      { Name: `Beta`, Score: 1 },
      { Name: `Gamma`, Score: 2 },
    ]}
    columns={table_columns}
    bind:show_heatmap
    bind:heatmap_opacity
    {show_row_numbers}
    bind:column_prefs
    show_controls="always"
    search
    export_data
    show_column_toggle
    show_row_select
    row_key="Name"
    pagination={{ page_size: 2, page_sizes: [1, 2, 3] }}
  />
</section>

<section class="demo-grid">
  <div class="demo-card">
    <h2 id="1-basic-flat-list">1. Basic Flat List</h2>
    <p>No groups - displays as a simple grid of toggles.</p>
    <div class="demo-container">
      <ToggleMenu bind:columns={basic_columns} bind:column_panel_open={basic_open} />
    </div>
    <div class="state-display">
      <strong>Visible:</strong>
      {basic_visible}
    </div>
  </div>

  <div class="demo-card">
    <h2 id="2-grouped-sections">2. Grouped Sections</h2>
    <p>Columns grouped by category with collapsible section headers.</p>
    <div class="demo-container">
      <ToggleMenu
        bind:columns={grouped_columns}
        bind:column_panel_open={grouped_open}
        bind:collapsed_sections={grouped_collapsed}
      />
    </div>
    <div class="state-display">
      <strong>Collapsed sections:</strong>
      {grouped_collapsed.join(`, `) || `none`}
    </div>
  </div>

  <div class="demo-card">
    <h2 id="3-with-disabled-items">3. With Disabled Items</h2>
    <p>Some toggles are disabled and cannot be changed. Hover for tooltips.</p>
    <div class="demo-container">
      <ToggleMenu bind:columns={disabled_columns} bind:column_panel_open={disabled_open} />
    </div>
    <div class="state-display">
      <strong>Disabled:</strong>
      {disabled_columns
        .filter((col) => col.disabled)
        .map((col) => col.label)
        .join(`, `) || `none`}
    </div>
  </div>

  <div class="demo-card">
    <h2 id="4-html-labels">4. HTML Labels</h2>
    <p>Labels support HTML for subscripts, superscripts, etc.</p>
    <div class="demo-container">
      <ToggleMenu
        bind:columns={html_columns}
        bind:column_panel_open={html_open}
        bind:collapsed_sections={html_collapsed}
      />
    </div>
  </div>

  <div class="demo-card">
    <h2 id="5-pre-collapsed-sections">5. Pre-collapsed Sections</h2>
    <p>Some sections start collapsed (Group B and D).</p>
    <div class="demo-container">
      <ToggleMenu
        bind:columns={many_groups_columns}
        bind:column_panel_open={many_groups_open}
        bind:collapsed_sections={many_groups_collapsed}
      />
    </div>
    <div class="state-display">
      <strong>Collapsed:</strong>
      {many_groups_collapsed.join(`, `) || `none`}
    </div>
  </div>

  <div class="demo-card wide">
    <h2 id="6-multi-column-sections">6. Multi-column Sections</h2>
    <p>Each section header spans the full width and its items wrap into up to 3 columns.</p>
    <div class="demo-container">
      <ToggleMenu
        bind:columns={multicolumn_columns}
        bind:column_panel_open={multicolumn_open}
        bind:collapsed_sections={multicolumn_collapsed}
      />
    </div>
    <div class="state-display">
      <strong>Collapsed:</strong>
      {multicolumn_collapsed.join(`, `) || `none`}
    </div>
  </div>
</section>

<style>
  h1 {
    margin-bottom: 0.5em;
  }
  h1 + p {
    color: var(--text-muted);
    margin-bottom: 2em;
  }
  .demo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 20px;
    margin-bottom: 30px;
  }
  .demo-card {
    background: var(--page-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
  }
  .demo-card.wide {
    grid-column: 1 / -1;
  }
  .demo-card h2 {
    margin: 0 0 8px;
    font-size: 1.1em;
  }
  .demo-card > p {
    color: var(--text-muted);
    font-size: 0.9em;
    margin: 0 0 12px;
  }
  .demo-container {
    display: flex;
    min-height: 40px;
  }
  .state-display {
    margin-top: 12px;
    padding: 8px;
    background: var(--nav-bg);
    border-radius: 4px;
    font-size: 0.85em;
    font-family: monospace;
  }
</style>
