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
    toggle_visible = $bindable(false),
    show_pane = true,
    pane_props = {},
    toggle_props = {},
    children,
  }: {
    ordering?: ElementAxisOrderingKey
    orderings?: ElementAxisOrderingKey[]
    controls_open?: boolean
    toggle_visible?: boolean
    show_pane?: boolean
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    children?: Snippet<[{
      controls_open: boolean
    }]>
  } = $props()

  function merge_styles(base_style: string, override_style: unknown): string {
    const override_style_str = typeof override_style === `string`
      ? override_style
      : ``
    if (!override_style_str) return base_style
    return `${base_style}; ${override_style_str}`
  }

  let show_toggle = $derived(controls_open || toggle_visible)
  let default_toggle_style = $derived(
    [
      `position: absolute`,
      `top: var(--heatmap-matrix-controls-toggle-top, 6px)`,
      `right: var(--heatmap-matrix-controls-toggle-right, 6px)`,
      `z-index: var(--heatmap-matrix-controls-toggle-z-index, 20)`,
      `opacity: ${show_toggle ? `1` : `0`}`,
      `pointer-events: ${show_toggle ? `auto` : `none`}`,
      `transition: var(--heatmap-matrix-controls-toggle-transition, opacity 0.2s ease)`,
    ].join(`; `),
  )
  let default_pane_style = [
    `z-index: var(--heatmap-matrix-controls-pane-z-index, 25)`,
    `min-width: var(--heatmap-matrix-controls-pane-min-width, 220px)`,
  ].join(`; `)
</script>

<DraggablePane
  bind:show={controls_open}
  {show_pane}
  pane_props={{
    ...pane_props,
    class: `heatmap-matrix-controls-pane ${pane_props?.class ?? ``}`.trim(),
    style: merge_styles(default_pane_style, pane_props?.style),
  }}
  toggle_props={{
    ...toggle_props,
    title: toggle_props.title ?? (controls_open ? `` : `Heatmap controls`),
    class: `heatmap-matrix-controls-toggle ${toggle_props?.class ?? ``}`.trim(),
    style: merge_styles(default_toggle_style, toggle_props?.style),
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
