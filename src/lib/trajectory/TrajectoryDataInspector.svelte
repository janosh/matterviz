<script lang="ts">
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'
  import Tabs from 'svelte-widgets/Tabs.svelte'
  import { display_idx, format_num, from_display_idx } from '#lib/labels.js'
  import { get_electro_neg_formula } from '#lib/composition/index.js'
  import { type AnyStructure, get_density, get_element_counts } from '#lib/structure/index.js'
  import { numeric_sites, site_count } from '#lib/structure/site.js'
  import { vector_reader } from '#lib/structure/vectors.js'
  import { type CellVal, HeatmapTable, type Column, type RowData } from '#lib/table/index.js'
  import SiteTable from '#lib/structure/SiteTable.svelte'
  import DockedSidebar from '#lib/layout/DockedSidebar.svelte'
  import InfoPaneCards from '#lib/overlays/InfoPaneCards.svelte'
  import {
    DATA_TABLE_PROPS,
    DOCKED_SCROLL_STYLE,
    property_column,
    property_config,
    PROP_PREFIX,
    vec3_norm,
  } from '#lib/structure/site-table.js'
  import { BOOKKEEPING_METADATA_KEYS } from './extract'
  import { sampled_source_indices } from './linked-sites'
  import type { TrajectoryFrame, TrajectoryMetadata, TrajectoryRun } from './index'
  import { summarize_run_info, trajectory_info_cards } from './TrajectoryInfoPane.svelte'

  type InspectorTab = `global` | `frames` | `atoms` | `info`

  let {
    run,
    current_step_idx = 0,
    current_frame = null,
    property_rows,
    properties_complete,
    on_step_change,
    selected_atoms = $bindable(),
    hovered_atom = $bindable(null),
    active_tab = $bindable(`global`),
  }: {
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
    // Source atom (0-based) of the atom row under the pointer, null once it leaves. Bound to the
    // viewer's hover, an atom hovered in 3D shades and scrolls to its row.
    hovered_atom?: number | null
    // The displayed frame's scalars (OVITO's global attributes), every frame's scalars, the
    // displayed frame's per-atom rows, or the run's info cards
    active_tab?: InspectorTab
  } = $props()

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
    const shown = format_num(frame_source.entries.length, `,d`)
    const total = format_num(total_frames, `,d`)
    return frame_source.complete
      ? `Sampled frames: ${shown} of ${total}. The table lists the run's available property sample.`
      : `Loading frame properties: ${shown} of ${total} available so far.`
  })

  let active_frame = $derived(
    current_frame ?? (current_step_idx === 0 ? run?.preview : null) ?? null,
  )
  // Read lazily: a numeric snapshot builds its Site records on first access
  let active_sites = $derived(active_frame?.structure.sites ?? [])
  let n_sites = $derived(site_count(active_frame?.structure))
  // A render sample shows every n-th of `total_atoms` atoms, `source_indices` naming each
  let sample = $derived.by(() => {
    const source_indices = sampled_source_indices(active_frame)
    if (!source_indices) return null
    const total_atoms = active_frame?.metadata?.total_atoms
    if (typeof total_atoms !== `number`)
      throw new Error(`Render-sampled frame lacks total_atoms, got ${typeof total_atoms}`)
    return { source_indices, total_atoms }
  })

  // The largest per-site force, from the renderer's cached magnitudes when the frame has
  // them. A loop, since Math.max(...norms) overflows the call stack past ~125k atoms.
  const max_site_force = (structure: AnyStructure): number | undefined => {
    let max: number | undefined
    const count = site_count(structure)
    for (const key of [`force`, `forces`]) {
      const cached = numeric_sites.get(structure)?.display_metrics?.vector_magnitudes[key]
      const read = vector_reader(structure, key, cached?.values)
      if (!read) continue
      for (let site_idx = 0; site_idx < count; site_idx++) {
        const norm = cached ? cached.values[site_idx] : vec3_norm(read(site_idx) ?? [NaN])
        if (Number.isFinite(norm) && norm > (max ?? -1)) max = norm
      }
    }
    return max
  }

  // The displayed frame's scalars as attribute/value rows, updating while the trajectory plays:
  // what the file recorded for this frame, then what its structure implies. A recorded value
  // wins over a derived one of the same name.
  let global_rows = $derived.by(() => {
    const { kind, entries } = frame_source
    const entry =
      kind === `full`
        ? entries[current_step_idx]
        : entries.find(({ frame_number }) => frame_number === current_step_idx)
    const recorded =
      entry?.properties ??
      Object.fromEntries(
        Object.entries(active_frame?.metadata ?? {}).filter(
          (pair): pair is [string, number] =>
            typeof pair[1] === `number` && !BOOKKEEPING_METADATA_KEYS.has(pair[0]),
        ),
      )
    const rows: RowData[] = []
    // Label and unit from the config that labels the plot axes, else the given ones
    const add = (key: string, value: CellVal | undefined, label = key, unit = ``) => {
      if (value === undefined || rows.some((row) => row.key === key)) return
      const config = property_config(key)
      rows.push({ key, attribute: config?.label ?? label, value, unit: config?.unit ?? unit })
    }
    add(`frame`, display_idx(current_step_idx), `Frame`)
    add(`step`, active_frame?.step ?? entry?.step, `Step`)
    for (const [key, value] of Object.entries(recorded)) if (key !== `Step`) add(key, value)
    const structure = active_frame?.structure
    if (!structure) return rows
    // Counts and per-atom values describe the whole frame. Formula, density and a derived
    // Fmax would describe only a render sample's atoms, so a sample leaves them out.
    const n_atoms = sample?.total_atoms ?? n_sites
    add(`n_atoms`, n_atoms, `Atoms`)
    if (!sample)
      add(
        `formula`,
        get_electro_neg_formula(get_element_counts(structure), { plain_text: true }),
        `Formula`,
      )
    if (`lattice` in structure) {
      const { volume, a, b, c, alpha, beta, gamma } = structure.lattice
      add(`volume`, volume)
      add(
        `volume_per_atom`,
        n_atoms ? volume / n_atoms : undefined,
        `Volume per atom`,
        `Å³/atom`,
      )
      if (!sample) add(`density`, get_density(structure))
      for (const [key, value] of Object.entries({ a, b, c, alpha, beta, gamma }))
        add(key, value)
    }
    if (typeof recorded.energy === `number` && n_atoms)
      add(`energy_per_atom`, recorded.energy / n_atoms)
    if (!sample) add(`force_max`, max_site_force(structure))
    return rows
  })
  const global_columns: Column[] = [
    { id: `attribute`, label: `Attribute`, color_scale: null, sticky: true },
    { id: `value`, label: `Value`, color_scale: null, format: `.6~g` },
    { id: `unit`, label: `Unit`, color_scale: null },
  ]

  // Counts that cost nothing to read: labels must not build a hidden tab's rows every frame
  const tab_item = (value: typeof active_tab, name: string, count?: number) => {
    const label = count === undefined ? name : `${name} (${format_num(count, `,d`)})`
    return { id: value, value, label }
  }
  let tab_items = $derived([
    tab_item(`global`, `Global`),
    tab_item(`frames`, `Frames`, frame_source.entries.length),
    tab_item(`atoms`, `Atoms`, n_sites),
    tab_item(`info`, `Info`),
  ])

  // The info pane's cards (file, timing, property statistics), which the host hides its info
  // button for while this sidebar shows. Read only by the Info tab, so built only while open.
  let info_summary = $derived(run && summarize_run_info(run, frame_source.entries))
  let info_cards = $derived(
    run && info_summary
      ? trajectory_info_cards({
          run,
          rows: frame_source.entries,
          rows_complete: frame_source.complete,
          current_step_idx,
          current_frame: active_frame,
          summary: info_summary,
        })
      : [],
  )

  // The table toolbar shares the tab row while the full tab labels and the toolbar both fit
  // there, else it takes its own row above the table. Measured, since labels ("Atoms (12,345)")
  // and the toolbar (an open search box) both vary in width.
  const fit_toolbar = (tabs: HTMLElement) => {
    const list = tabs.querySelector<HTMLElement>(`:scope > .tabs-list`)
    if (!list) throw new Error(`Data inspector tabs have no .tabs-list`)
    let toolbar: HTMLElement | null = null
    const sizes = new ResizeObserver(() => fit())
    const fit = (): void => {
      // Only a table that starts its panel can lift its toolbar: a notice above it keeps its own
      const next = tabs.querySelector<HTMLElement>(
        `.tabs-panel > .table-container:first-child > .control-buttons`,
      )
      if (next !== toolbar) {
        if (toolbar) sizes.unobserve(toolbar)
        // Recorded before observing: an observer that reports synchronously re-enters fit
        toolbar = next
        if (next) sizes.observe(next)
      }
      // Tried inline first: the room the tabs then reserve lets a content-fit sidebar widen for
      // the toolbar, which a sidebar measured with the toolbar in its own row never would. It
      // stays there unless that cuts a tab label short.
      tabs.style.setProperty(`--toolbar-width`, `${toolbar?.offsetWidth ?? 0}px`)
      tabs.dataset.toolbar = `inline`
      const inline =
        toolbar !== null &&
        [...list.children].every((tab) => tab.scrollWidth <= tab.clientWidth)
      if (!inline) tabs.dataset.toolbar = `row`
    }
    sizes.observe(tabs)
    // relabelled tabs (growing counts) and the table a tab switch mounts
    const mutations = new MutationObserver(fit)
    mutations.observe(list, { subtree: true, childList: true, characterData: true })
    for (const panel of tabs.querySelectorAll(`:scope > .tabs-panel`))
      mutations.observe(panel, { childList: true })
    fit()
    return () => {
      sizes.disconnect()
      mutations.disconnect()
    }
  }
