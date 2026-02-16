<script lang="ts">
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import type { ComponentProps, Snippet } from 'svelte'
  import type {
    DomainMode,
    HeatmapExportFormat,
    LegendPosition,
    NormalizeMode,
    SymmetricMode,
  } from './index'
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
    normalize = $bindable(`linear`),
    domain_mode = $bindable(`auto`),
    show_legend = $bindable(false),
    legend_position = $bindable(`bottom`),
    search_query = $bindable(``),
    symmetric = $bindable<SymmetricMode>(false),
    show_values = $bindable<boolean | string>(false),
    show_row_summaries = $bindable(false),
    show_col_summaries = $bindable(false),
    theme = $bindable<`default` | `light` | `dark` | `publication`>(`default`),
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
    normalize?: NormalizeMode
    domain_mode?: DomainMode
    show_legend?: boolean
    legend_position?: LegendPosition
    search_query?: string
    symmetric?: SymmetricMode
    show_values?: boolean | string
    show_row_summaries?: boolean
    show_col_summaries?: boolean
    theme?: `default` | `light` | `dark` | `publication`
    export_formats?: HeatmapExportFormat[]
    onexport?: (format: HeatmapExportFormat) => void
    show_pane?: boolean
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    children?: Snippet<[{ controls_open: boolean }]>
  } = $props()

  function merge_styles(base_style: string, override_style: unknown): string {
    const override_style_str = typeof override_style === `string`
      ? override_style
      : ``
    return override_style_str ? `${base_style}; ${override_style_str}` : base_style
  }

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
  ].join(`; `)
</script>

<DraggablePane
  bind:show={controls_open}
  {show_pane}
  pane_props={{
    ...pane_props,
    class: `heatmap-controls ${pane_props?.class ?? ``}`.trim(),
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
  <label>
    Ordering
    <select bind:value={ordering}>
      {#each orderings as ord (ord)}
        <option value={ord}>{ORDERING_LABELS[ord]}</option>
      {/each}
    </select>
  </label>
  <label>
    Search
    <input bind:value={search_query} placeholder="Filter labels/keys" />
  </label>
  <div class="pane-row">
    <label>
      Normalize
      <select bind:value={normalize}>
        <option value="linear">linear</option>
        <option value="log">log</option>
      </select>
    </label>
    <label>
      Domain
      <select bind:value={domain_mode}>
        <option value="auto">auto</option>
        <option value="robust">robust</option>
        <option value="fixed">fixed</option>
      </select>
    </label>
  </div>
  <div class="pane-row">
    <label>
      <input type="checkbox" bind:checked={show_legend} />
      Legend
    </label>
    {#if show_legend}
      <label>
        Position
        <select bind:value={legend_position}>
          <option value="right">right</option>
          <option value="bottom">bottom</option>
        </select>
      </label>
    {/if}
  </div>
  <div class="pane-row">
    <label>
      Symmetric
      <select bind:value={symmetric}>
        <option value={false}>off</option>
        <option value="lower">lower</option>
        <option value="upper">upper</option>
      </select>
    </label>
    <label>
      Theme
      <select bind:value={theme}>
        <option value="default">default</option>
        <option value="light">light</option>
        <option value="dark">dark</option>
        <option value="publication">publication</option>
      </select>
    </label>
  </div>
  <div class="pane-row">
    <label>
      <input
        type="checkbox"
        checked={!!show_values}
        onchange={(evt) => {
          if (evt.currentTarget.checked) {
            show_values = stashed_format || true
          } else {
            stashed_format = typeof show_values === `string` ? show_values : null
            show_values = false
          }
        }}
      />
      Values
    </label>
    <label>
      <input type="checkbox" bind:checked={show_row_summaries} />
      Row sums
    </label>
    <label>
      <input type="checkbox" bind:checked={show_col_summaries} />
      Col sums
    </label>
  </div>
  <div class="pane-row">
    {#each export_formats as export_format (export_format)}
      <button type="button" onclick={() => onexport?.(export_format)}>
        Export {export_format.toUpperCase()}
      </button>
    {/each}
  </div>
  {@render children?.({ controls_open })}
</DraggablePane>

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
  label {
    display: flex;
    align-items: center;
    gap: 6pt;
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
