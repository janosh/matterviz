<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import type { D3InterpolateName } from '$lib/colors'
  import { pick_contrast_color } from '$lib/colors'
  import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
  import { format_value } from '$lib/labels'
  import { FullscreenToggle, set_fullscreen_bg } from '$lib/layout'
  import { DEG_TO_RAD, type Vec2 } from '$lib/math'
  import type {
    BasePlotProps,
    LegendConfig,
    LegendItem,
    SunburstLabelRotation,
    SunburstLabelText,
    SunburstNode,
    SunburstNodeHandlerProps,
    SunburstShape,
    SunburstSort,
    SunburstValueMode,
  } from '$lib/plot'
  import { ColorBar, PlotLegend, PlotTooltip, SunburstControls } from '$lib/plot'
  import { closest_data_idx, get_relative_coords } from '$lib/plot/core/interactions'
  import {
    compute_element_placement,
    filter_padding,
    measure_text_width,
  } from '$lib/plot/core/layout'
  import type { Sides } from '$lib/plot/core/layout'
  import { create_color_scale } from '$lib/plot/core/scales'
  import { SCALE_DEFAULTS } from '$lib/plot/core/types'
  import {
    arc_label_transform,
    arrow_nav_target,
    project_arcs,
  } from '$lib/plot/sunburst/render'
  import type { ScreenArc as ScreenArcOf } from '$lib/plot/sunburst/render'
  import { compute_sunburst_layout, type PositionedArc } from '$lib/plot/sunburst/sunburst'
  import { DEFAULTS } from '$lib/settings'
  import { arc as d3_arc } from 'd3-shape'
  import { type ComponentProps, type Snippet, tick, untrack } from 'svelte'
  import { cubicInOut } from 'svelte/easing'
  import type { HTMLAttributes } from 'svelte/elements'
  import { Tween, type TweenOptions } from 'svelte/motion'
  import { SvelteSet } from 'svelte/reactivity'

  const DEFAULT_PADDING: Required<Sides> = { t: 10, b: 10, l: 10, r: 10 }

  // An arc with its current screen-space geometry (angles in radians, radii in px)
  type ScreenArc = ScreenArcOf<Metadata>

  let {
    data = $bindable([]),
    shape = $bindable(DEFAULTS.sunburst.shape),
    value_mode = $bindable(DEFAULTS.sunburst.value_mode),
    sort = `none`,
    level_lighten = 0,
    min_fraction = $bindable(DEFAULTS.sunburst.min_fraction),
    other_label = `Other`,
    max_depth = $bindable(DEFAULTS.sunburst.max_depth),
    inner_radius = $bindable(DEFAULTS.sunburst.inner_radius),
    pad_angle = $bindable(DEFAULTS.sunburst.pad_angle),
    show_labels = $bindable(DEFAULTS.sunburst.show_labels),
    label_rotation = $bindable(DEFAULTS.sunburst.label_rotation),
    label_text = $bindable(DEFAULTS.sunburst.label_text),
    zoom_on_click = $bindable(DEFAULTS.sunburst.zoom_on_click),
    zoom_root_id = $bindable(null),
    show_breadcrumbs = $bindable(DEFAULTS.sunburst.show_breadcrumbs),
    color_values,
    color_scale = SCALE_DEFAULTS.scheme,
    color_range,
    colorbar = {},
    export_buttons = true,
    export_filename = `sunburst`,
    tween,
    value_format = `,`,
    padding = DEFAULT_PADDING,
    legend = {},
    show_legend = false,
    tooltip,
    arc_content,
    center_content,
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
      data?: SunburstNode<Metadata> | SunburstNode<Metadata>[]
      shape?: SunburstShape // polar rings (sunburst) or stacked rows (icicle)
      value_mode?: SunburstValueMode
      sort?: SunburstSort
      level_lighten?: number
      // Aggregate sibling arcs below this fraction of the total into one 'Other' leaf
      // per parent (only when >= 2 qualify); 0 disables
      min_fraction?: number
      other_label?: string
      max_depth?: number // rings shown below the current zoom root (0 = all)
      inner_radius?: number // center hole as fraction of outer radius
      pad_angle?: number // degrees between sibling arcs
      show_labels?: boolean
      label_rotation?: SunburstLabelRotation
      label_text?: SunburstLabelText // what labels display (plotly textinfo equivalent)
      zoom_on_click?: boolean
      zoom_root_id?: string | number | null // id of the arc the view is rooted on
      show_breadcrumbs?: boolean // clickable ancestor trail when zoomed
      // Color arcs by a numeric metric (continuous colormap) instead of categorical
      // inheritance; return null to keep an arc's categorical color
      color_values?: (arc: PositionedArc<Metadata>) => number | null
      color_scale?: D3InterpolateName
      color_range?: Vec2 // defaults to the metric's [min, max]
      colorbar?: ComponentProps<typeof ColorBar> | null // null hides it
      export_buttons?: boolean // SVG/PNG download buttons in the controls pane
      export_filename?: string
      tween?: TweenOptions<{ x0: number; x1: number; y0: number; n_rings: number }>
      value_format?: string
      padding?: Sides
      legend?: LegendConfig | null
      show_legend?: boolean
      tooltip?: Snippet<[SunburstNodeHandlerProps<Metadata>]>
      // Fully replace the default arc path. NOTE: this also replaces the built-in
      // hover/focus/click + tooltip wiring, so re-implement any interactivity you
      // need inside the snippet.
      arc_content?: Snippet<
        [{ arc: PositionedArc<Metadata>; a0: number; a1: number; r0: number; r1: number }]
      >
      center_content?: Snippet<
        [{ root: PositionedArc<Metadata> | null; radius: number; zoomed: boolean }]
      >
      change?: (data: SunburstNodeHandlerProps<Metadata> | null) => void
      on_node_click?: (
        data: SunburstNodeHandlerProps<Metadata> & { event: MouseEvent | KeyboardEvent },
      ) => void
      on_node_hover?: (
        data: (SunburstNodeHandlerProps<Metadata> & { event: MouseEvent | FocusEvent }) | null,
      ) => void
      on_zoom?: (data: { root: SunburstNodeHandlerProps<Metadata> | null }) => void
      header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
      controls_extra?: Snippet<[{ zoom_root_id: string | number | null }]>
    } = $props()

  let [width, height] = $state([0, 0])
  let wrapper: HTMLDivElement | undefined = $state()
  let svg_element: SVGSVGElement | null = $state(null)
  let center_el: SVGCircleElement | null = $state(null)

  let hovered_idx = $state<number | null>(null)
  let hover_info = $state<SunburstNodeHandlerProps<Metadata> | null>(null)
  let hover_pos = $state<{ x: number; y: number }>({ x: 0, y: 0 })
  // Depth-1 category ids muted via legend toggle (dimmed, not removed - keeps layout stable)
  let muted_ids = new SvelteSet<string | number>()

  let pad = $derived(filter_padding(padding, DEFAULT_PADDING))
  let inner_width = $derived(Math.max(0, width - pad.l - pad.r))
  let avail_height = $derived(Math.max(0, height - pad.t - pad.b))
  // measured height of the bottom colorbar, reserved from the chart so it never overlaps
  // the arcs (16px covers its bottom offset + a small gap). reset to 0 when the colorbar
  // is hidden (effect below) since bind:clientHeight doesn't clear on unmount; capped at
  // half the area so a bad measurement can't collapse the chart
  let colorbar_height = $state(0)
  let colorbar_reserve = $derived(
    colorbar_height > 0 ? Math.min(colorbar_height + 16, avail_height / 2) : 0,
  )
  let inner_height = $derived(avail_height - colorbar_reserve)

  // Degrade to an empty layout (instead of crashing the host page) on invalid data.
  // Layout depends only on data/value semantics - not on size or zoom.
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
  let arc_by_id = $derived(new Map(layout.arcs.map((arc) => [arc.id, arc])))

  // Resolve the zoom root; stale ids (e.g. after a data swap) fall back to the root
  let zoom_root = $derived(
    (zoom_root_id != null ? arc_by_id.get(zoom_root_id) : null) ?? layout.root,
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
      set_arc_hover(null)
      focused_idx = null
    })
  })

  // The view window in normalized partition coordinates: the zoom root's angular
  // span + how many rings to show below it
  let view_target = $derived.by(() => {
    const below = layout.root ? layout.max_depth - (zoom_root?.depth ?? 0) : 1
    return {
      x0: zoom_root?.x0 ?? 0,
      x1: zoom_root?.x1 ?? 1,
      y0: zoom_root?.y0 ?? 0,
      n_rings: Math.max(1, max_depth > 0 ? Math.min(max_depth, below) : below),
    }
  })

  // Zooming tweens this single object; all arc geometry re-derives from view.current
  // each frame via clamping scales (the classic zoomable-sunburst trick - no per-arc
  // tweens, no re-layout). Tween.of seeds it at view_target (charts load fully drawn)
  // then re-targets on change via a render-effect that reads only view_target, never
  // view.current - so the tween can't feed back into its own target. untrack reads the
  // tween options once at init (they're not meant to update reactively).
  const view = Tween.of(
    () => view_target,
    untrack(() => ({ duration: 400, easing: cubicInOut, ...tween })),
  )

  // Pixel geometry
  let radius = $derived(Math.max(0, Math.min(inner_width, inner_height) / 2))
  let cx = $derived(pad.l + inner_width / 2)
  let cy = $derived(pad.t + inner_height / 2)
  // Min 14px center hole when zoomed so there's always a zoom-out click target
  let hole_r = $derived(Math.max(inner_radius * radius, zoomed ? 14 : 0))

  let screen_geom = $derived({ shape, inner_width, inner_height, radius, hole_r })

  // Projected with view.current once per animation frame; project_arcs is also called
  // with view.target where settled geometry suffices (e.g. legend placement, which
  // shouldn't rerun per frame)
  let projection = $derived(project_arcs(layout.arcs, view.current, screen_geom))
  let screen_arcs = $derived(projection.all)
  // Rendering iterates only non-collapsed arcs - when zoomed into a small subtree of
  // a large hierarchy this keeps per-frame template work proportional to what's on screen
  let visible_arcs = $derived(projection.visible)

  // Roving tabindex: exactly one arc is in the tab order (the last-focused one, else
  // the first visible clickable arc); arrow keys move focus between arcs. Without
  // this, tabbing through a large chart would visit every single arc.
  let focused_idx = $state<number | null>(null)
  let roving_idx = $derived.by(() => {
    if (focused_idx != null && screen_arcs[focused_idx]?.visible) return focused_idx
    return visible_arcs.find((screen) => arc_clickable(screen.arc))?.arc.node_idx ?? null
  })

  let arc_gen = $derived(
    d3_arc<ScreenArc>()
      .startAngle((screen) => screen.a0)
      .endAngle((screen) => screen.a1)
      .innerRadius((screen) => screen.r0)
      .outerRadius((screen) => screen.r1)
      .padAngle(pad_angle * DEG_TO_RAD)
      .padRadius(radius || 1),
  )

  // Path data for one arc/rect in the current shape
  const screen_path = (screen: ScreenArc): string =>
    shape === `icicle`
      ? `M${screen.a0},${screen.r0}H${screen.a1}V${screen.r1}H${screen.a0}Z`
      : (arc_gen(screen) ?? ``)

  // The chart group's transform: sunburst draws around the center, icicle from the
  // top-left of the padded plot area
  let chart_transform = $derived(
    shape === `icicle` ? `translate(${pad.l}, ${pad.t})` : `translate(${cx}, ${cy})`,
  )

  // Arc centroid in container (pad-offset) pixel space, for tooltip + legend placement
  const arc_center = (screen: ScreenArc): { x: number; y: number } => {
    if (shape === `icicle`) {
      return { x: pad.l + (screen.a0 + screen.a1) / 2, y: pad.t + (screen.r0 + screen.r1) / 2 }
    }
    const mid_a = (screen.a0 + screen.a1) / 2
    const mid_r = (screen.r0 + screen.r1) / 2
    return { x: cx + Math.sin(mid_a) * mid_r, y: cy - Math.cos(mid_a) * mid_r }
  }

  // Continuous metric coloring: when color_values is given, arcs are colored by their
  // metric on a d3 colormap (arcs returning null keep their categorical color).
  // The user accessor runs exactly once per arc.
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
  const arc_color = (arc: PositionedArc<Metadata>): string =>
    metric?.colors[arc.node_idx] ?? arc.color
  // release the colorbar's reserved chart space when it's not rendered
  $effect(() => {
    if (!metric || colorbar == null) colorbar_height = 0
  })

  // Predicate keeping the hovered arc + its ancestors/descendants fully opaque.
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
  const arc_opacity = (arc: PositionedArc<Metadata>): number => {
    if (is_muted(arc)) return MUTED_OPACITY
    if (active && !active(arc)) return 0.3
    return 1
  }

  // Black/white label text, whichever contrasts with the arc's fill (light arcs from
  // explicit colors or level_lighten would hide white labels, esp. when highlighted).
  // Memoized per color string - parsing/luminance would otherwise run per label per
  // animation frame, and distinct arc colors are few.
  const contrast_cache = new Map<string, string>()
  const label_color = (arc: PositionedArc<Metadata>): string => {
    const fill = arc_color(arc)
    let contrast = contrast_cache.get(fill)
    if (contrast === undefined) {
      contrast = pick_contrast_color({ bg_color: fill })
      contrast_cache.set(fill, contrast)
    }
    return contrast
  }

  // Parent arc of an arc (null for the root) and its display name
  const parent_of = (arc: PositionedArc<Metadata>): PositionedArc<Metadata> | null =>
    arc.parent_idx != null ? layout.arcs[arc.parent_idx] : null
  const arc_name = (arc: PositionedArc<Metadata>): string => arc.label ?? `${arc.id}`

  function make_node_props(arc: PositionedArc<Metadata>): SunburstNodeHandlerProps<Metadata> {
    // Handler props are the arc minus its screen geometry, plus the parent id
    const { x0, x1, y0, y1, subtree_end, parent_idx, ...node } = arc
    return {
      ...node,
      type: `node`,
      color: arc_color(arc),
      parent_id: parent_of(arc)?.id ?? null,
    }
  }

  // Anchor the tooltip at the cursor (mouse hover) so it follows the pointer across
  // wide arcs; fall back to the arc centroid on keyboard focus (no cursor).
  const event_pos = (event?: MouseEvent | FocusEvent): { x: number; y: number } | null =>
    event instanceof MouseEvent ? get_relative_coords(event, svg_element) : null

  function set_arc_hover(screen: ScreenArc | null, event?: MouseEvent | FocusEvent) {
    // Same arc as before: only the cursor anchor moves - skip rebuilding the handler
    // payload and re-firing change/on_node_hover on every mousemove within an arc.
    // Requires hover_info: legend item hover sets hovered_idx alone (for dimming), and
    // skipping then would leave the arc's own tooltip permanently suppressed.
    if (screen && screen.arc.node_idx === hovered_idx && hover_info) {
      hover_pos = event_pos(event) ?? hover_pos
      return
    }
    if (screen) {
      hovered = true
      hovered_idx = screen.arc.node_idx
      hover_info = make_node_props(screen.arc)
      hover_pos = event_pos(event) ?? arc_center(screen)
      change(hover_info)
      if (event) on_node_hover?.({ ...hover_info, event })
    } else {
      // Already clear: don't re-fire change(null)/on_node_hover(null) - both the svg
      // and chart group have mouseleave handlers, and zoom_to clears unconditionally
      if (hovered_idx == null && hover_info == null) return
      hovered = false
      hovered_idx = null
      hover_info = null
      change(null)
      on_node_hover?.(null)
    }
  }

  const screen_arc_from_event = (event: Event): ScreenArc | null => {
    const idx = closest_data_idx(event, `data-sunburst-node-idx`, svg_element)
    return idx == null ? null : (screen_arcs[idx] ?? null)
  }

  function handle_arc_hover_event(event: MouseEvent | FocusEvent) {
    const screen = screen_arc_from_event(event)
    // roving tabindex follows keyboard focus
    if (event.type === `focusin` && screen) focused_idx = screen.arc.node_idx
    set_arc_hover(screen, event)
  }

  // Re-root the view on the given arc (or the data root when null) and notify
  function zoom_to(arc: PositionedArc<Metadata> | null) {
    zoom_root_id = arc && arc.depth > 0 ? arc.id : null
    // The clicked arc collapses into the hole - drop the now-stale hover/tooltip
    set_arc_hover(null)
    on_zoom?.({ root: arc && arc.depth > 0 ? make_node_props(arc) : null })
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

  function handle_arc_click(event: MouseEvent | KeyboardEvent) {
    if (event instanceof MouseEvent && selection_in_chart()) return
    const screen = screen_arc_from_event(event)
    if (!screen) return
    const { arc } = screen
    on_node_click?.({ ...make_node_props(arc), event })
    if (zoom_on_click && !arc.is_leaf && arc.id !== zoom_root?.id) zoom_to(arc)
  }

  function zoom_out(event?: Event) {
    if (event instanceof MouseEvent && selection_in_chart()) return
    if (!zoomed) return
    zoom_to(breadcrumb_arcs.at(-2) ?? null)
  }

  // Double-clicking empty chart background resets the zoom to the root (double-
  // clicking an arc or label is click-to-zoom/text-selection territory, not a reset;
  // the center zoom-out button already fired its own click action twice - compounding
  // a third full reset would teleport step-by-step zoom-outs straight to the root)
  function handle_dblclick(event: MouseEvent) {
    if (screen_arc_from_event(event) || selection_in_chart()) return
    const target = event.target as Element | null
    if (target?.closest?.(`.center-circle, .center-label`)) return
    if (zoomed) zoom_to(null)
  }

  const focus_arc = (idx: number | null) => {
    if (idx == null) return
    svg_element
      ?.querySelector<SVGPathElement>(`.arcs [data-sunburst-node-idx="${idx}"]`)
      ?.focus()
  }

  // Arrow-key navigation: left/right cycle through visible siblings (wrapping),
  // down enters the first child, up returns to the parent. The pre-order walk
  // lives in render.ts (arrow_nav_target); this wrapper supplies the event's arc
  // and the current screen-space visibility.
  const nav_target_from_event = (event: KeyboardEvent): number | null => {
    const cur = screen_arc_from_event(event)?.arc
    if (!cur) return null
    return arrow_nav_target(
      layout.arcs,
      (idx) => screen_arcs[idx]?.visible ?? false,
      cur.node_idx,
      event.key,
    )
  }

  const is_activation_key = (evt: KeyboardEvent) => [`Enter`, ` `].includes(evt.key)

  function handle_arc_keydown(event: KeyboardEvent) {
    const nav_target = nav_target_from_event(event)
    if (nav_target != null) {
      event.preventDefault()
      focus_arc(nav_target)
      return
    }
    if (!is_activation_key(event)) return
    event.preventDefault()
    const prev_root = zoom_root_id
    handle_arc_click(event)
    // Zooming via keyboard unmounts the focused arc - move focus to the center circle
    // (the zoom-out button) so keyboard users stay inside the chart. In icicle mode
    // focus the new root's first child (pre-order: node_idx + 1): the clicked arc
    // itself collapses to zero height once the zoom tween settles, so focusing it
    // (the roving index) would drop focus to <body> mid-animation.
    if (zoom_root_id !== prev_root) {
      tick().then(() => {
        if (shape === `sunburst`) center_el?.focus()
        else focus_arc(zoom_root ? zoom_root.node_idx + 1 : roving_idx)
      })
    }
  }

  function handle_center_keydown(event: KeyboardEvent) {
    if (!is_activation_key(event)) return
    event.preventDefault()
    zoom_out()
  }

  const arc_clickable = (arc: PositionedArc<Metadata>): boolean =>
    Boolean(on_node_click) || (zoom_on_click && !arc.is_leaf)

  // Measure label fit in the font labels actually render in (respects the
  // --sunburst-font-size CSS var instead of assuming 11px). Memoized because canvas
  // measureText is far too slow to run for every visible arc on every tween frame.
  let label_font = $derived.by(() => {
    if (!svg_element) return `11px sans-serif`
    const { fontSize, fontFamily } = getComputedStyle(svg_element)
    return `${fontSize} ${fontFamily}`
  })
  const text_width_cache = new Map<string, number>()
  function cached_text_width(text: string, font: string): number {
    const key = `${font}|${text}`
    let text_width = text_width_cache.get(key)
    if (text_width === undefined) {
      if (text_width_cache.size > 10_000) text_width_cache.clear() // growth guard
      text_width = measure_text_width(text, font)
      text_width_cache.set(key, text_width)
    }
    return text_width
  }

  // What an arc's label displays, per the label_text mode (plotly textinfo equivalent)
  const arc_label_str = (arc: PositionedArc<Metadata>): string => {
    const name = arc_name(arc)
    if (label_text === `label`) return name
    const val = format_value(arc.value, value_format)
    if (label_text === `value`) return val
    const pct = format_value(arc.fraction, `.1%`)
    if (label_text === `percent`) return pct
    return label_text === `label+value` ? `${name} ${val}` : `${name} ${pct}`
  }

  // Per-arc label text, measured width and aria string - all view-independent, so
  // computed once per layout/label-option change instead of per animation frame
  // (format_value + canvas measureText would otherwise run per visible arc per frame)
  let arc_info = $derived(
    layout.arcs.map((arc) => {
      const text = arc_label_str(arc)
      return {
        text,
        width: cached_text_width(text, label_font),
        aria: `${arc_name(arc)}: ${arc.value}`,
      }
    }),
  )

  // Label text + placement transform for an arc; null = doesn't fit, hide the label
  function label_attrs(screen: ScreenArc): { transform: string; text: string } | null {
    const { text, width: text_w } = arc_info[screen.arc.node_idx]
    if (!text) return null
    const transform = arc_label_transform(screen, text_w, shape, label_rotation)
    return transform ? { transform, text } : null
  }

  // Legend: one item per depth-1 category, toggling mutes (dims) rather than removes.
  let depth1_arcs = $derived(layout.arcs.filter((arc) => arc.depth === 1))
  let legend_visible = $derived(show_legend && legend != null && depth1_arcs.length > 1)
  let legend_element = $state<HTMLDivElement | undefined>()
  let legend_placement = $derived.by(() => {
    if (!legend_visible || !width || !height) return null
    // Place against the settled (target) geometry, not the animated view - placement
    // is stable during zoom tweens and compute_element_placement runs once per zoom
    // instead of once per frame
    const settled = project_arcs(layout.arcs, view.target, screen_geom).visible
    return compute_element_placement({
      plot_bounds: { x: pad.l, y: pad.t, width: inner_width, height: inner_height },
      element: legend_element,
      element_size: { width: 120, height: 60 },
      axis_clearance: legend?.axis_clearance,
      exclude_rects: [],
      points: settled.map(arc_center),
    })
  })
  let legend_data = $derived.by<LegendItem[]>(() =>
    depth1_arcs.map((arc, idx) => ({
      series_idx: idx,
      label: arc_name(arc),
      visible: !muted_ids.has(arc.id),
      display_style: { symbol_type: `Square` as const, symbol_color: arc_color(arc) },
    })),
  )

  function toggle_category(series_idx: number) {
    const id = depth1_arcs[series_idx]?.id
    if (id === undefined) return
    if (muted_ids.has(id)) muted_ids.delete(id)
    else muted_ids.add(id)
  }

  $effect(() => set_fullscreen_bg(wrapper, fullscreen, `--sunburst-fullscreen-bg`))

  let center_label = $derived(zoom_root?.label ?? (zoomed ? `${zoom_root?.id}` : ``))
  // Where the center circle takes you on click (parent of the current zoom root)
  let zoom_out_label = $derived.by(() => {
    const parent = breadcrumb_arcs.at(-2)
    if (!parent) return ``
    return parent.depth === 0 ? `full chart` : arc_name(parent)
  })

  // Ancestor chain from the root to the current zoom root (clickable breadcrumb trail)
  let breadcrumb_arcs = $derived.by(() => {
    if (!zoom_root || zoom_root.depth === 0) return []
    const chain: PositionedArc<Metadata>[] = []
    for (let cur: PositionedArc<Metadata> | null = zoom_root; cur; cur = parent_of(cur))
      chain.unshift(cur)
    return chain
  })

  // Styles the component applies via CSS that exported standalone SVGs must carry
  // as presentation attributes (inlined onto a clone by the io/export helpers)
  const export_inline_styles = [
    `fill`,
    `stroke`,
    `stroke-width`,
    `text-anchor`,
    `dominant-baseline`,
    `font-size`,
    `font-family`,
    `font-weight`,
    `opacity`,
  ]

  function export_chart(format: `svg` | `png`) {
    if (!svg_element) return
    if (format === `svg`) {
      export_svg_as_svg(svg_element, `${export_filename}.svg`, export_inline_styles)
    } else {
      export_svg_as_png(svg_element, `${export_filename}.png`, 150, export_inline_styles)
    }
  }
</script>

<svelte:window
  onkeydown={(evt) => {
    if (evt.key !== `Escape`) return
    // only react when the user is interacting with this chart (pointer over it,
    // focus inside it, or fullscreen) - Escape zooms out one level, then exits
    // fullscreen once at the root
    const within =
      fullscreen ||
      Boolean(wrapper?.matches(`:hover`)) ||
      Boolean(wrapper && document.activeElement && wrapper.contains(document.activeElement))
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
  class={[`sunburst`, rest.class]}
  class:fullscreen
  class:icicle={shape === `icicle`}
>
  {#if width && height}
    <div class="header-controls">
      {@render header_controls?.({ height, width, fullscreen })}
      {#if show_controls}
        <SunburstControls
          toggle_props={{
            ...controls_toggle_props,
            // join the header flex row instead of absolute positioning (overrides
            // ControlPane's default; flex layout can't overlap with the other buttons)
            style: `position: static; ${controls_toggle_props?.style ?? ``}`,
          }}
          pane_props={controls_pane_props}
          bind:show_controls
          bind:controls_open
          bind:shape
          bind:value_mode
          bind:max_depth
          bind:inner_radius
          bind:pad_angle
          bind:min_fraction
          bind:show_labels
          bind:label_rotation
          bind:label_text
          bind:zoom_on_click
          bind:show_breadcrumbs
          {export_buttons}
          on_export={export_chart}
        >
          {@render controls_extra?.({ zoom_root_id })}
        </SunburstControls>
      {/if}
      {#if fullscreen_toggle}
        <FullscreenToggle bind:fullscreen />
      {/if}
    </div>
    {#if show_breadcrumbs && breadcrumb_arcs.length > 0}
      <nav class="breadcrumbs" aria-label="zoom path">
        {#each breadcrumb_arcs as crumb, crumb_idx (crumb.node_idx)}
          {#if crumb_idx > 0}<span class="breadcrumb-sep" aria-hidden="true">›</span>{/if}
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
      aria-label={rest[`aria-label`] ?? `${shape === `icicle` ? `Icicle` : `Sunburst`} chart`}
      onmouseleave={() => set_arc_hover(null)}
    >
      <!-- Hover/click delegation sits on the chart group (not the arcs group) so
      labels - which carry the same data-sunburst-node-idx and are selectable text -
      forward interactions to their arc instead of swallowing them -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <g
        transform={chart_transform}
        onmousemove={handle_arc_hover_event}
        onmouseleave={() => set_arc_hover(null)}
        onfocusin={handle_arc_hover_event}
        onfocusout={() => set_arc_hover(null)}
        onclick={handle_arc_click}
        ondblclick={handle_dblclick}
        onkeydown={handle_arc_keydown}
      >
        <!-- Arcs -->
        <g class="arcs">
          {#each visible_arcs as screen (screen.arc.node_idx)}
            {#if arc_content}
              {@render arc_content(screen)}
            {:else}
              {@const clickable = arc_clickable(screen.arc)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <path
                d={screen_path(screen)}
                data-sunburst-node-idx={screen.arc.node_idx}
                fill={arc_color(screen.arc)}
                fill-opacity={arc_opacity(screen.arc)}
                role={clickable ? `button` : undefined}
                tabindex={clickable
                  ? screen.arc.node_idx === roving_idx
                    ? 0
                    : -1
                  : undefined}
                aria-label={clickable ? arc_info[screen.arc.node_idx].aria : undefined}
                style:cursor={clickable ? `pointer` : `default`}
              />
            {/if}
          {/each}
        </g>

        <!-- Arc labels: selectable text; data-sunburst-node-idx forwards hover/click
        to the underlying arc via the chart-group delegation above -->
        {#if show_labels}
          <g class="arc-labels">
            {#each visible_arcs as screen (screen.arc.node_idx)}
              {@const lbl = label_attrs(screen)}
              {#if lbl}
                <text
                  class="arc-label"
                  data-sunburst-node-idx={screen.arc.node_idx}
                  transform={lbl.transform}
                  fill={label_color(screen.arc)}
                  fill-opacity={is_muted(screen.arc) ? MUTED_OPACITY : undefined}
                  style:cursor={arc_clickable(screen.arc) ? `pointer` : `text`}
                >
                  {lbl.text}
                </text>
              {/if}
            {/each}
          </g>
        {/if}

        {#if shape === `sunburst`}
          <!-- Center: zoom-out button + current-root summary -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <circle
            bind:this={center_el}
            class="center-circle"
            r={hole_r}
            role={zoomed ? `button` : undefined}
            tabindex={zoomed ? 0 : undefined}
            aria-label={zoomed ? `zoom out to ${zoom_out_label}` : undefined}
            style:cursor={zoomed ? `pointer` : `default`}
            style:pointer-events={zoomed ? `auto` : `none`}
            onclick={zoom_out}
            onkeydown={handle_center_keydown}
          />
          {#if center_content}
            {@render center_content({ root: zoom_root, radius: hole_r, zoomed })}
          {:else if hole_r >= 18 && zoom_root}
            <!-- Selectable text overlaying the center circle; clicks forward to the
            same zoom-out action as the circle (which also handles keyboard) -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <text
              class="center-label"
              style:cursor={zoomed ? `pointer` : `text`}
              onclick={zoom_out}
            >
              {#if center_label}
                <tspan x="0" dy={zoom_root.value ? `-0.3em` : `0.35em`}>
                  {center_label}
                </tspan>
              {/if}
              <tspan x="0" dy={center_label ? `1.2em` : `0.35em`} class="center-value">
                {format_value(zoom_root.value, value_format)}
              </tspan>
            </text>
          {/if}
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
      style="position: absolute; bottom: var(--sunburst-colorbar-bottom, 8px); left: 50%; transform: translateX(-50%); width: var(--sunburst-colorbar-width, 40%); min-width: 120px; pointer-events: auto;"
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
  .sunburst {
    position: relative;
    width: var(--sunburst-width, 100%);
    height: var(--sunburst-height, auto);
    min-height: var(--sunburst-min-height, 300px);
    container-type: size;
    z-index: var(--sunburst-z-index, auto);
    /* flex-basis auto (not 1 = 0%) so an authored height wins over flex sizing in
    column-flex parents while the chart still grows/shrinks to fill fixed layouts */
    flex: var(--sunburst-flex, 1 1 auto);
    display: var(--sunburst-display, flex);
    flex-direction: column;
    background: var(--sunburst-bg, var(--plot-bg));
    border-radius: var(--sunburst-border-radius, var(--border-radius, 3pt));
  }
  .sunburst.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw !important;
    height: 100vh !important;
    z-index: var(--sunburst-fullscreen-z-index, var(--z-index-overlay-nav, 100000001));
    margin: 0;
    border-radius: 0;
    background: var(--sunburst-fullscreen-bg, var(--sunburst-bg, var(--plot-bg)));
    max-height: none !important;
    overflow: hidden;
    /* border-top (not padding-top): bind:clientHeight includes padding but excludes
    borders - padding made the chart overflow + clip its bottom 2em (x-axis title) */
    border-top: var(--plot-fullscreen-padding-top, 2em) solid
      var(--sunburst-fullscreen-bg, var(--sunburst-bg, var(--plot-bg, transparent)));
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
  .breadcrumb {
    background: var(--sunburst-btn-bg, rgba(128, 128, 128, 0.15));
    color: inherit;
    border: none;
    border-radius: 3pt;
    padding: 1px 6px;
    cursor: pointer;
    font: inherit;
  }
  .breadcrumb:hover:not(:disabled) {
    background: var(--sunburst-btn-hover-bg, rgba(128, 128, 128, 0.35));
  }
  .breadcrumbs {
    position: absolute;
    top: var(--sunburst-breadcrumbs-top, 5pt);
    left: var(--sunburst-breadcrumbs-left, 8px);
    z-index: 9;
    display: flex;
    align-items: center;
    gap: 2px;
    flex-wrap: wrap;
    max-width: 75%;
    font-size: var(--sunburst-breadcrumbs-font-size, 0.85em);
  }
  .breadcrumb:disabled {
    cursor: default;
    font-weight: bold;
    background: transparent;
  }
  .breadcrumb-sep {
    opacity: 0.6;
  }
  .sunburst :global(.pane-toggle),
  .sunburst .header-controls {
    opacity: 0;
    transition:
      opacity 0.2s,
      background-color 0.2s;
  }
  .sunburst:hover :global(.pane-toggle),
  .sunburst:hover .header-controls,
  .sunburst :global(.pane-toggle:focus-visible),
  .sunburst :global(.pane-toggle[aria-expanded='true']),
  .sunburst .header-controls:has(:global([aria-expanded='true'])),
  .sunburst .header-controls:focus-within {
    opacity: 1;
  }
  svg {
    width: var(--sunburst-svg-width, 100%);
    height: var(--sunburst-svg-height, 100%);
    flex: var(--sunburst-svg-flex, 1);
    overflow: var(--sunburst-svg-overflow, visible);
    fill: var(--text-color);
    font-size: var(--sunburst-font-size, 11px);
  }
  .arcs path {
    /* stroke via CSS (not presentation attributes): var() substitution in SVG
    presentation attributes is not reliably supported across browsers */
    stroke: var(--sunburst-arc-stroke, var(--plot-bg, white));
    stroke-width: var(--sunburst-arc-stroke-width, 0.25);
    transition:
      fill-opacity 0.15s ease,
      transform 0.15s ease;
    /* hover 'pull': scaling about the chart center offsets the arc radially */
    transform-origin: 0 0;
  }
  .sunburst:not(.icicle) .arcs path:hover {
    transform: scale(var(--sunburst-hover-scale, 1.02));
  }
  .center-circle {
    fill: var(--sunburst-center-bg, transparent);
  }
  .arc-label {
    text-anchor: middle;
    dominant-baseline: central;
    /* selectable so labels can be copied; clicks/hover still reach the underlying
    arc via data-sunburst-node-idx + delegation on the chart group */
    -webkit-user-select: text;
    user-select: text;
  }
  .center-label {
    fill: var(--text-color);
    text-anchor: middle;
    font-weight: bold;
    -webkit-user-select: text;
    user-select: text;
  }
  .center-label .center-value {
    font-weight: normal;
    opacity: 0.8;
  }
</style>
