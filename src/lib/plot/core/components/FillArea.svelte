<script lang="ts">
  // FillArea component for rendering fill-between regions in ScatterPlot
  // Supports gradients, hover/click interactions, and animated path transitions
  import { interpolatePath } from 'd3-interpolate-path'
  import type { TweenOptions } from 'svelte/motion'
  import { add_alpha } from '$lib/colors'
  import PatternDefs from '$lib/plot/core/components/PatternDefs.svelte'
  import { is_fill_gradient } from '$lib/plot/core/fill-utils'
  import { resolve_pattern } from '$lib/plot/core/patterns'
  import type { FillHandlerEvent, FillRegion } from '$lib/plot/core/types'
  import { create_settling_tween } from '$lib/plot/core/settling-tween.svelte'
  import { unique_id } from '$lib/plot/core/utils'

  let {
    region,
    region_idx,
    is_first_segment = true,
    defs_id = unique_id(`fill`),
    path,
    clip_path_id,
    x_scale_fn,
    y_scale_fn,
    is_hovered = false,
    on_click,
    on_hover,
    tween_options,
  }: {
    region: FillRegion
    region_idx: number
    // A region split by gaps or crossings renders one FillArea per segment. They are one
    // logical region, so only the first joins the tab order, carries the label and emits the
    // gradient/pattern <defs> - the rest would otherwise be N identical tab stops announcing
    // the same thing and N identical tiles. Segments of one region must share `defs_id`.
    is_first_segment?: boolean
    defs_id?: string
    path: string
    clip_path_id: string
    x_scale_fn: ((x: number) => number) & { invert?: (y: number) => number | Date }
    y_scale_fn: ((y: number) => number) & { invert?: (y: number) => number }
    is_hovered?: boolean
    on_click?: (event: FillHandlerEvent) => void
    on_hover?: (event: FillHandlerEvent | null) => void
    tween_options?: TweenOptions<string>
  } = $props()

  // Scopes gradient/pattern ids to this region; `region.id` is user text and may not be a
  // valid id fragment
  let gradient_id = $derived(`${defs_id}-gradient`)

  // On hover (without an explicit hover_style), noticeably raise opacity. A faint fill (e.g. a
  // low-alpha rgba color at the default 0.3 fill-opacity) is otherwise nearly invisible, so a mere
  // brightness filter reads as "no change". An explicit hover_style.fill_opacity always wins.
  let effective_opacity = $derived(
    is_hovered
      ? (region.hover_style?.fill_opacity ?? Math.min(1, (region.fill_opacity ?? 0.3) + 0.4))
      : (region.fill_opacity ?? 0.3),
  )
  let effective_fill = $derived(
    is_hovered && region.hover_style?.fill
      ? region.hover_style.fill
      : (region.fill ?? `steelblue`),
  )
  // Hatch/texture over a solid fill color; a gradient fill has no single color to texture.
  // The fill opacity is baked into the tile backdrop instead of applied to the mark: a 0.3
  // fill-opacity on top of the tile would fade the texture below visibility and its
  // auto-contrast (chosen against the opaque color) would be wrong for the rendered tint.
  // The translucent backdrop makes the texture inherit currentColor, which reads on any tint.
  let tile_bg = $derived(
    typeof effective_fill === `string` ? add_alpha(effective_fill, effective_opacity) : ``,
  )
  let pattern = $derived(
    region.pattern && typeof effective_fill === `string`
      ? resolve_pattern(region.pattern, tile_bg, defs_id)
      : undefined,
  )
  // add_alpha leaves colors it cannot parse (CSS vars) alone; then the mark keeps its opacity
  let path_opacity = $derived(pattern && tile_bg !== effective_fill ? 1 : effective_opacity)
  let path_fill = $derived(
    typeof effective_fill === `object`
      ? `url(#${gradient_id})`
      : (pattern?.url ?? effective_fill),
  )
  // outline drawn only on hover when the user opted in via hover_style.stroke
  let hover_stroke = $derived(is_hovered ? region.hover_style?.stroke : undefined)
  let is_clickable = $derived(Boolean(on_click || region.on_click))
  // Reachable whenever the region reports anything, not only when it is clickable
  let is_interactive = $derived(is_clickable || Boolean(on_hover || region.on_hover))
  let cursor_style = $derived(
    region.hover_style?.cursor ?? (is_clickable ? `pointer` : `default`),
  )

  // tween_options per update, so a plot can drop the morph for a drag the way its lines do
  const tweened_path = create_settling_tween(
    () => path,
    { duration: 300, interpolate: interpolatePath },
    { live: () => tween_options },
  )

  // Emit helpers - call both region-level and prop-level handlers when distinct
  const emit_hover = (evt: FillHandlerEvent | null) => {
    region.on_hover?.(evt)
    if (on_hover !== region.on_hover) on_hover?.(evt)
  }
  const emit_click = (evt: FillHandlerEvent) => {
    region.on_click?.(evt)
    if (on_click !== region.on_click) on_click?.(evt)
  }

  // Client position -> svg-relative pixels -> data coords (time x axes invert to Date)
  const make_event = (
    // FocusEvent for keyboard focus, which carries no pointer and uses the center
    event: MouseEvent | KeyboardEvent | FocusEvent,
    client_x: number,
    client_y: number,
  ): FillHandlerEvent => {
    const target = event.currentTarget
    const svg_rect = (
      target instanceof SVGElement ? target.ownerSVGElement : null
    )?.getBoundingClientRect()
    const px = client_x - (svg_rect?.left ?? 0)
    const py = client_y - (svg_rect?.top ?? 0)
    const raw_x = x_scale_fn.invert?.(px) ?? 0
    return {
      event,
      region_idx,
      region_id: region.id,
      x: raw_x instanceof Date ? raw_x.getTime() : raw_x,
      y: y_scale_fn.invert?.(py) ?? 0,
      px,
      py,
      label: region.label,
      metadata: region.metadata,
    }
  }
  const mouse_event = (event: MouseEvent) => make_event(event, event.clientX, event.clientY)
  const handle_click = (event: MouseEvent) => {
    event.stopPropagation()
    emit_click(mouse_event(event))
  }
  // Keyboard has no pointer position: report the region's center
  const center_of = (target: EventTarget | null): [number, number] | null => {
    if (!(target instanceof SVGElement)) return null
    const { left, right, top, bottom } = target.getBoundingClientRect()
    return [(left + right) / 2, (top + bottom) / 2]
  }
  const handle_keydown = (event: KeyboardEvent) => {
    if (event.key !== `Enter` && event.key !== ` `) return
    event.preventDefault()
    const center = center_of(event.currentTarget)
    if (!is_clickable || !center) return
    emit_click(make_event(event, ...center))
  }
  // Focus is the keyboard's hover: without it a keyboard user reaches the region but
  // sees nothing, since every hover payload here comes from a pointer event
  const handle_focus = (event: FocusEvent) => {
    const center = center_of(event.currentTarget)
    if (center) emit_hover(make_event(event, ...center))
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<g
  class={['fill-region', { hovered: is_hovered }]}
  clip-path={`url(#${clip_path_id})`}
  style="cursor: {cursor_style}; pointer-events: all"
  onmouseenter={(event) => emit_hover(mouse_event(event))}
  onmouseleave={() => emit_hover(null)}
  onmousemove={(event) => is_hovered && emit_hover(mouse_event(event))}
  onclick={handle_click}
  onkeydown={handle_keydown}
  onfocus={handle_focus}
  onblur={() => emit_hover(null)}
  role="img"
  tabindex={is_interactive && is_first_segment ? 0 : -1}
  aria-hidden={is_first_segment ? undefined : `true`}
  aria-label={region.label ?? `Fill region ${region_idx}`}
>
  {#snippet gradient_stops(stops: readonly [number, string][])}
    {#each stops as [offset, color], idx (idx)}
      <stop offset="{offset * 100}%" stop-color={color} />
    {/each}
  {/snippet}

  {#if pattern && is_first_segment}
    <defs><PatternDefs patterns={[pattern]} /></defs>
  {/if}
  <!-- Gradient defs -->
  {#if is_fill_gradient(region.fill) && is_first_segment}
    <defs>
      {#if region.fill.type === `linear`}
        <linearGradient
          id={gradient_id}
          gradientTransform="rotate({region.fill.angle ?? 0}, 0.5, 0.5)"
        >
          {@render gradient_stops(region.fill.stops)}
        </linearGradient>
      {:else if region.fill.type === `radial`}
        <radialGradient
          id={gradient_id}
          cx={region.fill.center?.x ?? 0.5}
          cy={region.fill.center?.y ?? 0.5}
          r="0.5"
        >
          {@render gradient_stops(region.fill.stops)}
        </radialGradient>
      {/if}
    </defs>
  {/if}

  <!-- Main fill path. On hover the opacity boost (effective_opacity) highlights the area. We do NOT
       stroke by default: a fill-between region is one closed polygon, so stroking traces its whole
       perimeter (both boundaries + the straight closing edges), which looks messy and doesn't follow
       the visible area. Users can still opt into an outline via hover_style.stroke. -->
  <path
    d={tweened_path.current}
    fill={path_fill}
    fill-opacity={path_opacity}
    stroke={hover_stroke ?? `none`}
    stroke-width={hover_stroke ? (region.hover_style?.stroke_width ?? 1.5) : 0}
  />
</g>

<style>
  .fill-region {
    transition: opacity 0.15s ease;
  }
  .fill-region.hovered {
    filter: brightness(1.35) saturate(1.2);
  }
</style>
