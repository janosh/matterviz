<script lang="ts">
  import { format_num } from '$lib/labels'
  import type { Vec2 } from '$lib/math'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { TempUnit, TernaryPhaseDiagramData, VerticalSlice } from './types'
  import {
    compute_vertical_slice,
    generate_region_path,
    get_phase_color,
  } from './utils'

  type Props = HTMLAttributes<HTMLDivElement> & {
    data: TernaryPhaseDiagramData
    ratio: number
    is_open?: boolean
    on_close?: () => void
    on_ratio_change?: (ratio: number) => void
  }

  let {
    data,
    ratio,
    is_open = $bindable(true),
    on_close,
    on_ratio_change,
    ...rest
  }: Props = $props()

  // SVG dimensions
  const svg_width = 250
  const svg_height = 200
  const margin = { t: 20, r: 20, b: 40, l: 50 }
  const plot_width = svg_width - margin.l - margin.r
  const plot_height = svg_height - margin.t - margin.b

  // Compute the vertical slice
  const slice = $derived<VerticalSlice>(
    compute_vertical_slice(data.regions, ratio, data.components),
  )

  // Temperature range
  const t_range = $derived(data.temperature_range)
  const t_min = $derived(t_range[0])
  const t_max = $derived(t_range[1])

  // Convert [composition_C, T] to SVG coordinates
  function data_to_svg(comp_c: number, temp: number): Vec2 {
    const x_val = margin.l + comp_c * plot_width
    const y_val = margin.t + (1 - (temp - t_min) / (t_max - t_min)) * plot_height
    return [x_val, y_val]
  }

  // Generate paths for slice regions
  const region_paths = $derived(
    slice.regions.map((region) => ({
      ...region,
      path: generate_region_path(region.vertices.map((v) => data_to_svg(v[0], v[1]))),
      color: region.color || get_phase_color(region.name),
    })),
  )

  // Axis ticks
  const x_ticks = $derived([0, 0.25, 0.5, 0.75, 1])
  const y_ticks = $derived.by(() => {
    const count = 5
    const ticks: number[] = []
    for (let idx = 0; idx <= count; idx++) {
      ticks.push(t_min + (idx / count) * (t_max - t_min))
    }
    return ticks
  })

  // Temperature unit
  const temp_unit = $derived<TempUnit>((data.temperature_unit ?? `K`) as TempUnit)

  // Fixed component labels
  const fixed_label = $derived(
    `${slice.fixed_components[0]}:${slice.fixed_components[1]} = ${
      format_num(ratio * 100, `.0f`)
    }:${format_num((1 - ratio) * 100, `.0f`)}`,
  )
</script>

