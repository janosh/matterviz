<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  // Shared markup of Sunburst and Treemap inside a ChartShell: breadcrumbs, the svg with its
  // delegated pointer/keyboard handling, tooltip, legend and color bar. Each chart renders its
  // geometry into `marks`; all shared state lives on the HierarchyChartState it passes in.
  import { type TooltipProp, TooltipValue } from '#lib/tooltip/index.js'
  import { format_value } from '#lib/labels.js'
  import ColorBar from '#lib/plot/core/components/ColorBar.svelte'
  import PatternDefs from '#lib/plot/core/components/PatternDefs.svelte'
  import InsetLegend from '#lib/plot/core/components/InsetLegend.svelte'
  import PlotTooltip from '#lib/plot/core/components/PlotTooltip.svelte'
  import { observe_size } from '#lib/plot/core/utils.js'
  import { COLOR_BAR_GAP } from '#lib/plot/core/utils/hierarchy-chart.js'
  import type { HierarchyChartState } from '#lib/plot/core/utils/hierarchy-state.svelte.js'
  import type { SunburstNodeHandlerProps } from '#lib/plot/core/utils/hierarchy-layout.js'
  import type { Snippet } from 'svelte'

  let {
    chart_state,
    aria_label,
    chart_transform,
    show_breadcrumbs = true,
    crumb_separator = false,
    dblclick_target = `group`,
    extra_defs,
    marks,
    tooltip,
  }: {
    chart_state: HierarchyChartState<Metadata>
    aria_label: string
    chart_transform: string
    show_breadcrumbs?: boolean
    crumb_separator?: boolean // render a `›` between breadcrumb buttons
    // Sunburst listens on the chart group, treemap on the svg (whose background
    // is the only real empty-space hit target once cells tile the full area)
    dblclick_target?: `svg` | `group`
    extra_defs?: Snippet
    marks: Snippet
    tooltip?: TooltipProp<SunburstNodeHandlerProps<Metadata>>
  } = $props()

  // Color bar anchored beside (vertical) or below (horizontal) the chart; `--<chart>-colorbar-*`
  // CSS variables override each placement value
  const colorbar_style = $derived.by(() => {
    const { cbar: layout, chart } = chart_state
    const cbar_var = (name: string, fallback: string) =>
      `var(--${chart}-colorbar-${name}, ${fallback})`
    if (layout.is_vertical) {
      return `position: absolute; top: ${cbar_var(`top`, `50%`)}; ${layout.side}: ${cbar_var(layout.side, `${layout.offset_px}px`)}; transform: ${cbar_var(`transform`, `translateY(-50%)`)}; width: ${cbar_var(`width`, `auto`)}; min-width: ${cbar_var(`min-width`, `0`)}; pointer-events: auto;`
    }
    return `position: absolute; bottom: ${cbar_var(`bottom`, `${COLOR_BAR_GAP}px`)}; left: ${cbar_var(`left`, `50%`)}; transform: ${cbar_var(`transform`, `translateX(-50%)`)}; width: ${cbar_var(`width`, `40%`)}; min-width: 120px; pointer-events: auto;`
  })
</script>

<svelte:window onkeydown={chart_state.handle_escape} />

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
    <PatternDefs patterns={chart_state.node_infos.map((info) => info.pattern)} />
    {@render extra_defs?.()}
  </defs>
  <!-- Delegation sits on the chart group (not the node group) so labels, which carry the same
  data-<chart>-node-idx, forward interactions to their node instead of swallowing them -->
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
    {@render marks()}
  </g>
</svg>

{#if chart_state.hover_info && tooltip !== false}
  {@const info = chart_state.hover_info}
  <PlotTooltip
    x={chart_state.hover_pos.x}
    y={chart_state.hover_pos.y}
    offset={{ x: 10, y: 5 }}
    avoid_cursor={chart_state.hover_at_pointer}
    constrain_to={{ width: chart_state.width, height: chart_state.height }}
    fallback_size={{ width: 140, height: 44 }}
    bg_color={info.color}
  >
    {#if tooltip}
      {@render tooltip(info)}
    {:else}
      <!-- A bucket's label can't fit what it folded away, so that count goes here -->
      <strong>{info.label_path.join(` › `)}</strong>: <TooltipValue
        value={format_value(info.value, chart_state.value_format)}
      />
      (<TooltipValue value={format_value(info.fraction, `.1%`)} /> of total{#if info.depth > 1},
        <TooltipValue value={format_value(info.parent_fraction, `.1%`)} /> of parent{/if}{info.other_count
        ? `, ${info.other_count} grouped`
        : ``})
    {/if}
  </PlotTooltip>
{/if}

{#if chart_state.legend_visible}
  {@const { plot_left, pad, inner_width, inner_height } = chart_state}
  <InsetLegend
    legend={chart_state.legend}
    measured={Boolean(chart_state.width && chart_state.height)}
    plot_bounds={{ x: plot_left, y: pad.t, width: inner_width, height: inner_height }}
    points={chart_state.legend_points()}
    series_data={chart_state.legend_items}
    on_toggle={chart_state.legend?.on_toggle ?? chart_state.toggle_category}
    on_item_hover={chart_state.legend_hover}
  />
{/if}

{#if chart_state.metric && chart_state.color_bar}
  {@const { cbar, chart, color_bar } = chart_state}
  <ColorBar
    color_scale={chart_state.metric.color_scale}
    {...color_bar}
    tick_side={cbar.tick_side}
    wrapper_style="{cbar.is_vertical
      ? `--cbar-height: var(--${chart}-colorbar-height, 150px); --cbar-padding: ${cbar.tick_padding};`
      : ``} {color_bar.wrapper_style ?? ``}"
    style="{colorbar_style} {color_bar.style ?? ``}"
    {@attach observe_size((size) => (chart_state.colorbar_size = size))}
  />
{/if}
