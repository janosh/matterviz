<script lang="ts">
  // Shared draggable controls-pane shell (gear toggle + settings pane) used by plot/diagram
  // controls components. Centralizes the toggle/pane styling and the `*-controls-toggle` /
  // `*-controls-pane` class convention so it lives in one place instead of being re-typed in
  // every *Controls component (PlotControls, SankeyControls, ...).
  import { DraggablePane } from '$lib/overlays'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    controls_open = $bindable(false),
    controls_class = `plot`,
    title = controls_class || `plot`,
    toggle_props = {},
    pane_props = {},
    children,
  }: {
    controls_open?: boolean
    controls_class?: string // class prefix -> `${controls_class}-controls-{toggle,pane}`
    title?: string // toggle button title text ("Open <title> controls")
    toggle_props?: HTMLAttributes<HTMLButtonElement>
    pane_props?: HTMLAttributes<HTMLDivElement>
    children?: Snippet
  } = $props()
</script>

<DraggablePane
  bind:show={controls_open}
  closed_icon="Settings"
  open_icon="Cross"
  toggle_props={{
    title: `${controls_open ? `Close` : `Open`} ${title} controls`,
    ...toggle_props,
    class: `${controls_class}-controls-toggle ${toggle_props?.class ?? ``}`,
    style:
      `position: absolute; top: var(--ctrl-btn-top, 5pt); right: var(--ctrl-btn-right, 1ex);` +
      (toggle_props?.style ?? ``),
  }}
  pane_props={{
    ...pane_props,
    class: `${controls_class}-controls-pane ${pane_props?.class ?? ``}`,
    style: `--pane-padding: 12px; --pane-gap: 4px; ${pane_props?.style ?? ``}`,
  }}
>
  {@render children?.()}
</DraggablePane>
