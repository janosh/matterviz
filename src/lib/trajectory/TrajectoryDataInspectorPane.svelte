<script lang="ts">
  import { StatusMessage } from '$lib/feedback'
  import { format_num, trajectory_property_config } from '$lib/labels'
  import { ViewerPane, type ViewerPaneOptions } from '$lib/overlays'
  import { type CellVal, HeatmapTable, type Label, type RowData } from '$lib/table'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import { Tabs } from 'svelte-widgets'
  import { HeatmapTable as HeatmapTableIcon } from 'svelte-widgets/icons'
  import type { TrajectoryFrame, TrajectoryMetadata, TrajectoryRun } from './index'

  let {
    run,
    current_step_idx = 0,
    current_frame = null,
    property_rows,
    properties_complete,
    on_step_change,
    on_site_select,
    pane_open = $bindable(false),
    ...pane_options
  }: ViewerPaneOptions & {
    run?: TrajectoryRun
    // Session-mirrored: run.properties is rune-free (see run.ts). Fallback for standalone mounts.
    property_rows?: readonly TrajectoryMetadata[]
    properties_complete?: boolean
    current_step_idx?: number
    // Resolved frame for the atom tab. Lazy runs load frames on demand.
    current_frame?: TrajectoryFrame | null
    on_step_change?: (frame_idx: number) => void
    on_site_select?: (site_idx: number) => void
    pane_open?: boolean
  } = $props()

  // Per-frame scalars vs per-atom rows
  let active_tab = $state<`frames` | `atoms`>(`frames`)

  const VEC3_AXES = [`x`, `y`, `z`] as const
  const FRAC_AXES = [`a`, `b`, `c`] as const

  // Units for per-atom properties the parsers emit. trajectory_property_config covers
  // per-frame scalars only (force_max, energy, …), never the per-site arrays.
  const SITE_PROPERTY_UNITS: Record<string, string> = {
    force: `eV/Å`,
    forces: `eV/Å`,
    velocity: `Å/fs`,
    velocities: `Å/fs`,
    magmom: `μB`,
    magmoms: `μB`,
    charge: `e`,
    charges: `e`,
  }

  // Property row keys are namespaced so a property literally named `step` or `element`
  // cannot overwrite an identity column. Headers use the display label, so the prefix
  // never reaches the UI or the CSV/JSON export.
  const PROP_PREFIX = `prop_`

  const is_vec3_like = (value: unknown): value is (number | boolean)[] =>
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === `number` || typeof entry === `boolean`)

  // Scalars pass through; tensors and nested objects are stringified so the cell shows
  // the real value rather than [object Object]
  const to_cell_value = (value: unknown): CellVal =>
    typeof value === `number` || typeof value === `string` || typeof value === `boolean`
      ? value
      : JSON.stringify(value)

  // Column for one property. Per-frame scalars take label and unit from the same config
  // that labels the plot axes; per-atom keys, which that config never covers, take their
  // unit from SITE_PROPERTY_UNITS. `axis` splits a vec3 property into one column per axis.
  const property_column = (prop_name: string, axis?: string): Label => {
    const config =
      trajectory_property_config[prop_name] ??
      trajectory_property_config[prop_name.toLowerCase()]
    const label = axis ? `${prop_name} ${axis}` : (config?.label ?? prop_name)
    const unit = SITE_PROPERTY_UNITS[prop_name] ?? config?.unit
    return {
      key: `${PROP_PREFIX}${prop_name}${axis ? `_${axis}` : ``}`,
      label: unit ? `${label} (${unit})` : label,
      description: prop_name,
    }
  }

  let total_frames = $derived(run?.frame_count ?? 0)

  // A progressive or sampled run may expose fewer property rows than frames. Never present
  // that subset as the full trajectory.
  let frame_source = $derived.by(() => {
    const entries = property_rows ?? run?.properties.rows ?? ([] as TrajectoryMetadata[])
    const covers_all =
      entries.length === total_frames &&
      entries.every(({ frame_number }, frame_idx) => frame_number === frame_idx)
    return {
      kind: covers_all ? (`full` as const) : (`sampled` as const),
      entries,
      complete: properties_complete ?? run?.properties.complete ?? true,
    }
  })

  // One pass yields both rows and columns: the columns are the union of the property
  // keys seen across entries, in first-seen order.
  let frame_table = $derived.by(() => {
    const property_keys = new SvelteSet<string>()
    const rows = frame_source.entries.map(({ frame_number, step, properties }) => {
      const row: RowData = { frame_idx: frame_number, step }
      for (const [key, value] of Object.entries(properties)) {
        // `Step` duplicates the step column
        if (key === `Step`) continue
        row[`${PROP_PREFIX}${key}`] = value
        property_keys.add(key)
      }
      return row
    })
    const columns: Label[] = [
      { key: `frame_idx`, label: `Frame`, format: `d`, color_scale: null, sticky: true },
      { key: `step`, label: `Step`, format: `d`, color_scale: null },
      ...[...property_keys].map((key) => property_column(key)),
    ]
    return { rows, columns }
  })

  // Never present a sample as the full run: say how many rows stand for how many frames.
  let frame_notice = $derived.by(() => {
    if (frame_source.kind === `full`) return null
    const shown = format_num(frame_table.rows.length, `,d`)
    const total = format_num(total_frames, `,d`)
    return frame_source.complete
      ? `Sampled frames: ${shown} of ${total}. The table lists the run's available property sample.`
      : `Loading frame properties: ${shown} of ${total} available so far.`
  })

  let active_frame = $derived(
    current_frame ?? (current_step_idx === 0 ? run?.preview : null) ?? null,
  )
  let active_sites = $derived(active_frame?.structure.sites ?? [])

  // Enumerated from the sites rather than hardcoded: parsers keep growing the set of
  // per-atom entries they retain (forces, magmoms, charges, selective dynamics, …).
  // Each key maps to whether its values are vec3 (three columns) or scalar (one).
  let site_property_specs = $derived.by(() => {
    const specs = new SvelteMap<string, boolean>()
    for (const site of active_sites) {
      for (const [key, value] of Object.entries(site.properties ?? {})) {
        if (value != null && !specs.has(key)) specs.set(key, is_vec3_like(value))
      }
    }
    return [...specs]
  })

  let atom_columns: Label[] = $derived([
    { key: `site_idx`, label: `Site`, format: `d`, color_scale: null, sticky: true },
    { key: `element`, label: `Element`, color_scale: null },
    ...FRAC_AXES.map((axis) => ({
      key: `frac_${axis}`,
      label: `${axis}<sub>frac</sub>`,
      format: `.4~f`,
    })),
    ...VEC3_AXES.map((axis) => ({
      key: `cart_${axis}`,
      label: `${axis} (Å)`,
      format: `.4~f`,
    })),
    ...site_property_specs.flatMap(([key, is_vec3]) =>
      is_vec3 ? VEC3_AXES.map((axis) => property_column(key, axis)) : [property_column(key)],
    ),
  ])

  let atom_rows = $derived(
    active_sites.map((site, site_idx) => {
      const { species, abc, xyz, properties } = site
      const row: RowData = {
        site_idx,
        element: species.map(({ element }) => element).join(`/`),
        frac_a: abc[0],
        frac_b: abc[1],
        frac_c: abc[2],
        cart_x: xyz[0],
        cart_y: xyz[1],
        cart_z: xyz[2],
      }
      for (const [key, is_vec3] of site_property_specs) {
        const value = properties?.[key]
        if (value == null) continue
        if (!is_vec3) row[`${PROP_PREFIX}${key}`] = to_cell_value(value)
        // a site whose value does not match the column's vec3 shape leaves the three
        // cells empty (rendered "n/a") instead of silently misaligning components
        else if (is_vec3_like(value)) {
          VEC3_AXES.forEach((axis, axis_idx) => {
            row[`${PROP_PREFIX}${key}_${axis}`] = value[axis_idx]
          })
        }
      }
      return row
    }),
  )

  let tab_items = $derived([
    {
      value: `frames` as const,
      label: `Frames (${format_num(frame_table.rows.length, `,d`)})`,
    },
    { value: `atoms` as const, label: `Atoms (${format_num(active_sites.length, `,d`)})` },
  ])

  const table_props = {
    virtual: true,
    show_column_toggle: true,
    show_controls: true,
    show_heatmap: false,
    default_num_format: `.6~g`,
    scroll_style: `max-height: min(50vh, 26em)`,
    style: `text-align: left; width: 100%`,
  } as const
