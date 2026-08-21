<script lang="ts">
  import { SettingsSection } from '$lib/layout'
  import { ControlPane, type PaneProps, type PaneToggleProps } from '$lib/overlays'
  import type { Snippet } from 'svelte'
  import { ELEMENT_ORDERINGS, ORDERING_LABELS } from './index'
  import type {
    ElementAxisOrderingKey,
    HeatmapDomainMode,
    HeatmapExportFormat,
    HeatmapNormalizeMode,
    LegendPosition,
    SymmetricMode,
  } from './index'

  let {
    ordering = $bindable(`atomic_number`),
    orderings = ELEMENT_ORDERINGS,
    controls_open = $bindable(false),
    toggle_visible = $bindable(false),
    normalize = $bindable(`linear`),
    domain_mode = $bindable(`auto`),
    show_legend = $bindable(false),
    legend_position = $bindable(`bottom`),
    search_query = $bindable(``),
    symmetric = $bindable<SymmetricMode>(false),
    show_values = $bindable<boolean | string>(false),
    show_row_summaries = $bindable(false),
    show_col_summaries = $bindable(false),
    export_formats = [`csv`, `json`],
    onexport,
    show_pane = true,
    pane_props = {},
    toggle_props = {},
    children,
  }: {
    ordering?: ElementAxisOrderingKey
    orderings?: ElementAxisOrderingKey[]
    controls_open?: boolean
    toggle_visible?: boolean
    normalize?: HeatmapNormalizeMode
    domain_mode?: HeatmapDomainMode
    show_legend?: boolean
    legend_position?: LegendPosition
    search_query?: string
    symmetric?: SymmetricMode
    show_values?: boolean | string
    show_row_summaries?: boolean
    show_col_summaries?: boolean
    export_formats?: HeatmapExportFormat[]
    onexport?: (format: HeatmapExportFormat) => void
    show_pane?: boolean
    pane_props?: PaneProps
    toggle_props?: PaneToggleProps
    children?: Snippet<[{ controls_open: boolean }]>
  } = $props()

  // Stash custom format string so toggling the checkbox preserves it
  let stashed_format = $state<string | null>(null)

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
  const default_pane_style = [
    `z-index: var(--heatmap-matrix-controls-pane-z-index, 25)`,
    `min-width: var(--heatmap-matrix-controls-pane-min-width, 220px)`,
    `--ctrl-label-w: 6.5em`,
    `--ctrl-value-w: 4em`,
  ].join(`; `)
</script>

<!-- gated here so the toggle goes with the pane; ControlPane has no prop for it -->
{#if show_pane}
  <ControlPane
    bind:controls_open
    pane_class="heatmap-controls"
    toggle_class="heatmap-matrix-controls-toggle"
    pane_style={default_pane_style}
    toggle_style={default_toggle_style}
    toggle_props={{
      ...toggle_props,
      title: toggle_props.title ?? (controls_open ? `` : `Heatmap controls`),
      'aria-label': toggle_props[`aria-label`] ?? `Heatmap controls`,
    }}
    {pane_props}
  >
    <SettingsSection title="Heatmap" layout="grid">
      <label>
        <span>Ordering</span>
        <select bind:value={ordering}>
          {#each orderings as ord (ord)}
            <option value={ord}>{ORDERING_LABELS[ord]}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>Search</span>
        <input bind:value={search_query} placeholder="Filter labels/keys" />
      </label>
      <label>
        <span>Normalize</span>
        <select bind:value={normalize}>
          <option value="linear">Linear</option>
          <option value="log">Log</option>
        </select>
      </label>
      <label>
        <span>Domain</span>
        <select bind:value={domain_mode}>
          <option value="auto">Auto</option>
          <option value="robust">Robust</option>
          <option value="fixed">Fixed</option>
        </select>
      </label>
      <label>
        <span>Legend</span>
        <input type="checkbox" bind:checked={show_legend} />
      </label>
      {#if show_legend}
        <label>
          <span>Position</span>
          <select bind:value={legend_position}>
            <option value="right">Right</option>
            <option value="bottom">Bottom</option>
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
            if (evt.currentTarget.checked) {
              show_values = stashed_format || true
              return
            }
            stashed_format = typeof show_values === `string` ? show_values : null
            show_values = false
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
      <div class="setting">
        <span>Export</span>
        <div class="pane-row">
          {#each export_formats as export_format (export_format)}
            <button type="button" onclick={() => onexport?.(export_format)}>
              Export {export_format.toUpperCase()}
            </button>
          {/each}
        </div>
      </div>
    </SettingsSection>
    {@render children?.({ controls_open })}
  </ControlPane>
{/if}

<style>
  :global(.heatmap-controls) {
    font-size: 0.85em;
    max-width: 320px;
  }
  .pane-row {
    display: flex;
    gap: 10pt;
    flex-wrap: wrap;
  }
  select,
  input:not([type]) {
    height: 1.8em;
    padding: 0 0.5em;
    border-radius: var(--border-radius, 3pt);
    border: 1px solid light-dark(#ccc, #555);
    background: light-dark(white, #333);
    color: inherit;
    font: inherit;
    box-sizing: border-box;
    flex: 1;
    min-width: 0;
  }
</style>
