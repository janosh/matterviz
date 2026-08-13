<script lang="ts">
  type Orientation = `horizontal` | `vertical`
  const min_ratio = 0.15
  const max_ratio = 0.85

  let {
    orientation,
    ratio = $bindable(0.5),
    'aria-label': aria_label = `Resize panes`,
  }: {
    orientation: Orientation
    ratio?: number
    'aria-label'?: string
  } = $props()

  let divider = $state<HTMLDivElement>()
  let active_pointer = $state<number>()
  let drag_from_right = false
  const clamp_ratio = (value: number): number => {
    const finite_value = Number.isFinite(value) ? value : 0.5
    return Math.min(max_ratio, Math.max(min_ratio, finite_value))
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
    const [position, size] =
      orientation === `horizontal`
        ? [
            drag_from_right ? bounds.right - event.clientX : event.clientX - bounds.left,
            bounds.width,
          ]
        : [event.clientY - bounds.top, bounds.height]
    if (size > 0) apply_ratio(position / size)
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
    drag_from_right = false
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
