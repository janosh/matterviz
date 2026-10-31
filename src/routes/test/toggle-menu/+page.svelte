<script lang="ts">
  import { HeatmapTable, TABLE_EXPORT_FORMATS } from '#lib/table/index.js'
  import type { Column } from '#lib/table/index.js'
  import { sanitize_html } from '#lib/sanitize.js'
  import { ColumnPicker } from 'svelte-widgets/table'
  import TestSection from '../TestSection.svelte'
  import TestStatus from '../TestStatus.svelte'

  // Grouped columns get id `${key} (${group})`
  const group_cols = (group: string, entries: [string, string, string?][]): Column[] =>
    entries.map(([key, label, description]) => ({
      id: `${key} (${group})`,
      key,
      label,
      group,
      description,
    }))

  type Menu = {
    title: string
    description: string
    columns: Column[]
    open: boolean
    collapsed: string[]
    wide?: boolean
  }
  // One ColumnPicker card per entry, each bound to its own columns, open and collapsed state
  let menus: Record<string, Menu> = $state({
    basic: {
      title: `Basic flat list`,
      description: `No groups: a simple grid of toggles.`,
      columns: [
        { id: `name`, label: `Name`, description: `Person's full name` },
        { id: `age`, label: `Age`, description: `Age in years` },
        { id: `email`, label: `Email`, description: `Contact email address` },
        { id: `phone`, label: `Phone`, description: `Phone number` },
        { id: `address`, label: `Address`, description: `Home address` },
      ],
      open: false,
      collapsed: [],
    },
    grouped: {
      title: `Grouped sections`,
      description: `Columns grouped by category with collapsible section headers.`,
      columns: [
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
      ],
      open: false,
      collapsed: [],
    },
    disabled: {
      title: `Disabled items`,
      description: `Some toggles are disabled and cannot be changed. Hover for tooltips.`,
      columns: [
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
      ],
      open: false,
      collapsed: [],
    },
    html: {
      title: `HTML labels`,
      description: `Labels support HTML for subscripts, superscripts, etc.`,
      columns: [
        ...group_cols(`Chemistry`, [
          [`h2o`, `H<sub>2</sub>O`, `Water molecule`],
          [`co2`, `CO<sub>2</sub>`, `Carbon dioxide`],
        ]),
        ...group_cols(`Physics`, [[`emc2`, `E=mc<sup>2</sup>`, `Mass-energy equivalence`]]),
        ...group_cols(`Math`, [
          [`x2y2`, `x<sup>2</sup>+y<sup>2</sup>`, `Pythagorean components`],
        ]),
      ],
      open: false,
      collapsed: [],
    },
    pre_collapsed: {
      title: `Pre-collapsed sections`,
      description: `Some sections start collapsed (Group B and D).`,
      columns: Object.entries({ A: 2, B: 3, C: 1, D: 2 }).flatMap(([letter, count]) =>
        group_cols(
          `Group ${letter}`,
          Array.from({ length: count }, (_, idx): [string, string] => [
            `${letter.toLowerCase()}${idx + 1}`,
            `${letter}${idx + 1}`,
          ]),
        ),
      ),
      open: false,
      collapsed: [`Group B`, `Group D`],
    },
    multicolumn: {
      title: `Multi-column sections`,
      description: `Each section header spans the full width and its items wrap into up to 3 columns.`,
      columns: Object.entries({
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
      open: false,
      collapsed: [],
      wide: true,
    },
  })

  let table_columns: Column[] = $state([
    { id: `Name`, label: `Name` },
    { id: `Score`, label: `Score`, color_scale: `interpolateViridis` },
  ])
  let show_heatmap = $state(false)
  let heatmap_opacity = $state(0.5)
  let show_row_numbers = $state(true)
  let column_prefs = $state({ Score: { color_scale: null, width: 120 } })

  const labels = (columns: Column[], keep: (col: Column) => boolean | undefined) =>
    columns
      .filter(keep)
      .map((col) => col.label)
      .join(`, `) || `none`
  const list = (items: string[]) => items.join(`, `) || `none`

  // e2e waits on this: SSR buttons are clickable before their handlers exist
  let hydrated = $state(false)
  $effect(() => {
    hydrated = true
  })
</script>

<h1 data-hydrated={hydrated}>ColumnPicker test page</h1>

<TestSection title="Table controls" id="table-controls">
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
    export_formats={TABLE_EXPORT_FORMATS}
    show_column_toggle
    show_row_select
    row_key="Name"
    pagination={{ page_size: 2, page_sizes: [1, 2, 3] }}
  />
</TestSection>

<div class="demo-grid">
  {#each Object.entries(menus) as [key, menu] (key)}
    <TestSection
      title={menu.title}
      description={menu.description}
      style={menu.wide ? `grid-column: 1 / -1` : undefined}
    >
      <!-- labels carry sub/superscript markup -->
      <ColumnPicker
        bind:columns={menu.columns}
        bind:open={menu.open}
        bind:collapsed_groups={menu.collapsed}
      >
        {#snippet toggle_label({ column })}{@html sanitize_html(column.label)}{/snippet}
      </ColumnPicker>
    </TestSection>
  {/each}
</div>

<TestStatus
  values={{
    'basic-visible': labels(menus.basic.columns, (col) => col.visible !== false),
    'grouped-collapsed': list(menus.grouped.collapsed),
    'disabled-items': labels(menus.disabled.columns, (col) => col.disabled),
    'pre-collapsed': list(menus.pre_collapsed.collapsed),
    'multicolumn-collapsed': list(menus.multicolumn.collapsed),
  }}
/>

<style>
  .demo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 20px;
    & > :global(section) {
      margin: 0;
    }
  }
</style>
