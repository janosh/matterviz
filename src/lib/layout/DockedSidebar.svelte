<script module lang="ts">
  // Row width in px (sidebar included) from which a sidebar docks by itself. Below it the
  // viewer would keep under ~600 px, where its floating panes (export, info, ~28em) cover
  // most of the scene and any host controls drawn over it.
  export const SIDEBAR_DOCK_MIN_WIDTH = 900
  // The divider keeps the viewer at least this wide and the sidebar at least SIDEBAR_MIN_PX
  const VIEWER_MIN_PX = 320
  const SIDEBAR_MIN_PX = 260
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import PaneDivider from 'svelte-widgets/SplitPane.svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  // A resizable sidebar beside a viewer: the divider and the sidebar go last in a parent that
  // carries the `docked-sidebar-row` class, which lays the two out as grid columns
  let {
    label,
    width = $bindable(0),
    header,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLElement>, `children`> & {
    // Names the sidebar and its divider for assistive tech
    label: string
    // The sidebar's measured width, back to 0 once it unmounts so a host summing viewer and
    // sidebar widths does not count a sidebar that is gone
    width?: number
    header: Snippet
    children: Snippet
  } = $props()

  // Until the divider moves the sidebar is as wide as its content (at most half the row), so a
  // short table does not leave a band of empty sidebar. A drag hands the width to `ratio`.
  let resized = $state(false)
  // The viewer's share of the row: measured below while the sidebar fits its content
  let ratio = $state(0.5)
  let aside = $state<HTMLElement>()
  // Observed, not read once: a row that resizes around an unchanged content-fit sidebar still
  // moves the divider's share
  let row_width = $state(0)

  $effect(() => () => (width = 0))
  $effect(() => {
    const row = aside?.parentElement
    if (!row) return
    const observer = new ResizeObserver(() => (row_width = row.clientWidth))
    observer.observe(row)
    return () => observer.disconnect()
  })
  // The divider is the row's child and reads its place from the row, so the measured width
  // goes there while the column fits its content. The ratio follows too, so the divider's
  // arrow keys step from where it is drawn and it announces that place.
  // A row too narrow for both minimums (a phone) stacks the sidebar under the viewer: beside it,
  // the viewer's floor left the sidebar a few dozen px, too narrow to read or use
  let stacked = $derived(row_width > 0 && row_width < VIEWER_MIN_PX + SIDEBAR_MIN_PX)
  $effect(() => {
    const row = aside?.parentElement
    row?.classList.toggle(`docked-sidebar-stacked`, stacked)
    return () => row?.classList.remove(`docked-sidebar-stacked`)
  })
  $effect(() => {
    const row = aside?.parentElement
    row?.style.setProperty(`--docked-sidebar-width`, `${width}px`)
    if (!resized && row_width > 0) ratio = 1 - width / row_width
    return () => row?.style.removeProperty(`--docked-sidebar-width`)
  })
</script>

<PaneDivider
  orientation="horizontal"
  bind:ratio
  on_resize={() => (resized = true)}
  min_px={VIEWER_MIN_PX}
  second_min_px={SIDEBAR_MIN_PX}
  aria-label="Resize the {label}"
/>
<aside
  {...rest}
  class={[`docked-sidebar`, !resized && `fit-content`, rest.class]}
  aria-label={label}
  bind:this={aside}
  bind:clientWidth={width}
>
  <h4>{@render header()}</h4>
  {@render children()}
</aside>

<style>
  :global(.docked-sidebar-row) {
    display: grid;
    position: relative;
    grid-template-columns: minmax(0, var(--split-pane-size, 66%)) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }
  :global(.docked-sidebar-row:has(> .docked-sidebar.fit-content)) {
    /* at most half the row, and never under the viewer's 320px divider floor */
    grid-template-columns: minmax(0, 1fr) fit-content(min(50%, 100% - 320px));
  }
  :global(.docked-sidebar-row:has(> .docked-sidebar.fit-content) > .pane-divider) {
    inset-inline-start: calc(100% - var(--docked-sidebar-width, 0px));
  }
  /* stacked: viewer above, sidebar below at full width, no divider to drag */
  :global(.docked-sidebar-row.docked-sidebar-stacked:has(> .docked-sidebar)) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 55%) minmax(0, 1fr);
  }
  :global(.docked-sidebar-row.docked-sidebar-stacked > .pane-divider) {
    display: none;
  }
  .docked-sidebar {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding: 6pt 8pt;
    background: var(--surface-bg, transparent);
    h4 {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 0 0 4pt;
    }
    /* The table takes the height left under the header and scrolls within it */
    :global(.table-container) {
      flex: 1;
      min-height: 0;
    }
  }
</style>
