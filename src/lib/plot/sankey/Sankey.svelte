<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import { type TooltipProp, TooltipValue } from '#lib/tooltip/index.js'
  import ViewerError from '#lib/layout/ViewerError.svelte'
  import { format_value } from '#lib/labels.js'
  import type { BasePlotProps, LegendConfig, Orientation } from '#lib/plot/index.js'
  import { plot_color } from '#lib/colors/index.js'
  import { PlotTooltip, SankeyControls } from '#lib/plot/index.js'
  import ChartShell from '#lib/plot/core/components/ChartShell.svelte'
  import InsetLegend from '#lib/plot/core/components/InsetLegend.svelte'
  import { json_source, svg_sources } from '#lib/io/export.js'
  import { csv_source } from '#lib/plot/core/utils/chart-export.js'
  import {
    closest_data_idx,
    is_activation_key,
    pointer_pos,
  } from '#lib/plot/core/interactions.js'
  import { filter_padding } from '#lib/plot/core/layout.js'
  import type { Sides } from '#lib/plot/core/layout.js'
  import { toggle_muted } from '#lib/plot/core/utils/hierarchy-chart.js'
  import { resolve_legend_visibility } from '#lib/plot/core/utils/series-visibility.js'
  import { bucket_sankey_data, compute_sankey_layout } from '#lib/plot/sankey/sankey.js'
  import type { PositionedLink, PositionedNode } from '#lib/plot/sankey/sankey.js'
  import type {
    SankeyData,
    SankeyHandlerProps,
    SankeyLinkColorMode,
    SankeyLinkHandlerProps,
    SankeyNodeAlign,
    SankeyNodeHandlerProps,
  } from '#lib/plot/sankey/sankey-types.js'
  import { DEFAULTS } from '#lib/settings.js'
  import { to_error } from 'svelte-widgets/utils'
  import { TooltipPin } from '#lib/tooltip/pin.svelte.js'
  import { viewer_keys } from '#lib/shortcuts.js'
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
    min_fraction = $bindable(DEFAULTS.sankey.min_fraction),
    max_links = $bindable(DEFAULTS.sankey.max_links),
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
    show_controls,
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
      // Fold each node's small outgoing links into one 'Other' link; see bucket_sankey_data
      min_fraction?: number
      max_links?: number
      iterations?: number
      link_opacity?: number
      link_color_mode?: SankeyLinkColorMode
      show_node_labels?: boolean
      node_label?: (node: PositionedNode) => string
      value_format?: string
      padding?: Sides
      legend?: LegendConfig | null
      show_legend?: boolean
      tooltip?: TooltipProp<SankeyHandlerProps<Metadata>>
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
  // Keyboard focus anchors at a shape center, where there is no pointer glyph to dodge
  let hover_at_pointer = $state(false)
  // Legend hover dims like a node hover but shows no tooltip
  let legend_hover_idx = $state<number | null>(null)
  // Nodes muted via legend toggle (dimmed, not removed: keeps layout stable); absent ids inert
  const muted_nodes = new SvelteSet<string | number>()

  let pad = $derived(filter_padding(padding, DEFAULT_PADDING))
  let inner_width = $derived(Math.max(0, width - pad.l - pad.r))
  let inner_height = $derived(Math.max(0, height - pad.t - pad.b))

  // Palette colors are resolved before folding, so a node keeps its color when the fold
  // drops its neighbours and shifts every later index
  let colored_data = $derived({
    nodes: data.nodes.map((node, idx) => ({ ...node, color: node.color ?? plot_color(idx) })),
    links: data.links,
  })

  // Long-tail folding runs before layout, so d3-sankey only sees the graph the user looks at
  let bucketed_data = $derived(bucket_sankey_data(colored_data, { min_fraction, max_links }))
  // Indexed by the folded graph's node_idx, which is what the layout reports; reading
  // the pre-fold arrays here attached colors and metadata to the wrong records
  let node_colors = $derived(
    bucketed_data.nodes.map((node, idx) => node.color ?? plot_color(idx)),
  )

  // Invalid graphs (cycles, unknown node refs) render an error message in place of the
  // diagram instead of crashing the host page
  let layout = $derived.by(() => {
    try {
      return {
        error: null,
        ...compute_sankey_layout(bucketed_data, {
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
      return { nodes: [], links: [], error: to_error(err).message }
    }
  })

  // node_idx -> positioned node: the layout drops orphans, so positions are sparse in node_idx
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

  // The tooltip: the hovered node or link where it was hovered, unless a click pinned one (see
  // TooltipPin) when on_node_click/on_link_click leaves the click free
  const pin = new TooltipPin<SankeyHandlerProps<Metadata>>({
    key: (info) => (info.type === `node` ? `node ${info.node_idx}` : `link ${info.link_idx}`),
    enabled: (info) =>
      tooltip !== false && !(info.type === `node` ? on_node_click : on_link_click),
  })
  const tip_info = $derived(pin.shown(hover_info))
  const tip_anchor = pin.anchored(() => ({ ...hover_pos, at_pointer: hover_at_pointer }))
  // a pinned payload describes the previous layout
  $effect.pre(() => {
    void layout
    untrack(pin.unpin)
  })

  // Node/link indices kept fully opaque for the hover target, or the pinned tooltip's while
  // one is pinned (null = neither)
  let active = $derived.by(() => {
    const hovered_node =
      legend_hover_idx ?? (tip_info?.type === `node` ? tip_info.node_idx : null)
    if (hovered_node != null) {
      const node = node_by_idx.get(hovered_node)
      if (!node) return null
      const links = new Set<number>()
      const nodes = new Set<number>([hovered_node])
      for (const link of [...(node.sourceLinks ?? []), ...(node.targetLinks ?? [])]) {
        links.add((link as PositionedLink).link_idx)
        nodes.add((link.source as PositionedNode).node_idx)
        nodes.add((link.target as PositionedNode).node_idx)
      }
      return { links, nodes }
    }
    if (tip_info?.type === `link`) {
      return {
        links: new Set([tip_info.link_idx]),
        nodes: new Set([tip_info.source_idx, tip_info.target_idx]),
      }
    }
    return null
  })

  // Hover state is index-based, and new data or a refold renumbers the nodes: clear it
  $effect(() => {
    void bucketed_data
    untrack(clear_hover)
  })

  // Missing SvelteSet members subscribe to the whole set. Indexed state gives every
  // mark its own dependency, so moving between targets only updates their adjacency.
  const active_nodes = $state<boolean[]>([])
  const active_links = $state<boolean[]>([])
  const has_active = $derived(active !== null)
  let previous_active: typeof active = null
  $effect.pre(() => {
    const next_active = active
    untrack(() => {
      for (const [key, flags] of [
        [`nodes`, active_nodes],
        [`links`, active_links],
      ] as const) {
        for (const idx of previous_active?.[key] ?? [])
          if (!next_active?.[key].has(idx)) flags[idx] = false
        for (const idx of next_active?.[key] ?? [])
          if (!previous_active?.[key].has(idx)) flags[idx] = true
      }
      previous_active = next_active
    })
  })

  const node_opacity = (node: PositionedNode): number => {
    if (muted_nodes.has(node.id)) return 0.12
    if (has_active && !active_nodes[node.node_idx]) return 0.3
    return 1
  }

  const link_stroke_opacity = (link: PositionedLink): number => {
    if (muted_nodes.has(link.source.id) || muted_nodes.has(link.target.id))
      return link_opacity * 0.15
    if (!has_active) return link_opacity
    return active_links[link.link_idx] ? Math.min(1, link_opacity + 0.35) : link_opacity * 0.25
  }

  // Nodes may carry only an id
  const node_name = (node: { id: string | number; label?: string }): string =>
    node.label ?? `${node.id}`
  const node_text = (node: PositionedNode): string => node_label?.(node) ?? node_name(node)

  // === Export ===
  // Data as laid out (after small-link bucketing): links as a source/target/value table,
  // or the whole graph as JSON
  const export_sources = {
    ...svg_sources(() => svg_element),
    csv: csv_source(() => ({
      header: [`source`, `target`, `value`],
      rows: layout.links.map(({ source, target, value }) => [
        node_text(source),
        node_text(target),
        value,
      ]),
    })),
    json: json_source(() => ({
      nodes: layout.nodes.map((node) => ({
        id: node.id,
        label: node_text(node),
        value: node.value,
        color: node_colors[node.node_idx],
      })),
      links: layout.links.map(({ source, target, value, label }) => ({
        source: source.id,
        target: target.id,
        value,
        ...(label && { label }),
      })),
    })),
  }

  const node_props = (node: PositionedNode): SankeyNodeHandlerProps<Metadata> => ({
    type: `node`,
    node_idx: node.node_idx,
    id: node.id,
    label: node.label,
    value: node.value,
    color: node_colors[node.node_idx],
    metadata: bucketed_data.nodes[node.node_idx].metadata,
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
    metadata: bucketed_data.links[link.link_idx].metadata,
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
    if (!node && !link) return clear_hover()
    hovered = true
    const cursor = pointer_pos(event, svg_element)
    hover_at_pointer = Boolean(cursor)
    const prev = hover_info
    if (node) {
      hover_pos = cursor ?? node_center(node)
      if (prev?.type === `node` && prev.node_idx === node.node_idx) return
      if (prev?.type === `link`) on_link_hover?.(null)
      hover_info = node_props(node)
      on_node_hover?.({ ...hover_info, event })
    } else if (link) {
      hover_pos = cursor ?? { x: pad.l + link.mid.x, y: pad.t + link.mid.y }
      if (prev?.type === `link` && prev.link_idx === link.link_idx) return
      if (prev?.type === `node`) on_node_hover?.(null)
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
    const link = node ? null : link_from_event(event)
    if (node) on_node_click?.({ ...node_props(node), event })
    else if (link) on_link_click?.({ ...link_props(link), event })
    pin.toggle(node || link ? hover_info : null)
  }

  function handle_keydown(event: KeyboardEvent) {
    if (!is_activation_key(event)) return
    event.preventDefault()
    handle_click(event)
  }

  // Legend: one item per node that survives the layout (orphans are dropped), toggling mutes
  // (dims) rather than removes. Node box centers are obstacles for its auto-placement.
  let legend_data = $derived(
    layout.nodes.map(({ node_idx: idx, id: identifier, label }) => ({
      series_idx: idx,
      label: label ?? `${identifier}`,
      visible: !muted_nodes.has(identifier),
      display_style: { symbol_type: `Square` as const, symbol_color: node_colors[idx] },
    })),
  )
  // Nodes are labelled in place, so a legend stays opt-in. Counting rendered entries (not
  // input nodes) means orphan-only data can't open an empty legend.
  let legend_visible = $derived(
    resolve_legend_visibility(show_legend, legend, legend_data.length, false),
  )

  const toggle_node = (series_idx: number) =>
    toggle_muted(muted_nodes, node_by_idx.get(series_idx)?.id)

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

<ChartShell
  empty={!data.nodes.length}
  chart_class="sankey"
  css_prefix="sankey"
  bind:wrapper
  bind:width
  bind:height
  bind:fullscreen
  {fullscreen_toggle}
  {show_controls}
  {controls_toggle_props}
  {header_controls}
  {export_sources}
  {children}
  {...rest}
  {@attach viewer_keys(() => ({ Escape: pin.unpin }))}
>
  {#snippet controls(toggle_props, show_controls)}
    <SankeyControls
      {toggle_props}
      pane_props={controls_pane_props}
      {show_controls}
      bind:controls_open
      bind:orientation
      bind:node_width
      bind:node_padding
      bind:node_align
      bind:min_fraction
      bind:max_links
      bind:link_opacity
      bind:show_node_labels
    >
      {@render controls_extra?.({ orientation })}
    </SankeyControls>
  {/snippet}

  {#snippet body()}
    <ViewerError message={layout.error} />
    <!-- Clicks land here so empty space unpins; keys go through the focusable nodes and links -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <svg
      bind:this={svg_element}
      role="application"
      aria-label={rest[`aria-label`] ?? `Sankey diagram`}
      onmouseleave={clear_hover}
      onclick={handle_click}
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
                  ? `flow ${node_name(link.source)} to ${node_name(link.target)}: ${link.value}`
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
                  aria-label={on_node_click ? `${node_name(node)}: ${node.value}` : undefined}
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

    {#if tip_info && tooltip !== false}
      {@const { at_pointer, ...pos } = tip_anchor.current}
      <!-- Solid chip bg (PlotTooltip auto-contrasts text). Links use their ribbon color, or for
    a url(...) gradient ribbon the source node color it fades from. -->
      <PlotTooltip
        {...pos}
        offset={{ x: 10, y: 5 }}
        avoid_cursor={at_pointer}
        constrain_to={{ width, height }}
        fallback_size={{ width: 140, height: 44 }}
        bg_color={tip_info.type === `link` && tip_info.color.startsWith(`url(`)
          ? node_colors[tip_info.source_idx]
          : tip_info.color}
        pinned={pin.value !== null}
      >
        {#if tooltip}
          {@render tooltip(tip_info)}
        {:else if tip_info.type === `node`}
          <strong>{node_name(tip_info)}</strong>: <TooltipValue
            value={format_value(tip_info.value, value_format)}
          />
        {:else}
          {@const { source_idx, target_idx, source_label, target_label } = tip_info}
          {source_label ?? node_by_idx.get(source_idx)?.id} &rarr; {target_label ??
            node_by_idx.get(target_idx)?.id}: <TooltipValue
            value={format_value(tip_info.value, value_format)}
          />
        {/if}
      </PlotTooltip>
    {/if}

    {#if legend_visible}
      <InsetLegend
        {legend}
        measured={width > 0 && height > 0}
        plot_bounds={{ x: pad.l, y: pad.t, width: inner_width, height: inner_height }}
        points={layout.nodes.map(node_center)}
        bind:hover_idx={legend_hover_idx}
        series_data={legend_data}
        on_toggle={toggle_node}
      />
    {/if}
  {/snippet}
</ChartShell>

<style>
  svg {
    width: var(--sankey-svg-width, 100%);
    height: var(--sankey-svg-height, 100%);
    flex: var(--sankey-svg-flex, 1);
    overflow: var(--sankey-svg-overflow, visible);
    fill: var(--text-color);
    font-size: var(--sankey-font-size, 11px);
  }
  /* .sankey is a size container; node labels sit beside nodes and collide fast when a
     multi-column diagram is squeezed into a phone-width host */
  @container (max-width: 480px) {
    svg {
      font-size: var(--sankey-font-size, 9px);
    }
  }
  .links path {
    transition: stroke-opacity 0.15s ease;
  }
  .node {
    transition: opacity 0.15s ease;
  }
  .node-label {
    pointer-events: none;
    paint-order: stroke;
    stroke: var(--sankey-label-halo, var(--page-bg, white));
    stroke-width: var(--sankey-label-halo-width, 3px);
    stroke-linejoin: round;
  }
</style>
