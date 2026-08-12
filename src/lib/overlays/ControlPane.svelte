<script lang="ts">
  // Shared gear toggle + draggable pane shell for viewer controls.
  import type { PaneProps, PaneToggleProps } from '$lib/overlays'
  import { DraggablePane } from 'svelte-widgets'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { ClassValue } from 'svelte/elements'
  import { Cross, Settings } from 'svelte-widgets/icons'

  let {
    controls_open = $bindable(false),
    pane = $bindable(null),
    controls_class = `plot`,
    pane_class = `${controls_class}-controls-pane`,
    toggle_class = `${controls_class}-controls-toggle`,
    toggle_title = controls_class,
    toggle_style = `position: absolute; top: var(--ctrl-btn-top, 5pt); right: var(--ctrl-btn-right, 1ex);`,
    pane_style = `--pane-padding: 12px; --pane-gap: 4px;`,
    toggle_props = {},
    pane_props = {},
    children,
    ...rest
  }: Omit<ComponentProps<typeof DraggablePane>, `children` | `open`> & {
    controls_open?: boolean
    controls_class?: string
    pane_class?: ClassValue
    toggle_class?: ClassValue
    toggle_title?: string
    // Empty style opts out when ViewerChrome owns toggle layout.
    toggle_style?: string
    pane_style?: string
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
    children?: Snippet
  } = $props()

  // Caller styles go last and therefore win.
  const join_style = (base: string, extra?: string | null): string =>
    [base, extra].filter(Boolean).join(`; `)
</script>

<DraggablePane
  bind:open={controls_open}
  bind:pane
  toggle_props={{
    title: `${controls_open ? `Close` : `Open`} ${toggle_title} controls`,
    ...toggle_props,
    class: [toggle_class, toggle_props.class],
    style: join_style(toggle_style, toggle_props.style),
  }}
  pane_props={{
    ...pane_props,
    class: [pane_class, pane_props.class],
    style: join_style(pane_style, pane_props.style),
  }}
  open_icon={Cross}
  closed_icon={Settings}
  {...rest}
>
  {@render children?.()}
</DraggablePane>
