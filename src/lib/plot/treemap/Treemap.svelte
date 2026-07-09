<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import type { D3InterpolateName } from '$lib/colors'
  import { format_value } from '$lib/labels'
  import { FullscreenToggle, set_fullscreen_bg } from '$lib/layout'
  import type { Vec2 } from '$lib/math'
  import type {
    BasePlotProps,
    LegendConfig,
    LegendItem,
    SunburstLabelText,
    SunburstSort,
    SunburstValueMode,
  } from '$lib/plot'
  import { ColorBar, PlotLegend, PlotTooltip, TreemapControls } from '$lib/plot'
  import { closest_data_idx, get_relative_coords } from '$lib/plot/core/interactions'
  import { compute_element_placement, filter_padding } from '$lib/plot/core/layout'
  import {
    export_hierarchy_chart,
    make_cached_contrast,
    make_cached_text_width,
    node_display_name,
    node_label_variants,
  } from '$lib/plot/core/utils/hierarchy-labels'
  import { create_color_scale } from '$lib/plot/core/scales'
  import { SCALE_DEFAULTS } from '$lib/plot/core/types'
  import type { Rect, Sides } from '$lib/plot/core/layout'
  import { arrow_nav_target } from '$lib/plot/sunburst/render'
  import type { PositionedArc } from '$lib/plot/sunburst/sunburst'
  import { compute_sunburst_layout } from '$lib/plot/sunburst/sunburst'
  import type { TreemapNode, TreemapNodeHandlerProps } from '$lib/plot/treemap/treemap'
  import { lerp_rects, tile_rects } from '$lib/plot/treemap/treemap'
  import { DEFAULTS } from '$lib/settings'
  import type { ComponentProps, Snippet } from 'svelte'
  import { tick, untrack } from 'svelte'
  import { cubicInOut } from 'svelte/easing'
  import type { HTMLAttributes } from 'svelte/elements'
  import { Tween, type TweenOptions } from 'svelte/motion'
  import { SvelteSet } from 'svelte/reactivity'

  const DEFAULT_PADDING: Required<Sides> = { t: 10, b: 10, l: 10, r: 10 }

  let {
    data = $bindable([]),
    value_mode = $bindable(DEFAULTS.treemap.value_mode),
    sort = `none`,
    level_lighten = 0,
    min_fraction = $bindable(DEFAULTS.treemap.min_fraction),
    other_label = `Other`,
    max_depth = $bindable(DEFAULTS.treemap.max_depth),
    padding_inner = $bindable(DEFAULTS.treemap.padding_inner),
    padding_top = $bindable(DEFAULTS.treemap.padding_top),
    padding_outer = $bindable(DEFAULTS.treemap.padding_outer),
    show_labels = $bindable(DEFAULTS.treemap.show_labels),
    label_text = $bindable(DEFAULTS.treemap.label_text),
    zoom_on_click = $bindable(DEFAULTS.treemap.zoom_on_click),
    zoom_root_id = $bindable(null),
    show_breadcrumbs = $bindable(DEFAULTS.treemap.show_breadcrumbs),
    color_values,
    color_scale = SCALE_DEFAULTS.scheme,
    color_range,
    colorbar = {},
    export_buttons = true,
    export_filename = `treemap`,
    tween,
    value_format = `,`,
    padding = DEFAULT_PADDING,
    legend = {},
    show_legend = false,
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
    Omit<BasePlotProps, `change`> & {
      data?: TreemapNode<Metadata> | TreemapNode<Metadata>[]
      value_mode?: SunburstValueMode
      sort?: SunburstSort
      level_lighten?: number
      // Aggregate sibling cells below this fraction of the total into one 'Other'
      // cell per parent (only when >= 2 qualify); 0 disables
      min_fraction?: number
      other_label?: string
      max_depth?: number // levels shown below the current zoom root (0 = all)
      padding_inner?: number // px gap between sibling cells
      padding_top?: number // px header strip on branch cells (0 = no headers)
      padding_outer?: number // px inset of children within their parent (plotly marker.pad)
      show_labels?: boolean
      label_text?: SunburstLabelText // what labels display (plotly textinfo equivalent)
      zoom_on_click?: boolean
      zoom_root_id?: string | number | null // id of the cell the view is rooted on
      show_breadcrumbs?: boolean // clickable ancestor trail when zoomed
      // Color cells by a numeric metric (continuous colormap) instead of categorical
      // inheritance; return null to keep a cell's categorical color
      color_values?: (rect: PositionedArc<Metadata>) => number | null
      color_scale?: D3InterpolateName
      color_range?: Vec2 // defaults to the metric's [min, max]
      colorbar?: ComponentProps<typeof ColorBar> | null // null hides it
      export_buttons?: boolean // SVG/PNG download buttons in the controls pane
      export_filename?: string
      // Zoom transition timing (resizes/data swaps snap instantly, plotly-style).
      // interpolate is not overridable: the component's rect interpolator also
      // handles rect-array length changes on data swaps (default would throw)
      tween?: Omit<TweenOptions<Rect[]>, `interpolate`>
      value_format?: string
      padding?: Sides
      legend?: LegendConfig | null
      show_legend?: boolean
      tooltip?: Snippet<[TreemapNodeHandlerProps<Metadata>]>
      // Fully replace the default cell rect + labels. NOTE: this also replaces the
      // built-in hover/focus/click + tooltip wiring, so re-implement any
      // interactivity you need inside the snippet.
      cell_content?: Snippet<[{ arc: PositionedArc<Metadata>; rect: Rect }]>
      change?: (data: TreemapNodeHandlerProps<Metadata> | null) => void
      on_node_click?: (
        data: TreemapNodeHandlerProps<Metadata> & { event: MouseEvent | KeyboardEvent },
      ) => void
      on_node_hover?: (
        data: (TreemapNodeHandlerProps<Metadata> & { event: MouseEvent | FocusEvent }) | null,
      ) => void
      on_zoom?: (data: { root: TreemapNodeHandlerProps<Metadata> | null }) => void
      header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
      controls_extra?: Snippet<[{ zoom_root_id: string | number | null }]>
    } = $props()

  let [width, height] = $state([0, 0])
  let wrapper: HTMLDivElement | undefined = $state()
  let svg_element: SVGSVGElement | null = $state(null)
  // Unique per instance so multiple treemaps on one page don't collide on the
  // hatch pattern's SVG id.
  const uid = $props.id()
  const hatch_pattern_id = `treemap-hatch-${uid}`

  let hovered_idx = $state<number | null>(null)
  let hover_info = $state<TreemapNodeHandlerProps<Metadata> | null>(null)
  let hover_pos = $state<{ x: number; y: number }>({ x: 0, y: 0 })
  // Depth-1 category ids muted via legend toggle (dimmed, not removed - keeps layout stable)
  let muted_ids = new SvelteSet<string | number>()

  let pad = $derived(filter_padding(padding, DEFAULT_PADDING))
  let inner_width = $derived(Math.max(0, width - pad.l - pad.r))
  let avail_height = $derived(Math.max(0, height - pad.t - pad.b))
  // measured height of the bottom colorbar, reserved from the chart so it never
  // overlaps the cells; reset to 0 when hidden (effect below); capped at half the
  // area so a bad measurement can't collapse the chart
  let colorbar_height = $state(0)
  let colorbar_reserve = $derived(
    colorbar_height > 0 ? Math.min(colorbar_height + 16, avail_height / 2) : 0,
  )
  let inner_height = $derived(avail_height - colorbar_reserve)

  // Degrade to an empty layout (instead of crashing the host page) on invalid data.
  // Tree semantics (values, colors, ids, pre-order indexing) are shared with
  // Sunburst; only the pixel tiling below is treemap-specific.
  let layout = $derived.by(() => {
    try {
      return compute_sunburst_layout(data, {
        value_mode,
        sort,
        level_lighten,
        min_fraction,
        other_label,
      })
    } catch (err) {
      console.error(err)
      return { arcs: [], root: null, max_depth: 0 }
    }
  })

  // Resolve the zoom root; stale ids (e.g. after a data swap) fall back to the root
  let zoom_root = $derived(
    layout.arcs.find((arc) => arc.id === zoom_root_id) ?? layout.root,
  )
  let zoomed = $derived((zoom_root?.depth ?? 0) > 0)

  // Drop muted ids that no longer exist when data changes (untrack avoids a
  // self-trigger loop from reading/writing muted_ids in the same effect).
  // Hover/focus state is index-based, so a layout swap would otherwise leave a stale
  // tooltip and highlight whatever unrelated node now occupies the old index.
  $effect(() => {
    const valid = new Set(layout.arcs.filter((arc) => arc.depth === 1).map((arc) => arc.id))
    untrack(() => {
      for (const id of muted_ids) if (!valid.has(id)) muted_ids.delete(id)
      set_cell_hover(null)
      focused_idx = null
    })
  })

  // Re-tile the zoom root's subtree to the full plot area (plotly behavior:
  // squarified aspect ratios stay correct at every zoom level, unlike projecting
  // one fixed tiling through a window, which would distort cells and scale the
  // fixed-px header strips). Zoom animation interpolates between tilings.
  let target_rects = $derived(
    tile_rects(
      layout.arcs,
      zoom_root?.node_idx ?? 0,
      { width: inner_width, height: inner_height },
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
  let prev_zoom_idx = untrack(() => zoom_root?.node_idx ?? 0)
  let prev_arcs = untrack(() => layout.arcs)
  $effect(() => {
    const [target, zoom_idx, arcs] = [target_rects, zoom_root?.node_idx ?? 0, layout.arcs]
    const zoom_changed = zoom_idx !== prev_zoom_idx && arcs === prev_arcs
    ;[prev_zoom_idx, prev_arcs] = [zoom_idx, arcs]
    rects_tween.set(target, zoom_changed ? undefined : { duration: 0 })
  })
  let rects = $derived(rects_tween.current)

  // Deepest level rendered below the current zoom root (0 = unlimited)
  let depth_cutoff = $derived(
    max_depth > 0 ? (zoom_root?.depth ?? 0) + max_depth : Infinity,
  )
  // Shared by rendering and legend placement. The zoom root fills the viewport
  // and is represented by the breadcrumbs, not a cell — except when it's a leaf
  // (e.g. programmatic zoom_root_id onto a compound), which renders as one full-
  // viewport cell instead of a blank chart. Nodes outside the zoomed subtree
  // hold zero rects from tile_rects.
  const cell_visible = (arc: PositionedArc<Metadata>, rect: Rect): boolean =>
    arc.depth > 0 &&
    (arc.node_idx !== zoom_root?.node_idx || arc.is_leaf) &&
    arc.depth <= depth_cutoff &&
    rect.width > 0.5 &&
    rect.height > 0.5
  const idx_visible = (idx: number): boolean => {
    const [arc, rect] = [layout.arcs[idx], rects[idx]]
    return Boolean(arc && rect && cell_visible(arc, rect))
  }
  // Indices (= keys) of cells to render. A plain number array: arcs/rects/
  // cell_info/cell_dim are all index-aligned, so rendering reads them by idx
  // instead of rebuilding N wrapper objects per tween frame.
  let visible_idxs = $derived.by(() => {
    const idxs: number[] = []
    for (let idx = 0; idx < layout.arcs.length; idx++) {
      if (idx_visible(idx)) idxs.push(idx)
    }
    return idxs
  })

  // Roving tabindex: exactly one cell is in the tab order (the last-focused one,
  // else the first visible cell); arrow keys move focus between cells. Every
  // visible cell is focusable (not just clickable ones) so keyboard users can
  // reach tooltips, and so zooming into a branch of plain leaves doesn't strand
  // focus outside the chart. role="button" stays limited to clickable cells.
  let focused_idx = $state<number | null>(null)
  let roving_idx = $derived(
    focused_idx != null && idx_visible(focused_idx)
      ? focused_idx
      : (visible_idxs[0] ?? null),
  )

  // Continuous metric coloring: when color_values is given, cells are colored by
  // their metric on a d3 colormap (cells returning null keep their categorical color)
  let metric = $derived.by<{ range: Vec2; colors: string[] } | null>(() => {
    if (!color_values) return null
    const vals = layout.arcs.map((arc) => {
      const val = arc.depth === 0 ? null : color_values(arc)
      return val != null && Number.isFinite(val) ? val : null
    })
    const finite = vals.filter((val) => val != null)
    if (finite.length === 0) return null
    const range = color_range ?? [Math.min(...finite), Math.max(...finite)]
    const scale = create_color_scale({ scheme: color_scale, value_range: range }, range)
    return {
      range,
      colors: vals.map((val, idx) => (val == null ? layout.arcs[idx].color : `${scale(val)}`)),
    }
  })
  const cell_color = (arc: PositionedArc<Metadata>): string =>
    metric?.colors[arc.node_idx] ?? arc.color
  // release the colorbar's reserved chart space when it's not rendered
  $effect(() => {
    if (!metric || colorbar == null) colorbar_height = 0
  })

  // Predicate keeping the hovered cell + its ancestors/descendants fully opaque.
  // Pre-order indexing makes both tests O(1): a subtree is the contiguous index
  // range [node_idx, subtree_end].
  let active = $derived.by(() => {
    if (hovered_idx == null) return null
    const hov = layout.arcs[hovered_idx]
    if (!hov) return null
    return (arc: PositionedArc<Metadata>): boolean =>
      (arc.node_idx >= hov.node_idx && arc.node_idx <= hov.subtree_end) ||
      (hov.node_idx >= arc.node_idx && hov.node_idx <= arc.subtree_end)
  })

  const is_muted = (arc: PositionedArc<Metadata>): boolean =>
    arc.path.length > 0 && muted_ids.has(arc.path[0])

  const MUTED_OPACITY = 0.12
  // Legend muting + hover dimming per cell, indexed by node_idx. Zoom-independent:
  // recomputed only when hover/mute state changes, so during zoom tweens this is
  // a plain array lookup.
  let cell_dim = $derived(
    layout.arcs.map((arc) => {
      const muted = is_muted(arc)
      return {
        opacity: muted ? MUTED_OPACITY : active && !active(arc) ? 0.3 : 1,
        // labels dim only when muted, not when hover-inactive (undefined omits the attr)
        label_opacity: muted ? MUTED_OPACITY : undefined,
      }
    }),
  )

  const contrast_for = make_cached_contrast()

  // Parent arc of an arc (null for the root)
  const parent_of = (arc: PositionedArc<Metadata>): PositionedArc<Metadata> | null =>
    arc.parent_idx != null ? layout.arcs[arc.parent_idx] : null

  function make_node_props(arc: PositionedArc<Metadata>): TreemapNodeHandlerProps<Metadata> {
    // Handler props are the arc minus its layout geometry, plus the parent id
    const { x0, x1, y0, y1, subtree_end, parent_idx, ...node } = arc
    return {
      ...node,
      type: `node`,
      color: cell_color(arc),
      parent_id: parent_of(arc)?.id ?? null,
    }
  }

  // Anchor the tooltip at the cursor (mouse hover) so it follows the pointer across
  // wide cells; fall back to the cell center on keyboard focus (no cursor).
  const event_pos = (event?: MouseEvent | FocusEvent): { x: number; y: number } | null =>
    event instanceof MouseEvent ? get_relative_coords(event, svg_element) : null

  // Rect center in container (pad-offset) pixel space, for tooltip + legend placement
  const rect_center = (rect: Rect): { x: number; y: number } => ({
    x: pad.l + rect.x + rect.width / 2,
    y: pad.t + rect.y + rect.height / 2,
  })

  function set_cell_hover(idx: number | null, event?: MouseEvent | FocusEvent) {
    // Same cell as before: only the cursor anchor moves - skip rebuilding the
    // handler payload and re-firing change/on_node_hover on every mousemove.
    // Requires hover_info: legend item hover sets hovered_idx alone (for dimming).
    if (idx != null && idx === hovered_idx && hover_info) {
      hover_pos = event_pos(event) ?? hover_pos
      return
    }
    if (idx != null) {
      hovered = true
      hovered_idx = idx
      hover_info = make_node_props(layout.arcs[idx])
      hover_pos = event_pos(event) ?? (rects[idx] ? rect_center(rects[idx]) : hover_pos)
      change(hover_info)
      if (event) on_node_hover?.({ ...hover_info, event })
    } else {
      if (hovered_idx == null && hover_info == null) return
      hovered = false
      hovered_idx = null
      hover_info = null
      change(null)
      on_node_hover?.(null)
    }
  }

  // Node idx carried by the event's nearest [data-treemap-node-idx] element
  const idx_from_event = (event: Event): number | null => {
    const idx = closest_data_idx(event, `data-treemap-node-idx`, svg_element)
    return idx != null && layout.arcs[idx] ? idx : null
  }

  function handle_cell_hover_event(event: MouseEvent | FocusEvent) {
    const idx = idx_from_event(event)
    // roving tabindex follows keyboard focus
    if (event.type === `focusin` && idx != null) focused_idx = idx
    set_cell_hover(idx, event)
  }

  // Re-root the view on the given arc (or the data root when null) and notify
  function zoom_to(arc: PositionedArc<Metadata> | null) {
    const root = arc && arc.depth > 0 ? arc : null
    zoom_root_id = root?.id ?? null
    // The clicked cell expands to fill the viewport - drop the stale hover/tooltip
    set_cell_hover(null)
    on_zoom?.({ root: root && make_node_props(root) })
  }

  // True while the user has an uncollapsed text selection inside this chart. Labels
  // are selectable text, and the mouseup that ends a selection drag also fires a
  // click - selecting a label must not zoom or fire on_node_click.
  function selection_in_chart(): boolean {
    const selection = globalThis.getSelection?.()
    return Boolean(
      selection &&
      !selection.isCollapsed &&
      selection.anchorNode &&
      wrapper?.contains(selection.anchorNode),
    )
  }

  // Plotly semantics: clicking any cell (leaves included) zooms into it;
  // clicking the current zoom root (the full-viewport cell a leaf zoom renders)
  // zooms back out one level
  function handle_cell_click(event: MouseEvent | KeyboardEvent) {
    if (event instanceof MouseEvent && selection_in_chart()) return
    const idx = idx_from_event(event)
    if (idx == null) return
    const arc = layout.arcs[idx]
    on_node_click?.({ ...make_node_props(arc), event })
    if (!zoom_on_click) return
    if (arc.id === zoom_root?.id) zoom_out()
    else zoom_to(arc)
  }

  function zoom_out() {
    if (!zoomed) return
    zoom_to(breadcrumb_arcs.at(-2) ?? null)
  }

  // Double-clicking empty chart background resets the zoom to the root (double-
  // clicking a cell or label is click-to-zoom/text-selection territory, not a reset)
  function handle_dblclick(event: MouseEvent) {
    if (idx_from_event(event) != null || selection_in_chart()) return
    if (zoomed) zoom_to(null)
  }

  const focus_cell = (idx: number | null) => {
    if (idx == null) return
    svg_element
      ?.querySelector<SVGRectElement>(`.cells [data-treemap-node-idx="${idx}"]`)
      ?.focus()
  }

  // Arrow-key navigation: left/right cycle through visible siblings (wrapping),
  // down enters the first child, up returns to the parent (shared with Sunburst
  // via the pre-order walk in render.ts)
  const nav_target_from_event = (event: KeyboardEvent): number | null => {
    const cur_idx = idx_from_event(event)
    if (cur_idx == null) return null
    return arrow_nav_target(layout.arcs, idx_visible, cur_idx, event.key)
  }

  const is_activation_key = (evt: KeyboardEvent) => [`Enter`, ` `].includes(evt.key)

  function handle_cell_keydown(event: KeyboardEvent) {
    const nav_target = nav_target_from_event(event)
    if (nav_target != null) {
      event.preventDefault()
      focus_cell(nav_target)
      return
    }
    if (!is_activation_key(event)) return
    event.preventDefault()
    const prev_root = zoom_root_id
    handle_cell_click(event)
    // Zooming via keyboard unmounts the focused cell - move focus to the new
    // root's first child (pre-order: node_idx + 1), or the root cell itself for
    // leaf zooms (rendered full-viewport), so keyboard users stay in the chart
    if (zoom_root_id !== prev_root) {
      tick().then(() => {
        if (!zoom_root) return focus_cell(roving_idx)
        focus_cell(zoom_root.is_leaf ? zoom_root.node_idx : zoom_root.node_idx + 1)
      })
    }
  }

  // Uniform now that any cell zooms (plotly semantics), not just branches
  let cells_clickable = $derived(Boolean(on_node_click) || zoom_on_click)

  // Measure label fit in the font labels actually render in (respects the
  // --treemap-font-size CSS var). Memoized because canvas measureText is far too
  // slow to run for every visible cell on every tween frame.
  let label_font = $derived.by(() => {
    if (!svg_element) return `11px sans-serif`
    const { fontSize, fontFamily } = getComputedStyle(svg_element)
    return `${fontSize} ${fontFamily}`
  })
  const cached_text_width = make_cached_text_width()

  // Per-cell label text, measured width, fill/label colors, clickability and aria
  // string - all zoom-independent, so computed once per layout/option change
  // instead of per animation frame
  let cell_info = $derived(
    layout.arcs.map((arc) => {
      const { text, extended } = node_label_variants(arc, label_text, value_format)
      const fill = cell_color(arc)
      return {
        text,
        width: cached_text_width(text, label_font),
        extended,
        extended_width: extended === undefined
          ? undefined
          : cached_text_width(extended, label_font),
        aria: `${node_display_name(arc)}: ${arc.value}`,
        fill,
        label_fill: contrast_for(fill),
      }
    }),
  )

  const LABEL_MARGIN = 6 // px clearance between label text and cell edges
  // Label text + placement for a cell; null = doesn't fit, hide the label.
  // Branch cells label their header strip (top-left); leaves (and branches at the
  // depth cutoff, which render as plain cells) center their label, rotating 90°
  // in thin-but-tall cells like the icicle shape does. Compound label modes try
  // the full text first and degrade to the bare label when it doesn't fit.
  function label_attrs(
    arc: PositionedArc<Metadata>,
    rect: Rect,
  ): { x: number; y: number; text: string; transform?: string; header: boolean } | null {
    const info = cell_info[arc.node_idx]
    if (!info.text) return null
    const { x, y, width: cell_w, height: cell_h } = rect
    const variants: { text: string; width: number }[] = [
      ...(info.extended !== undefined && info.extended_width !== undefined
        ? [{ text: info.extended, width: info.extended_width }]
        : []),
      { text: info.text, width: info.width },
    ]
    // Branches with visible children only ever label their header strip: a
    // centered label would paint over the descendant cells that cover the rest
    // of the cell, so when the strip is missing/too thin the label is dropped
    const has_visible_children = !arc.is_leaf && arc.depth < depth_cutoff
    if (has_visible_children) {
      if (padding_top < 12) return null
      const fitting = variants.find((entry) => entry.width <= cell_w - 2 * LABEL_MARGIN)
      if (!fitting) return null
      return { x: x + LABEL_MARGIN, y: y + padding_top / 2, text: fitting.text, header: true }
    }
    const fits = (text_w: number, along: number, across: number) =>
      text_w <= along - 2 * LABEL_MARGIN && across >= 12
    const [cx, cy] = [x + cell_w / 2, y + cell_h / 2]
    for (const { text, width: text_w } of variants) {
      if (fits(text_w, cell_w, cell_h)) return { x: cx, y: cy, text, header: false }
      if (fits(text_w, cell_h, cell_w)) {
        return { x: cx, y: cy, text, transform: `rotate(-90, ${cx}, ${cy})`, header: false }
      }
    }
    return null
  }

  // Legend: one item per depth-1 category, toggling mutes (dims) rather than removes.
  let depth1_arcs = $derived(layout.arcs.filter((arc) => arc.depth === 1))
  let legend_visible = $derived(show_legend && legend != null && depth1_arcs.length > 1)
  let legend_element = $state<HTMLDivElement | undefined>()
  let legend_placement = $derived.by(() => {
    if (!legend_visible || !width || !height) return null
    // Place against the settled (target) tiling, not the animated one - placement
    // is stable during zoom tweens. Same visibility rule as rendering so hidden
    // cells (zoom root, beyond max_depth) don't repel the legend.
    const settled = layout.arcs.flatMap((arc, idx) =>
      cell_visible(arc, target_rects[idx]) ? [rect_center(target_rects[idx])] : []
    )
    return compute_element_placement({
      plot_bounds: { x: pad.l, y: pad.t, width: inner_width, height: inner_height },
      element: legend_element,
      element_size: { width: 120, height: 60 },
      axis_clearance: legend?.axis_clearance,
      exclude_rects: [],
      points: settled,
    })
  })
  let legend_data: LegendItem[] = $derived(
    depth1_arcs.map((arc, idx) => ({
      series_idx: idx,
      label: node_display_name(arc),
      visible: !muted_ids.has(arc.id),
      display_style: { symbol_type: `Square` as const, symbol_color: cell_color(arc) },
    })),
  )

  function toggle_category(series_idx: number) {
    const id = depth1_arcs[series_idx]?.id
    if (id !== undefined && !muted_ids.delete(id)) muted_ids.add(id)
  }

  $effect(() => set_fullscreen_bg(wrapper, fullscreen, `--treemap-fullscreen-bg`))

  // Ancestor chain from the root to the current zoom root (clickable breadcrumb trail)
  let breadcrumb_arcs = $derived.by(() => {
    if (!zoom_root || zoom_root.depth === 0) return []
    const chain: PositionedArc<Metadata>[] = []
    for (let cur: PositionedArc<Metadata> | null = zoom_root; cur; cur = parent_of(cur))
      chain.unshift(cur)
    return chain
  })

  const export_chart = (format: `svg` | `png`) =>
    export_hierarchy_chart(svg_element, export_filename, format)
</script>

<svelte:window
  onkeydown={(evt) => {
    if (evt.key !== `Escape`) return
    // only react when the user is interacting with this chart (pointer over it,
    // focus inside it, or fullscreen) - Escape zooms out one level, then exits
    // fullscreen once at the root
    const within = fullscreen ||
      (wrapper != null &&
        (wrapper.matches(`:hover`) || wrapper.contains(document.activeElement)))
    if (!within) return
    if (zoomed) {
      evt.preventDefault()
      zoom_out()
    } else if (fullscreen) {
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
  class={[`treemap`, rest.class]}
  class:fullscreen
>
  {#if width && height}
    <div class="header-controls">
      {@render header_controls?.({ height, width, fullscreen })}
      {#if show_controls}
        <TreemapControls
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
          on_export={export_chart}
        >
          {@render controls_extra?.({ zoom_root_id })}
        </TreemapControls>
      {/if}
      {#if fullscreen_toggle}
        <FullscreenToggle bind:fullscreen />
      {/if}
    </div>
    {#if show_breadcrumbs && breadcrumb_arcs.length > 0}
      <!-- plotly-style pathbar: chevron segments, current root last (disabled) -->
      <nav class="breadcrumbs" aria-label="zoom path">
        {#each breadcrumb_arcs as crumb, crumb_idx (crumb.node_idx)}
          <button
            type="button"
            class="breadcrumb"
            disabled={crumb_idx === breadcrumb_arcs.length - 1}
            onclick={() => zoom_to(crumb)}
          >
            {crumb.depth === 0 ? `all` : (crumb.label ?? crumb.id)}
          </button>
        {/each}
      </nav>
    {/if}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <svg
      bind:this={svg_element}
      viewBox="0 0 {width} {height}"
      role="application"
      aria-label={rest[`aria-label`] ?? `Treemap chart`}
      onmouseleave={() => set_cell_hover(null)}
      ondblclick={handle_dblclick}
    >
      <!-- inert unless some cell references it via fill -->
      <defs>
        <pattern id={hatch_pattern_id} patternUnits="userSpaceOnUse" width="8" height="8">
          <path class="hatch-pattern-line" d="M-1,1 l2,-2 M0,8 l8,-8 M7,9 l2,-2" />
        </pattern>
      </defs>
      <!-- Hover/click delegation sits on the chart group (not the cells group) so
      labels - which carry the same data-treemap-node-idx and are selectable text -
      forward interactions to their cell instead of swallowing them -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <g
        transform={`translate(${pad.l}, ${pad.t})`}
        onmousemove={handle_cell_hover_event}
        onmouseleave={() => set_cell_hover(null)}
        onfocusin={handle_cell_hover_event}
        onfocusout={() => set_cell_hover(null)}
        onclick={handle_cell_click}
        onkeydown={handle_cell_keydown}
      >
        <!-- Cells: pre-order document order paints parents first, children on top -->
        <g class="cells">
          {#each visible_idxs as idx (idx)}
            {@const rect = rects[idx]}
            {#if cell_content}
              {@render cell_content({ arc: layout.arcs[idx], rect })}
            {:else}
              {@const info = cell_info[idx]}
              {@const opacity = cell_dim[idx].opacity}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
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
              {#if layout.arcs[idx].hatch}
                <!-- Decorative texture overlay; ignores pointer events -->
                <rect
                  class="cell-hatch"
                  aria-hidden="true"
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  fill="url(#{hatch_pattern_id})"
                  fill-opacity={opacity}
                />
              {/if}
            {/if}
          {/each}
        </g>

        <!-- Cell labels: selectable text; data-treemap-node-idx forwards hover/click
        to the underlying cell via the chart-group delegation above -->
        {#if show_labels && !cell_content}
          <g class="cell-labels">
            {#each visible_idxs as idx (idx)}
              {@const lbl = label_attrs(layout.arcs[idx], rects[idx])}
              {#if lbl}
                <text
                  class="cell-label"
                  class:header={lbl.header}
                  data-treemap-node-idx={idx}
                  x={lbl.x}
                  y={lbl.y}
                  transform={lbl.transform}
                  fill={cell_info[idx].label_fill}
                  fill-opacity={cell_dim[idx].label_opacity}
                  style:cursor={cells_clickable ? `pointer` : `text`}
                >
                  {lbl.text}
                </text>
              {/if}
            {/each}
          </g>
        {/if}
      </g>
    </svg>
  {/if}

  {#if hover_info}
    <PlotTooltip
      x={hover_pos.x}
      y={hover_pos.y}
      offset={{ x: 10, y: 5 }}
      constrain_to={{ width, height }}
      fallback_size={{ width: 140, height: 44 }}
      bg_color={hover_info.color}
    >
      {#if tooltip}
        {@render tooltip(hover_info)}
      {:else}
        <strong>{hover_info.label_path.join(` › `)}</strong>: {format_value(
          hover_info.value,
          value_format,
        )}
        ({format_value(hover_info.fraction, `.1%`)} of total{hover_info.depth > 1
          ? `, ${format_value(hover_info.parent_fraction, `.1%`)} of parent`
          : ``})
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
      on_toggle={legend?.on_toggle ?? toggle_category}
      on_item_hover={(item) =>
        (hovered_idx =
          item != null && item.series_idx >= 0
            ? (depth1_arcs[item.series_idx]?.node_idx ?? null)
            : null)}
      style={`position: absolute; left: ${legend_left}px; top: ${legend_top}px; pointer-events: auto; ${
        legend?.style ?? ``
      }`}
    />
  {/if}

  {#if metric && colorbar != null}
    <div
      bind:clientHeight={colorbar_height}
      style="position: absolute; bottom: var(--treemap-colorbar-bottom, 8px); left: 50%; transform: translateX(-50%); width: var(--treemap-colorbar-width, 40%); min-width: 120px; pointer-events: auto;"
    >
      <ColorBar
        {color_scale}
        range={metric.range}
        {...colorbar}
        wrapper_style={`width: 100%; ${colorbar?.wrapper_style ?? ``}`}
      />
    </div>
  {/if}

  {@render children?.({ height, width, fullscreen })}
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
    background: var(--treemap-bg, var(--plot-bg));
    border-radius: var(--treemap-border-radius, var(--border-radius, 3pt));
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
  /* plotly-pathbar look: right-pointing chevron segments with a matching left
  notch on all but the first, slightly overlapped so they read as one bar.
  Opaque background: the pathbar overlays arbitrarily-colored cells, and a
  translucent one would be illegible over dark fills */
  .breadcrumb {
    background: var(--treemap-btn-bg, light-dark(#e3e6ea, #33383f));
    color: inherit;
    border: none;
    padding: 2px 14px 2px 12px;
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
  .breadcrumb:first-child {
    border-radius: 3pt 0 0 3pt;
    padding-inline-start: 8px;
    clip-path: polygon(0 0, calc(100% - 7px) 0, 100% 50%, calc(100% - 7px) 100%, 0 100%);
  }
  .breadcrumb:hover:not(:disabled) {
    background: var(--treemap-btn-hover-bg, light-dark(#d0d5db, #454b54));
  }
  /* inset focus ring: native outlines get clipped by the chevron clip-path and
  hidden under the next overlapped segment */
  .breadcrumb:focus-visible {
    position: relative;
    z-index: 1;
    outline: none;
    box-shadow: inset 0 0 0 2px var(--accent-color, Highlight);
  }
  .breadcrumbs {
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
  .breadcrumb + .breadcrumb {
    margin-left: -6px;
  }
  .breadcrumb:disabled {
    cursor: default;
    font-weight: bold;
  }
  .treemap :global(.pane-toggle),
  .treemap .header-controls {
    opacity: 0;
    transition:
      opacity 0.2s,
      background-color 0.2s;
  }
  .treemap:hover :global(.pane-toggle),
  .treemap:hover .header-controls,
  .treemap :global(.pane-toggle:focus-visible),
  .treemap :global(.pane-toggle[aria-expanded='true']),
  .treemap .header-controls:has(:global([aria-expanded='true'])),
  .treemap .header-controls:focus-within {
    opacity: 1;
  }
  svg {
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
  .hatch-pattern-line {
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
    dominant-baseline: central;
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
