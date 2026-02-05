<script lang="ts">
  import { ToggleMenu } from '$lib/table'
  import type { Label } from '$lib/table'

  // === Example 1: Basic flat list (no groups) ===
  let basic_columns: Label[] = $state([
    { key: `name`, label: `Name`, description: `Person's full name` },
    { key: `age`, label: `Age`, description: `Age in years` },
    { key: `email`, label: `Email`, description: `Contact email address` },
    { key: `phone`, label: `Phone`, description: `Phone number` },
    { key: `address`, label: `Address`, description: `Home address` },
  ])
  let basic_open = $state(false)

  // === Example 2: Grouped columns (horizontal layout) ===
  let grouped_columns: Label[] = $state([
    { key: `name`, label: `Name`, group: `Personal`, description: `Full name` },
    { key: `age`, label: `Age`, group: `Personal`, description: `Age in years` },
    {
      key: `gender`,
      label: `Gender`,
      group: `Personal`,
      description: `Gender identity`,
    },
    { key: `email`, label: `Email`, group: `Contact`, description: `Email address` },
    { key: `phone`, label: `Phone`, group: `Contact`, description: `Phone number` },
    { key: `company`, label: `Company`, group: `Work`, description: `Employer name` },
    { key: `title`, label: `Title`, group: `Work`, description: `Job title` },
    { key: `salary`, label: `Salary`, group: `Work`, description: `Annual salary` },
    { key: `notes`, label: `Notes`, description: `Additional notes (ungrouped)` },
  ])
  let grouped_open = $state(false)
  let grouped_collapsed: string[] = $state([])

  // === Example 3: Vertical layout ===
  let vertical_columns: Label[] = $state([
    {
      key: `width`,
      label: `Width`,
      group: `Dimensions`,
      description: `Width in pixels`,
    },
    {
      key: `height`,
      label: `Height`,
      group: `Dimensions`,
      description: `Height in pixels`,
    },
    {
      key: `depth`,
      label: `Depth`,
      group: `Dimensions`,
      description: `Depth in pixels`,
    },
    { key: `red`, label: `Red`, group: `Colors`, description: `Red channel` },
    { key: `green`, label: `Green`, group: `Colors`, description: `Green channel` },
    { key: `blue`, label: `Blue`, group: `Colors`, description: `Blue channel` },
    {
      key: `alpha`,
      label: `Alpha`,
      group: `Colors`,
      description: `Alpha/transparency`,
    },
    { key: `bold`, label: `Bold`, group: `Font`, description: `Bold text` },
    { key: `italic`, label: `Italic`, group: `Font`, description: `Italic text` },
    {
      key: `underline`,
      label: `Underline`,
      group: `Font`,
      description: `Underlined text`,
    },
  ])
  let vertical_open = $state(false)
  let vertical_collapsed: string[] = $state([])

  // === Example 4: With disabled items ===
  let disabled_columns: Label[] = $state([
    { key: `enabled1`, label: `Enabled 1`, description: `This toggle is enabled` },
    {
      key: `disabled1`,
      label: `Disabled 1`,
      description: `This toggle is disabled`,
      disabled: true,
    },
    { key: `enabled2`, label: `Enabled 2`, description: `Another enabled toggle` },
    {
      key: `disabled2`,
      label: `Disabled 2`,
      description: `Another disabled toggle`,
      disabled: true,
      visible: false,
    },
    {
      key: `enabled3`,
      label: `Enabled 3`,
      description: `Yet another enabled toggle`,
    },
  ])
  let disabled_open = $state(false)

  // === Example 5: Fixed column count ===
  let fixed_columns: Label[] = $state([
    { key: `col1`, label: `Col 1` },
    { key: `col2`, label: `Col 2` },
    { key: `col3`, label: `Col 3` },
    { key: `col4`, label: `Col 4` },
    { key: `col5`, label: `Col 5` },
    { key: `col6`, label: `Col 6` },
    { key: `col7`, label: `Col 7` },
    { key: `col8`, label: `Col 8` },
  ])
  let fixed_open = $state(false)

  // === Example 6: HTML labels with subscripts/superscripts ===
  let html_columns: Label[] = $state([
    {
      key: `h2o`,
      label: `H<sub>2</sub>O`,
      group: `Chemistry`,
      description: `Water molecule`,
    },
    {
      key: `co2`,
      label: `CO<sub>2</sub>`,
      group: `Chemistry`,
      description: `Carbon dioxide`,
    },
    {
      key: `emc2`,
      label: `E=mc<sup>2</sup>`,
      group: `Physics`,
      description: `Mass-energy equivalence`,
    },
    {
      key: `x2y2`,
      label: `x<sup>2</sup>+y<sup>2</sup>`,
      group: `Math`,
      description: `Pythagorean components`,
    },
  ])
  let html_open = $state(false)
  let html_collapsed: string[] = $state([])

  // === Example 7: Many groups with pre-collapsed ===
  let many_groups_columns: Label[] = $state([
    { key: `a1`, label: `A1`, group: `Group A` },
    { key: `a2`, label: `A2`, group: `Group A` },
    { key: `b1`, label: `B1`, group: `Group B` },
    { key: `b2`, label: `B2`, group: `Group B` },
    { key: `b3`, label: `B3`, group: `Group B` },
    { key: `c1`, label: `C1`, group: `Group C` },
    { key: `d1`, label: `D1`, group: `Group D` },
    { key: `d2`, label: `D2`, group: `Group D` },
  ])
  let many_groups_open = $state(false)
  let many_groups_collapsed: string[] = $state([`Group B`, `Group D`])

  // === Example 8: Multi-column sections (horizontal layout with n_columns) ===
  let multicolumn_columns: Label[] = $state([
    { key: `li`, label: `Lithium`, group: `Alkali Metals` },
    { key: `na`, label: `Sodium`, group: `Alkali Metals` },
    { key: `k`, label: `Potassium`, group: `Alkali Metals` },
    { key: `rb`, label: `Rubidium`, group: `Alkali Metals` },
    { key: `cs`, label: `Cesium`, group: `Alkali Metals` },
    { key: `fr`, label: `Francium`, group: `Alkali Metals` },
    { key: `be`, label: `Beryllium`, group: `Alkaline Earth` },
    { key: `mg`, label: `Magnesium`, group: `Alkaline Earth` },
    { key: `ca`, label: `Calcium`, group: `Alkaline Earth` },
    { key: `sr`, label: `Strontium`, group: `Alkaline Earth` },
    { key: `ba`, label: `Barium`, group: `Alkaline Earth` },
    { key: `ra`, label: `Radium`, group: `Alkaline Earth` },
    { key: `sc`, label: `Scandium`, group: `Transition Metals` },
    { key: `ti`, label: `Titanium`, group: `Transition Metals` },
    { key: `v`, label: `Vanadium`, group: `Transition Metals` },
    { key: `cr`, label: `Chromium`, group: `Transition Metals` },
    { key: `mn`, label: `Manganese`, group: `Transition Metals` },
    { key: `fe`, label: `Iron`, group: `Transition Metals` },
    { key: `co`, label: `Cobalt`, group: `Transition Metals` },
    { key: `ni`, label: `Nickel`, group: `Transition Metals` },
    { key: `cu`, label: `Copper`, group: `Transition Metals` },
    { key: `zn`, label: `Zinc`, group: `Transition Metals` },
  ])
  let multicolumn_open = $state(false)
  let multicolumn_collapsed: string[] = $state([])

  // === Example 9: Vertical with n_columns (demonstrates n_columns ignored in vertical) ===
  let ex9_columns: Label[] = $state([
    { key: `width`, label: `Width`, group: `Dimensions` },
    { key: `height`, label: `Height`, group: `Dimensions` },
    { key: `depth`, label: `Depth`, group: `Dimensions` },
    { key: `red`, label: `Red`, group: `Colors` },
    { key: `green`, label: `Green`, group: `Colors` },
    { key: `blue`, label: `Blue`, group: `Colors` },
  ])
  let ex9_open = $state(false)

  // Derive visibility counts for display (reactive without effects)
  let basic_visible = $derived(
    basic_columns.filter((c) => c.visible !== false).map((c) => c.label).join(`, `) ||
      `none`,
  )
