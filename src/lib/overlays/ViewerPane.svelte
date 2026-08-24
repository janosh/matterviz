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

  let dragging = $state(false)
  const container_gap_px = 4
  // Leave room for the pane's protruding control tab plus a small inset on both sides.
  const container_width_reserve_px = 32
  // Phone-width screens: the pane also gets capped to the viewer so the whole pane is on
  // screen whenever the viewer is (see constrain_to_container). Desktop keeps the plain
  // viewport cap from the stylesheet below.
  const phone_width_px = 640
  const viewport_margin_px = 64
  const min_pane_height_px = 150

  $effect(() => {
    if (!open || !pane || position === `fixed` || dragging) return
    const pane_element = pane
    let container = pane_element.parentElement
    while (container && getComputedStyle(container).containerType === `normal`) {
      container = container.parentElement
    }
    if (!container) return

    const constrain_to_container = (): void => {
      const offset_parent = pane_element.offsetParent
      if (!(offset_parent instanceof HTMLElement)) return

      const pane_rect = pane_element.getBoundingClientRect()
      const visual_right =
        pane_element
          .querySelector<HTMLElement>(`:scope > .control-tab`)
          ?.getBoundingClientRect().right ?? pane_rect.right
      const container_rect = container.getBoundingClientRect()
      // Measured in JS rather than with 100cqh: a viewer whose height comes from min-height
      // (Trajectory in portrait) reports 100cqh as 0px, which collapsed the pane entirely.
      if (globalThis.innerWidth <= phone_width_px) {
        const below_pane_top = container_rect.bottom - pane_rect.top - container_gap_px
        const cap = Math.min(below_pane_top, globalThis.innerHeight - viewport_margin_px)
        pane_element.style.setProperty(
          `--pane-viewport-clamp`,
          `${Math.max(cap, min_pane_height_px)}px`,
        )
      } else pane_element.style.removeProperty(`--pane-viewport-clamp`)
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
      pane_element.style.left = `${pane_element.offsetLeft + shift_px / scale_x}px`
    }
    const resize_observer = new ResizeObserver(constrain_to_container)
    resize_observer.observe(container)
    resize_observer.observe(pane_element)
    constrain_to_container()
    return () => resize_observer.disconnect()
  })
</script>

<DraggablePane
  bind:open
  bind:pane
  bind:dragging
  toggle_props={{
    title: `${open ? `Close` : `Open`} ${pane_name}`,
    ...toggle_props,
    class: [`${class_prefix}-toggle`, `viewer-pane-toggle`, toggle_props.class],
  }}
  pane_props={{
    ...pane_props,
    class: [
      `${class_prefix}-pane`,
      `viewer-pane`,
      pane_props.class,
      open && `viewer-pane-open`,
    ],
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
  :global(.draggable-pane.viewer-pane) {
    --pane-viewport-clamp: calc(100dvh - 4em);
  }
  /* finger-sized toggles and drag/reset/close tab on touch screens; icons keep their size */
  @media (pointer: coarse) {
    :global(button.viewer-pane-toggle) {
      min-width: 32px;
      min-height: 32px;
    }
    :global(.draggable-pane.viewer-pane > .control-tab) {
      font-size: 1.5em;
    }
  }
  :global(.analysis-controls) {
    display: flex;
    flex-direction: column;
    gap: 4pt;
    font-size: 0.85em;
  }
  :global(.analysis-controls label) {
    display: flex;
    align-items: center;
    gap: 4pt;
  }
  :global(.analysis-controls input:is([type='number'], [type='text'])) {
    width: 5em;
    text-align: center;
  }
  :global(.analysis-controls button) {
    align-self: flex-start;
    padding: 2pt 8pt;
  }
  :global(.analysis-controls .hint) {
    opacity: 0.7;
    font-size: 0.9em;
    margin: 0;
  }
</style>
