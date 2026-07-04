<script lang="ts">
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import type { SankeyNodeAlign, SankeyOrientation } from '$lib/plot'
  import ControlPane from '$lib/plot/core/components/ControlPane.svelte'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    orientation = $bindable(DEFAULTS.sankey.orientation),
    node_width = $bindable(DEFAULTS.sankey.node_width),
    node_padding = $bindable(DEFAULTS.sankey.node_padding),
    node_align = $bindable(DEFAULTS.sankey.node_align),
    link_opacity = $bindable(DEFAULTS.sankey.link_opacity),
    show_node_labels = $bindable(DEFAULTS.sankey.show_node_labels),
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
        ;({
          orientation,
          node_align,
          node_width,
          node_padding,
          link_opacity,
          show_node_labels,
        } = DEFAULTS.sankey)
      }}
      style="display: flex; flex-wrap: wrap; gap: 2ex"
    >
      <label style="flex: 1">
        Orientation:
        <select bind:value={orientation}>
          <option value="horizontal">Horizontal</option>
          <option value="vertical">Vertical</option>
        </select>
      </label>
      <label style="flex: 1">
        Node align:
        <select bind:value={node_align}>
          <option value="justify">Justify</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
          <option value="center">Center</option>
        </select>
      </label>
      <NumberRangeInput
        min={4}
        max={60}
        step={1}
        bind:value={node_width}
        style="flex: 1 1 100%">Node width:</NumberRangeInput
      >
      <NumberRangeInput
        min={0}
        max={40}
        step={1}
        bind:value={node_padding}
        style="flex: 1 1 100%">Node padding:</NumberRangeInput
      >
      <NumberRangeInput
        min={0.05}
        max={1}
        step={0.05}
        bind:value={link_opacity}
        style="flex: 1 1 100%">Link opacity:</NumberRangeInput
      >
      <label style="flex: 1 1 100%">
        <input type="checkbox" bind:checked={show_node_labels} />
        Show node labels
      </label>
    </SettingsSection>
  </ControlPane>
{/if}
