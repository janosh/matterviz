<script lang="ts">
  import type { LegendItem, Orientation } from '$lib/plot'
  import { onDestroy } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'

  // Unique instance ID to prevent gradient ID collisions when multiple legends render on the same page
  const instance_id = crypto.randomUUID().slice(0, 8)

  let {
    series_data = [],
    layout = `vertical`,
    layout_tracks = 1, // Default to 1 column/row
    style = ``,
    item_style = ``,
    on_toggle = () => {},
    on_double_click = () => {},
    on_fill_toggle,
    on_fill_double_click,
    on_group_toggle,
    on_group_double_click,
    on_drag_start = () => {},
    on_drag = () => {},
    on_drag_end = () => {},
    draggable = true,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `style`> & {
    series_data: LegendItem[]
    layout?: Orientation
    layout_tracks?: number // Number of columns for horizontal, rows for vertical
    style?: string // Inline styles forwarded to wrapper div
    item_style?: string
    on_toggle?: (series_idx: number) => void
    on_double_click?: (series_idx: number) => void
    on_fill_toggle?: (
      source_type: `fill_region` | `error_band`,
      source_idx: number,
    ) => void
    on_fill_double_click?: (
      source_type: `fill_region` | `error_band`,
      source_idx: number,
    ) => void
    on_group_toggle?: (group_name: string, series_indices: number[]) => void
    on_group_double_click?: (group_name: string, series_indices: number[]) => void
    on_drag_start?: (event: MouseEvent) => void
    on_drag?: (event: MouseEvent) => void
    on_drag_end?: (event: MouseEvent) => void
    draggable?: boolean
  } = $props()

  let is_dragging = $state(false)
  let drag_start_coords = $state<{ x: number; y: number } | null>(null)
  // Track collapsed groups
  let collapsed_groups = new SvelteSet<string>()

  // Group series by legend_group, preserving order
  type GroupedData = { group_name: string | null; items: LegendItem[] }
  let grouped_series = $derived.by<GroupedData[]>(() => {
    const groups: GroupedData[] = []
    const group_map = new SvelteMap<string | null, LegendItem[]>()

    for (const item of series_data) {
      const group_key = item.legend_group ?? null
      if (!group_map.has(group_key)) {
        group_map.set(group_key, [])
        groups.push({ group_name: group_key, items: group_map.get(group_key)! })
      }
      group_map.get(group_key)!.push(item)
    }
    return groups
  })

  // Check if any grouping is present
  let has_groups = $derived(
    grouped_series.some((group) =>
      group.group_name !== null && group.items.length > 0
    ),
  )

  function toggle_group_collapse(group_name: string) {
    // Set.delete returns true if element existed, so add if delete failed
    if (!collapsed_groups.delete(group_name)) collapsed_groups.add(group_name)
  }

  const handle_group_click = (group_name: string, items: LegendItem[]) =>
    on_group_toggle?.(group_name, items.map((item) => item.series_idx))

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
  onDestroy(cleanup_drag_listeners)

  function handle_legend_mouse_down(event: MouseEvent) {
    if (!draggable) return

    // Only start drag if clicking on empty areas (not on legend items)
    const target = event.target as HTMLElement
    if (target.closest(`.legend-item`)) return

    event.preventDefault()
    event.stopPropagation()

    is_dragging = true
    drag_start_coords = { x: event.clientX, y: event.clientY }

    on_drag_start(event)

    // Add global event listeners
    window.addEventListener(`mousemove`, handle_window_mouse_move)
    window.addEventListener(`mouseup`, handle_window_mouse_up)
  }

  function handle_window_mouse_move(event: MouseEvent) {
    if (!is_dragging || !drag_start_coords) return

    event.preventDefault()
    on_drag(event)
  }

  function handle_window_mouse_up(event: MouseEvent) {
    if (!is_dragging) return

    is_dragging = false
    drag_start_coords = null

    on_drag_end(event)

    // Remove global event listeners
    window.removeEventListener(`mousemove`, handle_window_mouse_move)
    window.removeEventListener(`mouseup`, handle_window_mouse_up)
  }

  let div_style = $derived(
    {
      horizontal: `grid-template-columns: repeat(${layout_tracks}, auto);`,
      vertical:
        `grid-template-rows: repeat(${layout_tracks}, auto); grid-template-columns: auto;`,
    }[layout] + style,
  )

  // Extracted toggle handlers to reduce duplication
  function toggle_item(item: LegendItem) {
    if (
      item.item_type === `fill` && on_fill_toggle && item.fill_source_type &&
      item.fill_source_idx !== undefined
    ) {
      on_fill_toggle(item.fill_source_type, item.fill_source_idx)
    } else on_toggle(item.series_idx)
  }
  function double_click_item(item: LegendItem) {
    if (
      item.item_type === `fill` && on_fill_double_click && item.fill_source_type &&
      item.fill_source_idx !== undefined
    ) {
      on_fill_double_click(item.fill_source_type, item.fill_source_idx)
    } else on_double_click(item.series_idx)
  }
</script>

{#snippet legend_item(series: LegendItem, indent: boolean = false)}
  {@const is_fill_item = series.item_type === `fill`}
  <div
    class="legend-item"
    class:hidden={!series.visible}
    class:indented={indent}
    class:fill-item={is_fill_item}
    style={item_style}
    onclick={(event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      toggle_item(series)
    }}
    ondblclick={(event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      double_click_item(series)
    }}
    onkeydown={(event) => {
      if ([`Enter`, ` `].includes(event.key)) {
        event.preventDefault()
        toggle_item(series)
      }
    }}
    role="button"
    tabindex="0"
    aria-pressed={series.visible}
    aria-label="Toggle visibility for {series.label}"
  >
    <span class="legend-marker">
      <!-- Fill region swatch -->
      {#if is_fill_item &&
        (series.display_style.fill_color || series.display_style.fill_gradient)}
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
            : (series.display_style.fill_color ?? `steelblue`)}
            fill-opacity={series.display_style.fill_opacity ?? 0.3}
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
    <span class="legend-label">{@html series.label}</span>
  </div>
{/snippet}

<div
  onmousedown={handle_legend_mouse_down}
  {...rest}
  style={div_style}
  class="legend {rest.class ?? ``}"
  class:draggable
  class:is-dragging={is_dragging}
  class:grouped={has_groups}
>
  {#each grouped_series as { group_name, items } (group_name ?? `__ungrouped__`)}
    {#if group_name !== null && has_groups}
      <!-- Group header -->
      {@const is_collapsed = collapsed_groups.has(group_name)}
      {@const group_visible = items.some((item) => item.visible)}
      <div
        class="legend-group-header"
        class:hidden={!group_visible}
        onclick={(event: MouseEvent) => {
          event.preventDefault()
          event.stopPropagation()
          handle_group_click(group_name, items)
        }}
        ondblclick={(event: MouseEvent) => {
          event.preventDefault()
          event.stopPropagation()
          on_group_double_click?.(group_name, items.map((item) => item.series_idx))
        }}
        onkeydown={(event) => {
          if ([`Enter`, ` `].includes(event.key)) {
            event.preventDefault()
            handle_group_click(group_name, items)
          }
        }}
        role="button"
        tabindex="0"
        aria-expanded={!is_collapsed}
        aria-label="Toggle group {group_name}"
      >
        <span
          class="group-chevron"
          class:collapsed={is_collapsed}
          onclick={(event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
            toggle_group_collapse(group_name)
          }}
          onkeydown={(event) => {
            if ([`Enter`, ` `].includes(event.key)) {
              event.preventDefault()
              event.stopPropagation()
              toggle_group_collapse(group_name)
            }
          }}
          role="button"
          tabindex="0"
          aria-label="{is_collapsed ? `Expand` : `Collapse`} group {group_name}"
        >
          ▶
        </span>
        <span class="group-label">{@html group_name}</span>
      </div>
      <!-- Group items (collapsible) -->
      {#if !is_collapsed}
        {#each items as
          series
          (series.item_type === `fill`
      ? `fill-${series.fill_idx}`
      : `series-${series.series_idx}`)
        }
          {@render legend_item(series, true)}
        {/each}
      {/if}
    {:else}
      <!-- Ungrouped items -->
      {#each items as
        series
        (series.item_type === `fill`
      ? `fill-${series.fill_idx}`
      : `series-${series.series_idx}`)
      }
        {@render legend_item(series, false)}
      {/each}
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
  .legend-item.indented {
    padding: var(--plot-legend-item-padding, 0 8px 1px 3px);
    padding-left: var(--plot-legend-group-indent, 16px);
  }
  .legend-item.hidden {
    opacity: var(--plot-legend-item-hidden-opacity, 0.5);
  }
  .legend-item:hover, .legend-item:focus {
    background-color: var(--plot-legend-item-hover-bg-color);
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
  .legend-label {
    display: inline-block;
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
  .legend-group-header:hover, .legend-group-header:focus {
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
  .group-label {
    display: inline-block;
  }
</style>
