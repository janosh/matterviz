<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import type { BasePlotProps } from '$lib/plot'
  import { TreemapControls } from '$lib/plot'
  import ChartShell from '$lib/plot/core/components/ChartShell.svelte'
  import HierarchyShell from '$lib/plot/core/components/HierarchyShell.svelte'
  import type { Rect, Sides } from '$lib/plot/core/layout'
  import { create_settling_tween } from '$lib/plot/core/settling-tween.svelte'
  import { SCALE_DEFAULTS } from '$lib/plot/core/types'
  import type { HierarchyChartProps } from '$lib/plot/core/utils/hierarchy-state.svelte'
  import {
    HierarchyChartState,
    hierarchy_layout_options,
  } from '$lib/plot/core/utils/hierarchy-state.svelte'
  import type { PositionedArc } from '$lib/plot/core/utils/hierarchy-layout'
  import {
    measure_treemap_label_block,
    normalize_treemap_label_lines,
    place_treemap_label,
    safe_font_size,
  } from '$lib/plot/treemap/labels'
  import type {
    TreemapLabelBlock,
    TreemapLabelFit,
    TreemapLabelFormatter,
    TreemapLabelPlacement,
  } from '$lib/plot/treemap/labels'
  import type { Tiling } from '$lib/plot/treemap/treemap'
  import {
    align_tiling,
    header_strip,
    lerp_rects,
    tile_rects,
  } from '$lib/plot/treemap/treemap'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { cubicInOut } from 'svelte/easing'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { TweenOptions } from 'svelte/motion'

  // no outer inset by default: cells tile flush with the container (pass
  // `padding` to reserve chart-edge space, e.g. for host-drawn annotations)
  const DEFAULT_PADDING: Required<Sides> = { t: 0, b: 0, l: 0, r: 0 }
  const LABEL_MARGIN = 6 // px clearance between label text and cell edges

  let {
    data = $bindable([]),
    value_mode = $bindable(DEFAULTS.treemap.value_mode),
    // descending (unlike Sunburst's input-order default): squarified tiling
    // reads best with the largest cell top-left and smallest bottom-right
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
    color_range,
    color_bar = {},
    color_bar_side = `right`,
    export_buttons = true,
    export_filename = `treemap`,
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
    Omit<BasePlotProps, `range_padding` | `title`> &
    // data/value semantics, coloring, legend, export and node handlers are
    // shared verbatim with Sunburst
    HierarchyChartProps<Metadata> & {
      padding_inner?: number // px gap between sibling cells
      padding_top?: number // px header strip on branch cells (0 = no headers)
      padding_outer?: number // px inset of children within their parent (plotly marker.pad)
      // Structured multiline labels. Unlike cell_content, this keeps built-in
      // hover/focus/click and tooltip behavior on the underlying cell.
      label_formatter?: TreemapLabelFormatter<Metadata>
      label_fit?: TreemapLabelFit // shrink-to-fit (default), hide, or clip at max size
      label_min_font_size?: number // px floor used by shrink mode
      label_max_font_size?: number // px ceiling for leaf/cutoff labels
      parent_label_font_size?: number // px size/ceiling for branch header labels
      // Zoom transition timing (resizes/data swaps snap instantly, plotly-style).
      // interpolate is not overridable: the component's rect interpolator also
      // handles rect-array length changes on data swaps (default would throw)
      // `interpolate` and `duration`-as-function are the component's own: the tweened
      // value is a tiling (rects keyed by their arcs), not a bare rect list
      tween?: Omit<TweenOptions<Rect[]>, `interpolate` | `duration`> & { duration?: number }
      // Fully replace the default cell rect + labels. NOTE: this also replaces the
      // built-in hover/focus/click + tooltip wiring, so re-implement any
      // interactivity you need inside the snippet.
      cell_content?: Snippet<[{ arc: PositionedArc<Metadata>; rect: Rect }]>
    } = $props()

  let [width, height] = $state([0, 0])
  const uid = $props.id()

  // Tree semantics (values, colors, ids, pre-order indexing), zoom/hover/legend
  // state and keyboard plumbing are shared with Sunburst; only the pixel tiling
  // below is treemap-specific.
  // annotated because the geometry hooks below close over `chart_state` itself
  const chart_state: HierarchyChartState<Metadata> = new HierarchyChartState<Metadata>({
    chart: `treemap`,
    uid,
    default_padding: DEFAULT_PADDING,
    data: () => data,
    layout_options: () =>
      hierarchy_layout_options({
        value_mode,
        sort,
        level_lighten,
        min_fraction,
        max_children,
        zoom_root_id,
        expanded_parents: chart_state.expanded_parents,
        other_label,
      }),
    label_text: () => label_text,
    value_format: () => value_format,
    width: () => width,
    height: () => height,
    padding: () => padding,
    color_values: () => color_values,
    color_scale: () => color_scale,
    color_range: () => color_range,
    color_bar: () => color_bar,
    color_bar_side: () => color_bar_side,
    legend: () => legend,
    show_legend: () => show_legend,
    zoom_on_click: () => zoom_on_click,
    export_filename: () => export_filename,
    zoom_root_id: () => zoom_root_id,
    set_zoom_root_id: (value) => (zoom_root_id = value),
    set_hovered: (value) => (hovered = value),
    fullscreen: () => fullscreen,
    set_fullscreen: (value) => (fullscreen = value),
    on_node_click: (payload) => on_node_click?.(payload),
    on_node_hover: (payload) => on_node_hover?.(payload),
    on_zoom: (payload) => on_zoom?.(payload),
    per_node_hover_dim: true,
    visible: (idx) => idx_visible(idx),
    node_center: (idx) => (rects[idx] ? rect_center(rects[idx]) : null),
    // Place against the settled (target) tiling, not the animated one - placement
    // is stable during zoom tweens. Same visibility rule as rendering so hidden
    // cells (zoom root, beyond max_depth) don't repel the legend.
    legend_points: () =>
      chart_state.arcs.flatMap((arc, idx) =>
        cell_visible(arc, target_rects[idx]) ? [rect_center(target_rects[idx])] : [],
      ),
    // Zooming via keyboard unmounts the focused cell - move focus to the new
    // root's first child (pre-order: node_idx + 1), or the root cell itself for
    // leaf zooms (rendered full-viewport), so keyboard users stay in the chart
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

  // Re-tile the zoom root's subtree to the full plot area (plotly behavior:
  // squarified aspect ratios stay correct at every zoom level, unlike projecting
  // one fixed tiling through a window, which would distort cells and scale the
  // fixed-px header strips). Zoom animation interpolates between tilings.
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
  // The rects travel with the arcs they were computed from: a zoom can change the arc
  // set (bucketing measures its threshold against the zoom root), and the two tilings
  // then have to be matched by id rather than by position.
  let tiling = $derived<Tiling>({ rects: target_rects, arcs: chart_state.arcs })
  // Animate only zoom transitions; resizes, data swaps and padding tweaks snap
  // instantly (animating a container drag-resize would chase the pointer with a
  // 400ms lerp on every width change, and morphing between unrelated datasets
  // is meaningless). Keyed on the zoom root's id, not its node_idx, which shifts
  // whenever bucketing changes the arc set without the view having moved.
  // untrack reads the options once at init.
  let prev_zoom_id = untrack(() => chart_state.zoom_root?.id ?? null)
  let prev_data = untrack(() => data)
  const rects_tween = create_settling_tween<Tiling>(
    () => tiling,
    untrack(() => ({
      duration: 400,
      easing: cubicInOut,
      ...tween,
      interpolate: (from: Tiling, to: Tiling) => {
        // Realigned once per transition, not per frame
        const start = align_tiling(from, to)
        return (t: number) => ({ rects: lerp_rects(start, to.rects, t), arcs: to.arcs })
      },
    })),
    {
      live: () =>
        (chart_state.zoom_root?.id ?? null) !== prev_zoom_id && data === prev_data
          ? undefined
          : { duration: 0 },
    },
  )
  // Bookkeeping lives outside `live`, which the tween skips while the plot is still settling:
  // a zoom inside that window would otherwise leave prev_* stale and snap the next zoom back.
  // Created after the tween so it runs after `live` has read the previous values.
  $effect.pre(() => {
    ;[prev_zoom_id, prev_data] = [chart_state.zoom_root?.id ?? null, data]
  })
  let rects = $derived(rects_tween.current.rects)

  // Deepest level rendered below the current zoom root (0 = unlimited)
  let depth_cutoff = $derived(
    max_depth > 0 ? (chart_state.zoom_root?.depth ?? 0) + max_depth : Infinity,
  )
  // Shared by rendering and legend placement. The zoom root fills the viewport
  // and is represented by the breadcrumbs, not a cell — except when it's a leaf
  // (e.g. programmatic zoom_root_id onto a compound), which renders as one full-
  // viewport cell instead of a blank chart. Nodes outside the zoomed subtree
  // hold zero rects from tile_rects.
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
  // Indices (= keys) of cells to render. A plain number array: arcs/rects/
  // node_infos/node_dim are all index-aligned, so rendering reads them by idx
  // instead of rebuilding N wrapper objects per tween frame.
  let visible_idxs = $derived.by(() => {
    const idxs: number[] = []
    for (let idx = 0; idx < chart_state.arcs.length; idx++) {
      if (idx_visible(idx)) idxs.push(idx)
    }
    return idxs
  })

  // Every visible cell is focusable, not just the clickable ones, so arrow keys reach
  // tooltips and a zoom into plain leaves can't strand focus outside the chart.
  let roving_idx = $derived(chart_state.roving_idx(visible_idxs[0] ?? null))

  // Rect center in container (pad-offset) pixel space, for tooltip + legend placement
  const rect_center = (rect: Rect): { x: number; y: number } => ({
    x: chart_state.plot_left + rect.x + rect.width / 2,
    y: chart_state.pad.t + rect.y + rect.height / 2,
  })

  // Uniform now that any cell zooms (plotly semantics), not just branches
  let cells_clickable = $derived(Boolean(on_node_click) || zoom_on_click)

  // Branches with visible children only ever label their header strip: a centered
  // label would paint over the descendant cells that cover the rest of the cell
  const is_header = (arc: PositionedArc<Metadata>): boolean =>
    !arc.is_leaf && arc.depth < depth_cutoff
  // Header labels render bold (600) and at their own size ceiling
  let header_font = $derived({ ...chart_state.label_font, font_weight: `600` })
  let header_font_size = $derived(safe_font_size(parent_label_font_size, 14))
  let leaf_font_size = $derived(
    safe_font_size(label_max_font_size ?? chart_state.label_font.font_size, 11),
  )

  // Per-node label candidates, richest first. Without a formatter, shrink/clip fit
  // the richest built-in variant, while hide mode falls back through the compact
  // variants before dropping the label. Formatter output is font- and layout-
  // independent, so it resolves once per data/option change. The depth-0 root
  // never renders a cell, so the formatter is never invoked for it (for array
  // data it's synthetic and e.g. carries no metadata).
  let label_lines = $derived(
    chart_state.arcs.map((arc, idx) => {
      if (arc.depth === 0) return []
      if (label_formatter) return [normalize_treemap_label_lines(label_formatter(arc))]
      const { variants } = chart_state.node_infos[idx]
      if (label_fit === `hide`) return variants.map(({ text }) => [{ text }])
      return [normalize_treemap_label_lines(variants[0]?.text)]
    }),
  )
  // Measured at their maximum size once per font/zoom change rather than per
  // frame of a zoom tween; placement below is arithmetic on these metrics
  let label_blocks: TreemapLabelBlock[][] = $derived(
    label_lines.map((candidates, idx) => {
      const header = is_header(chart_state.arcs[idx])
      const font = header ? header_font : chart_state.label_font
      const font_size = header ? header_font_size : leaf_font_size
      return candidates.map((lines) => measure_treemap_label_block(lines, font_size, font))
    }),
  )

  // Label text + placement for a cell; null means hide the label. Branch cells
  // label their header strip (top-left); leaves (and branches at the depth
  // cutoff, which render as plain cells) center their label, rotating 90° in
  // thin-but-tall cells like the icicle shape does.
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

  // hide mode never overflows (unfitting labels return null), so clipPaths are
  // only rendered/applied for the shrink/clip modes (with or without formatter)
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
  // Defs and visible text share these placements, avoiding duplicate fitting
  // work on every frame of a zoom tween.
  let label_placements = $derived(new Map(visible_idxs.map((idx) => [idx, place_label(idx)])))

  // The chrome floats over the cells, so its icons take their color from whatever is
  // painted under the top-right corner rather than from the page. Cells are drawn
  // parents-first, so the last visible one containing the point is the one on top.
  // Probes the settled tiling, like legend_points: the tweened rects re-ran this ~24x per zoom
  // and flickered the icons through every cell sweeping the corner.
  let chrome_color = $derived.by(() => {
    const probe = { x: chart_state.inner_width - 1, y: 1 }
    let label_fill: string | undefined
    for (const idx of visible_idxs) {
      const rect = target_rects[idx]
      if (
        rect &&
        probe.x >= rect.x &&
        probe.x <= rect.x + rect.width &&
        probe.y >= rect.y &&
        probe.y <= rect.y + rect.height
      )
        label_fill = chart_state.node_infos[idx]?.label_fill
    }
    // label_fill already accounts for a pattern's backdrop (transparent in `replace` mode)
    // and for translucent fills, where inheriting is the only honest answer
    return label_fill === `currentColor` ? undefined : label_fill
  })
</script>

<ChartShell
  chart_class="treemap"
  css_prefix="treemap"
  {chrome_color}
  css_var_fallbacks={{ flex: `1 1 auto`, bg: `transparent` }}
  bind:wrapper={chart_state.wrapper}
  bind:width
  bind:height
  bind:fullscreen
  {fullscreen_toggle}
  {controls_toggle_props}
  {header_controls}
  {children}
  {...rest}
>
  {#snippet controls(toggle_props)}
    <TreemapControls
      chart="treemap"
      {toggle_props}
      pane_props={controls_pane_props}
      bind:show_controls
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
      {export_buttons}
      on_export={chart_state.export_chart}
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
                tabindex={idx === roving_idx ? 0 : -1}
                aria-label={info.aria}
                style:cursor={cells_clickable ? `pointer` : `default`}
              />
            {/if}
          {/each}
        </g>

        <!-- Cell labels: selectable text; data-treemap-node-idx forwards hover/click
      to the underlying cell via the chart-group delegation in the shell -->
        {#if show_labels && !cell_content}
          <g>
            {#each visible_idxs as idx (idx)}
              {@const lbl = label_placements.get(idx)}
              {#if lbl}
                <!-- Keep the clip on this untransformed wrapper. Applying it to
              rotated text rotates the clipping region and crops the wrong area. -->
                {@const { label_fill, label_halo } = chart_state.node_infos[idx]}
                {@const label_opacity = chart_state.node_dim(idx).label_opacity}
                {#snippet label_lines(halo: boolean)}
                  {#each lbl.lines as line}
                    <tspan
                      class={line.class}
                      x={lbl.x}
                      y={line.y}
                      font-size={lbl.font_size * (line.font_scale ?? 1)}
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
                    <!-- Blurred halo in the tile backdrop color so the label stays legible
                    over hatch/dot strokes; style not attributes since it may be a CSS var -->
                    <text
                      class={['cell-label', 'halo', { header: lbl.header }]}
                      aria-hidden="true"
                      x={lbl.x}
                      y={lbl.lines[0].y}
                      dominant-baseline={lbl.dominant_baseline}
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
                    dominant-baseline={lbl.dominant_baseline}
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
  /* fully :global: the wrapper is ChartShell's element and breadcrumbs and chart svg
  are HierarchyShell's, so none carry this component's scope - but their theming stays
  in the chart's variable namespace.
  plotly-pathbar look: right-pointing chevron segments with a matching left
  notch on all but the first, slightly overlapped so they read as one bar.
  Opaque background: the pathbar overlays arbitrarily-colored cells, and a
  translucent one would be illegible over dark fills */
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
    /* stroke via CSS (not presentation attributes): var() substitution in SVG
    presentation attributes is not reliably supported across browsers.
    Dividers matter more here than in the sunburst: sibling gaps show the
    parent's fill (parents paint under their children), which is identical to
    the children's inherited color - without a stroke, same-color siblings
    blend into one shape. Not defaulted to --plot-bg because that is often
    semi-transparent (near-invisible as a line); light-dark keeps dividers
    paper-colored in both themes, like plotly */
    stroke: var(--treemap-cell-stroke, light-dark(white, #16181d));
    stroke-width: var(--treemap-cell-stroke-width, 1);
    transition: fill-opacity 0.15s ease;
  }
  .cells rect:hover {
    filter: brightness(var(--treemap-hover-brightness, 1.08));
  }
  .cell-label {
    text-anchor: middle;
    /* selectable so labels can be copied; clicks/hover still reach the underlying
    cell via data-treemap-node-idx + delegation on the chart group */
    -webkit-user-select: text;
    user-select: text;
  }
  /* WebKit doesn't inherit dominant-baseline from <text> to <tspan>, so lines
  would sit on the alphabetic baseline and crop at the top of the clip strip */
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
