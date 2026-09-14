<script lang="ts">
  import type { ComponentProps, Snippet } from 'svelte'
  import { DraggablePane } from 'svelte-widgets'
  import { Cross, type IconData } from 'svelte-widgets/icons'

  let {
    open = $bindable(false),
    pane = $bindable(null),
    pane_name,
    class_prefix,
    toggle_props = {},
    pane_props = {},
    open_icon = Cross,
    closed_icon,
    max_width,
    position = `absolute`,
    resize = `both`,
    children,
    ...rest
  }: Omit<
    ComponentProps<typeof DraggablePane>,
    `children` | `closed_icon` | `toggle_btn` | `has_been_dragged` | `dragging`
  > & {
    pane_name: string
    class_prefix: string
    closed_icon: IconData
    children?: Snippet
  } = $props()

  let has_been_dragged = $state(false)
  const container_gap_px = 4
  // Leave room for the pane's protruding control tab plus a small inset on both sides.
  const container_width_reserve_px = 32
  const viewport_shift = (start: number, end: number, viewport_size: number) =>
    Math.max(container_gap_px - start, Math.min(0, viewport_size - container_gap_px - end))

  $effect(() => {
    if (!open || !pane) return
    const pane_element = pane
    let frame_id = 0
    const keep_in_viewport = () => {
      if (!document.fullscreenElement?.contains(pane_element)) return
      const rect = pane_element.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const tab = pane_element.querySelector(`:scope > .control-tab`)?.getBoundingClientRect()
      // offsetLeft/Top round to integers, which can make scaled corrections oscillate.
      const styles = getComputedStyle(pane_element)
      const parent = pane_element.offsetParent
      const parent_rect = parent instanceof HTMLElement ? parent.getBoundingClientRect() : null
      for (const [start, end, dimension, offset, viewport] of [
        [`left`, `right`, `width`, `offsetWidth`, innerWidth],
        [`top`, `bottom`, `height`, `offsetHeight`, innerHeight],
      ] as const) {
        const shift = viewport_shift(
          rect[start],
          Math.max(rect[end], tab?.[end] ?? rect[end]),
          viewport,
        )
        const scale =
          parent_rect && parent instanceof HTMLElement && parent[offset]
            ? parent_rect[dimension] / parent[offset]
            : 1
        if (Math.abs(shift) >= 0.5 && scale)
          pane_element.style[start] = `${Number(styles[start].slice(0, -2)) + shift / scale}px`
      }
    }
    const position_observer = new MutationObserver(keep_in_viewport)
    const handle_fullscreen = () => {
      cancelAnimationFrame(frame_id)
      position_observer.disconnect()
      // Responsive pane_props can rewrite inline position after fullscreenchange. Keep
      // those later updates on screen too, without resetting manual placement ownership.
      if (!document.fullscreenElement?.contains(pane_element)) return
      position_observer.observe(pane_element, { attributes: true, attributeFilter: [`style`] })
      frame_id = requestAnimationFrame(keep_in_viewport)
    }
    document.addEventListener(`fullscreenchange`, handle_fullscreen)
    handle_fullscreen()
    return () => {
      cancelAnimationFrame(frame_id)
      position_observer.disconnect()
      document.removeEventListener(`fullscreenchange`, handle_fullscreen)
    }
  })

  $effect(() => {
    // Constrain automatic placement only; manual placement belongs to the user until Reset.
    if (!open || !pane || position === `fixed` || has_been_dragged) return
    const pane_element = pane
    let container = pane_element.parentElement
    while (container && getComputedStyle(container).containerType === `normal`) {
      container = container.parentElement
    }
    if (!container) return

    const constrain_to_container = (): void => {
      if (!open || has_been_dragged) return
      const offset_parent = pane_element.offsetParent
      if (!(offset_parent instanceof HTMLElement)) return

      const pane_rect = pane_element.getBoundingClientRect()
      const visual_right =
        pane_element
          .querySelector<HTMLElement>(`:scope > .control-tab`)
          ?.getBoundingClientRect().right ?? pane_rect.right
      const container_rect = container.getBoundingClientRect()
      // Phone widths also cap the pane to the viewer so the whole pane is on screen whenever
      // the viewer is; desktop keeps the stylesheet's viewport cap. Measured in JS rather than
      // with 100cqh: a viewer whose height comes from min-height (Trajectory in portrait)
      // reports 100cqh as 0px, which collapsed the pane entirely.
      if (globalThis.innerWidth <= 640) {
        const below_pane_top = container_rect.bottom - pane_rect.top - container_gap_px
        const cap = Math.min(below_pane_top, globalThis.innerHeight - 64)
        const height = `${Math.max(cap, 150)}px`
        if (pane_element.style.getPropertyValue(`--pane-viewport-clamp`) !== height)
          pane_element.style.setProperty(`--pane-viewport-clamp`, height)
      } else if (pane_element.style.getPropertyValue(`--pane-viewport-clamp`))
        pane_element.style.removeProperty(`--pane-viewport-clamp`)
      const min_left = container_rect.left + container_gap_px
      const max_right = container_rect.right - container_gap_px
      const shift_px = Math.min(
        Math.max(min_left - pane_rect.left, 0),
        max_right - visual_right,
      )
      if (Math.abs(shift_px) < 0.5) return

      const scale_x =
        offset_parent.clientWidth > 0
          ? offset_parent.getBoundingClientRect().width / offset_parent.clientWidth
          : 1
      if (scale_x === 0) return
      pane_element.style.left = `${Number(getComputedStyle(pane_element).left.slice(0, -2)) + shift_px / scale_x}px`
    }
    const resize_observer = new ResizeObserver(constrain_to_container)
    resize_observer.observe(container)
    resize_observer.observe(pane_element)
    // DraggablePane reanchors after a debounced viewport resize, even if its size stays
    // unchanged. Observe that position update too; the correction is idempotent.
    const position_observer = new MutationObserver(constrain_to_container)
    position_observer.observe(pane_element, { attributes: true, attributeFilter: [`style`] })
    constrain_to_container()
    return () => {
      resize_observer.disconnect()
      position_observer.disconnect()
    }
  })
