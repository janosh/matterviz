<script lang="ts">
  import type { LegendItem, Orientation } from '$lib/plot'
  import { onDestroy } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    series_data: LegendItem[]
    layout?: Orientation
    layout_tracks?: number // Number of columns for horizontal, rows for vertical
    wrapper_style?: string
    item_style?: string
    on_toggle?: (series_idx: number) => void
    on_double_click?: (series_idx: number) => void
    on_drag_start?: (event: MouseEvent) => void
    on_drag?: (event: MouseEvent) => void
    on_drag_end?: (event: MouseEvent) => void
    draggable?: boolean
  }
  let {
    series_data = [],
    layout = `vertical`,
    layout_tracks = 1, // Default to 1 column/row
    wrapper_style = ``,
    item_style = ``,
    on_toggle = () => {},
    on_double_click = () => {},
    on_drag_start = () => {},
    on_drag = () => {},
    on_drag_end = () => {},
    draggable = true,
    ...rest
  }: Props = $props()

  let is_dragging = $state(false)
  let drag_start_coords = $state<{ x: number; y: number } | null>(null)

  // Cleanup function prevents memory leaks on component destroy (remove event listeners and reset styles)
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
    }[layout] + wrapper_style + (rest.style ?? ``),
  )
</script>

<div
  onmousedown={handle_legend_mouse_down}
  {...rest}
  style={div_style}
  class="legend {draggable ? `draggable` : ``} {is_dragging ? `is-dragging` : ``} {rest.class ?? ``}"
>
  {#each series_data as series (series.series_idx)}
    <div
      class="legend-item {series.visible ? `` : `hidden`}"
      style={item_style}
      onclick={(event: MouseEvent) => {
        event.preventDefault() // Prevent any default browser behavior
        event.stopPropagation() // Prevent event bubbling to SVG
        on_toggle(series.series_idx)
      }}
      ondblclick={(event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        on_double_click(series.series_idx)
      }}
      onkeydown={(event) => {
        if ([`Enter`, ` `].includes(event.key)) {
          event.preventDefault()
          on_toggle(series.series_idx)
        }
      }}
      role="button"
      tabindex="0"
      aria-pressed={series.visible}
      aria-label="Toggle visibility for {series.label}"
    >
      <span class="legend-marker">
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
          <svg width="10" height="10" viewBox="0 0 10 10">
            {#if series.display_style.symbol_type === `Circle`}
              <circle
                cx="5"
                cy="5"
                r="4"
                fill={series.display_style.symbol_color ?? `currentColor`}
              />
            {:else if series.display_style.symbol_type === `Square`}
              <rect
                x="1"
                y="1"
                width="8"
                height="8"
                fill={series.display_style.symbol_color ?? `currentColor`}
              />
            {:else if series.display_style.symbol_type === `Triangle`}
              <polygon
                points="5,1 9,9 1,9"
                fill={series.display_style.symbol_color ?? `currentColor`}
              />
            {:else if series.display_style.symbol_type === `Cross`}
              <path
                d="M2 2 L8 8 M2 8 L8 2"
                stroke={series.display_style.symbol_color ?? `currentColor`}
                stroke-width="2"
                fill="none"
              />
            {:else if series.display_style.symbol_type === `Star`}
              <polygon
                points="5,0 6.1,3.5 9.8,4.1 7.4,6.7 7.9,10 5,8.3 2.1,10 2.6,6.7 0.2,4.1 3.9,3.5"
                fill={series.display_style.symbol_color ?? `currentColor`}
              />
            {/if}
          </svg>
        {/if}
      </span>
      <span class="legend-label">{@html series.label}</span>
    </div>
  {/each}
</div>

<style>
  .legend {
    display: grid;
    gap: 1px 6px; /* row-gap column-gap */
    background-color: var(--plot-legend-bg-color);
    border: var(--plot-legend-border);
    border-radius: var(--plot-legend-border-radius, 3px);
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
    padding: var(--plot-legend-item-padding, 1px 3px);
    opacity: var(--plot-legend-item-opacity, 1);
    transition: var(--plot-legend-item-transition, opacity 0.3s ease);
    color: var(--plot-legend-item-color);
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
  .legend-label {
    display: inline-block;
  }
</style>