</script>

<ViewerPane
  bind:open={pane_open}
  pane_name="data inspector"
  class_prefix="trajectory-data-inspector"
  max_width="min(56em, 92vw)"
  closed_icon={HeatmapTableIcon}
  {...pane_options}
>
  <h4 style="margin: 0 0 4pt">Data Inspector</h4>
  <!-- ViewerPane keeps its children mounted and merely hides them, so without the
  pane_open gate a closed pane would still rebuild a 100k-row atom table on every frame -->
  {#if !run}
    <StatusMessage message="No trajectory loaded" style="border: none" />
  {:else if pane_open}
    <Tabs
      items={tab_items}
      bind:value={active_tab}
      label="Data inspector tabs"
      class="inspector-tabs"
    >
      {#snippet panel({ item, selected })}
        {#if selected && item.value === `frames`}
          {#if frame_notice}
            <StatusMessage
              type="warning"
              message={frame_notice}
              style="font-size: 0.8em; margin-bottom: 4pt"
            />
          {/if}
          <HeatmapTable
            data={frame_table.rows}
            columns={frame_table.columns}
            search={{ placeholder: `Filter frames`, fuzzy: true }}
            export_data={{ formats: [`csv`, `json`], filename: `trajectory-frames` }}
            initial_sort={{ column: `frame_idx` }}
            on_row_click={(_event, row) => {
              if (typeof row.frame_idx === `number`) on_step_change?.(row.frame_idx)
            }}
            {...table_props}
          />
        {:else if selected && item.value === `atoms`}
          {#if active_sites.length === 0}
            <StatusMessage message="No frame loaded" style="border: none" />
          {:else}
            <HeatmapTable
              data={atom_rows}
              columns={atom_columns}
              search={{ placeholder: `Filter atoms`, fuzzy: true }}
              export_data={{ formats: [`csv`, `json`], filename: `frame-atoms` }}
              initial_sort={{ column: `site_idx` }}
              on_row_click={(_event, row) => {
                if (typeof row.site_idx === `number`) on_site_select?.(row.site_idx)
              }}
              {...table_props}
            />
          {/if}
        {/if}
      {/snippet}
    </Tabs>
  {/if}
</ViewerPane>

<style>
  :global(.inspector-tabs .tabs-list) {
    display: flex;
    gap: 2pt;
    margin-bottom: 6pt;
  }
  :global(.inspector-tabs .tabs-tab) {
    padding: 2pt 8pt;
    background: transparent;
    border-bottom: 2px solid transparent;
    border-radius: 0;
  }
  :global(.inspector-tabs .tabs-tab[data-state='active']) {
    border-bottom-color: var(--accent-color, cornflowerblue);
  }
  :global(.inspector-tabs .tabs-panel:focus-visible) {
    outline: 1px solid var(--accent-color, cornflowerblue);
  }
</style>