</script>

<DraggablePane
  bind:open
  bind:pane
  bind:has_been_dragged
  toggle_props={{
    title: `${open ? `Close` : `Open`} ${pane_name}`,
    ...toggle_props,
    class: [`${class_prefix}-toggle`, `viewer-pane-toggle`, toggle_props.class],
  }}
  pane_props={{
    ...pane_props,
    class: [`${class_prefix}-pane`, pane_props.class, open && `viewer-pane-open`],
  }}
  {open_icon}
  {closed_icon}
  max_width={position === `fixed`
    ? max_width
    : `min(${max_width ?? `450px`}, 100cqw - ${container_width_reserve_px}px)`}
  {position}
  {resize}
  {...rest}
>
  {@render children?.()}
</DraggablePane>

<style>
  /* These panes scroll with the page (position: absolute), so DraggablePane's own viewport
     clamp (fixed panes only) never applies. A pane taller than the screen can then only be
     read by scrolling the page while touches inside it scroll the pane content instead, so
     cap it to the viewport. Phone-width screens get a tighter inline cap from the effect
     above; fixed panes override this var inline as well. */
  :global(.draggable-pane.viewer-pane-open) {
    --pane-viewport-clamp: calc(100dvh - 4em);
  }
  /* finger-sized toggles and drag/reset/close tab on touch screens; icons keep their size */
  @media (pointer: coarse) {
    :global(button.viewer-pane-toggle) {
      min-width: 32px;
      min-height: 32px;
    }
    :global(.draggable-pane.viewer-pane-open > .control-tab) {
      font-size: 1.5em;
    }
  }
</style>
