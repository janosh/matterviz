<script lang="ts">
  import { format_num } from '$lib/labels'
  import type { Vec2 } from '$lib/math'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { TempUnit, TernaryPhaseDiagramData } from './types'
  import {
    barycentric_to_ternary_xy,
    compute_isothermal_slice,
    generate_region_path,
    get_phase_color,
    TRIANGLE_VERTICES,
  } from './utils'

  type Props = HTMLAttributes<HTMLDivElement> & {
    data: TernaryPhaseDiagramData
    temperature: number
    is_open?: boolean
    on_close?: () => void
    on_temperature_change?: (temperature: number) => void
  }

  let {
    data,
    temperature,
    is_open = $bindable(true),
    on_close,
    on_temperature_change,
    ...rest
  }: Props = $props()

  // SVG dimensions
  const svg_size = 250
  const margin = 30
  const plot_size = svg_size - margin * 2

  // Compute the isothermal slice
  const slice = $derived(compute_isothermal_slice(data.regions, temperature))

  // Triangle vertices in SVG coordinates
  const svg_triangle = $derived(
    TRIANGLE_VERTICES.map(([tri_x, tri_y]) =>
      [
        margin + tri_x * plot_size,
        margin + (1 - tri_y) * plot_size * (Math.sqrt(3) / 2),
      ] as Vec2
    ),
  )

  // Generate SVG path for triangle outline
  const triangle_path = $derived(generate_region_path(svg_triangle))

  // Convert ternary composition to SVG coordinates
  function ternary_to_svg(comp: [number, number, number]): Vec2 {
    const [tri_x, tri_y] = barycentric_to_ternary_xy(comp)
    return [
      margin + tri_x * plot_size,
      margin + (1 - tri_y) * plot_size * (Math.sqrt(3) / 2),
    ]
  }

  // Generate paths for slice regions
  const region_paths = $derived(
    slice.regions.map((region) => ({
      ...region,
      path: generate_region_path(region.vertices.map(ternary_to_svg)),
      color: region.color || get_phase_color(region.name),
    })),
  )

  // Component labels at corners
  const component_labels = $derived(
    data.components.map((comp, idx) => ({
      label: comp,
      x: svg_triangle[idx][0],
      y: svg_triangle[idx][1],
      anchor: idx === 0 ? `start` : idx === 1 ? `middle` : `end`,
      dy: idx === 1 ? -10 : 15,
    })),
  )

  // Temperature unit
  const temp_unit = $derived<TempUnit>((data.temperature_unit ?? `K`) as TempUnit)
</script>

{#if is_open}
  <div {...rest} class="isothermal-slice-panel {rest.class ?? ``}">
    <header>
      <h4>Isothermal Section</h4>
      <span class="temperature">{format_num(temperature, `.0f`)} {temp_unit}</span>
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

    <svg
      width={svg_size}
      height={svg_size * 0.9}
      viewBox="0 0 {svg_size} {svg_size * 0.9}"
    >
      <!-- Triangle outline -->
      <path
        d={triangle_path}
        fill="none"
        stroke="var(--text-color, #333)"
        stroke-width="1"
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
          const svg_pt = ternary_to_svg(v)
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

      <!-- Component labels -->
      {#each component_labels as { label, x, y, anchor, dy } (label)}
        <text
          {x}
          y={y + dy}
          text-anchor={anchor}
          font-size="12"
          font-weight="bold"
          fill="var(--text-color, #333)"
        >
          {label}
        </text>
      {/each}
    </svg>

    <!-- Temperature slider -->
    <div class="slider-container">
      <label>
        <span>T:</span>
        <input
          type="range"
          min={data.temperature_range[0]}
          max={data.temperature_range[1]}
          step={(data.temperature_range[1] - data.temperature_range[0]) / 100}
          value={temperature}
          oninput={(event) => {
            const new_temp = parseFloat((event.target as HTMLInputElement).value)
            on_temperature_change?.(new_temp)
          }}
        />
        <input
          type="number"
          min={data.temperature_range[0]}
          max={data.temperature_range[1]}
          value={format_num(temperature, `.0f`)}
          oninput={(event) => {
            const new_temp = parseFloat((event.target as HTMLInputElement).value)
            if (!isNaN(new_temp)) on_temperature_change?.(new_temp)
          }}
        />
        <span>{temp_unit}</span>
      </label>
    </div>
  </div>
{/if}

<style>
  .isothermal-slice-panel {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    background: var(--panel-bg, rgba(255, 255, 255, 0.95));
    border-radius: var(--border-radius, 4px) 0 0 var(--border-radius, 4px);
    box-shadow: -2px 0 8px rgba(0, 0, 0, 0.15);
    padding: 12px;
    z-index: 100;
    max-width: 280px;
  }
  :global(.dark) .isothermal-slice-panel,
  :global([data-theme='dark']) .isothermal-slice-panel {
    background: var(--panel-bg, rgba(30, 30, 30, 0.95));
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-color, #ddd);
  }
  header h4 {
    margin: 0;
    font-size: 14px;
    flex: 1;
  }
  .temperature {
    font-size: 13px;
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
    width: 60px;
    padding: 2px 4px;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 3px;
    font-size: 12px;
  }
</style>