</script>

<svelte:head>
  <title>ToggleMenu Demo</title>
</svelte:head>

<h1>ToggleMenu Component Demo</h1>
<p>
  A flexible toggle menu supporting grouped sections, collapsible headers,
  horizontal/vertical layouts, and disabled states.
</p>

<section class="demo-grid">
  <div class="demo-card">
    <h2>1. Basic Flat List</h2>
    <p>No groups - displays as a simple grid of toggles.</p>
    <div class="demo-container">
      <ToggleMenu bind:columns={basic_columns} bind:column_panel_open={basic_open} />
    </div>
    <div class="state-display">
      <strong>Visible:</strong> {basic_visible}
    </div>
  </div>

  <div class="demo-card">
    <h2>2. Grouped (Horizontal Layout)</h2>
    <p>Columns grouped by category with collapsible section headers.</p>
    <div class="demo-container">
      <ToggleMenu
        bind:columns={grouped_columns}
        bind:column_panel_open={grouped_open}
        bind:collapsed_sections={grouped_collapsed}
        layout="horizontal"
      />
    </div>
    <div class="state-display">
      <strong>Collapsed sections:</strong> {grouped_collapsed.join(`, `) || `none`}
    </div>
  </div>

  <div class="demo-card">
    <h2>3. Grouped (Vertical Layout)</h2>
    <p>Sections displayed side-by-side as columns, toggles stack vertically.</p>
    <div class="demo-container">
      <ToggleMenu
        bind:columns={vertical_columns}
        bind:column_panel_open={vertical_open}
        bind:collapsed_sections={vertical_collapsed}
        layout="vertical"
      />
    </div>
    <div class="state-display">
      <strong>Collapsed sections:</strong> {vertical_collapsed.join(`, `) || `none`}
    </div>
  </div>

  <div class="demo-card">
    <h2>4. With Disabled Items</h2>
    <p>Some toggles are disabled and cannot be changed. Hover for tooltips.</p>
    <div class="demo-container">
      <ToggleMenu
        bind:columns={disabled_columns}
        bind:column_panel_open={disabled_open}
      />
    </div>
    <div class="state-display">
      <strong>Disabled:</strong>
      {
        disabled_columns.filter((c) => c.disabled).map((c) => c.label).join(
          `, `,
        ) || `none`
      }
    </div>
  </div>

  <div class="demo-card">
    <h2>5. Fixed Column Count (n_columns=4)</h2>
    <p>Force exactly 4 columns regardless of container width.</p>
    <div class="demo-container">
      <ToggleMenu
        bind:columns={fixed_columns}
        bind:column_panel_open={fixed_open}
        n_columns={4}
      />
    </div>
  </div>

  <div class="demo-card">
    <h2>6. HTML Labels</h2>
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
    <h2>7. Pre-collapsed Sections</h2>
    <p>Some sections start collapsed (Group B and D).</p>
    <div class="demo-container">
      <ToggleMenu
        bind:columns={many_groups_columns}
        bind:column_panel_open={many_groups_open}
        bind:collapsed_sections={many_groups_collapsed}
      />
    </div>
    <div class="state-display">
      <strong>Collapsed:</strong> {many_groups_collapsed.join(`, `) || `none`}
    </div>
  </div>

  <div class="demo-card wide">
    <h2>8. Multi-column Sections</h2>
    <p>
      Horizontal layout with n_columns=3. Each section header spans the full width, items
      fill a 3-column grid below it.
    </p>
    <div class="demo-container">
      <ToggleMenu
        bind:columns={multicolumn_columns}
        bind:column_panel_open={multicolumn_open}
        bind:collapsed_sections={multicolumn_collapsed}
        n_columns={3}
      />
    </div>
    <div class="state-display">
      <strong>Collapsed:</strong> {multicolumn_collapsed.join(`, `) || `none`}
    </div>
  </div>

  <div class="demo-card wide">
    <h2>9. Vertical with Fixed Columns (n_columns ignored)</h2>
    <p>
      In vertical layout, n_columns is ignored - each section is a single column of
      stacked toggles.
    </p>
    <div class="demo-container">
      <ToggleMenu
        bind:columns={ex9_columns}
        bind:column_panel_open={ex9_open}
        layout="vertical"
        n_columns={3}
      />
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
