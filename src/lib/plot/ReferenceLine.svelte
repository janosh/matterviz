<script lang="ts">
  // ReferenceLine component for rendering 2D reference lines with annotations
  // Supports horizontal, vertical, diagonal, segment, and line types
  import type { RefLine, RefLineEvent, RefLineStyle } from './types'
  import { REF_LINE_STYLE_DEFAULTS } from './types'
  import {
    calculate_annotation_position,
    resolve_line_endpoints,
  } from './reference-line-utils'

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

  // Compute if this line is hovered
  let is_hovered = $derived(hovered_line_idx === line_idx)

  // Merge default and custom styles
  let base_style = $derived<Required<RefLineStyle>>({
    ...REF_LINE_STYLE_DEFAULTS,
    ...ref_line.style,
  })

  // Apply hover style if hovered
  let effective_style = $derived<Required<RefLineStyle>>(
    is_hovered && ref_line.hover_style
      ? { ...base_style, ...ref_line.hover_style }
      : base_style,
  )

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

  // Event construction
  function construct_event(mouse_event: MouseEvent): RefLineEvent {
    return {
      event: mouse_event,
      line_idx,
      line_id: ref_line.id,
      type: ref_line.type,
      label: ref_line.label ?? ref_line.annotation?.text,
      metadata: ref_line.metadata,
    }
  }

  // Event handlers
  function handle_mouse_enter(event: MouseEvent) {
    on_hover?.(construct_event(event))
  }

  function handle_mouse_leave() {
    on_hover?.(null)
  }

  function handle_click(event: MouseEvent) {
    ref_line.on_click?.(construct_event(event))
    on_click?.(construct_event(event))
  }

  function handle_keydown(event: KeyboardEvent) {
    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      const mouse_event = new MouseEvent(`click`)
      ref_line.on_click?.(construct_event(mouse_event))
      on_click?.(construct_event(mouse_event))
    }
  }

  // Cursor style
  let cursor = $derived(on_click || ref_line.on_click ? `pointer` : `default`)
</script>

{#if endpoints && ref_line.visible !== false}
  {@const [x1, y1, x2, y2] = endpoints}

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <g
    class="reference-line"
    class:hovered={is_hovered}
    clip-path="url(#{clip_path_id})"
    role="img"
    aria-label={ref_line.label ?? ref_line.annotation?.text ?? `Reference line ${line_idx}`}
    tabindex={on_click || ref_line.on_click ? 0 : -1}
    style:cursor
    onmouseenter={handle_mouse_enter}
    onmouseleave={handle_mouse_leave}
    onclick={handle_click}
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
      stroke={effective_style.color}
      stroke-width={effective_style.width}
      stroke-dasharray={effective_style.dash || null}
      stroke-opacity={effective_style.opacity}
      style:pointer-events="none"
    />

    <!-- Annotation -->
    {#if annotation_pos && ref_line.annotation}
      {@const anno = ref_line.annotation}
      {@const anno_padding = anno.padding ?? 2}
      {#if anno.background}
        <!-- Background rect for annotation text -->
        <rect
          x={annotation_pos.x - anno_padding - (annotation_pos.text_anchor === `end`
          ? 50
          : annotation_pos.text_anchor === `middle`
          ? 25
          : 0)}
          y={annotation_pos.y - 10 - anno_padding}
          width={50 + anno_padding * 2}
          height={14 + anno_padding * 2}
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
        fill={anno.color ?? effective_style.color}
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
