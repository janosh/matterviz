<script lang="ts" generics="Datum = unknown">
  import {
    FACET_AXES,
    assign_facet_panels,
    compute_facet_geometry,
    propagate_facet_range,
    reconcile_facet_padding,
    reconcile_facet_ranges,
    resolve_facet_axis_visibility,
    type FacetAxis,
    type FacetAxisModes,
    type FacetAxisRanges,
    type FacetAxisVisibilityModes,
    type FacetKey,
    type FacetPanel,
    type FacetPanelContext,
    type FacetPanelLayoutReport,
    type FacetRangeUpdate,
    type FacetSharedBandContext,
    type FacetSharedBandSizes,
    type ResolvedFacetGridGeometry,
  } from '$lib/plot/core/facets'
  import { is_valid_range } from '$lib/plot/core/shared-axes'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap } from 'svelte/reactivity'

  let {
    panels,
    columns,
    rows,
    gap = 0,
    row_gap = gap,
    column_gap = gap,
    shared_bands = {},
    axis_modes = {},
    axis_visibility = {},
    children,
    title,
    legend,
    colorbar,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `children` | `title`> & {
    panels: readonly FacetPanel<Datum>[]
    columns: number
    rows?: number
    gap?: number
    row_gap?: number
    column_gap?: number
    shared_bands?: FacetSharedBandSizes
    axis_modes?: Partial<FacetAxisModes>
    axis_visibility?: FacetAxisVisibilityModes
    children?: Snippet<[FacetPanelContext<Datum>]>
    title?: Snippet<[FacetSharedBandContext]>
    legend?: Snippet<[FacetSharedBandContext]>
    colorbar?: Snippet<[FacetSharedBandContext]>
  } = $props()

  let [grid_width, grid_height] = $state([0, 0])
  const layout_reports = new SvelteMap<FacetKey, FacetPanelLayoutReport>()
  const range_overrides = new SvelteMap<FacetKey, FacetAxisRanges>()
  const report_callbacks: {
    key: FacetKey
    callback: (report: FacetPanelLayoutReport) => void
  }[] = []
  const range_update_callbacks: {
    key: FacetKey
    callback: (axis: FacetAxis, range: FacetRangeUpdate) => void
  }[] = []

  const layout = $derived(assign_facet_panels(panels, columns, rows))
  const active_shared_bands = $derived.by((): FacetSharedBandSizes => {
    const require_size = (
      slot: Snippet<[FacetSharedBandContext]> | undefined,
      value: number | undefined,
      name: `title_height` | `legend_width` | `colorbar_width`,
    ): number | undefined => {
      if (!slot) return undefined
      if (!Number.isFinite(value) || (value ?? 0) <= 0) {
        throw new RangeError(
          `FacetGrid ${name} must be a finite positive number when its slot is present, got ${value}`,
        )
      }
      return value
    }
    return {
      title_height: require_size(title, shared_bands.title_height, `title_height`),
      legend_width: require_size(legend, shared_bands.legend_width, `legend_width`),
      colorbar_width: require_size(colorbar, shared_bands.colorbar_width, `colorbar_width`),
      gap: shared_bands.gap,
    }
  })
  const keyed_reports = $derived(
    [...layout_reports.entries()].map(([key, report]) => ({ key, ...report })),
  )
  const keyed_range_overrides = $derived(
    [...range_overrides.entries()].map(([key, ranges]) => ({ key, ranges })),
  )
  const resolved_padding = $derived(reconcile_facet_padding(layout, keyed_reports))
  const resolved_ranges = $derived(
    reconcile_facet_ranges(layout, keyed_reports, axis_modes, keyed_range_overrides),
  )
  const resolved_geometry = $derived.by((): ResolvedFacetGridGeometry => {
    if (grid_width <= 0 || grid_height <= 0) {
      const rect = { x: 0, y: 0, width: 0, height: 0 }
      return {
        panel_grid: rect,
        panels: layout.panels.map(({ key }) => ({
          key,
          rect,
        })),
        ...(title && { title: { band: `title`, rect } }),
        ...(legend && { legend: { band: `legend`, rect } }),
        ...(colorbar && { colorbar: { band: `colorbar`, rect } }),
      }
    }
    return compute_facet_geometry(layout, {
      width: grid_width,
      height: grid_height,
      row_gap,
      column_gap,
      shared_bands: active_shared_bands,
    })
  })

  const normalize_report = (
    key: FacetKey,
    report: FacetPanelLayoutReport,
  ): FacetPanelLayoutReport => {
    const ranges: FacetAxisRanges = {}
    for (const axis of FACET_AXES) {
      const range = report.ranges?.[axis]
      if (range === undefined) continue
      if (!is_valid_range(range)) {
        throw new TypeError(
          `Invalid ${axis} layout range from facet "${key}": ${String(range)}`,
        )
      }
      ranges[axis] = [range[0], range[1]]
    }
    return {
      ...(report.padding && { padding: { ...report.padding } }),
      ...(report.ranges && { ranges }),
    }
  }

  const reports_equal = (
    left: FacetPanelLayoutReport | undefined,
    right: FacetPanelLayoutReport,
  ): boolean => {
    if (!left) return false
    const padding_equal = ([`t`, `b`, `l`, `r`] as const).every((side) =>
      Object.is(left.padding?.[side], right.padding?.[side]),
    )
    const ranges_equal = FACET_AXES.every(
      (axis) =>
        Object.is(left.ranges?.[axis]?.[0], right.ranges?.[axis]?.[0]) &&
        Object.is(left.ranges?.[axis]?.[1], right.ranges?.[axis]?.[1]),
    )
    return padding_equal && ranges_equal
  }

  const preserve_resolved_echoes = (
    key: FacetKey,
    report: FacetPanelLayoutReport,
  ): FacetPanelLayoutReport => {
    const previous = layout_reports.get(key)
    if (!previous) return report
    const padding = report.padding ? { ...report.padding } : undefined
    for (const side of [`t`, `b`, `l`, `r`] as const) {
      const incoming = padding?.[side]
      const previous_value = previous.padding?.[side]
      if (
        padding &&
        incoming !== undefined &&
        previous_value !== undefined &&
        !Object.is(incoming, previous_value) &&
        Object.is(incoming, resolved_padding[side])
      ) {
        padding[side] = previous_value
      }
    }

    const ranges = report.ranges ? { ...report.ranges } : undefined
    const panel_ranges = resolved_ranges.find((entry) => entry.key === key)?.ranges
    for (const axis of FACET_AXES) {
      const incoming = ranges?.[axis]
      const previous_range = previous.ranges?.[axis]
      const resolved_range = panel_ranges?.[axis]
      if (
        incoming &&
        previous_range &&
        resolved_range &&
        (incoming[0] !== previous_range[0] || incoming[1] !== previous_range[1]) &&
        incoming[0] === resolved_range[0] &&
        incoming[1] === resolved_range[1]
      ) {
        ranges[axis] = previous_range
      }
    }
    return {
      ...(padding && { padding }),
      ...(ranges && { ranges }),
    }
  }

  // Stable callback identities plus value equality make repeated child layout reports a no-op.
  // Resolved padding/range echoes retain the last intrinsic report, preventing a child effect
  // from turning grid-supplied geometry into a new intrinsic input and cycling indefinitely.
  const report_callback_for = (key: FacetKey): ((report: FacetPanelLayoutReport) => void) => {
    const existing = report_callbacks.find((entry) => entry.key === key)
    if (existing) return existing.callback
    const callback = (report: FacetPanelLayoutReport): void => {
      if (!layout.panels.some((panel) => panel.key === key)) return
      const normalized = preserve_resolved_echoes(key, normalize_report(key, report))
      if (reports_equal(layout_reports.get(key), normalized)) return
      layout_reports.set(key, normalized)
    }
    report_callbacks.push({ key, callback })
    return callback
  }

  const ranges_equal = (left: FacetAxisRanges | undefined, right: FacetAxisRanges): boolean =>
    FACET_AXES.every(
      (axis) =>
        Object.is(left?.[axis]?.[0], right[axis]?.[0]) &&
        Object.is(left?.[axis]?.[1], right[axis]?.[1]),
    )

  // Each panel keeps one callback for its lifetime. The callback reads current layout/modes,
  // then atomically updates every member of the relevant shared/row/column group.
  const range_update_callback_for = (key: FacetKey) => {
    const existing = range_update_callbacks.find((entry) => entry.key === key)
    if (existing) return existing.callback
    const callback = (axis: FacetAxis, range: FacetRangeUpdate): void => {
      const current = [...range_overrides.entries()].map(([panel_key, ranges]) => ({
        key: panel_key,
        ranges,
      }))
      const next = propagate_facet_range(layout, current, key, axis, range, axis_modes)
      for (const entry of next) {
        if (Object.keys(entry.ranges).length === 0) {
          range_overrides.delete(entry.key)
        } else if (!ranges_equal(range_overrides.get(entry.key), entry.ranges)) {
          range_overrides.set(entry.key, entry.ranges)
        }
      }
    }
    range_update_callbacks.push({ key, callback })
    return callback
  }

  const contexts = $derived(
    layout.panels.map(
      (panel): FacetPanelContext<Datum> => ({
        ...panel,
        rect: resolved_geometry.panels.find((entry) => entry.key === panel.key)?.rect ?? {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        },
        padding: resolved_padding,
        ranges: resolved_ranges.find((entry) => entry.key === panel.key)?.ranges ?? {},
        axis_visibility: resolve_facet_axis_visibility(
          panel,
          layout,
          axis_modes,
          axis_visibility,
        ),
        report_layout: report_callback_for(panel.key),
        update_range: range_update_callback_for(panel.key),
      }),
    ),
  )

  let previous_linked_group_signature: string | undefined
  // Existing zoom overrides encode the groups active when the update occurred. Clear them
  // after panels move or modes change rather than applying an old row/column group incorrectly.
  $effect(() => {
    const next_signature = JSON.stringify({
      modes: FACET_AXES.map((axis) => axis_modes[axis] ?? `shared`),
      panels: layout.panels.map(({ key, row, column, row_span, column_span }) => [
        key,
        row,
        column,
        row_span,
        column_span,
      ]),
    })
    if (
      previous_linked_group_signature !== undefined &&
      previous_linked_group_signature !== next_signature
    ) {
      range_overrides.clear()
    }
    previous_linked_group_signature = next_signature
  })

  // Discard state for removed panels so reusing a key never inherits stale geometry or zoom.
  $effect(() => {
    const current_keys = new Set(layout.panels.map((panel) => panel.key))
    for (const key of layout_reports.keys()) {
      if (!current_keys.has(key)) layout_reports.delete(key)
    }
    for (const key of range_overrides.keys()) {
      if (!current_keys.has(key)) range_overrides.delete(key)
    }
  })

  const update_grid_size = (element: HTMLElement): void => {
    const next_width = Math.round(element.clientWidth)
    const next_height = Math.round(element.clientHeight)
    if (next_width !== grid_width) grid_width = next_width
    if (next_height !== grid_height) grid_height = next_height
  }

  const root_columns = $derived(
    [
      `minmax(0, 1fr)`,
      ...(legend ? [`${active_shared_bands.legend_width}px`] : []),
      ...(colorbar ? [`${active_shared_bands.colorbar_width}px`] : []),
    ].join(` `),
  )
  const root_rows = $derived(
    title ? `${active_shared_bands.title_height}px minmax(0, 1fr)` : `minmax(0, 1fr)`,
  )
  const content_row = $derived(title ? 2 : 1)
  const colorbar_column = $derived(legend ? 3 : 2)
</script>

<div
  {...rest}
  class={[`facet-grid`, rest.class]}
  style:grid-template-columns={root_columns}
  style:grid-template-rows={root_rows}
  style:row-gap={title ? `${active_shared_bands.gap ?? 0}px` : `0`}
  style:column-gap={legend || colorbar ? `${active_shared_bands.gap ?? 0}px` : `0`}
  bind:clientWidth={grid_width}
  bind:clientHeight={grid_height}
  onresize={(event) => update_grid_size(event.currentTarget)}
>
  {#if title && resolved_geometry.title}
    <div
      class="facet-grid-title"
      data-facet-slot="title"
      style:grid-row="1"
      style:grid-column="1 / -1"
    >
      {@render title(resolved_geometry.title)}
    </div>
  {/if}
  <div
    class="facet-grid-panels"
    data-rows={layout.rows}
    data-columns={layout.columns}
    style:grid-row={content_row}
    style:grid-column="1"
    style:grid-template-columns={`repeat(${layout.columns}, minmax(0, 1fr))`}
    style:grid-template-rows={layout.rows ? `repeat(${layout.rows}, minmax(0, 1fr))` : `none`}
    style:row-gap={`${row_gap}px`}
    style:column-gap={`${column_gap}px`}
  >
    {#each contexts as context (context.key)}
      <div
        class="facet-grid-panel"
        data-facet-key={context.key}
        data-row={context.row}
        data-column={context.column}
        style:grid-row={`${context.row + 1} / span ${context.row_span}`}
        style:grid-column={`${context.column + 1} / span ${context.column_span}`}
      >
        {@render children?.(context)}
      </div>
    {/each}
  </div>
  {#if legend && resolved_geometry.legend}
    <div
      class="facet-grid-legend"
      data-facet-slot="legend"
      style:grid-row={content_row}
      style:grid-column="2"
    >
      {@render legend(resolved_geometry.legend)}
    </div>
  {/if}
  {#if colorbar && resolved_geometry.colorbar}
    <div
      class="facet-grid-colorbar"
      data-facet-slot="colorbar"
      style:grid-row={content_row}
      style:grid-column={colorbar_column}
    >
      {@render colorbar(resolved_geometry.colorbar)}
    </div>
  {/if}
</div>

<style>
  .facet-grid {
    display: grid;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .facet-grid-panels {
    display: grid;
    min-width: 0;
    min-height: 0;
  }
  .facet-grid-panel {
    position: relative;
    min-width: 0;
    min-height: 0;
  }
  .facet-grid-title,
  .facet-grid-legend,
  .facet-grid-colorbar {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
</style>
