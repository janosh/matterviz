<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import type { BasePlotProps } from '$lib/plot'
  import { TreemapControls } from '$lib/plot'
  import HierarchyShell from '$lib/plot/core/components/HierarchyShell.svelte'
  import type { Rect, Sides } from '$lib/plot/core/layout'
  import { SCALE_DEFAULTS } from '$lib/plot/core/types'
  import {
    HierarchyChartState,
    type HierarchyChartProps,
  } from '$lib/plot/core/utils/hierarchy-state.svelte'
  import type { PositionedArc } from '$lib/plot/sunburst/sunburst'
  import {
    normalize_treemap_label_lines,
    place_treemap_label,
    safe_font_size,
  } from '$lib/plot/treemap/labels'
  import type {
    TreemapLabelFit,
    TreemapLabelFormatter,
    TreemapLabelLine,
    TreemapLabelPlacement,
  } from '$lib/plot/treemap/labels'
  import { lerp_rects, tile_rects } from '$lib/plot/treemap/treemap'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { cubicInOut } from 'svelte/easing'
  import type { HTMLAttributes } from 'svelte/elements'
  import { Tween, type TweenOptions } from 'svelte/motion'

  // no outer inset by default: cells tile flush with the container (pass
  // `padding` to reserve chart-edge space, e.g. for host-drawn annotations)
  const DEFAULT_PADDING: Required<Sides> = { t: 0, b: 0, l: 0, r: 0 }

  let {
    data = $bindable([]),
    value_mode = $bindable(DEFAULTS.treemap.value_mode),
    // descending (unlike Sunburst's input-order default): squarified tiling
    // reads best with the largest cell top-left and smallest bottom-right
    sort = `descending`,
    level_lighten = 0,
    min_fraction = $bindable(DEFAULTS.treemap.min_fraction),
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
    change = () => {},
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
    Omit<BasePlotProps, `change` | `range_padding` | `title`> &
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
      tween?: Omit<TweenOptions<Rect[]>, `interpolate`>
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
    layout_options: () => ({ value_mode, sort, level_lighten, min_fraction, other_label }),
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
    change: (info) => change(info),
    on_node_click: (payload) => on_node_click?.(payload),
    on_node_hover: (payload) => on_node_hover?.(payload),
    on_zoom: (payload) => on_zoom?.(payload),
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
  let target_rects = $derived(
    tile_rects(
      chart_state.arcs,
      chart_state.zoom_root?.node_idx ?? 0,
      { width: chart_state.inner_width, height: chart_state.inner_height },
      { padding_inner, padding_top, padding_outer },
    ),
  )
  // Seeded at the current target (charts load fully drawn); untrack reads the
  // tween options once at init (not meant to be reactive). The rect interpolator
  // is applied after the user's options: Svelte's default interpolator throws
  // when the rect-array length changes (data swaps), so it must not be overridable.
  const rects_tween = new Tween<Rect[]>(
    untrack(() => target_rects),
    untrack(() => ({
      duration: 400,
      easing: cubicInOut,
      ...tween,
      interpolate: (from: Rect[], to: Rect[]) => (t: number) => lerp_rects(from, to, t),
    })),
  )
  // Animate only zoom transitions; resizes, data swaps and padding tweaks snap
  // instantly (animating a container drag-resize would chase the pointer with a
  // 400ms lerp on every width change, and morphing between unrelated datasets
  // is meaningless)
  let prev_zoom_idx = untrack(() => chart_state.zoom_root?.node_idx ?? 0)
  let prev_arcs = untrack(() => chart_state.arcs)
  $effect(() => {
    const zoom_idx = chart_state.zoom_root?.node_idx ?? 0
    const [target, arcs] = [target_rects, chart_state.arcs]
    const zoom_changed = zoom_idx !== prev_zoom_idx && arcs === prev_arcs
    ;[prev_zoom_idx, prev_arcs] = [zoom_idx, arcs]
    rects_tween.set(target, zoom_changed ? undefined : { duration: 0 })
  })
  let rects = $derived(rects_tween.current)

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
    (arc.node_idx !== chart_state.zoom_root?.node_idx || arc.is_leaf) &&
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

  // Roving tabindex: exactly one cell is in the tab order (the last-focused one,
  // else the first visible cell); arrow keys move focus between cells. Every
  // visible cell is focusable (not just clickable ones) so keyboard users can
  // reach tooltips, and so zooming into a branch of plain leaves doesn't strand
  // focus outside the chart. role="button" stays limited to clickable cells.
  let roving_idx = $derived(
    chart_state.focused_idx != null && idx_visible(chart_state.focused_idx)
      ? chart_state.focused_idx
      : (visible_idxs[0] ?? null),
  )

  // Rect center in container (pad-offset) pixel space, for tooltip + legend placement
  const rect_center = (rect: Rect): { x: number; y: number } => ({
    x: chart_state.plot_left + rect.x + rect.width / 2,
    y: chart_state.pad.t + rect.y + rect.height / 2,
  })

  // Uniform now that any cell zooms (plotly semantics), not just branches
  let cells_clickable = $derived(Boolean(on_node_click) || zoom_on_click)

  // leading "<n>px" of the CSS font shorthand (e.g. "11px sans-serif")
  let label_font_size = $derived.by(() => {
    const leading_num = Number(chart_state.label_font.match(/^[\d.]+/)?.[0])
    return safe_font_size(leading_num, 11)
  })
  let resolved_parent_label_font_size = $derived(safe_font_size(parent_label_font_size, 14))

  const LABEL_MARGIN = 6 // px clearance between label text and cell edges
  const label_clip_id = (idx: number) => `treemap-label-clip-${uid}-${idx}`
  const font_for_line = (line: TreemapLabelLine, font_size: number): string => {
    const sized_font = chart_state.label_font.replace(
      /(?:\d+(?:\.\d+)?|\.\d+)px/,
      `${font_size}px`,
    )
    return line.font_weight == null ? sized_font : `${line.font_weight} ${sized_font}`
  }
  const measure_label_line = (line: TreemapLabelLine, font_size: number): number => {
    const measured_width = chart_state.text_width(line.text, font_for_line(line, font_size))
    // Canvas text metrics can be unavailable during SSR and in lightweight DOM
    // environments. A conservative fallback keeps fitting deterministic there.
    return measured_width > 0 ? measured_width : line.text.length * font_size * 0.6
  }

  // Formatter output is layout-independent, so resolve it once per node instead
  // of on every frame of a zoom tween. Without a formatter, fit modes use the
  // richest built-in variant (compound text when configured).
  // The depth-0 root never renders a cell, so the formatter is never invoked
  // for it (for array data it's synthetic and e.g. carries no metadata).
  let label_lines = $derived(
    chart_state.arcs.map((arc, idx) =>
      arc.depth === 0
        ? []
        : normalize_treemap_label_lines(
            label_formatter
              ? label_formatter(arc)
              : chart_state.node_infos[idx].variants[0]?.text,
          ),
    ),
  )

  // Label text + placement for a cell; null means hide the label.
  // Branch cells label their header strip (top-left); leaves (and branches at the
  // depth cutoff, which render as plain cells) center their label, rotating 90°
  // in thin-but-tall cells like the icicle shape does.
  function place_label(
    arc: PositionedArc<Metadata>,
    rect: Rect,
  ): TreemapLabelPlacement | null {
    // Branches with visible children only ever label their header strip: a
    // centered label would paint over the descendant cells that cover the rest
    // of the cell, so when the strip is missing/too thin the label is dropped
    const has_visible_children = !arc.is_leaf && arc.depth < depth_cutoff

    const place = (lines: TreemapLabelLine[]) =>
      place_treemap_label({
        rect,
        lines,
        header: has_visible_children,
        fit: label_fit,
        min_font_size: label_min_font_size,
        max_font_size: has_visible_children
          ? resolved_parent_label_font_size
          : (label_max_font_size ?? label_font_size),
        padding_top,
        margin: LABEL_MARGIN,
        measure_line: (line, font_size) =>
          measure_label_line(
            has_visible_children && line.font_weight == null
              ? { ...line, font_weight: 600 }
              : line,
            font_size,
          ),
      })

    if (!label_formatter && label_fit === `hide`) {
      for (const { text } of chart_state.node_infos[arc.node_idx].variants) {
        const placement = place([{ text }])
        if (placement) return placement
      }
      return null
    }
    return place(label_lines[arc.node_idx])
  }

  // hide mode never overflows (unfitting labels return null), so clipPaths are
  // only rendered/applied for the shrink/clip modes (with or without formatter)
  let clip_labels = $derived(label_fit !== `hide`)
  const label_clip_rect = (rect: Rect, header: boolean): Rect => {
    const inset = 1
    const clip_height = header ? Math.min(rect.height, padding_top) : rect.height
    return {
      x: rect.x + inset,
      y: rect.y + inset,
      width: Math.max(0, rect.width - 2 * inset),
      height: Math.max(0, clip_height - 2 * inset),
    }
  }
  // Defs and visible text share these placements, avoiding duplicate text
  // measurement and fitting work on every frame of a zoom tween.
  let label_placements = $derived(
    new Map(visible_idxs.map((idx) => [idx, place_label(chart_state.arcs[idx], rects[idx])])),
  )
</script>

<div
  bind:this={chart_state.wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  {...rest}
  class={[`treemap`, rest.class, { fullscreen }]}
>
  <HierarchyShell
    {chart_state}
    aria_label={rest[`aria-label`] ?? `Treemap chart`}
    chart_transform={`translate(${chart_state.plot_left}, ${chart_state.pad.t})`}
    {show_breadcrumbs}
    dblclick_target="svg"
    {fullscreen_toggle}
    {header_controls}
    {tooltip}
    {children}
  >
    {#snippet controls()}
      <TreemapControls
        chart="treemap"
        toggle_props={{
          ...controls_toggle_props,
          // join the header flex row instead of absolute positioning
          style: `position: static; ${controls_toggle_props?.style ?? ``}`,
        }}
        pane_props={controls_pane_props}
        bind:show_controls
        bind:controls_open
        bind:value_mode
        bind:max_depth
        bind:padding_inner
        bind:padding_top
        bind:padding_outer
        bind:min_fraction
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

    {#snippet body()}
      <!-- Cells: pre-order document order paints parents first, children on top -->
      <g class="cells">
        {#each visible_idxs as idx (idx)}
          {@const rect = rects[idx]}
          {#if cell_content}
            {@render cell_content({ arc: chart_state.arcs[idx], rect })}
          {:else}
            {@const info = chart_state.node_infos[idx]}
            {@const opacity = chart_state.node_dim[idx].opacity}
            <!-- svelte-ignore a11y_no_static_element_interactions, a11y_no_noninteractive_tabindex -->
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              data-treemap-node-idx={idx}
              fill={info.fill}
              fill-opacity={opacity}
              role={cells_clickable ? `button` : undefined}
              tabindex={idx === roving_idx ? 0 : -1}
              aria-label={info.aria}
              style:cursor={cells_clickable ? `pointer` : `default`}
            />
            {#if chart_state.arcs[idx].hatch}
              <!-- Decorative texture overlay; ignores pointer events -->
              <rect
                class="cell-hatch"
                aria-hidden="true"
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                fill="url(#{chart_state.hatch_pattern_id})"
                fill-opacity={opacity}
              />
            {/if}
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
              <g clip-path={clip_labels ? `url(#${label_clip_id(idx)})` : undefined}>
                <text
                  class={['cell-label', { header: lbl.header }]}
                  data-treemap-node-idx={idx}
                  x={lbl.x}
                  y={lbl.lines[0].y}
                  dominant-baseline={lbl.dominant_baseline}
                  transform={lbl.transform}
                  fill={chart_state.node_infos[idx].label_fill}
                  fill-opacity={chart_state.node_dim[idx].label_opacity}
                  font-size={lbl.font_size}
                  style:cursor={cells_clickable ? `pointer` : `text`}
                >
                  {#each lbl.lines as line}
                    <tspan
                      class={line.class}
                      x={lbl.x}
                      y={line.y}
                      font-size={lbl.font_size * (line.font_scale ?? 1)}
                      font-weight={line.font_weight}
                      opacity={line.opacity}
                      fill={line.fill}
                    >
                      {line.text}
                    </tspan>
                  {/each}
                </text>
              </g>
            {/if}
          {/each}
        </g>
      {/if}
    {/snippet}
  </HierarchyShell>
</div>

<style>
  .treemap {
    position: relative;
    width: var(--treemap-width, 100%);
    height: var(--treemap-height, auto);
    min-height: var(--treemap-min-height, 300px);
    container-type: size;
    z-index: var(--treemap-z-index, auto);
    /* flex-basis auto (not 1 = 0%) so an authored height wins over flex sizing in
    column-flex parents while the chart still grows/shrinks to fill fixed layouts */
    flex: var(--treemap-flex, 1 1 auto);
    display: var(--treemap-display, flex);
    flex-direction: column;
    /* no bg shading by default: the cells are the chart; set --treemap-bg to
    add a panel background */
    background: var(--treemap-bg, transparent);
    border-radius: var(--treemap-border-radius, 0);
  }
  .treemap.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw !important;
    height: 100vh !important;
    z-index: var(--treemap-fullscreen-z-index, var(--z-index-overlay-nav, 100000001));
    margin: 0;
    border-radius: 0;
    background: var(--treemap-fullscreen-bg, var(--treemap-bg, var(--plot-bg)));
    max-height: none !important;
    overflow: hidden;
    /* border-top (not padding-top): bind:clientHeight includes padding but excludes
    borders */
    border-top: var(--plot-fullscreen-padding-top, 2em) solid
      var(--treemap-fullscreen-bg, var(--treemap-bg, var(--plot-bg, transparent)));
    box-sizing: border-box;
  }
  /* :global for everything HierarchyShell renders (header row, breadcrumbs, the
  chart svg and the hatch pattern): those elements carry the shell's scope, not
  this component's, but their theming stays in the chart's variable namespace.
  plotly-pathbar look: right-pointing chevron segments with a matching left
  notch on all but the first, slightly overlapped so they read as one bar.
  Opaque background: the pathbar overlays arbitrarily-colored cells, and a
  translucent one would be illegible over dark fills */
  .treemap :global(.breadcrumb) {
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
  .treemap :global(.breadcrumb:first-child) {
    border-radius: 3pt 0 0 3pt;
    padding-inline-start: 8px;
    clip-path: polygon(0 0, calc(100% - 7px) 0, 100% 50%, calc(100% - 7px) 100%, 0 100%);
  }
  .treemap :global(.breadcrumb:hover:not(:disabled)) {
    background: var(--treemap-btn-hover-bg, light-dark(#d0d5db, #454b54));
  }
  /* inset focus ring: native outlines get clipped by the chevron clip-path and
  hidden under the next overlapped segment */
  .treemap :global(.breadcrumb:focus-visible) {
    position: relative;
    z-index: 1;
    outline: none;
    box-shadow: inset 0 0 0 2px var(--accent-color, Highlight);
  }
  .treemap :global(.breadcrumbs) {
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
  .treemap :global(.breadcrumb + .breadcrumb) {
    margin-left: -6px;
  }
  .treemap :global(.breadcrumb:disabled) {
    cursor: default;
    font-weight: bold;
  }
  .treemap :global(svg[role='application']) {
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
  /* decorative overlay: never intercepts pointer events, no hover effect */
  .cells rect.cell-hatch {
    stroke: none;
    pointer-events: none;
  }
  /* subtle by default: thin stripes inheriting the cell border color (itself
  defaulting to the chart bg) at low opacity, so hatching matches the gaps
  between cells instead of reading as solid white */
  .treemap :global(.hatch-pattern-line) {
    stroke: var(
      --treemap-hatch-stroke,
      color-mix(
        in srgb,
        var(--treemap-cell-stroke, light-dark(white, #16181d)) 30%,
        transparent
      )
    );
    stroke-width: var(--treemap-hatch-stroke-width, 0.35);
  }
  .cell-label {
    text-anchor: middle;
    /* selectable so labels can be copied; clicks/hover still reach the underlying
    cell via data-treemap-node-idx + delegation on the chart group */
    -webkit-user-select: text;
    user-select: text;
  }
  .cell-label.header {
    text-anchor: start;
    font-weight: 600;
  }
</style>
