<script lang="ts">
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import type { ComponentProps, Snippet } from 'svelte'
  import {
    ELEMENT_ORDERINGS,
    type ElementAxisOrderingKey,
    ORDERING_LABELS,
  } from './index'

  let {
    ordering = $bindable(`atomic_number`),
    orderings = ELEMENT_ORDERINGS,
    controls_open = $bindable(false),
    show_pane = true,
    pane_props = {},
    toggle_props = {},
    children,
  }: {
    ordering?: ElementAxisOrderingKey
    orderings?: ElementAxisOrderingKey[]
    controls_open?: boolean
    show_pane?: boolean
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    children?: Snippet<[{
      controls_open: boolean
    }]>
  } = $props()
</script>

<DraggablePane
  bind:show={controls_open}
  {show_pane}
  pane_props={{
    ...pane_props,
    class: `heatmap-matrix-controls-pane ${pane_props?.class ?? ``}`.trim(),
  }}
  toggle_props={{
    ...toggle_props,
    title: toggle_props.title ?? (controls_open ? `` : `Heatmap controls`),
    class: `heatmap-matrix-controls-toggle ${toggle_props?.class ?? ``}`.trim(),
  }}
  closed_icon="Settings"
  open_icon="Cross"
>
  <div class="heatmap-matrix-controls">
    <label>
      Axis Ordering
      <select bind:value={ordering}>
        {#each orderings as ord (ord)}
          <option value={ord}>{ORDERING_LABELS[ord]}</option>
        {/each}
      </select>
    </label>
    {@render children?.({ controls_open })}
  </div>
</DraggablePane>

<style>
  :global(button.heatmap-matrix-controls-toggle) {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 20;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  :global(.heatmap-controls-anchor:hover button.heatmap-matrix-controls-toggle),
  :global(button.heatmap-matrix-controls-toggle[aria-expanded='true']) {
    opacity: 1;
    pointer-events: auto;
  }
  :global(div.heatmap-matrix-controls-pane.draggable-pane) {
    z-index: 25;
    min-width: 220px;
  }
  .heatmap-matrix-controls {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.2em;
    font-size: 0.9em;
  }
  select {
    padding: 0.3em 0.5em;
    border-radius: var(--border-radius, 3pt);
    border: 1px solid light-dark(#ccc, #555);
    background: light-dark(white, #333);
    color: inherit;
    font-size: inherit;
  }
</style>
