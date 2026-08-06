<script lang="ts">
  // ReferenceLine: 2D reference lines with annotations (horizontal, vertical, diagonal, segment, line)
  import {
    estimate_reference_annotation_metrics,
    reference_annotation_text_rect,
    resolve_line_endpoints,
    resolve_reference_annotation,
  } from '$lib/plot/core/reference-line'
  import {
    project_obstacles,
    type DecorationPoint,
    type ReferenceAnnotationCandidate,
  } from '$lib/plot/core/decorations'
  import type { Rect } from '$lib/plot/core/layout'
  import type { RefLine, RefLineEvent, RefLineStyle } from '$lib/plot/core/types'
  import { REF_LINE_STYLE_DEFAULTS } from '$lib/plot/core/types'

  let {
    ref_line,
    line_idx,
    x_min,
    x_max,
    y_min,
    y_max,
    x_scale,
    x2_scale,
    y_scale,
    y2_scale,
    clip_path_id,
    hovered_line_idx = null,
    exclusion_rects = [],
    obstacles = [],
    obstacles_norm = [],
    annotation_clearance,
    annotation_placement,
    on_click,
    on_hover,
  }: {
    ref_line: RefLine
    line_idx: number
    x_min: number
    x_max: number
    y_min: number
    y_max: number
    x_scale: (val: number) => number
    x2_scale?: (val: number) => number
    y_scale: (val: number) => number
    y2_scale?: (val: number) => number
    clip_path_id: string
    hovered_line_idx?: number | null
    exclusion_rects?: readonly Rect[]
    obstacles?: readonly DecorationPoint[]
    obstacles_norm?: readonly DecorationPoint[]
    annotation_clearance?: number
    annotation_placement?: ReferenceAnnotationCandidate
    on_click?: (event: RefLineEvent) => void
    on_hover?: (event: RefLineEvent | null) => void
  } = $props()

  let endpoints = $derived(
    resolve_line_endpoints(
      ref_line,
      { x_min, x_max, y_min, y_max },
      {
        x_scale,
        x2_scale,
        y_scale,
        y2_scale,
      },
    ),
  )

  let is_focused = $state(false)
  let is_hovered = $derived(hovered_line_idx === line_idx || is_focused)
  let is_clickable = $derived(Boolean(on_click || ref_line.on_click))

  let style = $derived<Required<RefLineStyle>>({
    ...REF_LINE_STYLE_DEFAULTS,
    ...ref_line.style,
    ...(is_hovered && ref_line.hover_style),
  })

  let annotation_plot_bounds = $derived.by((): Rect => {
    const active_x_scale = ref_line.x_axis === `x2` && x2_scale ? x2_scale : x_scale
    const active_y_scale = ref_line.y_axis === `y2` && y2_scale ? y2_scale : y_scale
    const x_pixels = [active_x_scale(x_min), active_x_scale(x_max)]
    const y_pixels = [active_y_scale(y_min), active_y_scale(y_max)]
    const x_left = Math.min(...x_pixels)
    const y_top = Math.min(...y_pixels)
    return {
      x: x_left,
      y: y_top,
      width: Math.max(...x_pixels) - x_left,
      height: Math.max(...y_pixels) - y_top,
    }
  })
  let annotation_obstacles = $derived([
    ...obstacles,
    ...project_obstacles(obstacles_norm, annotation_plot_bounds),
  ])
  let annotation_pos = $derived(
    annotation_placement ??
      (endpoints && ref_line.annotation
        ? resolve_reference_annotation(endpoints, ref_line.annotation, {
            clearance: annotation_clearance,
            exclusion_rects,
            obstacles: annotation_obstacles,
          })
        : null),
  )

  const make_event = (event: MouseEvent | KeyboardEvent | FocusEvent): RefLineEvent => ({
    event,
    line_idx,
    line_id: ref_line.id,
    type: ref_line.type,
    label: ref_line.label ?? ref_line.annotation?.text,
    metadata: ref_line.metadata,
  })

  function handle_keydown(event: KeyboardEvent) {
    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      const evt = make_event(event)
      ref_line.on_click?.(evt)
      on_click?.(evt)
    }
  }
</script>

{#if endpoints && ref_line.visible !== false}
  {@const [x1, y1, x2, y2] = endpoints}

  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <g
    class="reference-line"
    class:hovered={is_hovered}
    role={is_clickable ? `button` : `img`}
    aria-label={ref_line.label ?? ref_line.annotation?.text ?? `Reference line ${line_idx}`}
    tabindex={is_clickable ? 0 : -1}
    style:cursor={is_clickable ? `pointer` : `default`}
    onmouseenter={(evt) => on_hover?.(make_event(evt))}
    onmouseleave={() => on_hover?.(null)}
    onfocus={(evt) => {
      is_focused = true
      on_hover?.(make_event(evt))
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
    <!-- Lines clipped to plot area -->
    <g clip-path="url(#{clip_path_id})">
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
    </g>

    <!-- Annotation (outside clip-path to remain visible) -->
    {#if annotation_pos && ref_line.annotation}
      {@const anno = ref_line.annotation}
      {@const annotation_transform = annotation_pos.rotation
        ? `rotate(${annotation_pos.rotation}, ${annotation_pos.x}, ${annotation_pos.y})`
        : undefined}
      {#if anno.background}
        {@const background_rect = reference_annotation_text_rect(
          annotation_pos,
          estimate_reference_annotation_metrics(anno),
        )}
        <rect
          x={background_rect.x}
          y={background_rect.y}
          width={background_rect.width}
          height={background_rect.height}
          fill={anno.background}
          rx="2"
          ry="2"
          transform={annotation_transform}
          style:pointer-events="none"
        />
      {/if}
      <text
        x={annotation_pos.x}
        y={annotation_pos.y}
        text-anchor={annotation_pos.text_anchor}
        dominant-baseline={annotation_pos.dominant_baseline}
        transform={annotation_transform}
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
