<script module lang="ts">
  // Row width in px (sidebar included) from which a sidebar docks by itself. Below it the
  // viewer would keep under ~600 px, where its floating panes (export, info, ~28em) cover
  // most of the scene and any host controls drawn over it.
  export const SIDEBAR_DOCK_MIN_WIDTH = 900
  // The share of the row the viewer keeps once a sidebar docks
  export const SIDEBAR_RATIO = { sites: 0.68, inspector: 0.64 } as const
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import PaneDivider from 'svelte-widgets/SplitPane.svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  // A resizable sidebar beside a viewer: the divider and the sidebar go last in a parent that
  // carries the `docked-sidebar-row` class, which lays the two out as grid columns
  let {
    label,
    ratio = $bindable(),
    width = $bindable(0),
    header,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLElement>, `children`> & {
    // Names the sidebar and its divider for assistive tech
    label: string
    // The viewer's share of the row, from SIDEBAR_RATIO until the divider moves
    ratio: number
    // The sidebar's measured width, back to 0 once it unmounts so a host summing viewer and
    // sidebar widths does not count a sidebar that is gone
    width?: number
    header: Snippet
    children: Snippet
  } = $props()

  // Until the divider moves the sidebar is as wide as its content (at most half the row), so a
  // short table does not leave a band of empty sidebar. A drag hands the width to `ratio`.
  let resized = $state(false)
  let aside = $state<HTMLElement>()

  $effect(() => () => (width = 0))
  // The divider is the row's child and reads its place from the row, so the measured width
  // goes there while the column fits its content. The ratio follows too, so the divider's
  // arrow keys step from where it is drawn and it announces that place.
  $effect(() => {
    const row = aside?.parentElement
    row?.style.setProperty(`--docked-sidebar-width`, `${width}px`)
    if (!resized && row && row.clientWidth > 0) ratio = 1 - width / row.clientWidth
    return () => row?.style.removeProperty(`--docked-sidebar-width`)
  })
</script>

<PaneDivider
  orientation="horizontal"
  bind:ratio
  on_resize={() => (resized = true)}
  min_px={320}
  second_min_px={260}
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
  .docked-sidebar {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding: 6pt 8pt;
    background: var(--surface-bg, transparent);
    border-inline-start: 1px solid var(--border-color, rgba(128, 128, 128, 0.3));
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
