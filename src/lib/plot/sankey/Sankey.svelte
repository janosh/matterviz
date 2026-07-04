<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import { format_value } from '$lib/labels'
  import { FullscreenToggle, set_fullscreen_bg } from '$lib/layout'
  import type {
    BasePlotProps,
    LegendConfig,
    LegendItem,
    SankeyData,
    SankeyHandlerProps,
    SankeyLinkColorMode,
    SankeyLinkHandlerProps,
    SankeyNodeAlign,
    SankeyNodeHandlerProps,
    SankeyOrientation,
  } from '$lib/plot'
  import { DEFAULT_SERIES_COLORS, PlotLegend, PlotTooltip, SankeyControls } from '$lib/plot'
  import { closest_data_idx } from '$lib/plot/core/interactions'
  import {
    compute_element_placement,
    constrain_tooltip_position,
    filter_padding,
  } from '$lib/plot/core/layout'
  import type { Sides } from '$lib/plot/core/layout'
  import { compute_sankey_layout } from '$lib/plot/sankey/sankey'
  import type { PositionedLink, PositionedNode } from '$lib/plot/sankey/sankey'
  import { unique_id } from '$lib/plot/core/utils'
  import { DEFAULTS } from '$lib/settings'
  import { type Snippet, untrack } from 'svelte'
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
    show_legend = false,
    tooltip,
    node_content,
    link_content,
    hovered = $bindable(false),
    change = () => {},
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
    Omit<BasePlotProps, `change`> & {
      data?: SankeyData<Metadata>
      orientation?: SankeyOrientation
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
      change?: (data: SankeyHandlerProps<Metadata> | null) => void
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
      controls_extra?: Snippet<[{ orientation: SankeyOrientation }]>
    } = $props()

  let [width, height] = $state([0, 0])
  let wrapper: HTMLDivElement | undefined = $state()
  let svg_element: SVGSVGElement | null = $state(null)
  let tooltip_el = $state<HTMLDivElement | undefined>()
  // Unique per-instance prefix for gradient ids (collision-resistant, see unique_id)
  const uid = unique_id(`sankey`)

  let hovered_node = $state<number | null>(null)
  let hovered_link = $state<number | null>(null)
  let hover_info = $state<SankeyHandlerProps<Metadata> | null>(null)
  let hover_pos = $state<{ x: number; y: number }>({ x: 0, y: 0 })
  // Nodes muted via legend toggle (dimmed, not removed - keeps layout stable)
  let muted_nodes = new SvelteSet<string | number>()

  let pad = $derived(filter_padding(padding, DEFAULT_PADDING))
  let inner_width = $derived(Math.max(0, width - pad.l - pad.r))
  let inner_height = $derived(Math.max(0, height - pad.t - pad.b))

  // Resolved node colors (per node_idx), explicit color or cycled palette
  let node_colors = $derived(
    data.nodes.map(
      (node, idx) => node.color ?? DEFAULT_SERIES_COLORS[idx % DEFAULT_SERIES_COLORS.length],
    ),
  )

  // Drop muted ids that no longer exist when data changes (untrack avoids a
  // self-trigger loop from reading/writing muted_nodes in the same effect).
  $effect(() => {
    const valid = new Set(data.nodes.map((node, idx) => node.id ?? idx))
    untrack(() => {
      for (const id of muted_nodes) if (!valid.has(id)) muted_nodes.delete(id)
    })
  })

  // Degrade to an empty layout (instead of crashing the host page) when the graph
  // is invalid, e.g. contains a cycle. The thrown error is surfaced via console.error.
  let layout = $derived.by(() => {
    try {
      return compute_sankey_layout(data, {
        width: inner_width,
        height: inner_height,
        node_width,
        node_padding,
        node_align,
        orientation,
        iterations,
      })
    } catch (err) {
      console.error(err)
      return { nodes: [], links: [] }
    }
  })

  // node_idx -> positioned node (array order is preserved by d3-sankey, but map is safer)
  let node_by_idx = $derived(new Map(layout.nodes.map((node) => [node.node_idx, node])))

  const node_id_at = (node_idx: number): string | number =>
    node_by_idx.get(node_idx)?.id ?? node_idx

  // Node box center in container (pad-offset) pixel space, for tooltip + legend placement
  const node_center = (node: PositionedNode): { x: number; y: number } => ({
    x: pad.l + (node.x0 + node.x1) / 2,
    y: pad.t + (node.y0 + node.y1) / 2,
  })

  // Resolve a link's ribbon color from explicit color or the active color mode
  const link_color = (link: PositionedLink): string => {
    if (link.color) return link.color
    const src = node_colors[link.source.node_idx]
    const tgt = node_colors[link.target.node_idx]
    if (link_color_mode === `target`) return tgt
    if (link_color_mode === `gradient`) return `url(#${uid}-grad-${link.link_idx})`
    if (link_color_mode === `static`) return `var(--sankey-link-color, #888)`
    return src
  }

  // Set of node/link indices to keep fully opaque given the current hover target
  let active = $derived.by(() => {
    if (hovered_node != null) {
      const node = node_by_idx.get(hovered_node)
      if (!node) return null
      const link_set = new SvelteSet<number>()
      const node_set = new SvelteSet<number>([hovered_node])
      for (const link of [...(node.sourceLinks ?? []), ...(node.targetLinks ?? [])]) {
        link_set.add((link as PositionedLink).link_idx)
        node_set.add((link.source as PositionedNode).node_idx)
        node_set.add((link.target as PositionedNode).node_idx)
      }
      return { links: link_set, nodes: node_set }
    }
    if (hovered_link != null) {
      const link = layout.links[hovered_link]
      if (!link) return null
      return {
        links: new SvelteSet([hovered_link]),
        nodes: new SvelteSet([link.source.node_idx, link.target.node_idx]),
      }
    }
    return null
  })

  const node_opacity = (node: PositionedNode): number => {
    if (muted_nodes.has(node.id)) return 0.12
    if (active && !active.nodes.has(node.node_idx)) return 0.3
    return 1
  }

  const link_dim = (link: PositionedLink): boolean =>
    muted_nodes.has(link.source.id) || muted_nodes.has(link.target.id)

  const link_stroke_opacity = (link: PositionedLink): number => {
    if (link_dim(link)) return link_opacity * 0.15
    if (active)
      return active.links.has(link.link_idx)
        ? Math.min(1, link_opacity + 0.35)
        : link_opacity * 0.25
    return link_opacity
  }

  const node_text = (node: PositionedNode): string =>
    node_label?.(node) ?? node.label ?? `${node.id}`

  function make_node_props(node: PositionedNode): SankeyNodeHandlerProps<Metadata> {
    return {
      type: `node`,
      node_idx: node.node_idx,
      id: node.id,
      label: node.label,
      value: node.value ?? 0,
      color: node_colors[node.node_idx],
      metadata: data.nodes[node.node_idx]?.metadata,
    }
  }

  function make_link_props(link: PositionedLink): SankeyLinkHandlerProps<Metadata> {
    return {
      type: `link`,
      link_idx: link.link_idx,
      source_idx: link.source.node_idx,
      target_idx: link.target.node_idx,
      source_label: link.source.label,
      target_label: link.target.label,
      value: link.value,
      color: link_color(link),
      metadata: data.links[link.link_idx]?.metadata,
    }
  }

  // Anchor the tooltip at the cursor (mouse hover) so it follows the pointer over wide nodes
  // and long link ribbons; fall back to the element center on keyboard focus (no cursor).
  function event_pos(event?: MouseEvent | FocusEvent): { x: number; y: number } | null {
    if (event instanceof MouseEvent && svg_element) {
      const rect = svg_element.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    return null
  }

  function set_node_hover(node: PositionedNode | null, event?: MouseEvent | FocusEvent) {
    if (node) {
      hovered = true
      hovered_node = node.node_idx
      hovered_link = null
      hover_info = make_node_props(node)
      hover_pos = event_pos(event) ?? node_center(node)
      change(hover_info)
      if (event)
        on_node_hover?.({ ...(hover_info as SankeyNodeHandlerProps<Metadata>), event })
    } else {
      hovered_node = null
      hover_info = null
      change(null)
      on_node_hover?.(null)
    }
  }

  function set_link_hover(link: PositionedLink | null, event?: MouseEvent | FocusEvent) {
    if (link) {
      hovered = true
      hovered_link = link.link_idx
      hovered_node = null
      hover_info = make_link_props(link)
      hover_pos = event_pos(event) ?? { x: pad.l + link.mid.x, y: pad.t + link.mid.y }
      change(hover_info)
      if (event)
        on_link_hover?.({ ...(hover_info as SankeyLinkHandlerProps<Metadata>), event })
    } else {
      hovered_link = null
      hover_info = null
      change(null)
      on_link_hover?.(null)
    }
  }

  const link_from_event = (event: Event): PositionedLink | null => {
    const idx = closest_data_idx(event, `data-sankey-link-idx`, svg_element)
    return idx == null ? null : (layout.links[idx] ?? null)
  }

  const node_from_event = (event: Event): PositionedNode | null => {
    const idx = closest_data_idx(event, `data-sankey-node-idx`, svg_element)
    return idx == null ? null : (node_by_idx.get(idx) ?? null)
  }

  function handle_link_hover_event(event: MouseEvent | FocusEvent) {
    set_link_hover(link_from_event(event), event)
  }

  function handle_node_hover_event(event: MouseEvent | FocusEvent) {
    set_node_hover(node_from_event(event), event)
  }

  function handle_link_click(event: MouseEvent | KeyboardEvent) {
    const link = link_from_event(event)
    if (link) on_link_click?.({ ...make_link_props(link), event })
  }

  function handle_node_click(event: MouseEvent | KeyboardEvent) {
    const node = node_from_event(event)
    if (node) on_node_click?.({ ...make_node_props(node), event })
  }

  function handle_link_keydown(event: KeyboardEvent) {
    if (event.key !== `Enter` && event.key !== ` `) return
    event.preventDefault()
    handle_link_click(event)
  }

  function handle_node_keydown(event: KeyboardEvent) {
    if (event.key !== `Enter` && event.key !== ` `) return
    event.preventDefault()
    handle_node_click(event)
  }

  // Legend: one item per node, toggling mutes (dims) rather than removing.
  // Auto-place to avoid covering nodes (node box centers act as obstacle points).
  let legend_element = $state<HTMLDivElement | undefined>()
  let legend_placement = $derived.by(() => {
    if (!show_legend || legend == null || data.nodes.length <= 1 || !width || !height) {
      return null
    }
    return compute_element_placement({
      plot_bounds: { x: pad.l, y: pad.t, width: inner_width, height: inner_height },
      element: legend_element,
      element_size: { width: 120, height: 60 },
      axis_clearance: legend?.axis_clearance,
      exclude_rects: [],
      points: layout.nodes.map(node_center),
    })
  })
  // Only nodes that survive the layout (orphans with no links are dropped, see
  // compute_sankey_layout) - keeps the legend in sync with what's drawn.
  let legend_data = $derived.by<LegendItem[]>(() =>
    data.nodes
      .map((node, idx) => ({ node, idx }))
      .filter(({ idx }) => node_by_idx.has(idx))
      .map(({ node, idx }) => ({
        series_idx: idx,
        label: node.label ?? `${node.id ?? idx}`,
        visible: !muted_nodes.has(node.id ?? idx),
        display_style: { symbol_type: `Square` as const, symbol_color: node_colors[idx] },
      })),
  )

  function toggle_node(series_idx: number) {
    const id = node_id_at(series_idx)
    if (muted_nodes.has(id)) muted_nodes.delete(id)
    else muted_nodes.add(id)
  }

  $effect(() => set_fullscreen_bg(wrapper, fullscreen, `--sankey-fullscreen-bg`))

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

<svelte:window
  onkeydown={(evt) => {
    if (evt.key === `Escape` && fullscreen) {
      evt.preventDefault()
      fullscreen = false
    }
  }}
/>

<div
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  {...rest}
  class={[`sankey`, rest.class]}
  class:fullscreen
>
  {#if width && height}
    <div class="header-controls">
      {@render header_controls?.({ height, width, fullscreen })}
      {#if fullscreen_toggle}
        <FullscreenToggle bind:fullscreen />
      {/if}
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <svg
      bind:this={svg_element}
      role="application"
      aria-label={rest[`aria-label`] ?? `Sankey diagram`}
      onmouseleave={() => {
        hovered = false
        set_node_hover(null)
        set_link_hover(null)
      }}
    >
      {#if link_color_mode === `gradient`}
        <defs>
          {#each layout.links as link (link.link_idx)}
            {@const src_color = node_colors[link.source.node_idx]}
            {@const tgt_color = node_colors[link.target.node_idx]}
            {@const vertical = orientation === `vertical`}
            <linearGradient
              id="{uid}-grad-{link.link_idx}"
              gradientUnits="userSpaceOnUse"
              x1={vertical ? link.mid.x : link.source.x1}
              y1={vertical ? link.source.y1 : link.mid.y}
              x2={vertical ? link.mid.x : link.target.x0}
              y2={vertical ? link.target.y0 : link.mid.y}
            >
              <stop offset="0%" stop-color={src_color} />
              <stop offset="100%" stop-color={tgt_color} />
            </linearGradient>
          {/each}
        </defs>
      {/if}

      <g transform="translate({pad.l}, {pad.t})">
        <!-- Links -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <g
          class="links"
          fill="none"
          onmousemove={handle_link_hover_event}
          onmouseleave={() => set_link_hover(null)}
          onfocusin={handle_link_hover_event}
          onfocusout={() => set_link_hover(null)}
          onclick={handle_link_click}
          onkeydown={handle_link_keydown}
        >
          {#each layout.links as link (link.link_idx)}
            {@const color = link_color(link)}
            {#if link_content}
              {@render link_content({ link, color })}
            {:else}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
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

        <!-- Nodes -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <g
          class="nodes"
          onmousemove={handle_node_hover_event}
          onmouseleave={() => set_node_hover(null)}
          onfocusin={handle_node_hover_event}
          onfocusout={() => set_node_hover(null)}
          onclick={handle_node_click}
          onkeydown={handle_node_keydown}
        >
          {#each layout.nodes as node (node.node_idx)}
            {@const color = node_colors[node.node_idx]}
            <g class="node" style:opacity={node_opacity(node)}>
              {#if node_content}
                {@render node_content({ node, color })}
              {:else}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
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
    {@const tip = constrain_tooltip_position(
      hover_pos.x,
      hover_pos.y,
      tooltip_el?.offsetWidth ?? 140,
      tooltip_el?.offsetHeight ?? 44,
      width,
      height,
      { offset_x: 10, offset_y: 5 },
    )}
    <!-- Solid chip bg (PlotTooltip auto-contrasts text). Links use the source node
    color so gradient/static ribbons (url(...)/var(...)) still get a readable color. -->
    {@const tip_bg =
      hover_info.type === `node`
        ? hover_info.color
        : (node_colors[hover_info.source_idx] ?? `rgba(0, 0, 0, 0.7)`)}
    <PlotTooltip
      x={tip.x}
      y={tip.y}
      offset={{ x: 0, y: 0 }}
      bg_color={tip_bg}
      bind:wrapper={tooltip_el}
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

  {#if show_legend && legend != null && data.nodes.length > 1}
    {@const legend_left = legend_placement?.x ?? pad.l + 10}
    {@const legend_top = legend_placement?.y ?? pad.t + 10}
    <PlotLegend
      bind:root_element={legend_element}
      {...legend}
      series_data={legend_data}
      on_toggle={legend?.on_toggle ?? toggle_node}
      on_item_hover={(item) =>
        (hovered_node = item != null && item.series_idx >= 0 ? item.series_idx : null)}
      style={`position: absolute; left: ${legend_left}px; top: ${legend_top}px; pointer-events: auto; ${
        legend?.style ?? ``
      }`}
    />
  {/if}

  {#if show_controls}
    <SankeyControls
      toggle_props={{
        ...controls_toggle_props,
        style: `--ctrl-btn-right: var(--fullscreen-btn-offset, 30px); ${
          controls_toggle_props?.style ?? ``
        }`,
      }}
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
    border-radius: var(--sankey-border-radius, var(--border-radius, 3pt));
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
  .header-controls :global(.fullscreen-toggle) {
    position: static;
    opacity: 1;
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
    stroke: var(--sankey-label-halo, var(--plot-bg, white));
    stroke-width: var(--sankey-label-halo-width, 3px);
    stroke-linejoin: round;
  }
</style>
