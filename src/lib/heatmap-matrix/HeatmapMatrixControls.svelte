<script lang="ts">
  import { DEFAULT_CONTROLS_MODE } from '#lib/controls.js'
  import type { ShowControlsProp } from '#lib/controls.js'
  import { SettingsSection } from '#lib/layout/index.js'
  import { ControlPane, type PaneProps, type PaneToggleProps } from '#lib/overlays/index.js'
  import type ColorBar from '#lib/plot/core/components/ColorBar.svelte'
  import { to_color_scale_config } from '#lib/plot/core/scales.js'
  import { type ColorScale, get_scale_type_name } from '#lib/plot/core/types.js'
  import type { ComponentProps, Snippet } from 'svelte'
  import { ELEMENT_ORDERINGS, ORDERING_LABELS } from './index'
  import type { ElementAxisOrderingKey, HeatmapDomainMode, SymmetricMode } from './index'

  let {
    ordering = $bindable(),
    orderings = ELEMENT_ORDERINGS,
    controls_open = $bindable(false),
    show_controls = DEFAULT_CONTROLS_MODE,
    color_scale = $bindable(`interpolateViridis`),
    domain_mode = $bindable(`auto`),
    color_bar = $bindable(null),
    search_query = $bindable(``),
    symmetric = $bindable<SymmetricMode>(false),
    show_values = $bindable<boolean | string>(false),
    show_row_summaries = $bindable(false),
    show_col_summaries = $bindable(false),
    pane_props = {},
    toggle_props = {},
    children,
  }: {
    // Element-axis ordering, shown only when a host binds it: HeatmapMatrix itself is axis-
    // agnostic and never passes one, so its built-in pane would otherwise offer a dead select
    ordering?: ElementAxisOrderingKey
    orderings?: ElementAxisOrderingKey[]
    controls_open?: boolean
    show_controls?: ShowControlsProp<`controls`>
    color_scale?: ColorScale // the Normalize select writes its `type`
    domain_mode?: HeatmapDomainMode
    color_bar?: Partial<ComponentProps<typeof ColorBar>> | null
    search_query?: string
    symmetric?: SymmetricMode
    show_values?: boolean | string
    show_row_summaries?: boolean
    show_col_summaries?: boolean
    pane_props?: PaneProps
    toggle_props?: PaneToggleProps
    children?: Snippet<[{ controls_open: boolean }]>
  } = $props()

  // Stash custom format string so toggling the checkbox preserves it
  let stashed_format: string | null = null
  // Stash the color bar props so toggling the bar off and on again keeps them
  let stashed_color_bar: Partial<ComponentProps<typeof ColorBar>> = {}
</script>

<ControlPane
  {show_controls}
  bind:controls_open
  pane_class="heatmap-controls"
  toggle_class="heatmap-matrix-controls-toggle"
  pane_style="z-index: var(--heatmap-matrix-controls-pane-z-index, 25); min-width: var(--heatmap-matrix-controls-pane-min-width, 220px); --ctrl-label-w: 6.5em; --ctrl-value-w: 4em"
  toggle_style="position: absolute; top: var(--heatmap-matrix-controls-toggle-top, 6px); right: var(--heatmap-matrix-controls-toggle-right, 6px); z-index: var(--heatmap-matrix-controls-toggle-z-index, 20)"
  toggle_props={{
    ...toggle_props,
    title: toggle_props.title ?? (controls_open ? `` : `Heatmap controls`),
    'aria-label': toggle_props[`aria-label`] ?? `Heatmap controls`,
  }}
  {pane_props}
>
  <SettingsSection title="Heatmap" layout="grid">
    {#if ordering !== undefined}
      <label>
        <span>Ordering</span>
        <select bind:value={ordering}>
          {#each orderings as ord (ord)}
            <option value={ord}>{ORDERING_LABELS[ord]}</option>
          {/each}
        </select>
      </label>
    {/if}
    <label>
      <span>Search</span>
      <input bind:value={search_query} placeholder="Filter labels/keys" />
    </label>
    <label>
      <span>Normalize</span>
      <select
        bind:value={
          () => get_scale_type_name(to_color_scale_config(color_scale).type),
          (type) => (color_scale = { ...to_color_scale_config(color_scale), type })
        }
      >
        <option value="linear">Linear</option>
        <option value="log">Log</option>
      </select>
    </label>
    <label>
      <span>Domain</span>
      <select bind:value={domain_mode}>
        <option value="auto">Auto</option>
        <option value="robust">Robust</option>
      </select>
    </label>
    <label>
      <span>Color bar</span>
      <input
        type="checkbox"
        bind:checked={
          () => Boolean(color_bar),
          (show) => {
            if (color_bar) stashed_color_bar = color_bar
            color_bar = show ? stashed_color_bar : null
          }
        }
      />
    </label>
    {#if color_bar}
      <label>
        <span>Color bar side</span>
        <select
          bind:value={
            () => color_bar?.orientation ?? `horizontal`,
            (orientation) => (color_bar = { ...color_bar, orientation })
          }
        >
          <option value="vertical">Right</option>
          <option value="horizontal">Bottom</option>
        </select>
      </label>
    {/if}
    <label>
      <span>Symmetric</span>
      <select bind:value={symmetric}>
        <option value={false}>Off</option>
        <option value="lower">Lower</option>
        <option value="upper">Upper</option>
      </select>
    </label>
    <label>
      <span>Values</span>
      <input
        type="checkbox"
        checked={!!show_values}
        onchange={(evt) => {
          if (!evt.currentTarget.checked) {
            stashed_format = typeof show_values === `string` ? show_values : null
          }
          show_values = evt.currentTarget.checked ? stashed_format || true : false
        }}
      />
    </label>
    <label>
      <span>Row sums</span>
      <input type="checkbox" bind:checked={show_row_summaries} />
    </label>
    <label>
      <span>Col sums</span>
      <input type="checkbox" bind:checked={show_col_summaries} />
    </label>
    {@render children?.({ controls_open })}
  </SettingsSection>
</ControlPane>

<style>
  :global(.heatmap-controls) {
    font-size: 0.85em;
    max-width: 320px;
  }
</style>
