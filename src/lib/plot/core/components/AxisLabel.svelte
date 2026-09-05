<script lang="ts">
  import { Spinner } from 'svelte-widgets'
  import PortalSelect from '$lib/plot/core/components/PortalSelect.svelte'
  import { AXIS_TITLE_WRAP_WIDTH, resolve_axis_title_layout } from '$lib/plot/core/layout'
  import type { AxisOption } from '$lib/plot/core/types'

  // Axis title centered on (x, y). Static titles are SVG text wrapped by the same
  // measured layout auto-padding reserves for them; titles with selectable `options`
  // render a PortalSelect trigger inside a foreignObject sized to the closed trigger.
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
    width = AXIS_TITLE_WRAP_WIDTH,
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
    // Maximum line width (0 falls back to AXIS_TITLE_WRAP_WIDTH, like vertical titles, whose
    // plot height PlotAxis does not forward)
    width?: number
  } = $props()

  const wrap_width = $derived(width || AXIS_TITLE_WRAP_WIDTH)
  const title_layout = $derived(
    resolve_axis_title_layout({ label, options, selected_key }, wrap_width),
  )
  const first_line_y = $derived(
    y - ((title_layout.lines.length - 1) * title_layout.line_height) / 2,
  )
  // Keep browser wrapping from splitting the trigger when canvas metrics under-estimate page fonts.
  const trigger_width = $derived(Math.max(wrap_width, title_layout.width))

  const stop = (evt: Event) => evt.stopPropagation()
  // Only stop propagation for keys the dropdown handles, allow Tab/Escape for navigation
  const stop_key = (evt: KeyboardEvent) => {
    if (![`Tab`, `Escape`].includes(evt.key)) evt.stopPropagation()
  }
</script>

<g transform={rotate ? `rotate(-90, ${x}, ${y})` : undefined}>
  {#if options?.length}
    <foreignObject
      x={x - trigger_width / 2}
      y={y - title_layout.height / 2}
      width={trigger_width}
      height={title_layout.height}
      style="overflow: visible; pointer-events: none"
    >
      <!-- handlers only keep trigger clicks from starting a pan/zoom drag on the host plot -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class={[`interactive-axis-label`, `axis-label`, `${axis_type}-label`, { loading }]}
        style:color
        onmousedown={stop}
        onmouseup={stop}
        onclick={stop}
        onkeydown={stop_key}
        role="group"
      >
        <PortalSelect
          {options}
          {selected_key}
          {on_select}
          disabled={loading}
          class="axis-trigger"
        />
        {#if loading}
          <Spinner
            style="--spinner-size: 0.9em; --spinner-border-width: 2px; --spinner-margin: 0 0 0 0.3em"
          />
        {/if}
      </div>
    </foreignObject>
  {:else if title_layout.lines.length}
    <text
      class={[`axis-label`, `${axis_type}-label`]}
      dominant-baseline="central"
      fill={color ?? `currentColor`}
      pointer-events="none"
      text-anchor="middle"
      aria-label={title_layout.label}
      {x}
      {y}
    >
      <!-- contiguous markup keeps textContent free of layout whitespace -->
      {#each title_layout.lines as line, line_idx}
        <tspan {x} y={first_line_y + line_idx * title_layout.line_height} aria-hidden="true"
          >{#each line.segments as segment}<tspan
              baseline-shift={segment.shift}
              font-size={segment.shift ? `75%` : undefined}>{segment.text}</tspan
            >{/each}{line_idx < title_layout.lines.length - 1 ? ` ` : ``}</tspan
        >
      {/each}
    </text>
  {/if}
</g>

<style>
  .interactive-axis-label {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    pointer-events: none;
    :global(.axis-trigger) {
      pointer-events: auto;
    }
    &.loading :global(.axis-trigger) {
      opacity: 0.7;
      pointer-events: none;
    }
  }
  /* WebKit doesn't inherit dominant-baseline from <text> to <tspan> */
  .axis-label tspan {
    dominant-baseline: inherit;
  }
</style>
