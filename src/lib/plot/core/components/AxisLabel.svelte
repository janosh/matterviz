<script lang="ts">
  import { AXIS_LABEL_CONTAINER } from '$lib/plot/core/axis-utils'
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
    // container width for centering/wrapping; wider lets long horizontal titles fit on one line
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
</script>

<g transform={rotate ? `rotate(-90, ${x}, ${y})` : undefined}>
  {#if use_svg_text}
    <text
      class="axis-label {axis_type}-label"
      dominant-baseline="central"
      fill={color ?? `currentColor`}
      pointer-events="none"
      text-anchor="middle"
      {x}
      {y}
    >
      {#each segments as segment}
        <tspan baseline-shift={segment.shift} font-size={segment.shift ? `75%` : undefined}
          >{segment.text}</tspan
        >
      {/each}
    </text>
  {:else}
    <foreignObject
      x={x - width / 2}
      y={y - AXIS_LABEL_CONTAINER.y_offset}
      {width}
      height={AXIS_LABEL_CONTAINER.height}
      style="overflow: visible; pointer-events: none"
    >
      <div xmlns="http://www.w3.org/1999/xhtml" style="pointer-events: auto">
        <InteractiveAxisLabel
          {label}
          {options}
          {selected_key}
          {loading}
          {axis_type}
          {color}
          {on_select}
          class="axis-label {axis_type}-label"
        />
      </div>
    </foreignObject>
  {/if}
</g>
