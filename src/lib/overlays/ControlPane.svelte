<script lang="ts">
  // Shared gear toggle + draggable pane shell for viewer controls.
  import type { ViewerPaneOptions } from '$lib/overlays'
  import ViewerPane from './ViewerPane.svelte'
  import type { Snippet } from 'svelte'
  import type { ClassValue } from 'svelte/elements'
  import { Settings } from 'svelte-widgets/icons'

  let {
    controls_open = $bindable(false),
    pane = $bindable(null),
    controls_name = `plot`,
    pane_class,
    toggle_class,
    toggle_title = controls_name,
    // Empty style opts out when ViewerChrome owns toggle layout.
    toggle_style = `position: absolute; top: var(--viewer-buttons-top, var(--ctrl-btn-top, 1ex)); right: var(--ctrl-btn-right, var(--fullscreen-btn-offset, var(--ctrl-btn-default-right, 1ex)));`,
    pane_style = ``,
    toggle_props = {},
    pane_props = {},
    children,
    ...options
  }: ViewerPaneOptions & {
    controls_open?: boolean
    controls_name?: string
    pane_class?: ClassValue
    toggle_class?: ClassValue
    toggle_title?: string
    toggle_style?: string
    pane_style?: string
    children?: Snippet
  } = $props()
</script>

<ViewerPane
  bind:open={controls_open}
  bind:pane
  pane_name={`${toggle_title} controls`}
  class_prefix={`${controls_name}-controls`}
  toggle_props={{
    ...toggle_props,
    class: [toggle_class, toggle_props.class],
    style: [toggle_style, toggle_props.style].filter(Boolean).join(`; `),
  }}
  pane_props={{
    ...pane_props,
    class: [pane_class, pane_props.class],
    // Prepend compact defaults so a caller's pane_style can override individual vars
    // without dropping padding/gap the way a full-style replace used to.
    style: [`--pane-padding: 6px 8px; --pane-gap: 0`, pane_style, pane_props.style]
      .filter(Boolean)
      .join(`; `),
  }}
  closed_icon={Settings}
  {...options}
>
  {@render children?.()}
</ViewerPane>
