<script lang="ts">
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'
  import Tabs from 'svelte-widgets/Tabs.svelte'
  import {
    display_idx,
    format_num,
    from_display_idx,
    trajectory_property_config,
  } from '#lib/labels.js'
  import { ViewerPane, type ViewerPaneOptions } from '#lib/overlays/index.js'
  import { get_electro_neg_formula } from '#lib/composition/index.js'
  import { get_density } from '#lib/structure/index.js'
  import { type CellVal, HeatmapTable, type Column, type RowData } from '#lib/table/index.js'
  import { HeatmapTable as HeatmapTableIcon } from 'svelte-widgets/icons'
  import type { TrajectoryFrame, TrajectoryMetadata, TrajectoryRun } from './index'

  let {
    run,
    current_step_idx = 0,
    current_frame = null,
    property_rows,
    properties_complete,
    on_step_change,
    selected_atoms = $bindable(),
    on_atoms_hover,
    pane_open = $bindable(false),
    docked = $bindable(false),
    dockable = false,
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
    // Selected atoms of the source frame (0-based). Bound, the atom rows get checkboxes and a
    // row click toggles its atom; unbound, atom rows are display only.
    selected_atoms?: number[]
    // Source atoms of the atom row under the pointer (0-based), empty once it leaves
    on_atoms_hover?: (atoms: number[]) => void
    pane_open?: boolean
    // Docked, the inspector renders in place (the host gives it a sidebar) instead of as a
    // floating pane; `dockable` shows the button that switches between the two
    docked?: boolean
    dockable?: boolean
  } = $props()

  // The displayed frame's scalars (OVITO's global attributes), every frame's scalars, or the
  // displayed frame's per-atom rows
  let active_tab = $state<`global` | `frames` | `atoms`>(`global`)

  // Frame and Site columns are 1-based; clicks hand callbacks the 0-based index
  const row_click_handler = (callback: ((idx: number) => void) | undefined, key: string) =>
    callback
      ? (_event: MouseEvent | KeyboardEvent, row: RowData) => {
          const number = row[key]
          if (typeof number === `number`) callback(from_display_idx(number))
        }
      : undefined

  const VEC3_AXES = [`x`, `y`, `z`] as const
  const FRAC_AXES = [`a`, `b`, `c`] as const

  // Units for per-atom properties the parsers emit. trajectory_property_config covers
  // per-frame scalars only (force_max, energy, …), never the per-site arrays. Velocities have
  // no fixed unit (Å/fs in ASE-derived files, Å/ps in LAMMPS metal dumps), so none is shown.
  const SITE_PROPERTY_UNITS: Record<string, string> = {
    force: `eV/Å`,
    forces: `eV/Å`,
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
  const property_column = (prop_name: string, axis?: string): Column => {
    const config =
      trajectory_property_config[prop_name] ??
      trajectory_property_config[prop_name.toLowerCase()]
    const label =
      axis === `norm`
        ? `|${prop_name}|`
        : axis
          ? `${prop_name} ${axis}`
          : (config?.label ?? prop_name)
    const unit = SITE_PROPERTY_UNITS[prop_name] ?? config?.unit
    const id = `${PROP_PREFIX}${prop_name}${axis ? `_${axis}` : ``}`
    return {
      id,
      key: id,
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
    const property_keys = new Set<string>()
    const rows = frame_source.entries.map(({ frame_number, step, properties }) => {
      const row: RowData = { frame: display_idx(frame_number), step }
      for (const [key, value] of Object.entries(properties)) {
        // `Step` duplicates the step column
        if (key === `Step`) continue
        row[`${PROP_PREFIX}${key}`] = value
        property_keys.add(key)
      }
      return row
    })
    const columns: Column[] = [
      { id: `frame`, label: `Frame`, format: `d`, color_scale: null, sticky: true },
      { id: `step`, label: `Step`, format: `d`, color_scale: null },
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
  const atom_sample = $derived(Boolean(active_frame?.metadata?.render_sample))
  const atom_indices = $derived(active_frame?.metadata?.source_atom_indices)

  // Enumerated from the sites rather than hardcoded: parsers keep growing the set of
  // per-atom entries they retain (forces, magmoms, charges, selective dynamics, …).
  // Each key maps to its shape: scalar (one column), vec3 (three), or a numeric vec3 like a
  // force or velocity, which also gets its magnitude to sort by.
  let site_property_specs = $derived.by(() => {
    const specs = new Map<string, `scalar` | `vec3` | `numeric_vec3`>()
    for (const site of active_sites) {
      for (const [key, value] of Object.entries(site.properties ?? {})) {
        if (value == null || specs.has(key)) continue
        const shape = !is_vec3_like(value)
          ? `scalar`
          : value.every((entry) => typeof entry === `number`)
            ? `numeric_vec3`
            : `vec3`
        specs.set(key, shape)
      }
    }
    return [...specs]
  })

  let atom_columns: Column[] = $derived([
    { id: `site`, label: `Site`, format: `d`, color_scale: null, sticky: true },
    { id: `element`, label: `Element`, color_scale: null },
    ...[
      ...FRAC_AXES.map((axis) => [`frac_${axis}`, `${axis}<sub>frac</sub>`]),
      ...VEC3_AXES.map((axis) => [`cart_${axis}`, `${axis} (Å)`]),
    ].map(([id, label]) => ({ id, key: id, label, format: `.4~f` })),
    ...site_property_specs.flatMap(([key, shape]) =>
      shape === `scalar`
        ? [property_column(key)]
        : [...VEC3_AXES, ...(shape === `numeric_vec3` ? [`norm`] : [])].map((axis) =>
            property_column(key, axis),
          ),
    ),
  ])

  let atom_rows = $derived(
    active_sites.map((site, site_idx) => {
      const { species, abc, xyz, properties } = site
      const row: RowData = {
        site: display_idx(
          atom_sample && Array.isArray(atom_indices) ? atom_indices[site_idx] : site_idx,
        ),
        element: species.map(({ element }) => element).join(`/`),
        frac_a: abc[0],
        frac_b: abc[1],
        frac_c: abc[2],
        cart_x: xyz[0],
        cart_y: xyz[1],
        cart_z: xyz[2],
      }
      for (const [key, shape] of site_property_specs) {
        const value = properties?.[key]
        if (value == null) continue
        if (shape === `scalar`) row[`${PROP_PREFIX}${key}`] = to_cell_value(value)
        // a site whose value does not match the column's vec3 shape leaves the three
        // cells empty (rendered "n/a") instead of silently misaligning components
        else if (is_vec3_like(value)) {
          VEC3_AXES.forEach((axis, axis_idx) => {
            row[`${PROP_PREFIX}${key}_${axis}`] = value[axis_idx]
          })
          if (shape === `numeric_vec3`)
            row[`${PROP_PREFIX}${key}_norm`] = Math.hypot(...value.map(Number))
        }
      }
      return row
    }),
  )

  // The displayed frame's scalars as attribute/value rows, updating while the trajectory plays:
  // what the file recorded for this frame, then what its structure implies. A recorded value
  // wins over a derived one of the same name.
  let global_rows = $derived.by(() => {
    const recorded =
      frame_source.entries.find(({ frame_number }) => frame_number === current_step_idx)
        ?.properties ??
      Object.fromEntries(
        Object.entries(active_frame?.metadata ?? {}).filter(
          (entry): entry is [string, number] => typeof entry[1] === `number`,
        ),
      )
    const rows: RowData[] = []
    // Label and unit from the config that labels the plot axes, else the given ones
    const add = (key: string, value: CellVal | undefined, label = key, unit = ``) => {
      if (value === undefined || rows.some((row) => row.key === key)) return
      const config =
        trajectory_property_config[key] ?? trajectory_property_config[key.toLowerCase()]
      rows.push({ key, attribute: config?.label ?? label, value, unit: config?.unit ?? unit })
    }
    add(`frame`, display_idx(current_step_idx), `Frame`)
    add(`step`, active_frame?.step ?? recorded.step, `Step`)
    for (const [key, value] of Object.entries(recorded)) if (key !== `Step`) add(key, value)
    const structure = active_frame?.structure
    if (!structure) return rows
    const n_sites = structure.sites.length
    add(`n_atoms`, n_sites, `Atoms`)
    add(`formula`, get_electro_neg_formula(structure, { plain_text: true }), `Formula`)
    if (`lattice` in structure) {
      const { volume, a, b, c, alpha, beta, gamma } = structure.lattice
      add(`volume`, volume)
      add(
        `volume_per_atom`,
        n_sites ? volume / n_sites : undefined,
        `Volume per atom`,
        `Å³/atom`,
      )
      add(`density`, get_density(structure))
      for (const [key, value] of Object.entries({ a, b, c, alpha, beta, gamma }))
        add(key, value)
    }
    if (typeof recorded.energy === `number` && n_sites)
      add(`energy_per_atom`, recorded.energy / n_sites)
    const force_norms = structure.sites.flatMap(({ properties }) => {
      const force = properties?.force ?? properties?.forces
      return is_vec3_like(force) ? [Math.hypot(...force.map(Number))] : []
    })
    if (force_norms.length) add(`force_max`, Math.max(...force_norms))
    return rows
  })
  const global_columns: Column[] = [
    { id: `attribute`, label: `Attribute`, color_scale: null, sticky: true },
    { id: `value`, label: `Value`, color_scale: null, format: `.6~g` },
    { id: `unit`, label: `Unit`, color_scale: null },
  ]

  // A row click toggles its atom in the selection; the checkbox does that itself, and its
  // click must not toggle it back on the way up
  const toggle_atom = (event: MouseEvent | KeyboardEvent, row: RowData) => {
    if (event.target instanceof HTMLInputElement || typeof row.site !== `number`) return
    const atom = from_display_idx(row.site)
    const current = selected_atoms ?? []
    selected_atoms = current.includes(atom)
      ? current.filter((idx) => idx !== atom)
      : [...current, atom]
  }

  const tab_item = (value: typeof active_tab, name: string, count: number) => {
    const label = `${name} (${format_num(count, `,d`)})`
    return { id: label, value, label }
  }
  let tab_items = $derived([
    tab_item(`global`, `Global`, global_rows.length),
    tab_item(`frames`, `Frames`, frame_table.rows.length),
    tab_item(`atoms`, `Atoms`, active_sites.length),
  ])

  // Docked, the tables take the sidebar's height instead of the floating pane's cap
  let table_props = $derived({
    virtual: true,
    show_column_toggle: true,
    show_controls: true,
    show_heatmap: false,
    default_num_format: `.6~g`,
    scroll_style: docked ? `max-height: calc(100vh - 14em)` : `max-height: min(50vh, 26em)`,
    style: `text-align: left; width: 100%`,
  } as const)
</script>

{#snippet header()}
  <h4 class="inspector-header">
    Data Inspector
    {#if dockable}
      <button
        type="button"
        class="icon-btn"
        title={docked ? `Undock into a floating pane` : `Dock as a sidebar`}
        aria-label={docked ? `Undock data inspector` : `Dock data inspector`}
        onclick={() => (docked = !docked)}
      >
        {docked ? `⇱` : `⇥`}
      </button>
    {/if}
  </h4>
{/snippet}

{#snippet inspector_body()}
  {#if !run}
    <StatusMessage message="No trajectory loaded" style="border: none" />
  {:else}
    <Tabs
      items={tab_items}
      bind:value={active_tab}
      label="Data inspector tabs"
      class="inspector-tabs"
    >
      {#snippet panel({ item, selected })}
        {#if selected && item.value === `global`}
          <HeatmapTable
            data={global_rows}
            columns={global_columns}
            search={{ placeholder: `Filter attributes`, fuzzy: true }}
            export_formats={[`csv`, `json`]}
            export_filename={`frame-${display_idx(current_step_idx)}-attributes`}
            {...table_props}
            virtual={false}
          />
        {:else if selected && item.value === `frames`}
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
            export_formats={[`csv`, `json`]}
            export_filename="trajectory-frames"
            initial_sort={{ column: `frame` }}
            on_row_click={row_click_handler(on_step_change, `frame`)}
            {...table_props}
          />
        {:else if selected && item.value === `atoms`}
          {#if active_sites.length === 0}
            <StatusMessage message="No frame loaded" style="border: none" />
          {:else}
            {#if atom_sample}
              <StatusMessage
                message={`Sampled atoms: ${active_sites.length} of ${active_frame?.metadata?.total_atoms}. Site indices refer to the original frame; exported rows contain this sample only.`}
              />
            {/if}
            <HeatmapTable
              data={atom_rows}
              columns={atom_columns}
              search={{ placeholder: `Filter atoms`, fuzzy: true }}
              export_formats={[`csv`, `json`]}
              export_filename={atom_sample ? `frame-atoms-sample` : `frame-atoms`}
              initial_sort={{ column: `site` }}
              on_row_click={selected_atoms ? toggle_atom : undefined}
              on_row_hover={on_atoms_hover &&
                ((row: RowData | null) =>
                  on_atoms_hover(
                    typeof row?.site === `number` ? [from_display_idx(row.site)] : [],
                  ))}
              show_row_select={selected_atoms !== undefined}
              row_key="site"
              bind:selected_ids={
                () => (selected_atoms ?? []).map(display_idx),
                (ids) => (selected_atoms = ids.map((id) => from_display_idx(Number(id))))
              }
              {...table_props}
            />
          {/if}
        {/if}
      {/snippet}
    </Tabs>
  {/if}
{/snippet}

{#if docked}
  <section class="trajectory-data-inspector-sidebar" aria-label="Data inspector">
    {@render header()}
    {@render inspector_body()}
  </section>
{:else}
  <ViewerPane
    bind:open={pane_open}
    pane_name="data inspector"
    class_prefix="trajectory-data-inspector"
    max_width="min(56em, 92vw)"
    closed_icon={HeatmapTableIcon}
    {...pane_options}
  >
    {@render header()}
    <!-- ViewerPane keeps its children mounted and merely hides them, so without the
    pane_open gate a closed pane would still rebuild a 100k-row atom table on every frame -->
    {#if pane_open}{@render inspector_body()}{/if}
  </ViewerPane>
{/if}

<style>
  .inspector-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 0 4pt;
  }
  .trajectory-data-inspector-sidebar {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 6pt 8pt;
    background: var(--surface-bg, transparent);
    border-inline-start: 1px solid var(--border-color, rgba(128, 128, 128, 0.3));
  }
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
