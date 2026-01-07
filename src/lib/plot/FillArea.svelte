<script lang="ts">
  // FillArea component for rendering fill-between regions in ScatterPlot
  // Supports gradients, hover/click interactions, and animated path transitions
  import { interpolatePath } from 'd3-interpolate-path'
  import { Tween } from 'svelte/motion'
  import type {
    FillGradient,
    FillHandlerEvent,
    FillRegion,
    TweenedOptions,
  } from './types'

  let {
    region,
    region_idx,
    path,
    clip_path_id,
    x_scale_fn,
    y_scale_fn,
    hovered_region = null,
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
    hovered_region?: number | null
    on_click?: (event: FillHandlerEvent) => void
    on_hover?: (event: FillHandlerEvent | null) => void
    tween_options?: TweenedOptions<string>
  } = $props()

  // Stable instance ID for gradient uniqueness (generated once per component instance)
  const instance_id = crypto.randomUUID().slice(0, 8)
  let gradient_id = $derived(
    `fill-gradient-${region.id ?? region_idx}-${instance_id}`,
  )

  // Effective styling based on hover state
  let is_hovered = $derived(hovered_region === region_idx)
  let effective_opacity = $derived(
    is_hovered && region.hover_style?.fill_opacity != null
      ? region.hover_style.fill_opacity
      : region.fill_opacity ?? 0.3,
  )
  let effective_fill = $derived(
    is_hovered && region.hover_style?.fill
      ? region.hover_style.fill
      : region.fill ?? `steelblue`,
  )
  let path_fill = $derived(
    typeof effective_fill === `object` ? `url(#${gradient_id})` : effective_fill,
  )
  let cursor_style = $derived(
    region.hover_style?.cursor ?? (on_click ? `pointer` : `default`),
  )

  // Path animation using Tween
  const tweened_path = new Tween(path, {
    duration: 300,
    interpolate: interpolatePath,
    ...tween_options,
  })

  $effect.pre(() => {
    tweened_path.target = path
  })

  // Event handlers - use optional chaining for conciseness
  const handle_mouse_enter = (event: MouseEvent) => on_hover?.(construct_event(event))
  const handle_mouse_leave = () => on_hover?.(null)
  const handle_mouse_move = (event: MouseEvent) =>
    is_hovered && on_hover?.(construct_event(event))
  const handle_click = (event: MouseEvent) => on_click?.(construct_event(event))

  // Construct FillHandlerEvent from MouseEvent
  function construct_event(event: MouseEvent): FillHandlerEvent {
    const rect = (event.currentTarget as SVGElement).ownerSVGElement
      ?.getBoundingClientRect()
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
  const is_gradient = (
    fill: string | FillGradient | undefined,
  ): fill is FillGradient =>
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
  onkeydown={(event) => {
    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      handle_click(event as unknown as MouseEvent)
    }
  }}
  role="img"
  tabindex={on_click ? 0 : -1}
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

  <!-- Main fill path -->
  <path
    d={tweened_path.current}
    fill={path_fill}
    fill-opacity={effective_opacity}
  />
</g>

<style>
  .fill-region {
    transition: opacity 0.15s ease;
  }
  .fill-region.hovered {
    filter: brightness(1.1);
  }
</style>
