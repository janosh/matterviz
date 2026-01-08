<script lang="ts">
  // ReferenceLine component for rendering 2D reference lines with annotations
  // Supports horizontal, vertical, diagonal, segment, and line types
  import {
    calculate_annotation_position,
    resolve_line_endpoints,
  } from './reference-line-utils'
  import type { RefLine, RefLineEvent, RefLineStyle } from './types'
  import { REF_LINE_STYLE_DEFAULTS } from './types'

  let {
    ref_line,
    line_idx,
    // Plot bounds for coordinate resolution
    x_min,
    x_max,
    y_min,
    y_max,
    pad,
    width,
    height,
    // Scale functions
    x_scale,
    y_scale,
    y2_scale,
    // Clip path
    clip_path_id,
    // Hover state
    hovered_line_idx = null,
    // Event handlers
    on_click,
    on_hover,
  }: {
    ref_line: RefLine
    line_idx: number
    x_min: number
    x_max: number
    y_min: number
    y_max: number
    pad: { l: number; r: number; t: number; b: number }
    width: number
    height: number
    x_scale: (val: number) => number
    y_scale: (val: number) => number
    y2_scale?: (val: number) => number
    clip_path_id: string
    hovered_line_idx?: number | null
    on_click?: (event: RefLineEvent) => void
    on_hover?: (event: RefLineEvent | null) => void
  } = $props()

  // Resolve line endpoints
  let endpoints = $derived(
    resolve_line_endpoints(
      ref_line,
      { x_min, x_max, y_min, y_max, pad, width, height },
      { x_scale, y_scale, y2_scale },
    ),
  )

  // Track focus state for keyboard accessibility
  let is_focused = $state(false)

  // Compute if this line is hovered (includes keyboard focus for consistent styling)
  let is_hovered = $derived(hovered_line_idx === line_idx || is_focused)

  // Merge default, custom, and hover styles
  let style = $derived<Required<RefLineStyle>>({
    ...REF_LINE_STYLE_DEFAULTS,
    ...ref_line.style,
    ...(is_hovered && ref_line.hover_style),
  })

  // Compute annotation position if annotation exists
  let annotation_pos = $derived(
    endpoints && ref_line.annotation
      ? calculate_annotation_position(
        endpoints[0],
        endpoints[1],
        endpoints[2],
        endpoints[3],
        ref_line.annotation,
      )
      : null,
  )

  // Construct event object for handlers
  const make_event = (mouse_event: MouseEvent): RefLineEvent => ({
    event: mouse_event,
    line_idx,
    line_id: ref_line.id,
    type: ref_line.type,
    label: ref_line.label ?? ref_line.annotation?.text,
    metadata: ref_line.metadata,
  })

  function handle_keydown(event: KeyboardEvent) {
    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      const evt = make_event(new MouseEvent(`click`))
      ref_line.on_click?.(evt)
      on_click?.(evt)
    }
  }

  // Check if clickable (used for cursor, role, tabindex)
  let is_clickable = $derived(Boolean(on_click || ref_line.on_click))
  let cursor = $derived(is_clickable ? `pointer` : `default`)
</script>

{#if endpoints && ref_line.visible !== false}
  {@const [x1, y1, x2, y2] = endpoints}

  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <g
    class="reference-line"
    class:hovered={is_hovered}
    clip-path="url(#{clip_path_id})"
    role={is_clickable ? `button` : `img`}
    aria-label={ref_line.label ?? ref_line.annotation?.text ?? `Reference line ${line_idx}`}
    tabindex={is_clickable ? 0 : -1}
    style:cursor
    onmouseenter={(evt) => on_hover?.(make_event(evt))}
    onmouseleave={() => on_hover?.(null)}
    onfocus={(evt) => {
      is_focused = true
      on_hover?.(make_event(evt as unknown as MouseEvent))
    }}
    onblur={() => {
      is_focused = false
      on_hover?.(null)
    }}
    onclick={(evt) => {
      const ref_evt = make_event(evt)
      ref_line.on_click?.(ref_evt)
      on_click?.(ref_evt)
    }}
    onkeydown={handle_keydown}
  >
    <!-- Invisible hit area for easier interaction (8px wide) -->
    <line
      {x1}
      {y1}
      {x2}
      {y2}
      stroke="transparent"
      stroke-width="8"
      style:pointer-events="stroke"
    />

    <!-- Visible line -->
    <line
      {x1}
      {y1}
      {x2}
      {y2}
      stroke={style.color}
      stroke-width={style.width}
      stroke-dasharray={style.dash || null}
      stroke-opacity={style.opacity}
      style:pointer-events="none"
    />

    <!-- Annotation -->
    {#if annotation_pos && ref_line.annotation}
      {@const anno = ref_line.annotation}
      {@const anno_padding = anno.padding ?? 2}
      {@const font_size = parseFloat(String(anno.font_size ?? 12))}
      <!-- 0.6 ratio works well for most sans-serif fonts; may need adjustment for others -->
      {@const text_width = anno.text.length * font_size * 0.6}
      {@const anchor_offset = {
      start: 0,
      middle: text_width / 2,
      end: text_width,
    }[annotation_pos.text_anchor] ?? 0}
      {#if anno.background}
        <!-- Background rect for annotation text (width estimated from text length) -->
        <rect
          x={annotation_pos.x - anno_padding - anchor_offset}
          y={annotation_pos.y - font_size * 0.8 - anno_padding}
          width={text_width + anno_padding * 2}
          height={font_size * 1.2 + anno_padding * 2}
          fill={anno.background}
          rx="2"
          ry="2"
          transform={annotation_pos.rotation
          ? `rotate(${annotation_pos.rotation}, ${annotation_pos.x}, ${annotation_pos.y})`
          : undefined}
          style:pointer-events="none"
        />
      {/if}
      <text
        x={annotation_pos.x}
        y={annotation_pos.y}
        text-anchor={annotation_pos.text_anchor}
        dominant-baseline={annotation_pos.dominant_baseline}
        transform={annotation_pos.rotation
        ? `rotate(${annotation_pos.rotation}, ${annotation_pos.x}, ${annotation_pos.y})`
        : undefined}
        fill={anno.color ?? style.color}
        font-size={anno.font_size ?? `12px`}
        font-family={anno.font_family ?? `inherit`}
        style:pointer-events="none"
      >
        {anno.text}
      </text>
    {/if}
  </g>
{/if}

<style>
  .reference-line {
    transition: opacity 0.15s ease;
  }
  .reference-line.hovered line:not([stroke='transparent']) {
    filter: brightness(1.2);
  }
  .reference-line text {
    user-select: none;
  }
</style>
