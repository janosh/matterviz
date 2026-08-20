<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import { StatusMessage } from '$lib/feedback'
  import { format_value } from '$lib/labels'
  import { FullscreenButton } from '$lib/layout'
  import type { BasePlotProps, LegendConfig, Orientation } from '$lib/plot'
  import { DEFAULT_SERIES_COLORS, PlotLegend, PlotTooltip, SankeyControls } from '$lib/plot'
  import {
    closest_data_idx,
    is_activation_key,
    pointer_pos,
  } from '$lib/plot/core/interactions'
  import { compute_element_placement, filter_padding } from '$lib/plot/core/layout'
  import type { Sides } from '$lib/plot/core/layout'
  import { resolve_legend_visibility } from '$lib/plot/core/utils/series-visibility'
  import { compute_sankey_layout } from '$lib/plot/sankey/sankey'
  import type { PositionedLink, PositionedNode } from '$lib/plot/sankey/sankey'
  import type {
    SankeyData,
    SankeyHandlerProps,
    SankeyLinkColorMode,
    SankeyLinkHandlerProps,
    SankeyNodeAlign,
    SankeyNodeHandlerProps,
  } from '$lib/plot/sankey/sankey-types'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'

  const DEFAULT_PADDING: Required<Sides> = { t: 20, b: 20, l: 10, r: 10 }

  let {
    data = $bindable({ nodes: [], links: [] }),
    orientation = $bindable(DEFAULTS.sankey.orientation),
    node_width = $bindable(DEFAULTS.sankey.node_width),
    node_padding = $bindable(DEFAULTS.sankey.node_padding),
    node_align = $bindable(DEFAULTS.sankey.node_align),
    iterations = DEFAULTS.sankey.iterations,
    link_opacity = $bindable(DEFAULTS.sankey.link_opacity),
    link_color_mode = `source`,
    show_node_labels = $bindable(DEFAULTS.sankey.show_node_labels),
    node_label,
    value_format = `,`,
    padding = DEFAULT_PADDING,
    legend = {},
    show_legend,
    tooltip,
    node_content,
    link_content,
    hovered = $bindable(false),
    on_node_click,
    on_node_hover,
    on_link_click,
    on_link_hover,
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    controls_toggle_props,
    controls_pane_props,
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    children,
    header_controls,
    controls_extra,
    ...rest
  }: HTMLAttributes<HTMLDivElement> &
    // `range_padding` / `title` are Cartesian-only: accepting them here would silently
    // forward them to the wrapper div as invalid DOM attributes.
    Omit<BasePlotProps, `range_padding` | `title`> & {
      data?: SankeyData<Metadata>
      orientation?: Orientation
      node_width?: number
      node_padding?: number
      node_align?: SankeyNodeAlign
      iterations?: number
      link_opacity?: number
      link_color_mode?: SankeyLinkColorMode
      show_node_labels?: boolean
      node_label?: (node: PositionedNode) => string
      value_format?: string
      padding?: Sides
      legend?: LegendConfig | null
      show_legend?: boolean
      tooltip?: Snippet<[SankeyHandlerProps<Metadata>]>
      // Fully replace the default node rect / link ribbon. NOTE: this also replaces the
      // built-in hover/focus/click + tooltip wiring, so re-implement any interactivity
      // you need inside the snippet.
      node_content?: Snippet<[{ node: PositionedNode; color: string }]>
      link_content?: Snippet<[{ link: PositionedLink; color: string }]>
      on_node_click?: (
        data: SankeyNodeHandlerProps<Metadata> & { event: MouseEvent | KeyboardEvent },
      ) => void
      on_node_hover?: (
        data: (SankeyNodeHandlerProps<Metadata> & { event: MouseEvent | FocusEvent }) | null,
      ) => void
      on_link_click?: (
        data: SankeyLinkHandlerProps<Metadata> & { event: MouseEvent | KeyboardEvent },
      ) => void
      on_link_hover?: (
        data: (SankeyLinkHandlerProps<Metadata> & { event: MouseEvent | FocusEvent }) | null,
      ) => void
      header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
      controls_extra?: Snippet<[{ orientation: Orientation }]>
    } = $props()

  let [width, height] = $state([0, 0])
  let wrapper: HTMLDivElement | undefined = $state()
  let svg_element: SVGSVGElement | null = $state(null)
  // Unique per-instance prefix for gradient ids so several diagrams can share a page
  const uid = $props.id()

  // The hovered node or link (its public handler payload) + the tooltip anchor
  let hover_info = $state<SankeyHandlerProps<Metadata> | null>(null)
  let hover_pos = $state({ x: 0, y: 0 })
  // Legend hover dims like a node hover but shows no tooltip
  let legend_hover_idx = $state<number | null>(null)
  // Nodes muted via legend toggle (dimmed, not removed - keeps layout stable).
  // Ids of nodes absent from the current data are inert.
  const muted_nodes = new SvelteSet<string | number>()

  let pad = $derived(filter_padding(padding, DEFAULT_PADDING))
  let inner_width = $derived(Math.max(0, width - pad.l - pad.r))
  let inner_height = $derived(Math.max(0, height - pad.t - pad.b))

  // Resolved node colors (per node_idx), explicit color or cycled palette
  let node_colors = $derived(
    data.nodes.map(
      (node, idx) => node.color ?? DEFAULT_SERIES_COLORS[idx % DEFAULT_SERIES_COLORS.length],
    ),
  )

  // Invalid graphs (cycles, unknown node refs) render an error message in place
  // of the diagram instead of crashing the host page
  let layout = $derived.by(() => {
    try {
      return {
        error: null,
        ...compute_sankey_layout(data, {
          width: inner_width,
          height: inner_height,
          node_width,
          node_padding,
          node_align,
          orientation,
          iterations,
        }),
      }
    } catch (err) {
      return { nodes: [], links: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  // node_idx -> positioned node: orphans are dropped by the layout, so positions
  // are sparse in node_idx
  let node_by_idx = $derived(new Map(layout.nodes.map((node) => [node.node_idx, node])))

  // Node box center in container (pad-offset) pixel space, for tooltip + legend placement
  const node_center = (node: PositionedNode): { x: number; y: number } => ({
    x: pad.l + (node.x0 + node.x1) / 2,
    y: pad.t + (node.y0 + node.y1) / 2,
  })

  // Resolve a link's ribbon color from explicit color or the active color mode
  const link_color = (link: PositionedLink): string => {
    if (link.color) return link.color
    if (link_color_mode === `target`) return node_colors[link.target.node_idx]
    if (link_color_mode === `gradient`) return `url(#${uid}-grad-${link.link_idx})`
    if (link_color_mode === `static`) return `var(--sankey-link-color, #888)`
    return node_colors[link.source.node_idx]
  }

  // Node/link indices kept fully opaque for the current hover target (null = no hover)
  let active = $derived.by(() => {
    const hovered_node =
      legend_hover_idx ?? (hover_info?.type === `node` ? hover_info.node_idx : null)
    if (hovered_node != null) {
      const node = node_by_idx.get(hovered_node)
      if (!node) return null
      const links = new SvelteSet<number>()
      const nodes = new SvelteSet<number>([hovered_node])
      for (const link of [...(node.sourceLinks ?? []), ...(node.targetLinks ?? [])]) {
        links.add((link as PositionedLink).link_idx)
        nodes.add((link.source as PositionedNode).node_idx)
        nodes.add((link.target as PositionedNode).node_idx)
      }
      return { links, nodes }
    }
    if (hover_info?.type === `link`) {
      return {
        links: new SvelteSet([hover_info.link_idx]),
        nodes: new SvelteSet([hover_info.source_idx, hover_info.target_idx]),
      }
    }
    return null
  })

  const node_opacity = (node: PositionedNode): number => {
    if (muted_nodes.has(node.id)) return 0.12
    if (active && !active.nodes.has(node.node_idx)) return 0.3
    return 1
  }

  const link_stroke_opacity = (link: PositionedLink): number => {
    if (muted_nodes.has(link.source.id) || muted_nodes.has(link.target.id)) {
      return link_opacity * 0.15
    }
    if (active) {
      return active.links.has(link.link_idx)
        ? Math.min(1, link_opacity + 0.35)
        : link_opacity * 0.25
    }
    return link_opacity
  }

  const node_text = (node: PositionedNode): string =>
    node_label?.(node) ?? node.label ?? `${node.id}`

  const node_props = (node: PositionedNode): SankeyNodeHandlerProps<Metadata> => ({
    type: `node`,
    node_idx: node.node_idx,
    id: node.id,
    label: node.label,
    value: node.value,
    color: node_colors[node.node_idx],
    metadata: data.nodes[node.node_idx]?.metadata,
  })

  const link_props = (link: PositionedLink): SankeyLinkHandlerProps<Metadata> => ({
    type: `link`,
    link_idx: link.link_idx,
    source_idx: link.source.node_idx,
    target_idx: link.target.node_idx,
    source_label: link.source.label,
    target_label: link.target.label,
    value: link.value,
    color: link_color(link),
    metadata: data.links[link.link_idx]?.metadata,
  })

  const link_from_event = (event: Event): PositionedLink | null =>
    layout.links[closest_data_idx(event, `data-sankey-link-idx`, svg_element) ?? -1] ?? null
  const node_from_event = (event: Event): PositionedNode | null =>
    node_by_idx.get(closest_data_idx(event, `data-sankey-node-idx`, svg_element) ?? -1) ?? null

  // Resolve the event's node or link; hover follows the cursor across wide nodes and
  // long ribbons and falls back to the shape center on keyboard focus (no cursor).
  // Same target as before: only the anchor moves, the callbacks don't re-fire.
  function handle_hover(event: MouseEvent | FocusEvent) {
    const node = node_from_event(event)
    const link = node ? null : link_from_event(event)
    const [prev_node, prev_link] =
      hover_info?.type === `node`
        ? [hover_info.node_idx, null]
        : [null, hover_info?.type === `link` ? hover_info.link_idx : null]
    if (!node && !link) return clear_hover()
    hovered = true
    const cursor = pointer_pos(event, svg_element)
    if (node) {
      hover_pos = cursor ?? node_center(node)
      if (node.node_idx === prev_node) return
      if (prev_link != null) on_link_hover?.(null)
      hover_info = node_props(node)
      on_node_hover?.({ ...hover_info, event })
    } else if (link) {
      hover_pos = cursor ?? { x: pad.l + link.mid.x, y: pad.t + link.mid.y }
      if (link.link_idx === prev_link) return
      if (prev_node != null) on_node_hover?.(null)
      hover_info = link_props(link)
      on_link_hover?.({ ...hover_info, event })
    }
  }

  function clear_hover() {
    if (!hover_info) return
    const was_node = hover_info.type === `node`
    hover_info = null
    hovered = false
    if (was_node) on_node_hover?.(null)
    else on_link_hover?.(null)
  }

  function handle_click(event: MouseEvent | KeyboardEvent) {
    const node = node_from_event(event)
    if (node) return on_node_click?.({ ...node_props(node), event })
    const link = link_from_event(event)
    if (link) on_link_click?.({ ...link_props(link), event })
  }

  function handle_keydown(event: KeyboardEvent) {
    if (!is_activation_key(event)) return
    event.preventDefault()
    handle_click(event)
  }

  // Legend: one item per node, toggling mutes (dims) rather than removing.
  // Auto-place to avoid covering nodes (node box centers act as obstacle points).
  let legend_element = $state<HTMLDivElement | undefined>()
  // Only nodes that survive the layout (orphans with no links are dropped, see
  // compute_sankey_layout) - keeps the legend in sync with what's drawn.
  let legend_data = $derived(
    layout.nodes.map(({ node_idx: idx, id, label }) => ({
      series_idx: idx,
      label: label ?? `${id}`,
      visible: !muted_nodes.has(id),
      display_style: { symbol_type: `Square` as const, symbol_color: node_colors[idx] },
    })),
  )
  // Nodes are labelled in place, so a legend stays opt-in here. Count rendered
  // legend entries (not raw input nodes) so orphan-only data can't open an empty legend.
  let legend_visible = $derived(
    resolve_legend_visibility(show_legend, legend, legend_data.length, false),
  )
  let legend_placement = $derived.by(() => {
    if (!legend_visible || !width || !height) return null
    return compute_element_placement({
      plot_bounds: { x: pad.l, y: pad.t, width: inner_width, height: inner_height },
      element: legend_element,
      element_size: { width: 120, height: 60 },
      axis_clearance: legend?.axis_clearance,
      exclude_rects: [],
      points: layout.nodes.map(node_center),
    })
  })

  function toggle_node(series_idx: number) {
    const id = node_by_idx.get(series_idx)?.id ?? series_idx
    if (!muted_nodes.delete(id)) muted_nodes.add(id)
  }

  // Node label placement: horizontal -> beside node; vertical -> above node
  function label_attrs(node: PositionedNode) {
    if (orientation === `vertical`) {
      return {
        x: (node.x0 + node.x1) / 2,
        y: node.y0 - 4,
        anchor: `middle` as const,
        baseline: `auto` as const,
      }
    }
    const left_half = (node.x0 + node.x1) / 2 < inner_width / 2
    return {
      x: left_half ? node.x1 + 6 : node.x0 - 6,
      y: (node.y0 + node.y1) / 2,
      anchor: (left_half ? `start` : `end`) as `start` | `end`,
      baseline: `middle` as const,
    }
  }
</script>

<div
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  {...rest}
  class={[`sankey`, rest.class, { fullscreen }]}
>
  {#if width && height}
    <div class="header-controls">
      {@render header_controls?.({ height, width, fullscreen })}
      {#if fullscreen_toggle}
        <FullscreenButton bind:fullscreen {wrapper} bg_css_var="--sankey-fullscreen-bg" />
      {/if}
    </div>
    {#if layout.error}
      <StatusMessage message={layout.error} type="error" style="margin: auto 1em" />
    {/if}
    <svg
      bind:this={svg_element}
      role="application"
      aria-label={rest[`aria-label`] ?? `Sankey diagram`}
      onmouseleave={clear_hover}
    >
      {#if link_color_mode === `gradient`}
        <defs>
          {#each layout.links as link (link.link_idx)}
            {@const vertical = orientation === `vertical`}
            <linearGradient
              id="{uid}-grad-{link.link_idx}"
              gradientUnits="userSpaceOnUse"
              x1={vertical ? link.mid.x : link.source.x1}
              y1={vertical ? link.source.y1 : link.mid.y}
              x2={vertical ? link.mid.x : link.target.x0}
              y2={vertical ? link.target.y0 : link.mid.y}
            >
              <stop offset="0%" stop-color={node_colors[link.source.node_idx]} />
              <stop offset="100%" stop-color={node_colors[link.target.node_idx]} />
            </linearGradient>
          {/each}
        </defs>
      {/if}

      <!-- One delegated handler set for nodes and links: targets resolve via their
      data-sankey-{node,link}-idx attributes -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <g
        transform="translate({pad.l}, {pad.t})"
        onmousemove={handle_hover}
        onmouseleave={clear_hover}
        onfocusin={handle_hover}
        onfocusout={clear_hover}
        onclick={handle_click}
        onkeydown={handle_keydown}
      >
        <g class="links" fill="none">
          {#each layout.links as link (link.link_idx)}
            {@const color = link_color(link)}
            {#if link_content}
              {@render link_content({ link, color })}
            {:else}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <path
                d={link.path}
                data-sankey-link-idx={link.link_idx}
                stroke={color}
                stroke-width={Math.max(1, link.width)}
                stroke-opacity={link_stroke_opacity(link)}
                role={on_link_click ? `button` : undefined}
                tabindex={on_link_click ? 0 : undefined}
                aria-label={on_link_click
                  ? `flow ${link.source.label} to ${link.target.label}: ${link.value}`
                  : undefined}
                style:cursor={on_link_click ? `pointer` : `default`}
              />
            {/if}
          {/each}
        </g>

        <g class="nodes">
          {#each layout.nodes as node (node.node_idx)}
            {@const color = node_colors[node.node_idx]}
            <g class="node" style:opacity={node_opacity(node)}>
              {#if node_content}
                {@render node_content({ node, color })}
              {:else}
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <rect
                  data-sankey-node-idx={node.node_idx}
                  x={node.x0}
                  y={node.y0}
                  width={Math.max(0, node.x1 - node.x0)}
                  height={Math.max(0, node.y1 - node.y0)}
                  fill={color}
                  stroke="var(--sankey-node-stroke, rgba(0, 0, 0, 0.5))"
                  stroke-width="0.5"
                  rx="1"
                  role={on_node_click ? `button` : undefined}
                  tabindex={on_node_click ? 0 : undefined}
                  aria-label={on_node_click
                    ? `${node.label ?? node.id}: ${node.value}`
                    : undefined}
                  style:cursor={on_node_click ? `pointer` : `default`}
                />
              {/if}
              {#if show_node_labels}
                {@const lbl = label_attrs(node)}
                <text
                  class="node-label"
                  x={lbl.x}
                  y={lbl.y}
                  text-anchor={lbl.anchor}
                  dominant-baseline={lbl.baseline}>{node_text(node)}</text
                >
              {/if}
            </g>
          {/each}
        </g>
      </g>
    </svg>
  {/if}

  {#if hover_info}
    <!-- Solid chip bg (PlotTooltip auto-contrasts text). Links use the source node
    color so gradient/static ribbons (url(...)/var(...)) still get a readable color. -->
    <PlotTooltip
      x={hover_pos.x}
      y={hover_pos.y}
      offset={{ x: 10, y: 5 }}
      constrain_to={{ width, height }}
      fallback_size={{ width: 140, height: 44 }}
      bg_color={hover_info.type === `node`
        ? hover_info.color
        : node_colors[hover_info.source_idx]}
    >
      {#if tooltip}
        {@render tooltip(hover_info)}
      {:else if hover_info.type === `node`}
        <strong>{hover_info.label ?? hover_info.id}</strong>: {format_value(
          hover_info.value,
          value_format,
        )}
      {:else}
        {hover_info.source_label ?? hover_info.source_idx} &rarr; {hover_info.target_label ??
          hover_info.target_idx}: {format_value(hover_info.value, value_format)}
      {/if}
    </PlotTooltip>
  {/if}

  {#if legend_visible}
    {@const legend_left = legend_placement?.x ?? pad.l + 10}
    {@const legend_top = legend_placement?.y ?? pad.t + 10}
    <PlotLegend
      bind:root_element={legend_element}
      {...legend}
      series_data={legend_data}
      on_toggle={legend?.on_toggle ?? toggle_node}
      on_item_hover={(item) =>
        (legend_hover_idx = item != null && item.series_idx >= 0 ? item.series_idx : null)}
      style={`position: absolute; left: ${legend_left}px; top: ${legend_top}px; pointer-events: auto; ${
        legend?.style ?? ``
      }`}
    />
  {/if}

  {#if show_controls}
    <SankeyControls
      toggle_props={controls_toggle_props}
      pane_props={controls_pane_props}
      bind:show_controls
      bind:controls_open
      bind:orientation
      bind:node_width
      bind:node_padding
      bind:node_align
      bind:link_opacity
      bind:show_node_labels
    >
      {@render controls_extra?.({ orientation })}
    </SankeyControls>
  {/if}

  {@render children?.({ height, width, fullscreen })}
</div>

<style>
  .sankey {
    --ctrl-btn-default-right: 30px;
    position: relative;
    width: var(--sankey-width, 100%);
    height: var(--sankey-height, auto);
    min-height: var(--sankey-min-height, 300px);
    container-type: size;
    z-index: var(--sankey-z-index, auto);
    flex: var(--sankey-flex, 1);
    display: var(--sankey-display, flex);
    flex-direction: column;
    background: var(--sankey-bg, var(--plot-bg));
    border-radius: var(--sankey-border-radius, 0);
  }
  .sankey.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw !important;
    height: 100vh !important;
    z-index: var(--sankey-fullscreen-z-index, var(--z-index-overlay-nav, 100000001));
    margin: 0;
    border-radius: 0;
    background: var(--sankey-fullscreen-bg, var(--sankey-bg, var(--plot-bg)));
    max-height: none !important;
    overflow: hidden;
    /* border-top (not padding-top): bind:clientHeight includes padding but excludes
    borders - padding made the chart overflow + clip its bottom 2em (x-axis title) */
    border-top: var(--plot-fullscreen-padding-top, 2em) solid
      var(--sankey-fullscreen-bg, var(--sankey-bg, var(--plot-bg, transparent)));
    box-sizing: border-box;
  }
  .header-controls {
    position: absolute;
    top: var(--ctrl-btn-top, 5pt);
    right: var(--fullscreen-btn-right, 4px);
    z-index: var(--fullscreen-btn-z-index, 10);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sankey :global(.pane-toggle),
  .sankey .header-controls {
    opacity: 0;
    transition:
      opacity 0.2s,
      background-color 0.2s;
  }
  .sankey:hover :global(.pane-toggle),
  .sankey:hover .header-controls,
  .sankey :global(.pane-toggle:focus-visible),
  .sankey :global(.pane-toggle[aria-expanded='true']),
  .sankey .header-controls:focus-within {
    opacity: 1;
  }
  svg {
    width: var(--sankey-svg-width, 100%);
    height: var(--sankey-svg-height, 100%);
    flex: var(--sankey-svg-flex, 1);
    overflow: var(--sankey-svg-overflow, visible);
    fill: var(--text-color);
    font-size: var(--sankey-font-size, 11px);
  }
  .links path {
    transition: stroke-opacity 0.15s ease;
  }
  .node {
    transition: opacity 0.15s ease;
  }
  .node-label {
    fill: var(--text-color);
    pointer-events: none;
    paint-order: stroke;
    stroke: var(--sankey-label-halo, var(--page-bg, white));
    stroke-width: var(--sankey-label-halo-width, 3px);
    stroke-linejoin: round;
  }
</style>
