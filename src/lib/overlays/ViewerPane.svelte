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
    class: [`${class_prefix}-toggle`, toggle_props.class],
  }}
  pane_props={{
    ...pane_props,
    class: [`${class_prefix}-pane`, pane_props.class],
  }}
  {open_icon}
  {closed_icon}
  max_width={position === `fixed`
    ? max_width
    : `min(${max_width ?? `450px`}, 100cqw - ${container_width_reserve_px}px)`}
  {position}
  {...rest}
>
  {@render children?.()}
</DraggablePane>

<style>
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
