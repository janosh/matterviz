<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  // Shared markup shell for the hierarchical part-of-whole charts (Sunburst,
  // Treemap): header controls, breadcrumb trail, the svg with its delegated
  // pointer/keyboard handling, tooltip, legend and color bar. Each chart keeps
  // its own wrapper element - so its scoped CSS and CSS variable namespace stay
  // put - and renders its geometry into the `body` snippet. All shared state
  // lives on the HierarchyChartState the chart passes in.
  import { format_value } from '$lib/labels'
  import { FullscreenToggle, set_fullscreen_bg } from '$lib/layout'
  import HierarchyColorBar from '$lib/plot/core/components/HierarchyColorBar.svelte'
  import PlotLegend from '$lib/plot/core/components/PlotLegend.svelte'
  import PlotTooltip from '$lib/plot/core/components/PlotTooltip.svelte'
  import { compute_element_placement } from '$lib/plot/core/layout'
  import type { HierarchyChartState } from '$lib/plot/core/utils/hierarchy-state.svelte'
  import type { SunburstNodeHandlerProps } from '$lib/plot/sunburst/sunburst'
  import type { Snippet } from 'svelte'
  import { untrack } from 'svelte'

  let {
    chart_state,
    aria_label,
    chart_transform,
    show_breadcrumbs = true,
    crumb_separator = false,
    dblclick_target = `group`,
    fullscreen_toggle = true,
    controls,
    header_controls,
    extra_defs,
    body,
    tooltip,
    children,
  }: {
    chart_state: HierarchyChartState<Metadata>
    aria_label: string
    chart_transform: string
    show_breadcrumbs?: boolean
    crumb_separator?: boolean // render a `›` between breadcrumb buttons
    // Sunburst listens on the chart group, treemap on the svg (whose background
    // is the only real empty-space hit target once cells tile the full area)
    dblclick_target?: `svg` | `group`
    fullscreen_toggle?: boolean
    controls: Snippet
    header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
    extra_defs?: Snippet
    body: Snippet
    tooltip?: Snippet<[SunburstNodeHandlerProps<Metadata>]>
    children?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
  } = $props()

  let legend_element = $state<HTMLDivElement | undefined>()
  let legend_placement = $derived.by(() => {
    if (!chart_state.legend_visible || !chart_state.width || !chart_state.height) return null
    return compute_element_placement({
      plot_bounds: {
        x: chart_state.plot_left,
        y: chart_state.pad.t,
        width: chart_state.inner_width,
        height: chart_state.inner_height,
      },
      element: legend_element,
      element_size: { width: 120, height: 60 },
      axis_clearance: chart_state.legend?.axis_clearance,
      exclude_rects: [],
      points: chart_state.legend_points(),
    })
  })

  // untrack avoids a self-trigger loop from reading/writing muted ids and hover
  // state in the same effect
  $effect(() => {
    const { arcs } = chart_state.layout
    untrack(() => chart_state.reset_for_layout(arcs))
  })

  $effect(() =>
    set_fullscreen_bg(
      chart_state.wrapper,
      chart_state.fullscreen,
      `--${chart_state.chart}-fullscreen-bg`,
    ),
  )

  let slot_args = $derived({
    height: chart_state.height,
    width: chart_state.width,
    fullscreen: chart_state.fullscreen,
  })
</script>

<svelte:window onkeydown={chart_state.handle_escape} />

