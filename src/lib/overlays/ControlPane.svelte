<script lang="ts">
  import { normalize_show_controls, type ShowControlsProp } from '#lib/controls.js'
  // Shared gear toggle + draggable pane shell for viewer controls.
  import type { ViewerPaneOptions } from '#lib/overlays/index.js'
  import ViewerPane from './ViewerPane.svelte'
  import type { Snippet } from 'svelte'
  import type { ClassValue } from 'svelte/elements'
  import { Settings } from 'svelte-widgets/icons'

  let {
    show_controls = true,
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
    lazy = true,
    children,
    ...options
  }: ViewerPaneOptions & {
    show_controls?: ShowControlsProp
    controls_open?: boolean
    controls_name?: string
    pane_class?: ClassValue
    toggle_class?: ClassValue
    toggle_title?: string
    toggle_style?: string
    pane_style?: string
    // Mount children on first open (then keep them). Opt out when the children capture state
    // at mount that must predate the first open, like reset baselines.
    lazy?: boolean
    children?: Snippet
  } = $props()
  const controls_config = $derived(normalize_show_controls(show_controls))
  // Lazy children mount on first open and stay mounted after, so closed panes cost nothing up
  // front while reopening keeps their local state
  let ever_opened = $state(false)
  $effect.pre(() => {
    if (controls_open) ever_opened = true
  })
</script>

{#if controls_config.visible(`controls`)}
  <ViewerPane
    bind:open={controls_open}
    bind:pane
    pane_name={`${toggle_title} controls`}
    class_prefix={`${controls_name}-controls`}
    toggle_props={{
      ...toggle_props,
      class: [`control-pane-toggle`, controls_config.class, toggle_class, toggle_props.class],
      style: [toggle_style, controls_config.style, toggle_props.style]
        .filter(Boolean)
        .join(`; `),
    }}
    pane_props={{
      ...pane_props,
      class: [pane_class, pane_props.class],
      // Prepend compact defaults so a caller's pane_style overrides individual vars without
      // dropping padding/gap
      style: [`--pane-padding: 8px 10px; --pane-gap: 0`, pane_style, pane_props.style]
        .filter(Boolean)
        .join(`; `),
    }}
    closed_icon={Settings}
    {...options}
  >
    {#if !lazy || controls_open || ever_opened}
      {@render children?.()}
    {/if}
  </ViewerPane>
{/if}

<style>
  :global(.control-pane-toggle.hover-visible) {
    opacity: 0;
    transition: opacity 0.2s;
  }
  :global(*:is(:hover, :focus-within) > .control-pane-toggle.hover-visible),
  :global(.control-pane-toggle.hover-visible:focus-visible),
  :global(.control-pane-toggle.hover-visible[aria-expanded='true']) {
    opacity: 1;
  }
  @media (hover: none) {
    :global(.control-pane-toggle.hover-visible) {
      opacity: 1;
    }
  }
</style>
