<script lang="ts">
  import { StatusMessage } from '$lib/feedback'
  import { format_num, trajectory_property_config, type TrajPropertyConfig } from '$lib/labels'
  import { DraggablePane, type PaneProps, type PaneToggleProps } from '$lib/overlays'
  import { type CellVal, HeatmapTable, type Label, type RowData } from '$lib/table'
  import type { ComponentProps } from 'svelte'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import { Tabs } from 'svelte-widgets'
  import { full_data_extractor } from './extract'
  import type {
    TrajectoryDataExtractor,
    TrajectoryFrame,
    TrajectoryInspectorTab,
    TrajectoryMetadata,
    TrajectoryType,
  } from './index'

  let {
    trajectory,
    current_step_idx = 0,
    current_frame = null,
    data_extractor = full_data_extractor,
    property_config = trajectory_property_config,
    on_step_change,
    on_site_select,
    active_tab = $bindable(`frames`),
    pane_open = $bindable(false),
    toggle_props,
    pane_props,
    ...rest
  }: Omit<ComponentProps<typeof DraggablePane>, `children`> & {
    trajectory?: TrajectoryType
    current_step_idx?: number
    // Resolved frame for the atom tab. Indexed trajectories load frames on demand, so
    // the frame on screen is usually absent from `trajectory.frames`.
    current_frame?: TrajectoryFrame | null
    data_extractor?: TrajectoryDataExtractor
    property_config?: Record<string, TrajPropertyConfig>
    on_step_change?: (frame_idx: number) => void
    on_site_select?: (site_idx: number) => void
    active_tab?: TrajectoryInspectorTab
    pane_open?: boolean
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
  } = $props()

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
    const config = property_config[prop_name] ?? property_config[prop_name.toLowerCase()]
    const label = axis ? `${prop_name} ${axis}` : (config?.label ?? prop_name)
    const unit = SITE_PROPERTY_UNITS[prop_name] ?? config?.unit
    return {
      key: `${PROP_PREFIX}${prop_name}${axis ? `_${axis}` : ``}`,
      label: unit ? `${label} (${unit})` : label,
      description: prop_name,
    }
  }

  let total_frames = $derived(trajectory?.total_frames ?? trajectory?.frames.length ?? 0)

  // Per-frame entries. The trap: for an indexed trajectory `frames` holds only the first
  // handful (the parser loads min(10, total)) while total_frames can be six digits, so
  // mapping over `frames` would present 10 rows as the whole run. plot_metadata is the
  // sampled stand-in the parser leaves behind for exactly this case.
  let frame_source = $derived.by(() => {
    if (!trajectory) return { kind: `full` as const, entries: [] as TrajectoryMetadata[] }

    const is_lazy =
      trajectory.is_indexed === true ||
      trajectory.frame_loader != null ||
      trajectory.frames.length < total_frames

    if (is_lazy && trajectory.plot_metadata?.length) {
      return { kind: `sampled` as const, entries: trajectory.plot_metadata }
    }
    // the extractor yields plot_metadata's shape, so both sources build rows the same way
    const entries = trajectory.frames.map((frame, frame_idx) => ({
      frame_number: frame_idx,
      step: frame.step,
      properties: data_extractor(frame, trajectory),
    }))
    return { kind: is_lazy ? (`partial` as const) : (`full` as const), entries }
  })

  // One pass yields both rows and columns: the columns are the union of the property
  // keys seen across entries, in first-seen order.
  let frame_table = $derived.by(() => {
    const property_keys = new SvelteSet<string>()
    const rows = frame_source.entries.map(({ frame_number, step, properties }) => {
      const row: RowData = { frame_idx: frame_number, step }
      for (const [key, value] of Object.entries(properties)) {
        // `Step` duplicates the step column; `constant_*` are markers full_data_extractor
        // sets for non-varying lattice params, not measurements
        if (key === `Step` || key.startsWith(`constant_`)) continue
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
    // an indexed trajectory that reports no total_frames makes frames.length a lower
    // bound, not a total, so it must not be printed as one
    const total =
      trajectory?.total_frames == null
        ? `an unreported number of`
        : format_num(trajectory.total_frames, `,d`)
    if (frame_source.kind === `sampled`) {
      return `Sampled frames: ${shown} of ${total} frames. The table lists the pre-extracted sample, not every frame.`
    }
    return `Partial view: ${shown} of ${total} frames are in memory and no sampled metadata is available. Re-load with indexing off to inspect every frame.`
  })

  let active_frame = $derived(current_frame ?? trajectory?.frames[current_step_idx] ?? null)
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

<DraggablePane
  bind:show={pane_open}
  max_width="min(56em, 92vw)"
  toggle_props={{
    title: pane_open ? `` : `Data inspector`,
    ...toggle_props,
    class: `trajectory-data-inspector-toggle ${toggle_props?.class ?? ``}`,
  }}
  pane_props={{
    ...pane_props,
    class: `trajectory-data-inspector-pane ${pane_props?.class ?? ``}`,
  }}
  open_icon="Cross"
  closed_icon="HeatmapTable"
  {...rest}
>
  <h4 style="margin: 0 0 4pt">Data Inspector</h4>
  <!-- DraggablePane keeps its children mounted and merely hides them, so without the
  pane_open gate a closed pane would still rebuild a 100k-row atom table on every frame -->
  {#if !trajectory}
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
            onrowclick={(_event, row) => {
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
              onrowclick={(_event, row) => {
                if (typeof row.site_idx === `number`) on_site_select?.(row.site_idx)
              }}
              {...table_props}
            />
          {/if}
        {/if}
      {/snippet}
    </Tabs>
  {/if}
</DraggablePane>

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
