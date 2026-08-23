<script lang="ts">
  import { clamp } from '$lib/math'

  type Orientation = `horizontal` | `vertical`
  const min_ratio = 0.15
  const max_ratio = 0.85

  let {
    orientation,
    ratio = $bindable(0.5),
    min_px,
    max_px,
    second_min_px,
    'aria-label': aria_label = `Resize panes`,
  }: {
    orientation: Orientation
    ratio?: number
    'aria-label'?: string
    // Pixel clamps on top of the [15%, 85%] ratio clamps, so a narrow container can't squeeze a
    // pane below a usable size: min_px/max_px bound the first pane, second_min_px reserves room
    // for the second. They need the container's measured size, so they're skipped until layout
    min_px?: number
    max_px?: number
    second_min_px?: number
  } = $props()

  let divider = $state<HTMLDivElement>()
  let active_pointer = $state<number>()
  let drag_from_right = false
  const clamp_ratio = (value: number): number => {
    const bounds = divider?.parentElement?.getBoundingClientRect()
    const size = (orientation === `horizontal` ? bounds?.width : bounds?.height) ?? 0
    let lo = min_ratio
    let hi = max_ratio
    if (size > 0) {
      // a floor wider than the container itself means the first pane takes all of it
      if (min_px !== undefined) lo = Math.min(1, Math.max(lo, min_px / size))
      if (max_px !== undefined) hi = Math.min(hi, max_px / size)
      if (second_min_px !== undefined) hi = Math.min(hi, 1 - second_min_px / size)
      // A container too small for both pixel floors splits at the first pane's floor
      hi = Math.max(lo, hi)
    }
    return clamp(Number.isFinite(value) ? value : 0.5, lo, hi)
  }
  let safe_ratio = $derived(clamp_ratio(ratio))

  const update_parent = (value: number): void => {
    divider?.parentElement?.style.setProperty(`--split-pane-size`, `${value * 100}%`)
  }
  const is_right_to_left = (): boolean => {
    const parent = divider?.parentElement
    return parent ? getComputedStyle(parent).direction === `rtl` : false
  }

  const apply_ratio = (value: number): void => {
    ratio = clamp_ratio(value)
    update_parent(ratio)
  }

  $effect(() => update_parent(safe_ratio))

  const resize_from_pointer = (event: PointerEvent): void => {
    if (active_pointer !== event.pointerId || !divider?.parentElement) return
    const bounds = divider.parentElement.getBoundingClientRect()
    const horizontal = orientation === `horizontal`
    const size = horizontal ? bounds.width : bounds.height
    if (size <= 0) return
    const position = horizontal
      ? drag_from_right
        ? bounds.right - event.clientX
        : event.clientX - bounds.left
      : event.clientY - bounds.top
    apply_ratio(position / size)
  }

  const start_resize = (event: PointerEvent): void => {
    if (active_pointer !== undefined || event.button !== 0) return
    event.preventDefault()
    active_pointer = event.pointerId
    drag_from_right = is_right_to_left()
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  }

  const stop_resize = (event: PointerEvent): void => {
    if (active_pointer !== event.pointerId) return
    active_pointer = undefined
  }

  const resize_from_keyboard = (event: KeyboardEvent): void => {
    const horizontal_keys = is_right_to_left()
      ? [`ArrowRight`, `ArrowLeft`]
      : [`ArrowLeft`, `ArrowRight`]
    const [decrease_key, increase_key] =
      orientation === `horizontal` ? horizontal_keys : [`ArrowUp`, `ArrowDown`]
    if (event.key !== decrease_key && event.key !== increase_key) return
    event.preventDefault()
    apply_ratio(safe_ratio + (event.key === decrease_key ? -0.05 : 0.05))
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={divider}
  class={[`pane-divider`, orientation, active_pointer != null && `dragging`]}
  role="separator"
  aria-label={aria_label}
  aria-orientation={orientation === `horizontal` ? `vertical` : `horizontal`}
  aria-valuemin={min_ratio * 100}
  aria-valuemax={max_ratio * 100}
  aria-valuenow={Math.round(safe_ratio * 100)}
  tabindex="0"
  title="Drag to resize panes"
  onkeydown={resize_from_keyboard}
  onpointerdown={start_resize}
  onpointermove={resize_from_pointer}
  onpointerup={stop_resize}
  onpointercancel={stop_resize}
  onlostpointercapture={stop_resize}
></div>

<style>
  .pane-divider {
    position: absolute;
    z-index: 4;
    touch-action: none;
    &::before {
      position: absolute;
      background: color-mix(in srgb, currentColor 24%, transparent);
      content: '';
    }
    &:is(:hover, :focus-visible, .dragging)::before {
      background: var(--active-color, #4e79a7);
    }
    &.horizontal {
      inset-block: 0;
      inset-inline-start: var(--split-pane-size, 50%);
      width: 9px;
      cursor: col-resize;
      transform: translateX(-50%);
      &:dir(rtl) {
        transform: translateX(50%);
      }
      &::before {
        inset-block: 0;
        inset-inline-start: 4px;
        width: 1px;
      }
    }
    &.vertical {
      inset-block-start: var(--split-pane-size, 50%);
      inset-inline: 0;
      height: 9px;
      cursor: row-resize;
      transform: translateY(-50%);
      &::before {
        inset-block-start: 4px;
        inset-inline: 0;
        height: 1px;
      }
    }
  }
</style>
