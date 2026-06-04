<script lang="ts">
  import { SettingsSection } from '$lib/layout'
  import type { SankeyNodeAlign, SankeyOrientation } from '$lib/plot'
  import { unique_id } from '$lib/plot/utils'
  import ControlPane from './ControlPane.svelte'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  // Unique id prefix to avoid label/input collisions with other instances
  const uid = unique_id(`sankey`)

  let {
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    orientation = $bindable(`horizontal`),
    node_width = $bindable(DEFAULTS.sankey.node_width),
    node_padding = $bindable(DEFAULTS.sankey.node_padding),
    node_align = $bindable(`justify`),
    link_opacity = $bindable(DEFAULTS.sankey.link_opacity),
    show_node_labels = $bindable(true),
    toggle_props = {},
    pane_props = {},
    children,
  }: {
    show_controls?: boolean
    controls_open?: boolean
    orientation?: SankeyOrientation
    node_width?: number
    node_padding?: number
    node_align?: SankeyNodeAlign
    link_opacity?: number
    show_node_labels?: boolean
    toggle_props?: HTMLAttributes<HTMLButtonElement>
    pane_props?: HTMLAttributes<HTMLDivElement>
    children?: Snippet
  } = $props()
</script>

{#if show_controls}
  <ControlPane bind:controls_open controls_class="sankey" {toggle_props} {pane_props}>
    {@render children?.()}
    <SettingsSection
      title="Sankey"
      current_values={{
        orientation,
        node_align,
        node_width,
        node_padding,
        link_opacity,
        show_node_labels,
      }}
      on_reset={() => {
        orientation = DEFAULTS.sankey.orientation as SankeyOrientation
        node_align = DEFAULTS.sankey.node_align as SankeyNodeAlign
        node_width = DEFAULTS.sankey.node_width
        node_padding = DEFAULTS.sankey.node_padding
        link_opacity = DEFAULTS.sankey.link_opacity
        show_node_labels = DEFAULTS.sankey.show_node_labels
      }}
      style="display: flex; flex-wrap: wrap; gap: 2ex"
    >
      <label style="flex: 1">
        Orientation:
        <select bind:value={orientation} id="{uid}-orientation">
          <option value="horizontal">Horizontal</option>
          <option value="vertical">Vertical</option>
        </select>
      </label>
      <label style="flex: 1">
        Node align:
        <select bind:value={node_align} id="{uid}-node-align">
          <option value="justify">Justify</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
          <option value="center">Center</option>
        </select>
      </label>
      <label style="flex: 1 1 100%">
        Node width:
        <input type="range" min="4" max="60" step="1" bind:value={node_width} />
        <input type="number" min="4" max="60" step="1" bind:value={node_width} />
      </label>
      <label style="flex: 1 1 100%">
        Node padding:
        <input type="range" min="0" max="40" step="1" bind:value={node_padding} />
        <input type="number" min="0" max="40" step="1" bind:value={node_padding} />
      </label>
      <label style="flex: 1 1 100%">
        Link opacity:
        <input type="range" min="0.05" max="1" step="0.05" bind:value={link_opacity} />
        <input type="number" min="0.05" max="1" step="0.05" bind:value={link_opacity} />
      </label>
      <label style="flex: 1 1 100%">
        <input type="checkbox" bind:checked={show_node_labels} />
        Show node labels
      </label>
    </SettingsSection>
  </ControlPane>
{/if}
