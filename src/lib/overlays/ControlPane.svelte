<script lang="ts">
  // Shared draggable controls-pane shell (gear toggle + settings pane) used by every
  // *Controls component. Centralizes the toggle/pane icons, the
  // `*-controls-{toggle,pane}` class convention and the pane style vars so they live in
  // one place instead of being re-typed per viewer.
  import { DraggablePane, type PaneProps, type PaneToggleProps } from '$lib/overlays'
  import type { ComponentProps, Snippet } from 'svelte'
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
    controls_class?: string // class prefix -> `${controls_class}-controls-{toggle,pane}`
    pane_class?: string // full pane class, for viewers with a pre-existing name
    toggle_class?: string // full toggle class, likewise
    toggle_title?: string // toggle button title text ("Open <toggle_title> controls")
    // Default parks the gear at the top right of the chart. Viewers that put it in an
    // existing button row (ViewerChrome) pass `` and let the row do the layout.
    toggle_style?: string
    pane_style?: string
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
    children?: Snippet
  } = $props()

  // caller styles win, so they go last; base gets a `;` in case it lacks one
  const join_style = (base: string, extra?: string | null) => {
    if (!extra) return base
    if (!base) return extra
    return `${base.trim().replace(/;?$/, `;`)} ${extra}`
  }
</script>

<DraggablePane
  bind:open={controls_open}
  bind:pane
  toggle_props={{
    title: `${controls_open ? `Close` : `Open`} ${toggle_title} controls`,
    ...toggle_props,
    class: [toggle_class, toggle_props?.class],
    style: join_style(toggle_style, toggle_props?.style),
  }}
  pane_props={{
    ...pane_props,
    class: [pane_class, pane_props?.class],
    style: join_style(pane_style, pane_props?.style),
  }}
  open_icon={Cross}
  closed_icon={Settings}
  {...rest}
>
  {@render children?.()}
</DraggablePane>
