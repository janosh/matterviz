<script lang="ts">
  // FillArea component for rendering fill-between regions in ScatterPlot
  // Supports gradients, hover/click interactions, and animated path transitions
  import { interpolatePath } from 'd3-interpolate-path'
  import { untrack } from 'svelte'
  import { Tween, type TweenOptions } from 'svelte/motion'
  import type { FillGradient, FillHandlerEvent, FillRegion } from '$lib/plot/core/types'
  import { unique_id } from '$lib/plot/core/utils'

  let {
    region,
    region_idx,
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
    path: string
    clip_path_id: string
    x_scale_fn: ((x: number) => number) & { invert?: (y: number) => number | Date }
    y_scale_fn: ((y: number) => number) & { invert?: (y: number) => number }
    is_hovered?: boolean
    on_click?: (event: FillHandlerEvent) => void
    on_hover?: (event: FillHandlerEvent | null) => void
    tween_options?: TweenOptions<string>
  } = $props()

  // Stable instance ID for gradient uniqueness (generated once per component instance)
  const instance_id = unique_id()
  let gradient_id = $derived(`fill-gradient-${region.id ?? region_idx}-${instance_id}`)

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
  let path_fill = $derived(
    typeof effective_fill === `object` ? `url(#${gradient_id})` : effective_fill,
  )
  // outline drawn only on hover when the user opted in via hover_style.stroke
  let hover_stroke = $derived(is_hovered ? region.hover_style?.stroke : undefined)
  let is_clickable = $derived(Boolean(on_click || region.on_click))
  let cursor_style = $derived(
    region.hover_style?.cursor ?? (is_clickable ? `pointer` : `default`),
  )

  // Path animation using Tween - create once, update target via effect
  // untrack() explicitly captures initial values (intentional - config set once at mount)
  const tweened_path = new Tween(
    untrack(() => path),
    untrack(() => ({
      duration: 300,
      interpolate: interpolatePath,
      ...tween_options,
    })),
  )

  $effect.pre(() => {
    tweened_path.target = path
  })

  // Emit helpers - call both region-level and prop-level handlers when distinct
  const emit_hover = (evt: FillHandlerEvent | null) => {
    region.on_hover?.(evt)
    if (on_hover !== region.on_hover) on_hover?.(evt)
  }
  const emit_click = (evt: FillHandlerEvent) => {
    region.on_click?.(evt)
    if (on_click !== region.on_click) on_click?.(evt)
  }

  // Event handlers
  const handle_mouse_enter = (event: MouseEvent) => emit_hover(construct_event(event))
  const handle_mouse_leave = () => emit_hover(null)
  const handle_mouse_move = (event: MouseEvent) =>
    is_hovered && emit_hover(construct_event(event))
  const handle_click = (event: MouseEvent) => emit_click(construct_event(event))

  // Keyboard handler - creates event with default coordinates since no mouse position
  function handle_keydown(event: KeyboardEvent) {
    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      if (!is_clickable) return

      // For keyboard activation, use center of element or default coordinates
      const target = event.currentTarget
      if (!(target instanceof SVGElement)) return
      const rect = target.ownerSVGElement?.getBoundingClientRect()
      const element_rect = target.getBoundingClientRect()

      // Use center of the fill region element
      const px = element_rect
        ? (element_rect.left + element_rect.right) / 2 - (rect?.left ?? 0)
        : 0
      const py = element_rect
        ? (element_rect.top + element_rect.bottom) / 2 - (rect?.top ?? 0)
        : 0

      const raw_x = x_scale_fn.invert?.(px) ?? 0
      const data_x = raw_x instanceof Date ? raw_x.getTime() : raw_x
      const data_y = y_scale_fn.invert?.(py) ?? 0

      emit_click({
        event,
        region_idx,
        region_id: region.id,
        x: data_x,
        y: data_y,
        px,
        py,
        label: region.label,
        metadata: region.metadata,
      })
    }
  }

  // Construct FillHandlerEvent from MouseEvent
  function construct_event(event: MouseEvent): FillHandlerEvent {
    const current = event.currentTarget
    const rect = (
      current instanceof SVGElement ? current.ownerSVGElement : null
    )?.getBoundingClientRect()
    const px = event.clientX - (rect?.left ?? 0)
    const py = event.clientY - (rect?.top ?? 0)
    const raw_x = x_scale_fn.invert?.(px) ?? 0
    const data_x = raw_x instanceof Date ? raw_x.getTime() : raw_x
    const data_y = y_scale_fn.invert?.(py) ?? 0

    return {
      event,
      region_idx,
      region_id: region.id,
      x: data_x,
      y: data_y,
      px,
      py,
      label: region.label,
      metadata: region.metadata,
    }
  }

  // Type guard for gradient fill
  const is_gradient = (fill: string | FillGradient | undefined): fill is FillGradient =>
    typeof fill === `object` && fill !== null && `type` in fill
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<g
  class="fill-region"
  class:hovered={is_hovered}
  clip-path={`url(#${clip_path_id})`}
  style:cursor={cursor_style}
  style:pointer-events="all"
  onmouseenter={handle_mouse_enter}
  onmouseleave={handle_mouse_leave}
  onmousemove={handle_mouse_move}
  onclick={handle_click}
  onkeydown={handle_keydown}
  role="img"
  tabindex={is_clickable ? 0 : -1}
  aria-label={region.label ?? `Fill region ${region_idx}`}
>
  {#snippet gradient_stops(stops: readonly [number, string][])}
    {#each stops as [offset, color], idx (idx)}
      <stop offset="{offset * 100}%" stop-color={color} />
    {/each}
  {/snippet}

  <!-- Gradient defs -->
  {#if is_gradient(region.fill)}
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
    fill-opacity={effective_opacity}
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