</script>

<!-- The host puts the sidebar last in a `docked-sidebar-row` and mounts it only while open,
so a closed inspector builds no tables -->
<DockedSidebar label="data inspector" class="trajectory-data-inspector-sidebar">
  {#snippet header()}Data Inspector{/snippet}
  {#if !run}
    <StatusMessage message="No trajectory loaded" style="border: none" />
  {:else}
    <Tabs
      items={tab_items}
      bind:value={active_tab}
      label="Data inspector tabs"
      class="inspector-tabs"
      {@attach fit_toolbar}
    >
      {#snippet panel({ item, selected })}
        {#if selected && item.value === `global`}
          <HeatmapTable
            data={global_rows}
            columns={global_columns}
            search={{ placeholder: `Filter attributes`, fuzzy: true }}
            export_formats={[`csv`, `json`]}
            export_filename={`frame-${display_idx(current_step_idx)}-attributes`}
            {...DATA_TABLE_PROPS}
            scroll_style={DOCKED_SCROLL_STYLE}
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
            on_row_click={on_step_change &&
              ((_event: MouseEvent | KeyboardEvent, row: RowData) => {
                // Frame numbers are 1-based, on_step_change takes the 0-based index
                if (typeof row.frame === `number`) on_step_change(from_display_idx(row.frame))
              })}
            {...DATA_TABLE_PROPS}
            scroll_style={DOCKED_SCROLL_STYLE}
          />
        {:else if selected && item.value === `atoms`}
          {#if n_sites === 0}
            <StatusMessage message="No frame loaded" style="border: none" />
          {:else}
            {#if sample}
              <StatusMessage
                message={`Sampled atoms: ${n_sites} of ${sample.total_atoms}. Site indices refer to the original frame; exported rows contain this sample only.`}
              />
            {/if}
            <SiteTable
              sites={active_sites}
              source_indices={sample?.source_indices}
              bind:selected_atoms
              bind:hovered_atom
              export_filename={sample ? `frame-atoms-sample` : `frame-atoms`}
              search={{ placeholder: `Filter atoms`, fuzzy: true }}
              scroll_style={DOCKED_SCROLL_STYLE}
            />
          {/if}
        {:else if selected && item.value === `info`}
          <!-- No filter: a handful of cards, which start right under the tabs -->
          <InfoPaneCards
            cards={info_cards}
            empty_label="trajectory info"
            style="--info-card-accent: 0; min-height: 0; overflow: auto"
          />
        {/if}
      {/snippet}
    </Tabs>
  {/if}
</DockedSidebar>

<style>
  /* The tabs and the open panel pass the sidebar's height down to the table */
  :global(.trajectory-data-inspector-sidebar :is(.inspector-tabs, .tabs-panel:not([hidden]))) {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }
  :global(.inspector-tabs .tabs-list) {
    display: flex;
    gap: 2pt;
  }
  /* As wide as its buttons in either row, so fit_toolbar measures the same width in both */
  :global(.inspector-tabs .tabs-panel > .table-container > .control-buttons) {
    width: max-content;
    margin-inline-start: auto;
  }
  /* Inline, the toolbar sits at the right end of the tab row, so the table starts right under
     the tabs, and the tabs leave it the room it takes */
  :global(.inspector-tabs[data-toolbar='inline'] .tabs-list) {
    padding-inline-end: calc(var(--toolbar-width) + 2pt);
  }
  :global(
    .inspector-tabs[data-toolbar='inline']
      .tabs-panel
      > .table-container:first-child
      > .control-buttons
  ) {
    position: absolute;
    bottom: 100%;
    inset-inline-end: 0;
    margin: 0;
  }
  /* A sidebar too narrow for the labels alone shrinks them to an ellipsis, never wrapping */
  :global(.inspector-tabs .tabs-tab) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 2pt 5pt;
    background: transparent;
    border-bottom: 2px solid transparent;
    border-radius: 0;
  }
  /* The tables span the inspector instead of hugging their content */
  :global(.inspector-tabs .tabs-panel :is(.table-container, table.heatmap)) {
    width: 100%;
  }
  /* The first column (attribute, frame or site) fits its content; the rest take the width */
  :global(.inspector-tabs .tabs-panel table.heatmap :is(th, td):first-child) {
    width: 1%;
    white-space: nowrap;
  }
  :global(.inspector-tabs .tabs-tab[data-state='active']) {
    border-bottom-color: var(--accent-color, cornflowerblue);
  }
  :global(.inspector-tabs .tabs-panel:focus-visible) {
    outline: 1px solid var(--accent-color, cornflowerblue);
  }
</style>
