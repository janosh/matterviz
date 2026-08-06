<script lang="ts">
  import { add_alpha } from '$lib/colors'
  import type { LegendItem, Orientation } from '$lib/plot'
  import {
    get_legend_grid_cells,
    suggest_legend_tracks,
    type LegendItemExtent,
  } from '$lib/plot/core/decorations/tracks'
  import { unique_id } from '$lib/plot/core/utils'
  import { sanitize_html } from '$lib/sanitize'
  import { strip_html } from '$lib/table'
  import { onDestroy } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'

  // Unique instance ID to prevent gradient ID collisions when multiple legends render on the same page
  const instance_id = unique_id()

  let {
    series_data = [],
    layout = `vertical`,
    layout_tracks = 1, // Default to 1 column/row
    available_edge_length = Number.POSITIVE_INFINITY,
    item_extents,
    estimated_item_extent,
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
    estimated_item_extent?: LegendItemExtent
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
        width: measured?.width ?? estimated_item_extent?.width ?? estimate.width,
        height: measured?.height ?? estimated_item_extent?.height ?? estimate.height,
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

  function toggle_group_collapse(group_name: string) {
    // Normalize to SvelteSet if a plain Set was passed (ensures reactivity)
    if (!(collapsed_groups instanceof SvelteSet)) {
      collapsed_groups = new SvelteSet(collapsed_groups)
    }
    // Set.delete returns true if element existed, so add if delete failed
    if (!collapsed_groups.delete(group_name)) collapsed_groups.add(group_name)
  }

  const handle_group_click = (group_name: string, items: readonly LegendItem[]) =>
    on_group_toggle?.(
      group_name,
      items.map((item) => item.series_idx),
    )

  function cleanup_drag_listeners() {
    if (is_dragging) {
      // Remove global event listeners
      window.removeEventListener(`mousemove`, handle_window_mouse_move)
      window.removeEventListener(`mouseup`, handle_window_mouse_up)

      // Reset cursor and text selection
      document.body.style.cursor = `default`
      document.body.style.userSelect = `auto`
    }
  }
  onDestroy(() => {
    cleanup_drag_listeners()
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

    is_dragging = true

    on_drag_start(event)

    // Add global event listeners
    window.addEventListener(`mousemove`, handle_window_mouse_move)
    window.addEventListener(`mouseup`, handle_window_mouse_up)
  }

  function handle_window_mouse_move(event: MouseEvent) {
    if (!is_dragging) return

    event.preventDefault()
    on_drag(event)
  }

  function handle_window_mouse_up(event: MouseEvent) {
    if (!is_dragging) return

    is_dragging = false

    on_drag_end(event)

    // Remove global event listeners
    window.removeEventListener(`mousemove`, handle_window_mouse_move)
    window.removeEventListener(`mouseup`, handle_window_mouse_up)
  }

  let div_style = $derived(
    {
      horizontal: `grid-template-columns: repeat(${resolved_layout_tracks}, auto);`,
      vertical: `grid-template-rows: repeat(${resolved_layout_tracks}, auto); grid-template-columns: auto;${
        resolved_layout_tracks > 1 ? ` grid-auto-flow: column;` : ``
      }`,
    }[layout] + style,
  )

  // Extracted toggle handlers to reduce duplication
  function toggle_item(item: LegendItem) {
    if (
      item.item_type === `fill` &&
      on_fill_toggle &&
      item.fill_source_type &&
      item.fill_source_idx !== undefined
    ) {
      on_fill_toggle(item.fill_source_type, item.fill_source_idx)
    } else on_toggle(item.series_idx)
  }
  function double_click_item(item: LegendItem) {
    if (
      item.item_type === `fill` &&
      on_fill_double_click &&
      item.fill_source_type &&
      item.fill_source_idx !== undefined
    ) {
      on_fill_double_click(item.fill_source_type, item.fill_source_idx)
    } else on_double_click(item.series_idx)
  }

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
        <svg width="16" height="12" viewBox="0 0 16 12" class="fill-swatch">
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
            fill={gradient
              ? `url(#${gradient_id})`
              : add_alpha(series.display_style.fill_color ?? `steelblue`, 1)}
            fill-opacity="0.7"
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

        <!-- Marker symbol -->
        {#if series.display_style.symbol_type}
          {@const color = series.display_style.symbol_color ?? `currentColor`}
          <svg width="10" height="10" viewBox="0 0 10 10">
            {#if series.display_style.symbol_type === `Circle`}
              <circle cx="5" cy="5" r="4" fill={color} />
            {:else if series.display_style.symbol_type === `Square`}
              <rect x="1" y="1" width="8" height="8" fill={color} />
            {:else if series.display_style.symbol_type === `Triangle`}
              <polygon points="5,1 9,9 1,9" fill={color} />
            {:else if series.display_style.symbol_type === `Cross`}
              <polygon
                points="4,0 6,0 6,4 10,4 10,6 6,6 6,10 4,10 4,6 0,6 0,4 4,4"
                fill={color}
              />
            {:else if series.display_style.symbol_type === `Star`}
              <polygon
                points="5,0 6.1,3.5 9.8,4.1 7.4,6.7 7.9,10 5,8.3 2.1,10 2.6,6.7 0.2,4.1 3.9,3.5"
                fill={color}
              />
            {/if}
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
      {@const group_items = series_data.filter(
        ({ legend_group }) => legend_group === cell.group,
      )}
      {@const is_collapsed = collapsed_groups.has(cell.group)}
      {@const group_visible = group_items.some((item) => item.visible)}
      <div
        class="legend-group-header"
        class:hidden={!group_visible}
        onclick={(event) =>
          stop_and_run(event, () => handle_group_click(cell.group, group_items))}
        ondblclick={(event) =>
          stop_and_run(event, () =>
            on_group_double_click?.(
              cell.group,
              group_items.map((item) => item.series_idx),
            ),
          )}
        onkeydown={(event) =>
          keyboard_activate(event, () => handle_group_click(cell.group, group_items))}
        role="button"
        tabindex="0"
        aria-expanded={!is_collapsed}
        aria-label="Toggle group {strip_html(cell.group)}"
      >
        <span
          class="group-chevron"
          class:collapsed={is_collapsed}
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