{#if chart_state.width && chart_state.height}
  <div class="header-controls">
    {@render header_controls?.(slot_args)}
    {@render controls()}
    {#if fullscreen_toggle}
      <FullscreenToggle bind:fullscreen={chart_state.fullscreen} />
    {/if}
  </div>
  {#if show_breadcrumbs && chart_state.breadcrumb_arcs.length > 0}
    <nav class="breadcrumbs" aria-label="zoom path">
      {#each chart_state.breadcrumb_arcs as crumb, crumb_idx (crumb.node_idx)}
        {#if crumb_separator && crumb_idx > 0}
          <span style="opacity: 0.6" aria-hidden="true">›</span>
        {/if}
        <button
          type="button"
          class="breadcrumb"
          disabled={crumb_idx === chart_state.breadcrumb_arcs.length - 1}
          onclick={() => chart_state.zoom_to(crumb)}
        >
          {crumb.depth === 0 ? `all` : (crumb.label ?? crumb.id)}
        </button>
      {/each}
    </nav>
  {/if}
  <svg
    bind:this={chart_state.svg_element}
    viewBox="0 0 {chart_state.width} {chart_state.height}"
    role="application"
    aria-label={aria_label}
    onmouseleave={chart_state.clear_hover}
    ondblclick={dblclick_target === `svg` ? chart_state.handle_dblclick : undefined}
  >
    <defs>
      <!-- inert unless some node references it via fill -->
      <pattern
        id={chart_state.hatch_pattern_id}
        patternUnits="userSpaceOnUse"
        width="8"
        height="8"
      >
        <path class="hatch-pattern-line" d="M-1,1 l2,-2 M0,8 l8,-8 M7,9 l2,-2" />
      </pattern>
      {@render extra_defs?.()}
    </defs>
    <!-- Hover/click delegation sits on the chart group (not the node group) so
    labels - which carry the same data-<chart>-node-idx and are selectable text -
    forward interactions to their node instead of swallowing them -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <g
      transform={chart_transform}
      onmousemove={chart_state.handle_hover_event}
      onmouseleave={chart_state.clear_hover}
      onfocusin={chart_state.handle_hover_event}
      onfocusout={chart_state.clear_hover}
      onclick={chart_state.handle_click}
      onkeydown={chart_state.handle_keydown}
      ondblclick={dblclick_target === `group` ? chart_state.handle_dblclick : undefined}
    >
      {@render body()}
    </g>
  </svg>
{/if}

{#if chart_state.hover_info}
  {@const info = chart_state.hover_info}
  <PlotTooltip
    x={chart_state.hover_pos.x}
    y={chart_state.hover_pos.y}
    offset={{ x: 10, y: 5 }}
    constrain_to={{ width: chart_state.width, height: chart_state.height }}
    fallback_size={{ width: 140, height: 44 }}
    bg_color={info.color}
  >
    {#if tooltip}
      {@render tooltip(info)}
    {:else}
      <strong>{info.label_path.join(` › `)}</strong>: {format_value(
        info.value,
        chart_state.value_format,
      )}
      ({format_value(info.fraction, `.1%`)} of total{info.depth > 1
        ? `, ${format_value(info.parent_fraction, `.1%`)} of parent`
        : ``})
    {/if}
  </PlotTooltip>
{/if}

{#if chart_state.legend_visible}
  <!-- plot_left equals pad.l whenever the placement fallback applies (a color
  bar can only reserve space once the chart has a non-zero size) -->
  {@const legend_left = legend_placement?.x ?? chart_state.plot_left + 10}
  {@const legend_top = legend_placement?.y ?? chart_state.pad.t + 10}
  <PlotLegend
    bind:root_element={legend_element}
    {...chart_state.legend}
    series_data={chart_state.legend_items}
    on_toggle={chart_state.legend?.on_toggle ?? chart_state.toggle_category}
    on_item_hover={chart_state.legend_hover}
    style={`position: absolute; left: ${legend_left}px; top: ${legend_top}px; pointer-events: auto; ${
      chart_state.legend?.style ?? ``
    }`}
  />
{/if}

{#if chart_state.metric && chart_state.color_bar}
  <HierarchyColorBar
    color_bar={chart_state.color_bar}
    range={chart_state.metric.range}
    color_scale={chart_state.color_scale}
    layout={chart_state.cbar}
    css_prefix={chart_state.chart}
    on_measure={(size) => (chart_state.colorbar_size = size)}
  />
{/if}

{@render children?.(slot_args)}

<style>
  .header-controls {
    position: absolute;
    top: var(--ctrl-btn-top, 5pt);
    right: var(--fullscreen-btn-right, 4px);
    z-index: var(--fullscreen-btn-z-index, 10);
    display: flex;
    align-items: center;
    gap: 8px;
    opacity: 0;
    transition:
      opacity 0.2s,
      background-color 0.2s;
  }
  :global(:is(.sunburst, .treemap):hover) .header-controls,
  .header-controls:has(:global([aria-expanded='true'])),
  .header-controls:focus-within {
    opacity: 1;
  }
  .header-controls :global(.fullscreen-toggle) {
    position: static;
    opacity: 1;
  }
</style>
