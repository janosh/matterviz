<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import type { BasePlotProps } from '#lib/plot/index.js'
  import { TreemapControls } from '#lib/plot/index.js'
  import ChartShell from '#lib/plot/core/components/ChartShell.svelte'
  import HierarchyShell from '#lib/plot/core/components/HierarchyShell.svelte'
  import type { Rect, Sides } from '#lib/plot/core/layout.js'
  import { create_settling_tween } from '#lib/plot/core/settling-tween.svelte.js'
  import { SCALE_DEFAULTS } from '#lib/plot/core/types.js'
  import type { HierarchyChartProps } from '#lib/plot/core/utils/hierarchy-state.svelte.js'
  import { HierarchyChartState } from '#lib/plot/core/utils/hierarchy-state.svelte.js'
  import type { PositionedArc } from '#lib/plot/core/utils/hierarchy-layout.js'
  import {
    measure_treemap_label_block,
    normalize_treemap_label_lines,
    place_treemap_label,
    safe_font_size,
  } from '#lib/plot/treemap/labels.js'
  import type {
    TreemapLabelBlock,
    TreemapLabelFit,
    TreemapLabelFormatter,
    TreemapLabelPlacement,
  } from '#lib/plot/treemap/labels.js'
  import type { Tiling } from '#lib/plot/treemap/treemap.js'
  import {
    align_tiling,
    header_strip,
    lerp_rects,
    tile_rects,
    treemap_hover_veil,
  } from '#lib/plot/treemap/treemap.js'
  import { DEFAULTS } from '#lib/settings.js'
  import { type Snippet, untrack } from 'svelte'
  import { cubicInOut } from 'svelte/easing'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { TweenOptions } from 'svelte/motion'

  // no outer inset by default: cells tile flush with the container
  const DEFAULT_PADDING: Required<Sides> = { t: 0, b: 0, l: 0, r: 0 }
  const LABEL_MARGIN = 6 // px clearance between label text and cell edges

  let {
    data = $bindable([]),
    value_mode = $bindable(DEFAULTS.treemap.value_mode),
    // descending (unlike Sunburst): squarified tiling reads best largest-first
    sort = `descending`,
    level_lighten = 0,
    min_fraction = $bindable(DEFAULTS.treemap.min_fraction),
    max_children = $bindable(DEFAULTS.treemap.max_children),
    other_label = `Other`,
    max_depth = $bindable(DEFAULTS.treemap.max_depth),
    padding_inner = $bindable(DEFAULTS.treemap.padding_inner),
    padding_top = $bindable(DEFAULTS.treemap.padding_top),
    padding_outer = $bindable(DEFAULTS.treemap.padding_outer),
    show_labels = $bindable(DEFAULTS.treemap.show_labels),
    label_text = $bindable(DEFAULTS.treemap.label_text),
    label_formatter,
    label_fit = `shrink`,
    label_min_font_size = 6,
    label_max_font_size,
    parent_label_font_size = 14,
    zoom_on_click = $bindable(DEFAULTS.treemap.zoom_on_click),
    zoom_root_id = $bindable(null),
    show_breadcrumbs = $bindable(DEFAULTS.treemap.show_breadcrumbs),
    color_values,
    color_scale = SCALE_DEFAULTS.scheme,
    color_bar = {},
    color_bar_side = `right`,
    tween,
    value_format = `,`,
    padding = DEFAULT_PADDING,
    legend = {},
    show_legend,
    tooltip,
    cell_content,
    hovered = $bindable(false),
    on_node_click,
    on_node_hover,
    on_zoom,
    controls_open = $bindable(false),
    controls_pane_props,
    fullscreen = $bindable(false),
    controls_extra,
    // show_controls, controls_toggle_props, fullscreen_toggle, header_controls and children
    // reach ChartShell through rest
    ...rest
  }: HTMLAttributes<HTMLDivElement> &
    // Cartesian-only props would otherwise leak to the wrapper div as invalid DOM attributes
    Omit<BasePlotProps, `range_padding` | `title`> &
    // data/value semantics, coloring, legend, export and node handlers shared with Sunburst
    HierarchyChartProps<Metadata> & {
      padding_inner?: number // px gap between sibling cells
      padding_top?: number // px header strip on branch cells (0 = no headers)
      padding_outer?: number // px inset of children within their parent (plotly marker.pad)
      // Structured multiline labels; unlike cell_content keeps built-in hover/click/tooltip
      label_formatter?: TreemapLabelFormatter<Metadata>
      label_fit?: TreemapLabelFit // shrink-to-fit (default), hide, or clip at max size
      label_min_font_size?: number // px floor used by shrink mode
      label_max_font_size?: number // px ceiling for leaf/cutoff labels
      parent_label_font_size?: number // px size/ceiling for branch header labels
      // Zoom transition timing (resizes/data swaps snap instantly). `interpolate` and
      // `duration`-as-function are the component's own: the tweened value is a tiling
      tween?: Omit<TweenOptions<Rect[]>, `interpolate` | `duration`> & { duration?: number }
      // Fully replace the default cell rect + labels, including the built-in
      // hover/focus/click + tooltip wiring (re-implement interactivity in the snippet)
      cell_content?: Snippet<[{ arc: PositionedArc<Metadata>; rect: Rect }]>
    } = $props()

  let [width, height] = $state([0, 0])
  const uid = $props.id()

  // Tree semantics, zoom/hover/legend state and keyboard plumbing are shared with
  // Sunburst. Annotated because the geometry hooks below close over `chart_state` itself
  const chart_state: HierarchyChartState<Metadata> = new HierarchyChartState<Metadata>({
    chart: `treemap`,
    uid,
    default_padding: DEFAULT_PADDING,
    data: () => data,
    layout_options: () => ({
      value_mode,
      sort,
      level_lighten,
      min_fraction,
      max_children,
      other_label,
    }),
    label_text: () => (show_labels ? label_text : null),
    value_format: () => value_format,
    width: () => width,
    height: () => height,
    padding: () => padding,
    color_values: () => color_values,
    color_scale: () => color_scale,
    color_bar: () => color_bar,
    color_bar_side: () => color_bar_side,
    legend: () => legend,
    show_legend: () => show_legend,
    zoom_on_click: () => zoom_on_click,
    zoom_root_id: () => zoom_root_id,
    set_zoom_root_id: (value) => (zoom_root_id = value),
    set_hovered: (value) => (hovered = value),
    fullscreen: () => fullscreen,
    set_fullscreen: (value) => (fullscreen = value),
    on_node_click: (payload) => on_node_click?.(payload),
    on_node_hover: (payload) => on_node_hover?.(payload),
    on_zoom: (payload) => on_zoom?.(payload),
    visible: (idx) => idx_visible(idx),
    node_center: (idx) => (rects[idx] ? rect_center(rects[idx]) : null),
    // Place against the settled tiling (stable during zoom tweens), with the same
    // visibility rule as rendering so hidden cells don't repel the legend
    legend_points: () =>
      chart_state.arcs.flatMap((arc, idx) =>
        cell_visible(arc, target_rects[idx]) ? [rect_center(target_rects[idx])] : [],
      ),
    // Keyboard zoom unmounts the focused cell: focus the new root's first child
    // (pre-order node_idx + 1), or the root itself for full-viewport leaf zooms
    focus_after_zoom: () => {
      const { zoom_root } = chart_state
      chart_state.focus_node(
        zoom_root
          ? zoom_root.is_leaf
            ? zoom_root.node_idx
            : zoom_root.node_idx + 1
          : roving_idx,
      )
    },
  })

  // Re-tile the zoom root's subtree to the full plot area (plotly behavior): projecting one
  // fixed tiling would distort aspect ratios and scale the fixed-px header strips
  let zoom_idx = $derived(chart_state.zoom_root?.node_idx ?? 0)
  let target_rects = $derived(
    tile_rects(
      chart_state.arcs,
      zoom_idx,
      { width: chart_state.inner_width, height: chart_state.inner_height },
      { padding_inner, padding_top, padding_outer },
    ),
  )
  let header_height = $derived(header_strip(padding_top, padding_outer))
  // Rects travel with their arcs: a zoom can change the arc set (bucketing is relative
  // to the zoom root), so tilings must be matched by id rather than by position
  let tiling = $derived<Tiling>({ rects: target_rects, arcs: chart_state.arcs })
  // Animate only zoom transitions; resizes, data swaps and padding tweaks snap (a lerp
  // would chase a drag-resize). Keyed on the zoom root's id, not node_idx, which shifts
  // whenever bucketing changes the arc set. untrack reads the options once at init.
  let prev_zoom_id = untrack(() => chart_state.zoom_root?.id ?? null)
  let prev_data = untrack(() => data)
  const rects_tween = create_settling_tween<Tiling>(
    () => tiling,
    untrack(() => ({
      duration: 400,
      easing: cubicInOut,
      ...tween,
      interpolate: (from: Tiling, target: Tiling) => {
        // Realigned once per transition, not per frame
        const start = align_tiling(from, target)
        return (fraction: number) => ({
          rects: lerp_rects(start, target.rects, fraction),
          arcs: target.arcs,
        })
      },
    })),
    {
      live: () =>
        (chart_state.zoom_root?.id ?? null) !== prev_zoom_id && data === prev_data
          ? undefined
          : { duration: 0 },
    },
  )
  // Bookkeeping lives outside `live`, which the tween skips while settling (stale prev_*
  // would snap the next zoom back). Created after the tween so `live` reads old values first.
  $effect.pre(() => {
    ;[prev_zoom_id, prev_data] = [chart_state.zoom_root?.id ?? null, data]
  })
  let rects = $derived(rects_tween.current.rects)
  let hover_veil = $derived(
    treemap_hover_veil(chart_state.arcs, rects, chart_state.hovered_idx),
  )

  // Deepest level rendered below the current zoom root (0 = unlimited)
  let depth_cutoff = $derived(
    max_depth > 0 ? (chart_state.zoom_root?.depth ?? 0) + max_depth : Infinity,
  )
  // Shared by rendering and legend placement. The zoom root is shown by the breadcrumbs,
  // not a cell, unless it's a leaf (rendered full-viewport instead of a blank chart).
  // Nodes outside the zoomed subtree hold zero rects.
  const cell_visible = (arc: PositionedArc<Metadata>, rect: Rect): boolean =>
    arc.depth > 0 &&
    (arc.node_idx !== zoom_idx || arc.is_leaf) &&
    arc.depth <= depth_cutoff &&
    rect.width > 0.5 &&
    rect.height > 0.5
  const idx_visible = (idx: number): boolean => {
    const [arc, rect] = [chart_state.arcs[idx], rects[idx]]
    return Boolean(arc && rect && cell_visible(arc, rect))
  }
  // Indices of cells to render: arcs/rects/node_infos are index-aligned, so no N wrapper
  // objects get rebuilt per tween frame
  let visible_idxs = $derived.by(() => {
    const idxs: number[] = []
    for (let idx = 0; idx < chart_state.arcs.length; idx++) {
      if (idx_visible(idx)) idxs.push(idx)
    }
    return idxs
  })

  // Every visible cell is focusable so arrow keys reach tooltips and leaf zooms keep focus
  let roving_idx = $derived(chart_state.roving_idx(visible_idxs[0] ?? null))

  // Rect center in container (pad-offset) pixel space, for tooltip + legend placement
  const rect_center = (rect: Rect): { x: number; y: number } => ({
    x: chart_state.plot_left + rect.x + rect.width / 2,
    y: chart_state.pad.t + rect.y + rect.height / 2,
  })

  // Any cell zooms (plotly semantics), not just branches, so clickability is uniform
  let cells_clickable = $derived(Boolean(on_node_click) || zoom_on_click)

  // Branches with visible children label only their header strip (children cover the rest)
  const is_header = (arc: PositionedArc<Metadata>): boolean =>
    !arc.is_leaf && arc.depth < depth_cutoff
  // Header labels render bold (600) and at their own size ceiling
  let header_font = $derived({ ...chart_state.label_font, font_weight: `600` })
  let header_font_size = $derived(safe_font_size(parent_label_font_size, 14))
  let leaf_font_size = $derived(
    safe_font_size(label_max_font_size ?? chart_state.label_font.font_size, 11),
  )

  // Per-node label candidates, richest first. Without a formatter, shrink/clip fit the
  // richest variant while hide mode falls back through compact ones. The formatter runs once
  // per data/option change and never for the (possibly synthetic) depth-0 root.
  let label_lines = $derived(
    chart_state.arcs.map((arc, idx) => {
      if (arc.depth === 0) return []
      if (label_formatter) return [normalize_treemap_label_lines(label_formatter(arc))]
      const { variants } = chart_state.node_infos[idx]
      if (label_fit === `hide`) return variants.map(({ text }) => [{ text }])
      return [normalize_treemap_label_lines(variants[0]?.text)]
    }),
  )
  // Measured at max size once per font/zoom change, not per tween frame
  let label_blocks: TreemapLabelBlock[][] = $derived(
    label_lines.map((candidates, idx) => {
      const header = is_header(chart_state.arcs[idx])
      const font = header ? header_font : chart_state.label_font
      const font_size = header ? header_font_size : leaf_font_size
      return candidates.map((lines) => measure_treemap_label_block(lines, font_size, font))
    }),
  )

  // Label placement for a cell, null = hidden. Branch cells label their header strip;
  // leaves (and branches at the depth cutoff) center it, rotating 90° in thin tall cells.
  function place_label(idx: number): TreemapLabelPlacement | null {
    const header = is_header(chart_state.arcs[idx])
    for (const block of label_blocks[idx]) {
      const placement = place_treemap_label({
        rect: rects[idx],
        block,
        header,
        fit: label_fit,
        min_font_size: label_min_font_size,
        header_height,
        margin: LABEL_MARGIN,
      })
      if (placement) return placement
    }
    return null
  }

  // hide mode never overflows, so clipPaths are only needed for shrink/clip
  let clip_labels = $derived(label_fit !== `hide`)
  const label_clip_id = (idx: number) => `treemap-label-clip-${uid}-${idx}`
  const label_clip_rect = (rect: Rect, header: boolean): Rect => {
    const inset = 1
    const clip_height = header ? Math.min(rect.height, header_height) : rect.height
    return {
      x: rect.x + inset,
      y: rect.y + inset,
      width: Math.max(0, rect.width - 2 * inset),
      height: Math.max(0, clip_height - 2 * inset),
    }
  }
  // Defs and visible text share these placements to avoid duplicate fitting per frame
  let label_placements = $derived(new Map(visible_idxs.map((idx) => [idx, place_label(idx)])))

  // The chrome floats over the cells, so its icons take the color of the top-most cell
  // (parents paint first, so the last hit) under the top-right corner. Probes the settled
  // tiling, visibility included: tweened rects re-ran this ~24x per zoom and flickered the
  // icons (a cell still collapsed in the tween's start frame was skipped).
  let chrome_color = $derived.by(() => {
    const probe = { x: chart_state.inner_width - 1, y: 1 }
    let label_fill: string | undefined
    for (const [idx, arc] of chart_state.arcs.entries()) {
      const rect = target_rects[idx]
      if (
        rect &&
        cell_visible(arc, rect) &&
        probe.x >= rect.x &&
        probe.x <= rect.x + rect.width &&
        probe.y >= rect.y &&
        probe.y <= rect.y + rect.height
      )
        label_fill = chart_state.node_infos[idx]?.label_fill
    }
    // label_fill already accounts for pattern backdrops and translucent fills
    return label_fill === `currentColor` ? undefined : label_fill
  })