{#if is_open}
  <div {...rest} class="vertical-slice-panel {rest.class ?? ``}">
    <header>
      <h4>Pseudo-Binary Section</h4>
      <span class="ratio">{fixed_label}</span>
      <button
        type="button"
        class="close-btn"
        onclick={() => {
          is_open = false
          on_close?.()
        }}
        aria-label="Close panel"
      >
        ×
      </button>
    </header>

    <svg width={svg_width} height={svg_height} viewBox="0 0 {svg_width} {svg_height}">
      <!-- Plot background -->
      <rect
        x={margin.l}
        y={margin.t}
        width={plot_width}
        height={plot_height}
        fill="var(--plot-bg, #fafafa)"
        stroke="var(--border-color, #ccc)"
      />

      <!-- Phase regions -->
      {#each region_paths as region (region.id)}
        <path d={region.path} fill={region.color} stroke="none" opacity="0.7" />
      {/each}

      <!-- Region labels -->
      {#each region_paths as region (region.id)}
        {#if region.vertices.length >= 3}
          {@const centroid = region.vertices.reduce(
        (acc, v) => {
          const svg_pt = data_to_svg(v[0], v[1])
          return [acc[0] + svg_pt[0], acc[1] + svg_pt[1]]
        },
        [0, 0],
      )}
          {@const cx = centroid[0] / region.vertices.length}
          {@const cy = centroid[1] / region.vertices.length}
          <text
            x={cx}
            y={cy}
            text-anchor="middle"
            dominant-baseline="middle"
            font-size="10"
            fill="var(--text-color, #333)"
          >
            {region.name}
          </text>
        {/if}
      {/each}

      <!-- X-axis -->
      <line
        x1={margin.l}
        y1={margin.t + plot_height}
        x2={margin.l + plot_width}
        y2={margin.t + plot_height}
        stroke="var(--text-color, #333)"
      />
      {#each x_ticks as tick (tick)}
        {@const x_val = margin.l + tick * plot_width}
        <line
          x1={x_val}
          y1={margin.t + plot_height}
          x2={x_val}
          y2={margin.t + plot_height + 5}
          stroke="var(--text-color, #333)"
        />
        <text
          x={x_val}
          y={margin.t + plot_height + 15}
          text-anchor="middle"
          font-size="10"
          fill="var(--text-color, #333)"
        >
          {format_num(tick * 100, `.0f`)}
        </text>
      {/each}
      <text
        x={margin.l + plot_width / 2}
        y={svg_height - 5}
        text-anchor="middle"
        font-size="11"
        fill="var(--text-color, #333)"
      >
        {slice.variable_component} (%)
      </text>

      <!-- Y-axis -->
      <line
        x1={margin.l}
        y1={margin.t}
        x2={margin.l}
        y2={margin.t + plot_height}
        stroke="var(--text-color, #333)"
      />
      {#each y_ticks as tick (tick)}
        {@const y_val = margin.t + (1 - (tick - t_min) / (t_max - t_min)) * plot_height}
        <line
          x1={margin.l - 5}
          y1={y_val}
          x2={margin.l}
          y2={y_val}
          stroke="var(--text-color, #333)"
        />
        <text
          x={margin.l - 8}
          y={y_val}
          text-anchor="end"
          dominant-baseline="middle"
          font-size="10"
          fill="var(--text-color, #333)"
        >
          {format_num(tick, `.0f`)}
        </text>
      {/each}
      <text
        x={10}
        y={margin.t + plot_height / 2}
        text-anchor="middle"
        dominant-baseline="middle"
        font-size="11"
        fill="var(--text-color, #333)"
        transform="rotate(-90, 10, {margin.t + plot_height / 2})"
      >
        T ({temp_unit})
      </text>
    </svg>

    <!-- Ratio slider -->
    <div class="slider-container">
      <label>
        <span>{slice.fixed_components[0]}:</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={ratio}
          oninput={(event) => {
            const new_ratio = parseFloat((event.target as HTMLInputElement).value)
            on_ratio_change?.(new_ratio)
          }}
        />
        <input
          type="number"
          min="0"
          max="100"
          value={format_num(ratio * 100, `.0f`)}
          oninput={(event) => {
            const new_ratio = parseFloat((event.target as HTMLInputElement).value) /
              100
            if (!isNaN(new_ratio)) {
              on_ratio_change?.(
                Math.max(0, Math.min(1, new_ratio)),
              )
            }
          }}
        />
        <span>%</span>
      </label>
    </div>
  </div>
{/if}

<style>
  .vertical-slice-panel {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    background: var(--panel-bg, rgba(255, 255, 255, 0.95));
    border-radius: 0 var(--border-radius, 4px) var(--border-radius, 4px) 0;
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.15);
    padding: 12px;
    z-index: 100;
    max-width: 280px;
  }
  :global(.dark) .vertical-slice-panel,
  :global([data-theme='dark']) .vertical-slice-panel {
    background: var(--panel-bg, rgba(30, 30, 30, 0.95));
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-color, #ddd);
    flex-wrap: wrap;
  }
  header h4 {
    margin: 0;
    font-size: 14px;
    flex: 1;
    min-width: 100px;
  }
  .ratio {
    font-size: 12px;
    font-weight: 500;
    color: var(--accent-color, #1976d2);
  }
  .close-btn {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    padding: 0 4px;
    color: var(--text-color, #333);
    opacity: 0.6;
    transition: opacity 0.2s;
  }
  .close-btn:hover {
    opacity: 1;
  }
  svg {
    display: block;
    margin: 0 auto;
  }
  .slider-container {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border-color, #ddd);
  }
  .slider-container label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .slider-container input[type='range'] {
    flex: 1;
    min-width: 80px;
  }
  .slider-container input[type='number'] {
    width: 50px;
    padding: 2px 4px;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 3px;
    font-size: 12px;
  }
</style>
