<script lang="ts">
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import type { SankeyNodeAlign, Orientation } from '$lib/plot'
  import { ControlPane } from '$lib/overlays'
  import { DEFAULTS, enum_labels, SETTINGS_CONFIG } from '$lib/settings'
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
    orientation?: Orientation
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

<!-- select options come from the settings schema so labels/values have a single source of truth -->
{#snippet options(enum_map: Record<string, string>)}
  {#each Object.entries(enum_map) as [value, label] (value)}
    <option {value}>{label}</option>
  {/each}
{/snippet}

{#if show_controls}
  <ControlPane bind:controls_open controls_name="sankey" {toggle_props} {pane_props}>
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
      layout="grid"
    >
      <label>
        <span>Orientation</span>
        <select bind:value={orientation}>
          {@render options(enum_labels(SETTINGS_CONFIG.sankey.orientation))}
        </select>
      </label>
      <label>
        <span>Node align</span>
        <select bind:value={node_align}>
          {@render options(enum_labels(SETTINGS_CONFIG.sankey.node_align))}
        </select>
      </label>
      <NumberRangeInput min={4} max={60} step={1} bind:value={node_width}
        >Node width</NumberRangeInput
      >
      <NumberRangeInput min={0} max={40} step={1} bind:value={node_padding}
        >Node padding</NumberRangeInput
      >
      <NumberRangeInput min={0.05} max={1} step={0.05} bind:value={link_opacity}
        >Link opacity</NumberRangeInput
      >
      <label>
        <span>Show node labels</span>
        <input type="checkbox" bind:checked={show_node_labels} />
      </label>
    </SettingsSection>
  </ControlPane>
{/if}
