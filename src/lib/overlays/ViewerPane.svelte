<script lang="ts">
  import type { ComponentProps, Snippet } from 'svelte'
  import DraggablePane from 'svelte-widgets/DraggablePane.svelte'
  import type { IconData } from 'svelte-widgets/icons'
  import ShortcutsList from '#lib/layout/ShortcutsList.svelte'
  import type { ShortcutScope } from '#lib/shortcuts.js'

  let {
    open = $bindable(false),
    pane = $bindable(null),
    pane_name,
    class_prefix,
    toggle_props = {},
    pane_props = {},
    closed_icon,
    max_width,
    position = `absolute`,
    resize = `both`,
    shortcut_scopes,
    children,
    ...rest
  }: Omit<
    ComponentProps<typeof DraggablePane>,
    `children` | `closed_icon` | `toggle_btn` | `has_been_dragged` | `dragging`
  > & {
    pane_name: string
    class_prefix: string
    closed_icon: IconData
    // The owning viewer's keyboard shortcuts, listed at the bottom of the pane
    shortcut_scopes?: readonly ShortcutScope[]
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
        const visual_end = Math.max(rect[end], tab?.[end] ?? rect[end])
        const shift = viewport_shift(rect[start], visual_end, viewport)
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

  // Boxes that cut the pane off with no way to scroll to the rest, walking its containing blocks:
  // an absolute box escapes the clipping between it and its offset parent, a fixed one all of it.
  // The walk ends at the first scroller (the user can reach the rest) or a fullscreen viewer.
  const clipping_ancestors = (pane_node: HTMLElement): HTMLElement[] => {
    const clippers: HTMLElement[] = []
    let element: Element | null = pane_node
    while (element instanceof HTMLElement && element !== document.fullscreenElement) {
      const { overflowY, position: css_position } = getComputedStyle(element)
      if (overflowY === `auto` || overflowY === `scroll`) break
      if (overflowY === `hidden` || overflowY === `clip`) clippers.push(element)
      if (css_position === `fixed`) break
      element = css_position === `absolute` ? element.offsetParent : element.parentElement
    }
    return clippers
  }
  // A root or body that clips does so at the viewport (overflow propagates there), not its box.
  const clip_bottom = (clipper: HTMLElement): number =>
    clipper === document.documentElement || clipper === document.body
      ? globalThis.innerHeight
      : clipper.getBoundingClientRect().bottom

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
      const clippers = clipping_ancestors(pane_element)
      // re-observing is a no-op, and a stale clipper only costs an idempotent re-check
      for (const clipper of clippers) resize_observer.observe(clipper)
      // The pane ends above whatever clips it, else a host card with overflow: hidden cuts its
      // bottom off out of reach: a hard limit, however little room it leaves. Phone widths also
      // end it inside the viewer so the whole pane is on screen whenever the viewer is, a soft
      // limit floored at 150px since the pane may overflow the viewer. Measured in JS, not
      // 100cqh: a viewer whose height comes from min-height (Trajectory in portrait) reports
      // 100cqh as 0px, which collapsed the pane.
      const room_above = (bound: HTMLElement) =>
        clip_bottom(bound) - pane_rect.top - container_gap_px
      const phone = globalThis.innerWidth <= 640
      if (phone || clippers.length) {
        const cap = Math.min(
          globalThis.innerHeight - 64,
          phone ? Math.max(room_above(container), 150) : Infinity,
          ...clippers.map(room_above),
        )
        const height = `${Math.max(cap, 0)}px`
        if (pane_element.style.getPropertyValue(`--pane-viewport-clamp`) !== height)
          pane_element.style.setProperty(`--pane-viewport-clamp`, height)
      } else if (pane_element.style.getPropertyValue(`--pane-viewport-clamp`))
        pane_element.style.removeProperty(`--pane-viewport-clamp`)
      const min_left = container_rect.left + container_gap_px
      const max_right = container_rect.right - container_gap_px
      const shift_left = Math.max(min_left - pane_rect.left, 0)
      const shift_px = Math.min(shift_left, max_right - visual_right)
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
  {closed_icon}
  max_width={position === `fixed`
    ? max_width
    : `min(${max_width ?? `450px`}, 100cqw - ${container_width_reserve_px}px)`}
  {position}
  {resize}
  {...rest}
>
  {@render children?.()}
  {#if shortcut_scopes}<ShortcutsList scopes={shortcut_scopes} />{/if}
</DraggablePane>

<style>
  /* These panes scroll with the page (position: absolute), so DraggablePane's viewport clamp
     (fixed panes only) never applies and a pane taller than the screen would be unreadable on
     touch: cap it here. Phones get a tighter inline cap from the effect above. */
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
