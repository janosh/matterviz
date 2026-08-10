<script lang="ts">
  import { AXIS_LABEL_CONTAINER } from '$lib/plot/core/axis-utils'
  import { AXIS_TITLE_WRAP_WIDTH, resolve_axis_title_layout } from '$lib/plot/core/layout'
  import type { AxisOption } from '$lib/plot/core/types'
  import InteractiveAxisLabel from '$lib/plot/core/components/InteractiveAxisLabel.svelte'

  let {
    x,
    y,
    rotate = false,
    label = ``,
    options,
    selected_key,
    color,
    loading = false,
    axis_type,
    on_select,
    width = AXIS_LABEL_CONTAINER.width,
  }: {
    x: number
    y: number
    rotate?: boolean
    label?: string
    options?: AxisOption[]
    selected_key?: string
    color?: string | null
    loading?: boolean
    axis_type: `x` | `x2` | `y` | `y2`
    on_select?: (key: string) => void
    // Maximum line width. Vertical titles use the deterministic 200px fallback because
    // PlotAxis does not forward the plot height.
    width?: number
  } = $props()

  let use_svg_text = $derived(rotate && !options?.length && !loading)
  let wrap_width = $derived(width || AXIS_TITLE_WRAP_WIDTH)
  const resolve_layout = () =>
    resolve_axis_title_layout({ label, options, selected_key }, wrap_width)
  // Text measurement fills a shared cache, so resolve outside $derived and refresh before DOM
  // updates. This mirrors PlotTitle and avoids Svelte's unsafe-mutation guard.
  let title_layout = $state.raw(resolve_layout())
  $effect.pre(() => {
    title_layout = resolve_layout()
  })
  // Keep browser wrapping from splitting titles when canvas metrics under-estimate page fonts.
  let container_width = $derived(Math.max(wrap_width, title_layout.width))
  let first_line_y = $derived(
    y - ((title_layout.lines.length - 1) * title_layout.line_height) / 2,
  )
</script>

<g transform={rotate ? `rotate(-90, ${x}, ${y})` : undefined}>
  {#if use_svg_text}
    <text
      class="axis-label {axis_type}-label"
      dominant-baseline="central"
      fill={color ?? `currentColor`}
      pointer-events="none"
      text-anchor="middle"
      aria-label={title_layout.label}
      {x}
      {y}
    >
      {#each title_layout.lines as line, line_idx}
        <tspan {x} y={first_line_y + line_idx * title_layout.line_height} aria-hidden="true">
          {#each line.segments as segment}
            <tspan
              baseline-shift={segment.shift}
              font-size={segment.shift ? `75%` : undefined}
            >
              {segment.text}
            </tspan>
          {/each}{line_idx < title_layout.lines.length - 1 ? ` ` : ``}
        </tspan>
      {/each}
    </text>
  {:else}
    <foreignObject
      x={x - container_width / 2}
      y={y - title_layout.height / 2}
      width={container_width}
      height={title_layout.height}
      style="overflow: visible; pointer-events: none"
    >
      <InteractiveAxisLabel
        {label}
        {options}
        {selected_key}
        {loading}
        {axis_type}
        {color}
        {on_select}
        line_segments={title_layout.lines.map(({ segments }) => segments)}
        class="axis-label {axis_type}-label"
      />
    </foreignObject>
  {/if}
</g>