</script>

<ChartShell
  empty={Array.isArray(data) && !data.length}
  chart_class="treemap"
  css_prefix="treemap"
  {chrome_color}
  css_var_fallbacks={{ flex: `1 1 auto`, bg: `transparent` }}
  bind:wrapper={chart_state.wrapper}
  bind:width
  bind:height
  bind:fullscreen
  export_sources={chart_state.export_sources}
  {...rest}
>
  {#snippet controls(toggle_props, show_controls)}
    <TreemapControls
      chart="treemap"
      {toggle_props}
      pane_props={controls_pane_props}
      {show_controls}
      bind:controls_open
      bind:value_mode
      bind:max_depth
      bind:padding_inner
      bind:padding_top
      bind:padding_outer
      bind:min_fraction
      bind:max_children
      bind:show_labels
      bind:label_text
      bind:zoom_on_click
      bind:show_breadcrumbs
    >
      {@render controls_extra?.({ zoom_root_id })}
    </TreemapControls>
  {/snippet}

  {#snippet body()}
    <HierarchyShell
      {chart_state}
      aria_label={rest[`aria-label`] ?? `Treemap chart`}
      chart_transform={`translate(${chart_state.plot_left}, ${chart_state.pad.t})`}
      {show_breadcrumbs}
      dblclick_target="svg"
      {tooltip}
    >
      {#snippet extra_defs()}
        {#if show_labels && !cell_content && clip_labels}
          {#each visible_idxs as idx (idx)}
            {@const label = label_placements.get(idx)}
            {#if label}
              <clipPath id={label_clip_id(idx)}>
                <rect {...label_clip_rect(rects[idx], label.header)} />
              </clipPath>
            {/if}
          {/each}
        {/if}
      {/snippet}

      {#snippet marks()}
        <!-- Cells: pre-order document order paints parents first, children on top -->
        <g class="cells">
          {#each visible_idxs as idx (idx)}
            {@const rect = rects[idx]}
            {#if cell_content}
              {@render cell_content({ arc: chart_state.arcs[idx], rect })}
            {:else}
              {@const info = chart_state.node_infos[idx]}
              {@const opacity = chart_state.node_dim(idx).opacity}
              <!-- a per-node boolean: a moved tab stop re-runs two nodes' attributes, not all -->
              {@const tab_stop = idx === roving_idx}
              <!-- svelte-ignore a11y_no_static_element_interactions, a11y_no_noninteractive_tabindex -->
              <rect
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                data-treemap-node-idx={idx}
                fill={info.pattern?.url ?? info.fill}
                fill-opacity={opacity}
                role={cells_clickable ? `button` : undefined}
                tabindex={tab_stop ? 0 : -1}
                aria-label={info.aria}
                style:cursor={cells_clickable ? `pointer` : `default`}
              />
            {/if}
          {/each}
        </g>

        {#if hover_veil && !cell_content}
          <path
            class="hover-veil"
            d={hover_veil}
            fill="var(--page-bg, white)"
            opacity="0.7"
            pointer-events="none"
          />
        {/if}

        <!-- Selectable cell labels; data-treemap-node-idx forwards hover/click to the cell -->
        {#if show_labels && !cell_content}
          <g>
            {#each visible_idxs as idx (idx)}
              {@const lbl = label_placements.get(idx)}
              {#if lbl}
                <!-- Clip this untransformed wrapper: clipping rotated text rotates the clip -->
                {@const { label_fill, label_halo } = chart_state.node_infos[idx]}
                {@const label_opacity = chart_state.node_dim(idx).label_opacity}
                {#snippet label_lines(halo: boolean)}
                  {#each lbl.lines as line}
                    <tspan
                      class={line.class}
                      x={lbl.x}
                      y={line.y}
                      font-size={lbl.font_size * line.font_scale}
                      font-weight={line.font_weight}
                      opacity={line.opacity}
                      fill={halo ? undefined : line.fill}
                    >
                      {line.text}
                    </tspan>
                  {/each}
                {/snippet}
                <g clip-path={clip_labels ? `url(#${label_clip_id(idx)})` : undefined}>
                  {#if label_halo}
                    <!-- Blurred halo for legibility over patterns (style: may be a CSS var) -->
                    <text
                      class={['cell-label', 'halo', { header: lbl.header }]}
                      aria-hidden="true"
                      x={lbl.x}
                      y={lbl.lines[0].y}
                      dominant-baseline="central"
                      transform={lbl.transform}
                      font-size={lbl.font_size}
                      style="fill: {label_halo}; stroke: {label_halo}"
                      style:opacity={label_opacity}
                    >
                      {@render label_lines(true)}
                    </text>
                  {/if}
                  <text
                    class={['cell-label', { header: lbl.header }]}
                    data-treemap-node-idx={idx}
                    x={lbl.x}
                    y={lbl.lines[0].y}
                    dominant-baseline="central"
                    transform={lbl.transform}
                    fill={label_fill}
                    fill-opacity={label_opacity}
                    font-size={lbl.font_size}
                    style:cursor={cells_clickable ? `pointer` : `text`}
                  >
                    {@render label_lines(false)}
                  </text>
                </g>
              {/if}
            {/each}
          </g>
        {/if}
      {/snippet}
    </HierarchyShell>
  {/snippet}
</ChartShell>

<style>
  /* fully :global: wrapper, breadcrumbs and svg belong to ChartShell/HierarchyShell.
  plotly-pathbar look: overlapping chevron segments. Opaque background since a
  translucent one would be illegible over dark cells */
  :global(.treemap .breadcrumb) {
    background: var(--treemap-btn-bg, light-dark(#e3e6ea, #33383f));
    color: inherit;
    border: none;
    padding: var(--treemap-breadcrumbs-padding, 0 14px 0 12px);
    cursor: pointer;
    font: inherit;
    clip-path: polygon(
      0 0,
      calc(100% - 7px) 0,
      100% 50%,
      calc(100% - 7px) 100%,
      0 100%,
      7px 50%
    );
  }
  :global(.treemap .breadcrumb:first-child) {
    border-radius: 3pt 0 0 3pt;
    padding-inline-start: 8px;
    clip-path: polygon(0 0, calc(100% - 7px) 0, 100% 50%, calc(100% - 7px) 100%, 0 100%);
  }
  :global(.treemap .breadcrumb:hover:not(:disabled)) {
    background: var(--treemap-btn-hover-bg, light-dark(#d0d5db, #454b54));
  }
  /* inset focus ring: native outlines get clipped by the chevron clip-path and
  hidden under the next overlapped segment */
  :global(.treemap .breadcrumb:focus-visible) {
    position: relative;
    z-index: 1;
    outline: none;
    box-shadow: inset 0 0 0 2px var(--accent-color, Highlight);
  }
  :global(.treemap .breadcrumbs) {
    position: absolute;
    top: var(--treemap-breadcrumbs-top, 5pt);
    left: var(--treemap-breadcrumbs-left, 8px);
    z-index: 9;
    display: flex;
    align-items: stretch;
    flex-wrap: wrap;
    max-width: 75%;
    font-size: var(--treemap-breadcrumbs-font-size, 0.85em);
  }
  /* negative gap: each chevron tip tucks into the next segment's left notch */
  :global(.treemap .breadcrumb + .breadcrumb) {
    margin-left: -6px;
  }
  :global(.treemap .breadcrumb:disabled) {
    cursor: default;
    font-weight: bold;
  }
  :global(.treemap svg[role='application']) {
    width: var(--treemap-svg-width, 100%);
    height: var(--treemap-svg-height, 100%);
    flex: var(--treemap-svg-flex, 1);
    overflow: var(--treemap-svg-overflow, visible);
    fill: var(--text-color);
    font-size: var(--treemap-font-size, 11px);
  }
  .cells rect {
    /* stroke via CSS: var() in SVG presentation attributes is unreliable. Without
    dividers same-color siblings blend (gaps show the parent's identical fill). Not
    --plot-bg, which is often semi-transparent and near-invisible as a line */
    stroke: var(--treemap-cell-stroke, light-dark(white, #16181d));
    stroke-width: var(--treemap-cell-stroke-width, 1);
    transition: fill-opacity 0.15s ease;
  }
  .cells rect:hover {
    filter: brightness(var(--treemap-hover-brightness, 1.08));
  }
  .cell-label {
    text-anchor: middle;
    /* selectable so labels can be copied; clicks reach the cell via data-treemap-node-idx */
    -webkit-user-select: text;
    user-select: text;
  }
  /* WebKit doesn't inherit dominant-baseline from <text> to <tspan> */
  .cell-label tspan {
    dominant-baseline: inherit;
  }
  .cell-label.header {
    text-anchor: start;
    font-weight: 600;
  }
  .cell-label.halo {
    /* slightly see-through so the texture still reads as continuing under the label */
    opacity: 0.9;
    filter: blur(var(--treemap-label-halo-blur, 1px));
    stroke-width: 0.4em;
    stroke-linejoin: round;
    pointer-events: none;
    -webkit-user-select: none;
    user-select: none;
  }
</style>
