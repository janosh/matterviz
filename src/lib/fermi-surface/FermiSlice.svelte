<script lang="ts">
  import type { Vec3 } from '$lib/math'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { compute_fermi_slice } from './compute'
  import { BAND_COLORS } from './constants'
  import type { FermiSliceData, FermiSurfaceData } from './types'

  let {
    fermi_data,
    miller_indices = [0, 0, 1],
    distance = 0,
    line_width = 2,
    show_axes = true,
    axis_color = `#888`,
    background = `transparent`,
    children,
    ...rest
  }: {
    fermi_data?: FermiSurfaceData
    miller_indices?: Vec3
    distance?: number
    line_width?: number
    show_axes?: boolean
    axis_color?: string
    background?: string
    children?: Snippet<
      [{ fermi_data?: FermiSurfaceData; slice_data?: FermiSliceData | null }]
    >
  } & HTMLAttributes<SVGSVGElement> = $props()

  const SIZE = 400 // viewBox size

  let slice_data = $derived.by((): FermiSliceData | null => {
    if (!fermi_data) return null
    try {
      return compute_fermi_slice(fermi_data, { miller_indices, distance })
    } catch {
      return null
    }
  })

  let bounds = $derived.by(() => {
    if (!slice_data?.isolines.length) return { min: [-1, -1], max: [1, 1] }
    let [x_min, x_max, y_min, y_max] = [Infinity, -Infinity, Infinity, -Infinity]
    for (const { points_2d } of slice_data.isolines) {
      for (const [x, y] of points_2d) {
        if (x < x_min) x_min = x
        if (x > x_max) x_max = x
        if (y < y_min) y_min = y
        if (y > y_max) y_max = y
      }
    }
    const pad = 0.1, rx = x_max - x_min || 1, ry = y_max - y_min || 1
    return {
      min: [x_min - rx * pad, y_min - ry * pad],
      max: [x_max + rx * pad, y_max + ry * pad],
    }
  })

  function to_svg([x, y]: [number, number]): [number, number] {
    const rx = bounds.max[0] - bounds.min[0] || 1,
      ry = bounds.max[1] - bounds.min[1] || 1
    return [
      ((x - bounds.min[0]) / rx) * SIZE,
      SIZE - ((y - bounds.min[1]) / ry) * SIZE,
    ]
  }

  function path_d(pts: [number, number][]): string {
    if (pts.length < 2) return ``
    const [[x0, y0], ...rest] = pts.map(to_svg)
    return `M${x0} ${y0}` + rest.map(([x, y]) => `L${x} ${y}`).join(``)
  }

  let origin = $derived(to_svg([0, 0]))
  let x_axis = $derived([to_svg([bounds.min[0], 0]), to_svg([bounds.max[0], 0])])
  let y_axis = $derived([to_svg([0, bounds.min[1]]), to_svg([0, bounds.max[1]])])
</script>

<svg
  viewBox="0 0 {SIZE} {SIZE}"
  preserveAspectRatio="xMidYMid meet"
  xmlns="http://www.w3.org/2000/svg"
  {...rest}
  class="fermi-slice {rest.class ?? ``}"
  style:background
>
  {#if show_axes}
    <line
      x1={x_axis[0][0]}
      y1={x_axis[0][1]}
      x2={x_axis[1][0]}
      y2={x_axis[1][1]}
      stroke={axis_color}
      stroke-dasharray="4,4"
    />
    <line
      x1={y_axis[0][0]}
      y1={y_axis[0][1]}
      x2={y_axis[1][0]}
      y2={y_axis[1][1]}
      stroke={axis_color}
      stroke-dasharray="4,4"
    />
    <circle cx={origin[0]} cy={origin[1]} r="3" fill={axis_color} />
  {/if}
  {#if slice_data}
    {#each slice_data.isolines as iso, idx (`iso-${idx}`)}
      {@const d = path_d(iso.points_2d)}
      {#if d}<path
          {d}
          stroke={BAND_COLORS[iso.band_index % BAND_COLORS.length]}
          stroke-width={line_width}
          fill="none"
          stroke-linecap="round"
        />{/if}
    {/each}
  {:else}
    <text x={SIZE / 2} y={SIZE / 2} text-anchor="middle" fill="#888">
      No slice data
    </text>
  {/if}
</svg>
{@render children?.({ fermi_data, slice_data })}

<style>
  .fermi-slice {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
