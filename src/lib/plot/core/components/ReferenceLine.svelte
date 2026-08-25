<script lang="ts">
  // 2D reference line (horizontal, vertical, diagonal, segment, line) with an optional
  // annotation whose placement the host plot solves together with its other decorations.
  import type { ReferenceAnnotationCandidate } from '$lib/plot/core/decorations'
  import type { RefLineAxes } from '$lib/plot/core/reference-line'
  import {
    estimate_reference_annotation_metrics,
    reference_annotation_text_rect,
    resolve_line_endpoints,
  } from '$lib/plot/core/reference-line'
  import type { RefLine, RefLineEvent, RefLineStyle } from '$lib/plot/core/types'
  import { REF_LINE_STYLE_DEFAULTS } from '$lib/plot/core/types'

  let {
    ref_line,
    line_idx,
    axes,
    clip_path_id,
    hovered_line_idx = null,
    annotation_placement,
    on_click,
    on_hover,
  }: {
    ref_line: RefLine
    line_idx: number
    axes: RefLineAxes // bounds and scales of the axes this line is drawn on (resolve_ref_line_axes)
    clip_path_id: string
    hovered_line_idx?: number | null
    annotation_placement?: ReferenceAnnotationCandidate | null
    on_click?: (event: RefLineEvent) => void
    on_hover?: (event: RefLineEvent | null) => void
  } = $props()

  const endpoints = $derived(resolve_line_endpoints(ref_line, axes))

  let is_focused = $state(false)
  const is_hovered = $derived(hovered_line_idx === line_idx || is_focused)
  const is_clickable = $derived(Boolean(on_click || ref_line.on_click))
  const style = $derived<Required<RefLineStyle>>({
    ...REF_LINE_STYLE_DEFAULTS,
    ...ref_line.style,
    ...(is_hovered && ref_line.hover_style),
  })

  const make_event = (event: MouseEvent | KeyboardEvent | FocusEvent): RefLineEvent => ({
    event,
    line_idx,
    line_id: ref_line.id,
    type: ref_line.type,
    label: ref_line.label ?? ref_line.annotation?.text,
    metadata: ref_line.metadata,
  })
  const emit_click = (event: MouseEvent | KeyboardEvent) => {
    const ref_event = make_event(event)
    ref_line.on_click?.(ref_event)
    on_click?.(ref_event)
  }
</script>

{#if endpoints && ref_line.visible !== false}
  {@const [x1, y1, x2, y2] = endpoints}

  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <g
    class={['reference-line', { hovered: is_hovered }]}
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
      evt.stopPropagation()
      emit_click(evt)
    }}
    onkeydown={(evt) => {
      if (evt.key !== `Enter` && evt.key !== ` `) return
      evt.preventDefault()
      emit_click(evt)
    }}
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
    {#if annotation_placement && ref_line.annotation}
      {@const anno = ref_line.annotation}
      {@const { x, y, text_anchor, dominant_baseline, rotation } = annotation_placement}
      {@const annotation_transform = rotation ? `rotate(${rotation}, ${x}, ${y})` : undefined}
      {#if anno.background}
        {@const background_rect = reference_annotation_text_rect(
          annotation_placement,
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
        {x}
        {y}
        text-anchor={text_anchor}
        dominant-baseline={dominant_baseline}
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
