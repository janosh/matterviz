<script lang="ts">
  import Spinner from 'svelte-widgets/Spinner.svelte'
  import PopoverSelect from '#lib/plot/core/components/PopoverSelect.svelte'
  import { AXIS_TITLE_WRAP_WIDTH, resolve_axis_title_layout } from '#lib/plot/core/layout.js'
  import { clamp, type Vec2 } from '#lib/math.js'
  import type { AxisOption } from '#lib/plot/core/types.js'

  // Axis title centered on (x, y). Static titles are SVG text wrapped by the same
  // measured layout auto-padding reserves for them; titles with selectable `options`
  // render a PopoverSelect trigger inside a foreignObject sized to the closed trigger.
  let {
    x: coord_x,
    y: coord_y,
    rotate = false,
    label = ``,
    options,
    selected_key,
    color,
    loading = false,
    axis_type,
    on_select,
    width = AXIS_TITLE_WRAP_WIDTH,
    x_span,
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
    width?: number // maximum line width (see axis_title_wrap_width)
    // Horizontal span the title stays within: centred on x unless that crosses an end, then
    // slid inward (centred on the span when even that fails), e.g. over a narrow DOS column
    x_span?: Vec2
  } = $props()

  const title_layout = $derived(
    resolve_axis_title_layout({ label, options, selected_key }, width),
  )
  const first_line_y = $derived(
    coord_y - ((title_layout.lines.length - 1) * title_layout.line_height) / 2,
  )
  // Keep browser wrapping from splitting the trigger when canvas metrics under-estimate page fonts.
  const trigger_width = $derived(Math.max(width, title_layout.width))
  // The rendered text's width (canvas metrics can under-estimate page fonts), which only an
  // x_span reads. getBBox forces a layout mid-update, so it runs when the text changes, not
  // whenever a resize or data change rebuilds an equal layout.
  let text_width = $state(0)
  const needs_width = $derived(x_span !== undefined)
  const title_text = $derived(title_layout.lines.map(({ text }) => text).join(`\n`))
  const measure_text = (node: SVGTextElement) => {
    void title_text
    if (needs_width) text_width = node.getBBox().width
  }
  const x = $derived.by(() => {
    if (!x_span) return coord_x
    const half =
      (options?.length ? trigger_width : Math.max(text_width, title_layout.width)) / 2
    const [lo, hi] = x_span
    return hi - lo < 2 * half ? (lo + hi) / 2 : clamp(coord_x, lo + half, hi - half)
  })

  const stop = (evt: Event) => evt.stopPropagation()
  // Only stop propagation for keys the dropdown handles, allow Tab/Escape for navigation
  const stop_key = (evt: KeyboardEvent) => {
    if (![`Tab`, `Escape`].includes(evt.key)) evt.stopPropagation()
  }
</script>

<g transform={rotate ? `rotate(-90, ${coord_x}, ${coord_y})` : undefined}>
  {#if options?.length}
    <foreignObject
      data-export-exclude
      x={x - trigger_width / 2}
      y={coord_y - title_layout.height / 2}
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
        <PopoverSelect
          {options}
          {selected_key}
          placeholder={label || title_layout.label}
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
  {/if}
  {#if title_layout.lines.length}
    <text
      data-export-only={options?.length ? true : undefined}
      display={options?.length ? `none` : undefined}
      class={[`axis-label`, `${axis_type}-label`]}
      dominant-baseline="central"
      fill={color ?? `currentColor`}
      pointer-events="none"
      text-anchor="middle"
      aria-label={title_layout.label}
      {x}
      y={coord_y}
      {@attach measure_text}
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
