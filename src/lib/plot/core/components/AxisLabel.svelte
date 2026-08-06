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

  interface LabelSegment {
    text: string
    shift?: `sub` | `super`
  }

  const decode_text = (value: string, textarea?: HTMLTextAreaElement): string => {
    // Strip only sub/sup markup so literal angle-bracket text like <100> survives
    const without_tags = value.replaceAll(/<\/?(?:sub|sup)\b[^>]*>/gi, ``)
    if (!textarea) return without_tags
    textarea.innerHTML = without_tags
    return textarea.value
  }

  const label_segments = (value: string): LabelSegment[] => {
    const segments: LabelSegment[] = []
    const tag_pattern = /<(?<tag>sub|sup)\b[^>]*>(?<inner>.*?)<\/\k<tag>>/gis
    const textarea =
      typeof document === `undefined` ? undefined : document.createElement(`textarea`)
    let cursor = 0
    for (const match of value.matchAll(tag_pattern)) {
      const start = match.index ?? 0
      const plain_text = decode_text(value.slice(cursor, start), textarea)
      if (plain_text) segments.push({ text: plain_text })
      const shifted_text = decode_text(match.groups?.inner ?? ``, textarea)
      if (shifted_text) {
        segments.push({
          text: shifted_text,
          shift: match.groups?.tag?.toLowerCase() === `sub` ? `sub` : `super`,
        })
      }
      cursor = start + match[0].length
    }
    const tail_text = decode_text(value.slice(cursor), textarea)
    if (tail_text) segments.push({ text: tail_text })
    return segments
  }

  let use_svg_text = $derived(rotate && !options?.length && !loading)
  let segments = $derived(use_svg_text ? label_segments(label) : [])
  const resolve_layout = () =>
    resolve_axis_title_layout({ label, options, selected_key }, width || AXIS_TITLE_WRAP_WIDTH)
  // Text measurement fills a shared cache, so resolve outside $derived and refresh before DOM
  // updates. This mirrors PlotTitle and avoids Svelte's unsafe-mutation guard.
  let title_layout = $state.raw(resolve_layout())
  $effect.pre(() => {
    title_layout = resolve_layout()
  })
  let container_width = $derived(Math.max(1, title_layout.width))
  let container_height = $derived(Math.max(1, title_layout.height))
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
      {#if title_layout.lines.length === 1}
        {#each segments as segment}
          <tspan baseline-shift={segment.shift} font-size={segment.shift ? `75%` : undefined}
            >{segment.text}</tspan
          >
        {/each}
      {:else}
        {#each title_layout.lines as line, line_idx}
          <tspan {x} y={first_line_y + line_idx * title_layout.line_height} aria-hidden="true"
            >{line.text}{line_idx < title_layout.lines.length - 1 ? ` ` : ``}</tspan
          >
        {/each}
      {/if}
    </text>
  {:else}
    <foreignObject
      x={x - container_width / 2}
      y={y - container_height / 2}
      width={container_width}
      height={container_height}
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
        lines={title_layout.interactive
          ? undefined
          : title_layout.lines.map(({ text }) => text)}
        class="axis-label {axis_type}-label"
      />
    </foreignObject>
  {/if}
</g>
