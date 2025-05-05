<script lang="ts">
  import type { LegendItem } from '$lib/plot'

  interface Props {
    series_data: LegendItem[] // Use the simplified LegendItem type
    layout?: `horizontal` | `vertical`
    layout_tracks?: number // Number of columns for horizontal, rows for vertical
    wrapper_style?: string
    item_style?: string
    on_toggle?: (series_idx: number) => void
    on_double_click?: (series_idx: number) => void
  }
  let {
    series_data = [],
    layout = `vertical`,
    layout_tracks = 1, // Default to 1 column/row
    wrapper_style = ``,
    item_style = ``,
    on_toggle = () => {},
    on_double_click = () => {},
  }: Props = $props()

  function handle_click(event: MouseEvent, series_idx: number) {
    event.preventDefault() // Prevent any default browser behavior
    event.stopPropagation() // Prevent event bubbling to SVG
    on_toggle(series_idx)
  }

  function handle_double_click(event: MouseEvent, series_idx: number) {
    event.preventDefault()
    event.stopPropagation()
    on_double_click(series_idx)
  }

  let grid_template_style = $derived.by(() => {
    if (layout === `horizontal`) {
      // n_items defines columns
      return `grid-template-columns: repeat(${layout_tracks}, auto);`
    } else {
      // n_items defines rows (less common for legends, usually 1 column)
      // If vertical, usually just one column, n_items might not be intuitive.
      // Let's assume vertical always means 1 column unless n_items forces rows.
      return `grid-template-rows: repeat(${layout_tracks}, auto); grid-template-columns: auto;`
    }
  })
</script>

<div class="legend" style="{wrapper_style} {grid_template_style}">
  {#each series_data as series (series.series_idx)}
    <div
      class="legend-item {series.visible ? `` : `hidden`}"
      style={item_style}
      onclick={(event) => handle_click(event, series.series_idx)}
      ondblclick={(event) => handle_double_click(event, series.series_idx)}
      onkeydown={(event) => {
        if (event.key === `Enter` || event.key === ` `) {
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
      <span class="legend-label">{series.label}</span>
    </div>
  {/each}
</div>

<style>
  .legend {
    display: grid;
    gap: 5px 10px; /* row-gap column-gap */
    background-color: var(--plot-legend-background-color, rgba(0, 0, 0, 0.2));
    border: var(--plot-legend-border, 1px solid rgba(255, 255, 255, 0.4));
    border-radius: var(--plot-legend-border-radius, 3px);
    font-size: var(--plot-legend-font-size, 0.9em);
    max-width: var(--plot-legend-max-width);
    z-index: var(--plot-legend-z-index, 2);
    box-sizing: border-box;
  }
  .legend-item {
    display: flex;
    align-items: center;
    cursor: pointer;
    white-space: nowrap;
    padding: var(--plot-legend-item-padding, 0 5px);
    opacity: var(--plot-legend-item-opacity, 1);
    transition: var(--plot-legend-item-transition, opacity 0.3s ease);
    color: var(--plot-legend-item-color, inherit);
  }
  .legend-item.hidden {
    opacity: var(--plot-legend-item-hidden-opacity, 0.5);
  }
  .legend-item:hover,
  .legend-item:focus {
    background-color: var(
      --plot-legend-item-hover-background-color,
      rgba(255, 255, 255, 0.1)
    );
  }
  .legend-marker {
    display: inline-flex; /* Use flex to align items */
    align-items: center; /* Vertically center items */
    justify-content: center; /* Horizontally center items */
    width: var(--plot-legend-marker-width, 25px); /* Fixed width for alignment */
    margin: var(--plot-legend-marker-margin, 0 5px 0 0);
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
