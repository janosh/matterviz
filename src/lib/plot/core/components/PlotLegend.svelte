<script lang="ts">
  import { add_alpha } from '$lib/colors'
  import { symbol_map } from '$lib/labels'
  import type { LegendItem, Orientation } from '$lib/plot'
  import PatternDefs from '$lib/plot/core/components/PatternDefs.svelte'
  import type { LegendItemExtent } from '$lib/plot/core/decorations/tracks'
  import {
    get_legend_grid_cells,
    suggest_legend_tracks,
  } from '$lib/plot/core/decorations/tracks'
  import type { FillPattern } from '$lib/plot/core/patterns'
  import { resolve_pattern } from '$lib/plot/core/patterns'
  import { unique_id } from '$lib/plot/core/utils'
  import { sanitize_html } from '$lib/sanitize'
  import { strip_html } from '$lib/utils'
  import {
    symbol as d3_symbol,
    symbolAsterisk,
    symbolCircle,
    symbolPlus,
    symbolTimes,
  } from 'd3-shape'
  import { onDestroy } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'

  // Unique instance ID to prevent gradient ID collisions when multiple legends render on the same page
  const instance_id = unique_id()
  // d3 symbols with no interior: the plot paints them by stroke, a fill would be invisible
  const open_symbols = new Set([symbolPlus, symbolTimes, symbolAsterisk])
  // Swatch-sized copy of a series' hatch/texture (half the plot's tile so a 12px box shows
  // a few repeats); ids are scoped per legend instance and item
  const swatch_pattern = (pattern: FillPattern | undefined, color: string, key: string) =>
    pattern ? resolve_pattern(pattern, color, `legend-${instance_id}-${key}`, 0.5) : undefined

  let {
    series_data = [],
    layout = `vertical`,
    layout_tracks = 1, // Default to 1 column/row
    available_edge_length = Number.POSITIVE_INFINITY,
    item_extents,
    style = ``,
    item_style = ``,
    collapsed_groups = $bindable(new SvelteSet<string>()),
    on_toggle = () => {},
    on_double_click = () => {},
    on_fill_toggle,
    on_fill_double_click,
    on_group_toggle,
    on_group_double_click,
    on_drag_start = () => {},
    on_drag = () => {},
    on_drag_end = () => {},
    on_hover_change,
    on_item_hover,
    active_series_idx = null,
    active_fill_idx = null,
    filterable = true,
    filter_threshold = 12,
    filter_query = $bindable(``),
    draggable = true,
    root_element = $bindable<HTMLDivElement | undefined>(undefined),
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `style`> & {
    series_data: LegendItem[]
    layout?: Orientation
    layout_tracks?: number | `auto` // Number of columns for horizontal, rows for vertical
    // Length available along the layout edge. Infinity keeps all auto tracks on one edge.
    available_edge_length?: number
    // Optional measured grid-cell extents in rendered child order (including group/filter cells).
    item_extents?: readonly (LegendItemExtent | undefined)[]
    style?: string // Inline styles forwarded to wrapper div
    item_style?: string
    // Bindable set of collapsed group names (pass initial values to collapse groups by default)
    collapsed_groups?: Set<string>
    on_toggle?: (series_idx: number) => void
    on_double_click?: (series_idx: number) => void
    on_fill_toggle?: (source_type: `fill_region` | `error_band`, source_idx: number) => void
    on_fill_double_click?: (
      source_type: `fill_region` | `error_band`,
      source_idx: number,
    ) => void
    on_group_toggle?: (group_name: string, series_indices: number[]) => void
    on_group_double_click?: (group_name: string, series_indices: number[]) => void
    on_drag_start?: (event: MouseEvent) => void
    on_drag?: (event: MouseEvent) => void
    on_drag_end?: (event: MouseEvent) => void
    // Callback when hover state changes (for placement stability)
    on_hover_change?: (is_hovered: boolean) => void
    on_item_hover?: (item: LegendItem | null) => void
    active_series_idx?: number | null
    active_fill_idx?: number | null // highlight the fill legend item with this fill_idx
    filterable?: boolean
    filter_threshold?: number
    filter_query?: string
    draggable?: boolean
    // Bindable reference to the root DOM element for size measurements
    root_element?: HTMLDivElement
  } = $props()

  let is_dragging = $state(false)

  let has_groups = $derived(series_data.some(({ legend_group }) => legend_group != null))
  let show_filter = $derived(filterable && series_data.length >= filter_threshold)

  const estimate_item_extent = (
    label: string,
    kind: `item` | `indented-item` | `group` | `filter` | `empty`,
  ): Required<LegendItemExtent> => {
    if (kind === `filter`) return { width: 160, height: 25 }
    const chrome_width =
      kind === `group` ? 27 : kind === `indented-item` ? 52 : kind === `item` ? 39 : 11
    return { width: Array.from(strip_html(label)).length * 7 + chrome_width, height: 20 }
  }

  let legend_grid_cells = $derived(
    get_legend_grid_cells({
      items: series_data.map((item) => ({
        label: strip_html(item.label),
        legend_group: item.legend_group,
      })),
      collapsed_groups,
      filter_query,
      show_filter,
    }),
  )

  // Model direct grid children in render order without feeding layout through a DOM observer.
  let auto_item_extents = $derived.by<LegendItemExtent[]>(() => {
    if (layout_tracks !== `auto`) return []
    return legend_grid_cells.map((cell, cell_idx) => {
      const item = cell.kind === `item` ? series_data[cell.item_idx] : undefined
      const estimate = estimate_item_extent(
        cell.kind === `empty`
          ? `No legend items`
          : cell.kind === `group`
            ? cell.group
            : (item?.label ?? ``),
        cell.kind === `item` ? (item?.legend_group ? `indented-item` : `item`) : cell.kind,
      )
      const measured = item_extents?.[cell_idx]
      return {
        width: measured?.width ?? estimate.width,
        height: measured?.height ?? estimate.height,
      }
    })
  })

  let resolved_layout_tracks = $derived(
    layout_tracks === `auto`
      ? Math.max(
          1,
          suggest_legend_tracks({
            item_count: auto_item_extents.length,
            orientation: layout,
            available_edge_length,
            item_extents: auto_item_extents,
          }),
        )
      : layout_tracks,
  )

  // Group header cells look up their members here instead of re-filtering series_data per cell
  const items_by_group = $derived.by(() => {
    const groups = new SvelteMap<string, LegendItem[]>()
    for (const item of series_data) {
      if (item.legend_group == null) continue
      const members = groups.get(item.legend_group)
      if (members) members.push(item)
      else groups.set(item.legend_group, [item])
    }
    return groups
  })

  function toggle_group_collapse(group_name: string) {
    // Normalize to SvelteSet if a plain Set was passed (ensures reactivity)
    if (!(collapsed_groups instanceof SvelteSet)) {
      collapsed_groups = new SvelteSet(collapsed_groups)
    }
    // Set.delete returns true if element existed, so add if delete failed
    if (!collapsed_groups.delete(group_name)) collapsed_groups.add(group_name)
  }

  const group_indices = (items: readonly LegendItem[]): number[] =>
    items.map(({ series_idx }) => series_idx)
  const handle_group_click = (group_name: string, items: readonly LegendItem[]) =>
    on_group_toggle?.(group_name, group_indices(items))

  // Window listeners live only for the duration of a drag
  let drag_controller: AbortController | undefined
  const end_drag = () => {
    drag_controller?.abort()
    drag_controller = undefined
    is_dragging = false
  }
  onDestroy(() => {
    end_drag()
    on_item_hover?.(null)
  })

  function handle_legend_mouse_down(event: MouseEvent) {
    if (!draggable) return
    // Only start drag from non-interactive legend areas
    const target = event.target
    if (target instanceof Element && target.closest(`.legend-item, .legend-group-header`))
      return
    event.preventDefault()
    event.stopPropagation()
    end_drag()
    is_dragging = true
    on_drag_start(event)
    drag_controller = new AbortController()
    const { signal } = drag_controller
    window.addEventListener(
      `mousemove`,
      (move_event) => {
        move_event.preventDefault()
        on_drag(move_event)
      },
      { signal },
    )
    window.addEventListener(
      `mouseup`,
      (up_event) => {
        end_drag()
        on_drag_end(up_event)
      },
      { signal },
    )
  }

  let div_style = $derived(
    {
      horizontal: `grid-template-columns: repeat(${resolved_layout_tracks}, auto);`,
      vertical: `grid-template-rows: repeat(${resolved_layout_tracks}, auto); grid-template-columns: auto;${
        resolved_layout_tracks > 1 ? ` grid-auto-flow: column;` : ``
      }`,
    }[layout] + style,
  )

  const run_item_action = (
    item: LegendItem,
    fill_action: typeof on_fill_toggle,
    series_action: (series_idx: number) => void,
  ): void => {
    on_item_hover?.(null)
    if (
      item.item_type === `fill` &&
      fill_action &&
      item.fill_source_type &&
      item.fill_source_idx !== undefined
    ) {
      fill_action(item.fill_source_type, item.fill_source_idx)
    } else series_action(item.series_idx)
  }
  const toggle_item = (item: LegendItem): void =>
    run_item_action(item, on_fill_toggle, on_toggle)
  const double_click_item = (item: LegendItem): void =>
    run_item_action(item, on_fill_double_click, on_double_click)

  const stop_and_run = (event: Event, action: () => void): void => {
    event.preventDefault()
    event.stopPropagation()
    action()
  }

  const keyboard_activate = (
    event: KeyboardEvent,
    action: () => void,
    stop_propagation = false,
  ): void => {
    if (event.key !== `Enter` && event.key !== ` `) return
    event.preventDefault()
    if (stop_propagation) event.stopPropagation()
    action()
  }
</script>

{#snippet legend_item(series: LegendItem, indent: boolean = false)}
  {@const is_fill_item = series.item_type === `fill`}
  {@const is_active = is_fill_item
    ? active_fill_idx === series.fill_idx
    : active_series_idx === series.series_idx}
  <div
    class="legend-item"
    class:hidden={!series.visible}
    class:active={is_active}
    class:indented={indent}
    class:fill-item={is_fill_item}
    style={item_style}
    onclick={(event) => stop_and_run(event, () => toggle_item(series))}
    ondblclick={(event) => stop_and_run(event, () => double_click_item(series))}
    onkeydown={(event) => keyboard_activate(event, () => toggle_item(series))}
    onmouseenter={() => on_item_hover?.(series)}
    onmouseleave={() => on_item_hover?.(null)}
    onfocus={() => on_item_hover?.(series)}
    onblur={() => on_item_hover?.(null)}
    role="button"
    tabindex="0"
    aria-pressed={series.visible}
    aria-label="Toggle visibility for {strip_html(series.label)}"
  >
    <span class="legend-marker">
      <!-- Fill region swatch -->
      {#if is_fill_item && (series.display_style.fill_color || series.display_style.fill_gradient)}
        {@const gradient = series.display_style.fill_gradient}
        {@const gradient_id = `legend-grad-${instance_id}-${series.fill_idx}`}
        {@const fill_color = add_alpha(series.display_style.fill_color ?? `steelblue`, 1)}
        <!-- as in FillArea, the swatch tint goes into the tile so the texture stays legible -->
        {@const pattern = gradient
          ? undefined
          : swatch_pattern(
              series.display_style.pattern,
              add_alpha(fill_color, 0.7),
              `fill-${series.fill_idx}`,
            )}
        <svg width="16" height="12" viewBox="0 0 16 12" class="fill-swatch">
          {#if pattern}
            <defs><PatternDefs patterns={[pattern]} /></defs>
          {/if}
          {#if gradient}
            <defs>
              {#if gradient.type === `linear`}
                <linearGradient
                  id={gradient_id}
                  gradientTransform="rotate({gradient.angle ?? 0}, 0.5, 0.5)"
                >
                  {#each gradient.stops as [offset, color], stop_idx (stop_idx)}
                    <stop offset="{offset * 100}%" stop-color={color} />
                  {/each}
                </linearGradient>
              {:else if gradient.type === `radial`}
                <radialGradient
                  id={gradient_id}
                  cx={gradient.center?.x ?? 0.5}
                  cy={gradient.center?.y ?? 0.5}
                  r="0.5"
                >
                  {#each gradient.stops as [offset, color], stop_idx (stop_idx)}
                    <stop offset="{offset * 100}%" stop-color={color} />
                  {/each}
                </radialGradient>
              {/if}
            </defs>
          {/if}
          <rect
            x="1"
            y="1"
            width="14"
            height="10"
            rx="2"
            fill={gradient ? `url(#${gradient_id})` : (pattern?.url ?? fill_color)}
            fill-opacity={pattern ? 1 : 0.7}
            stroke={series.display_style.edge_color ?? `none`}
            stroke-width="1"
          />
        </svg>
      {:else}
        <!-- Line segment -->
        {#if series.display_style.line_color}
          <svg width="20" height="10" viewBox="0 0 20 10">
            <line
              x1="0"
              y1="5"
              x2="20"
              y2="5"
              stroke={series.display_style.line_color ?? `currentColor`}
              stroke-width="2"
              stroke-dasharray={series.display_style.line_dash ?? `none`}
            />
          </svg>
        {/if}

        <!-- Marker symbol: the same d3 outline the plot draws, filled unless the shape is
             a bare set of strokes -->
        {#if series.display_style.symbol_type}
          {@const color = series.display_style.symbol_color ?? `currentColor`}
          {@const shape = symbol_map[series.display_style.symbol_type] ?? symbolCircle}
          {@const stroke_only = open_symbols.has(shape)}
          {@const pattern = stroke_only
            ? undefined
            : swatch_pattern(series.display_style.pattern, color, `${series.series_idx}`)}
          <!-- size(50) reaches +-6.7 for the star and diamond, so the box is 14 wide -->
          <svg width="12" height="12" viewBox="-7 -7 14 14">
            {#if pattern}
              <defs><PatternDefs patterns={[pattern]} /></defs>
            {/if}
            <path
              d={d3_symbol().type(shape).size(50)() ?? ``}
              fill={stroke_only ? `none` : (pattern?.url ?? color)}
              stroke={stroke_only ? color : `none`}
              stroke-width="1.5"
            />
          </svg>
        {/if}
      {/if}
    </span>
    <span class="legend-label">{@html sanitize_html(series.label)}</span>
  </div>
{/snippet}

<div
  bind:this={root_element}
  onmousedown={handle_legend_mouse_down}
  onmouseenter={() => on_hover_change?.(true)}
  onmouseleave={() => on_hover_change?.(false)}
  {...rest}
  style={div_style}
  class={[`legend`, rest.class]}
  class:draggable
  class:is-dragging={is_dragging}
  class:grouped={has_groups}
>
  {#each legend_grid_cells as cell}
    {#if cell.kind === `filter`}
      <input
        class="legend-filter"
        type="search"
        bind:value={filter_query}
        placeholder="Filter legend"
        aria-label="Filter legend items"
        onclick={(event) => event.stopPropagation()}
        onmousedown={(event) => event.stopPropagation()}
      />
    {:else if cell.kind === `empty`}
      <span style="padding: var(--plot-legend-item-padding, 1px 8px 1px 3px); opacity: 0.7"
        >No legend items</span
      >
    {:else if cell.kind === `group`}
      {@const group_items = items_by_group.get(cell.group) ?? []}
      {@const is_collapsed = collapsed_groups.has(cell.group)}
      {@const group_visible = group_items.some((item) => item.visible)}
      <div
        class={['legend-group-header', { hidden: !group_visible }]}
        onclick={(event) =>
          stop_and_run(event, () => handle_group_click(cell.group, group_items))}
        ondblclick={(event) =>
          stop_and_run(event, () =>
            on_group_double_click?.(cell.group, group_indices(group_items)),
          )}
        onkeydown={(event) =>
          keyboard_activate(event, () => handle_group_click(cell.group, group_items))}
        role="button"
        tabindex="0"
        aria-expanded={!is_collapsed}
        aria-label="Toggle group {strip_html(cell.group)}"
      >
        <span
          class={['group-chevron', { collapsed: is_collapsed }]}
          onclick={(event) => stop_and_run(event, () => toggle_group_collapse(cell.group))}
          onkeydown={(event) =>
            keyboard_activate(event, () => toggle_group_collapse(cell.group), true)}
          role="button"
          tabindex="0"
          aria-label="{is_collapsed ? `Expand` : `Collapse`} group {strip_html(cell.group)}"
        >
          ▶
        </span>
        <span class="group-label">{@html sanitize_html(cell.group)}</span>
      </div>
    {:else}
      {@const series = series_data[cell.item_idx]}
      {#if series}
        {@render legend_item(series, series.legend_group != null)}
      {/if}
    {/if}
  {/each}
</div>

<style>
  .legend {
    display: grid;
    gap: 1px 6px; /* row-gap column-gap */
    background-color: var(
      --plot-legend-bg-color,
      light-dark(rgba(255, 255, 255, 0.75), rgba(40, 40, 40, 0.75))
    );
    border: var(--plot-legend-border);
    border-radius: var(--plot-legend-border-radius, var(--border-radius, 3pt));
    font-size: var(--plot-legend-font-size, 0.8em);
    max-width: var(--plot-legend-max-width);
    width: fit-content;
    /* cap height so legends with many series don't overflow the plot; scroll the rest.
    % resolves against the (position: relative) plot wrapper's height. */
    max-height: var(--plot-legend-max-height, 80%);
    overflow-y: auto;
    z-index: var(--plot-legend-z-index, 2);
    box-sizing: border-box;
  }
  .legend.draggable {
    cursor: grab;
  }
  .legend.draggable:active {
    cursor: grabbing;
  }
  .legend.is-dragging {
    cursor: move;
    user-select: none;
  }
  .legend-item {
    display: flex;
    align-items: center;
    cursor: pointer;
    white-space: nowrap;
    padding: var(--plot-legend-item-padding, 1px 8px 1px 3px);
    opacity: var(--plot-legend-item-opacity, 1);
    transition: var(--plot-legend-item-transition, opacity 0.3s ease);
    color: var(--plot-legend-item-color);
  }
  .legend-filter {
    box-sizing: border-box;
    width: calc(100% - 6px);
    min-width: 10em;
    margin: 3px;
    padding: 2px 5px;
    border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    border-radius: var(--border-radius, 3pt);
    background: color-mix(in srgb, var(--plot-legend-bg-color, Canvas) 88%, currentColor);
    color: inherit;
    font: inherit;
  }
  .legend-item.indented {
    padding: var(--plot-legend-item-padding, 0 8px 1px 3px);
    padding-left: var(--plot-legend-group-indent, 16px);
  }
  .legend-item.hidden {
    opacity: var(--plot-legend-item-hidden-opacity, 0.5);
  }
  /* ~21px rows are hard to tap; taller rows cost legend height, which the solver measures */
  @media (pointer: coarse) {
    .legend-item,
    .legend-group-header {
      padding-block: 4px;
    }
  }
  .legend-item:hover,
  .legend-item:focus,
  .legend-item.active {
    background-color: var(--plot-legend-item-hover-bg-color);
  }
  .legend-item.active {
    box-shadow: inset 2px 0 0 var(--accent-color, currentColor);
  }
  .legend-marker {
    display: inline-flex; /* Use flex to align items */
    align-items: center; /* Vertically center items */
    justify-content: center; /* Horizontally center items */
    width: var(--plot-legend-marker-width, 25px); /* Fixed width for alignment */
    margin: var(--plot-legend-marker-margin, 0 3px 0 0);
    /* Prevent extra space from svg */
    line-height: var(--plot-legend-marker-line-height, 0);
  }
  .legend-marker svg {
    vertical-align: middle;
  }
  .legend-marker svg.fill-swatch {
    margin-left: 2px;
  }
  .legend-item.fill-item .legend-marker {
    width: var(--plot-legend-fill-marker-width, 20px);
  }
  /* Group header styles */
  .legend-group-header {
    display: flex;
    align-items: center;
    cursor: pointer;
    white-space: nowrap;
    padding: var(--plot-legend-group-padding, 2px 8px 0 3px);
    font-weight: var(--plot-legend-group-font-weight, 600);
    color: var(--plot-legend-group-color, inherit);
    opacity: var(--plot-legend-group-opacity, 1);
    transition: var(--plot-legend-item-transition, opacity 0.3s ease);
  }
  .legend-group-header.hidden {
    opacity: var(--plot-legend-item-hidden-opacity, 0.5);
  }
  .legend-group-header:hover,
  .legend-group-header:focus {
    background-color: var(--plot-legend-item-hover-bg-color);
  }
  .group-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
    margin-right: 4px;
    font-size: 0.6em;
    transition: transform 0.15s ease;
    transform: rotate(90deg);
    cursor: pointer;
  }
  .group-chevron.collapsed {
    transform: rotate(0deg);
  }
  .group-chevron:hover {
    color: var(--accent-color, #4a90d9);
  }
</style>
