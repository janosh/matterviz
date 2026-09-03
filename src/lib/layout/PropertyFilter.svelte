<script lang="ts">
  import { Icon } from 'svelte-widgets'
  import { Close } from 'svelte-widgets/icons'
  import { sanitize_html } from '$lib/sanitize'
  import { strip_html } from '$lib/utils'
  import type { AxisConfig, HistogramSeries } from '$lib/plot'
  import { Histogram } from '$lib/plot'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    label,
    min_value = $bindable(),
    max_value = $bindable(),
    placeholders = {},
    title,
    histogram_data,
    histogram_height = 30,
    histogram_position = `top`,
    log = false,
    disabled = false,
    unit,
    on_change,
    on_clear,
    ...rest
  }: {
    label: string // Label text (supports HTML)
    min_value?: number // Minimum value for filtering (undefined = unbounded)
    max_value?: number // Maximum value for filtering (undefined = unbounded)
    placeholders?: { min?: string; max?: string } // Placeholder text for min/max inputs
    title?: string // Tooltip title for the label
    histogram_data?: number[] // Data array for histogram visualization
    histogram_height?: number // Height of histogram in pixels
    histogram_position?: `top` | `bottom` | `none` // Position of histogram relative to inputs, or 'none' to hide
    log?: boolean // Use logarithmic scale for histogram y-axis
    disabled?: boolean // Disable all inputs
    unit?: string // Unit label to display after inputs
    on_change?: (min: number | undefined, max: number | undefined) => void // Callback when filter values change
    on_clear?: () => void // Callback when clear button is clicked (fires before on_change)
  } & HTMLAttributes<HTMLDivElement> = $props()

  // Where the histogram renders (none without data)
  const histogram_at = $derived(histogram_data?.length ? histogram_position : `none`)
  // Active when either bound is set (undefined = unbounded)
  const active = $derived(min_value !== undefined || max_value !== undefined)
  const plain_label = $derived(strip_html(label))

  function onkeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
    if (event.key === `Enter`) {
      event.preventDefault()
      event.currentTarget.blur()
    } else if (event.key === `Escape` && active) {
      event.preventDefault()
      clear_filter()
    }
  }

  function clear_filter(): void {
    min_value = undefined
    max_value = undefined
    on_clear?.()
    on_change?.(undefined, undefined)
  }

  const axis_config: AxisConfig = {
    ticks: 0,
    label: ``,
    grid_style: { style: `opacity: 0` },
    tick_label: { inside: true },
    color: `color-mix(in srgb, currentColor 60%, transparent)`,
  }

  const series: HistogramSeries[] = $derived.by(() => {
    const all = histogram_data ?? []
    const [min, max] = [min_value ?? -Infinity, max_value ?? Infinity]
    return [
      { values: all, color: `rgba(0, 0, 0, 0.2)`, label: `All` },
      {
        values: all.filter((val) => val >= min && val <= max),
        color: `var(--accent-color, #228be6)`,
        label: `Filtered`,
      },
    ]
  })
</script>

{#snippet histogram_snippet()}
  <Histogram
    {series}
    mode="overlay"
    bins={50}
    show_controls={false}
    show_legend={false}
    x_axis={{ ...axis_config, ticks: 3 }}
    y_axis={{
      ticks: 0,
      label: ``,
      color: `transparent`,
      scale_type: log ? `log` : `linear`,
    }}
    display={{ y_grid: false, x_grid: false }}
    padding={{ t: 0, b: 12, l: 2, r: 2 }}
    bar={{ stroke_width: 0, border_radius: 1, opacity: 0.5 }}
    style="--histogram-min-height: {histogram_height}px; --histogram-svg-height: 0; --histogram-bg: transparent"
    fullscreen_toggle={false}
    range_padding={0}
  />
  {#if log}<span class="log-label">log</span>{/if}
{/snippet}

<div class:active class:disabled {...rest} class={[`filter-container`, rest.class]}>
  {#if histogram_at === `top`}
    {@render histogram_snippet()}
  {/if}
  <div class="filter-row">
    <span {title} class="filter-label">{@html sanitize_html(label)}</span>
    <div class="filter-inputs">
      <input
        bind:value={min_value}
        type="number"
        step="any"
        placeholder={placeholders.min ?? `min`}
        {onkeydown}
        onblur={() => on_change?.(min_value, max_value)}
        {disabled}
        aria-label="{plain_label} minimum"
      />
      <input
        bind:value={max_value}
        type="number"
        step="any"
        placeholder={placeholders.max ?? `max`}
        {onkeydown}
        onblur={() => on_change?.(min_value, max_value)}
        {disabled}
        aria-label="{plain_label} maximum"
      />
      {#if unit}<span class="unit-label">{unit}</span>{/if}
      {#if active && !disabled}
        <button
          type="button"
          class="clear-btn"
          onclick={clear_filter}
          title="Clear filter (Escape)"
          aria-label="Clear filter"
        >
          <Icon icon={Close} style="width: 12px; height: 12px" />
        </button>
      {/if}
    </div>
  </div>
  {#if histogram_at === `bottom`}
    {@render histogram_snippet()}
  {/if}
</div>

<style>
  .filter-container {
    display: flex;
    flex-direction: column;
    position: relative;
    padding: 4pt 8pt;
    border-radius: 6px;
    transition: all 0.15s;
    background: var(--filter-bg, rgba(128, 128, 128, 0.05));
    &.active {
      background: var(--filter-active-bg, rgba(77, 182, 255, 0.08));
    }
    &.disabled {
      opacity: 0.5;
      pointer-events: none;
    }
  }
  .filter-row {
    display: flex;
    align-items: center;
    gap: 8pt;
  }
  .log-label {
    position: absolute;
    top: 2pt;
    right: 4pt;
    font-size: 0.6em;
    font-weight: 600;
    text-transform: uppercase;
    opacity: 0.4;
    padding: 1pt 3pt;
    background: rgba(128, 128, 128, 0.1);
    border-radius: 2px;
  }
  .filter-inputs {
    display: flex;
    align-items: center;
    gap: 4pt;
    flex: 1;
    min-width: 0;
    input {
      flex: 1;
      min-width: 0;
      border: 1px solid rgba(128, 128, 128, 0.2);
      border-radius: 4px;
      padding: 3pt 6pt;
      background: color-mix(in srgb, currentColor 2%, transparent);
      color: inherit;
      font-family: var(--mono-font, monospace);
      &::placeholder {
        opacity: 0.4;
      }
      &:focus {
        outline: none;
        border-color: var(--highlight, #4db6ff);
      }
    }
  }
  .unit-label {
    font-size: 0.8em;
    opacity: 0.5;
    white-space: nowrap;
  }
  .clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    padding: 3pt;
    border-radius: 4px;
    color: inherit;
    opacity: 0.5;
    &:hover {
      opacity: 1;
      background: rgba(128, 128, 128, 0.15);
    }
  }
</style>
