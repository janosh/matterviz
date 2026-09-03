<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import { format_value } from '$lib/labels'
  import { DEG_TO_RAD } from '$lib/math'
  import type {
    BasePlotProps,
    SunburstGroupGap,
    SunburstLabelRotation,
    SunburstShape,
  } from '$lib/plot'
  import { SunburstControls } from '$lib/plot'
  import ChartShell from '$lib/plot/core/components/ChartShell.svelte'
  import HierarchyShell from '$lib/plot/core/components/HierarchyShell.svelte'
  import { is_activation_key } from '$lib/plot/core/interactions'
  import type { Sides } from '$lib/plot/core/layout'
  import { create_settling_tween } from '$lib/plot/core/settling-tween.svelte'
  import { SCALE_DEFAULTS } from '$lib/plot/core/types'
  import { ellipsize_to_width, node_display_name } from '$lib/plot/core/utils/hierarchy-chart'
  import type { HierarchyChartProps } from '$lib/plot/core/utils/hierarchy-state.svelte'
  import {
    HierarchyChartState,
    hierarchy_layout_options,
  } from '$lib/plot/core/utils/hierarchy-state.svelte'
  import type { ScreenArc as ScreenArcOf, ViewWindow } from '$lib/plot/sunburst/render'
  import {
    arc_label_slots,
    hover_veil_path,
    project_arcs,
    rect_path,
  } from '$lib/plot/sunburst/render'
  import type { PositionedArc } from '$lib/plot/core/utils/hierarchy-layout'
  import { DEFAULTS } from '$lib/settings'
  import { arc as d3_arc } from 'd3-shape'
  import { type Snippet, untrack } from 'svelte'
  import { cubicInOut } from 'svelte/easing'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { TweenOptions } from 'svelte/motion'

  // Preserve the established outer inset; pass `padding` to override chart-edge space.
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
    max_children = $bindable(DEFAULTS.sunburst.max_children),
    other_label = `Other`,
    max_depth = $bindable(DEFAULTS.sunburst.max_depth),
    inner_radius = $bindable(DEFAULTS.sunburst.inner_radius),
    pad_angle = $bindable(DEFAULTS.sunburst.pad_angle),
    group_gap,
    show_labels = $bindable(DEFAULTS.sunburst.show_labels),
    label_rotation = $bindable(DEFAULTS.sunburst.label_rotation),
    label_text = $bindable(DEFAULTS.sunburst.label_text),
    zoom_on_click = $bindable(DEFAULTS.sunburst.zoom_on_click),
    zoom_root_id = $bindable(null),
    show_breadcrumbs = $bindable(DEFAULTS.sunburst.show_breadcrumbs),
    color_values,
    color_scale = SCALE_DEFAULTS.scheme,
    color_range,
    color_bar = {},
    color_bar_side = `right`,
    export_buttons = true,
    export_filename = `sunburst`,
    tween,
    value_format = `,`,
    padding = DEFAULT_PADDING,
    legend = {},
    show_legend,
    tooltip,
    arc_content,
    center_content,
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
    // shared verbatim with Treemap
    HierarchyChartProps<Metadata> & {
      shape?: SunburstShape // polar rings (sunburst) or stacked rows (icicle)
      inner_radius?: number // center hole as fraction of outer radius
      pad_angle?: number // degrees between sibling arcs
      label_rotation?: SunburstLabelRotation
      group_gap?: SunburstGroupGap<Metadata> | null
      tween?: TweenOptions<ViewWindow> // zoom transition timing
      // Fully replace the default arc path. NOTE: this also replaces the built-in
      // hover/focus/click + tooltip wiring, so re-implement any interactivity you
      // need inside the snippet.
      arc_content?: Snippet<
        [{ arc: PositionedArc<Metadata>; a0: number; a1: number; r0: number; r1: number }]
      >
      center_content?: Snippet<
        [{ root: PositionedArc<Metadata> | null; radius: number; zoomed: boolean }]
      >
    } = $props()

  let [width, height] = $state([0, 0])
  let center_el: SVGCircleElement | null = $state(null)
  const uid = $props.id()

  // Hierarchy ingestion, zoom/hover/legend state, color-bar layout and keyboard
  // plumbing are shared with Treemap; only the polar projection below is ours.
  // annotated because the geometry hooks below close over `chart_state` itself
  const chart_state: HierarchyChartState<Metadata> = new HierarchyChartState<Metadata>({
    chart: `sunburst`,
    uid,
    default_padding: DEFAULT_PADDING,
    // the center circle/label run their own zoom-out click action, so a fast
    // double-click on them must not compound a full reset on top of it
    dblclick_ignore: `.center-circle, .center-label`,
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
    clickable: (arc) => arc_clickable(arc),
    per_node_hover_dim: false, // hover dimming is the veil path below
    visible: (idx) => screen_arcs[idx]?.visible ?? false,
    node_center: (idx) => {
      const screen = screen_arcs[idx]
      return screen ? arc_center(screen) : null
    },
    // Place against the settled (target) geometry, not the animated view -
    // placement is stable during zoom tweens and runs once per zoom instead of
    // once per frame
    legend_points: () =>
      project_arcs(chart_state.arcs, view_target, screen_geom, { group_gap }).visible.map(
        arc_center,
      ),
    // In icicle mode focus the new root's first child (pre-order: node_idx + 1):
    // the clicked arc itself collapses to zero height once the zoom tween
    // settles, so focusing it (the roving index) would drop focus to <body>
    // mid-animation. Polar mode hands focus to the center zoom-out button.
    focus_after_zoom: () => {
      if (shape === `sunburst`) center_el?.focus()
      else
        chart_state.focus_node(
          chart_state.zoom_root ? chart_state.zoom_root.node_idx + 1 : roving_idx,
        )
    },
  })

  // The view window in normalized partition coordinates: the zoom root's angular
  // span + how many rings to show below it
  let view_target: ViewWindow = $derived.by(() => {
    const { layout, zoom_root } = chart_state
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
  // tweens, no re-layout). Seeded at view_target so charts load fully drawn; the
  // structural is_same keeps a data swap that re-derives an identical window from
  // restarting the tween. untrack reads the tween options once at init.
  const view = create_settling_tween(
    () => view_target,
    untrack(() => ({ duration: 400, easing: cubicInOut, ...tween })),
    {
      is_same: (prev, next) =>
        prev.x0 === next.x0 &&
        prev.x1 === next.x1 &&
        prev.y0 === next.y0 &&
        prev.n_rings === next.n_rings,
    },
  )

  // Pixel geometry
  let radius = $derived(
    Math.max(0, Math.min(chart_state.inner_width, chart_state.inner_height) / 2),
  )
  let cx = $derived(chart_state.plot_left + chart_state.inner_width / 2)
  let cy = $derived(chart_state.pad.t + chart_state.inner_height / 2)
  // Min 14px center hole when zoomed so there's always a zoom-out click target
  let hole_r = $derived(Math.max(inner_radius * radius, chart_state.zoomed ? 14 : 0))

  let screen_geom = $derived({
    shape,
    inner_width: chart_state.inner_width,
    inner_height: chart_state.inner_height,
    radius,
    hole_r,
  })

  // Projected with view.current once per animation frame; project_arcs is also called
  // with view_target where settled geometry suffices (e.g. legend placement, which
  // shouldn't rerun per frame)
  let projection = $derived(
    project_arcs(chart_state.arcs, view.current, screen_geom, { group_gap }),
  )
  let screen_arcs = $derived(projection.all)
  // Rendering iterates only non-collapsed arcs - when zoomed into a small subtree of
  // a large hierarchy this keeps per-frame template work proportional to what's on screen
  let visible_arcs = $derived(projection.visible)

  // Every visible arc is focusable and labelled, not just the clickable ones, so arrow keys
  // reach leaf tooltips instead of dead-ending. role="button" stays limited to clickable arcs.
  let roving_idx = $derived(chart_state.roving_idx(visible_arcs[0]?.arc.node_idx ?? null))

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
      ? rect_path(screen.a0, screen.a1, screen.r0, screen.r1)
      : (arc_gen(screen) ?? ``)

  // Hover dimming as one path with holes for the hovered subtree and its ancestors (see
  // hover_veil_path). Re-derives per frame while zooming, but only walks the ancestry.
  let hover_veil = $derived(
    chart_state.hovered_idx == null
      ? null
      : hover_veil_path(screen_arcs, chart_state.hovered_idx, screen_geom),
  )

  // The chart group's transform: sunburst draws around the center, icicle from the
  // top-left of the padded plot area
  let chart_transform = $derived(
    shape === `icicle`
      ? `translate(${chart_state.plot_left}, ${chart_state.pad.t})`
      : `translate(${cx}, ${cy})`,
  )

  // Arc centroid in container (pad-offset) pixel space, for tooltip + legend placement
  const arc_center = (screen: ScreenArc): { x: number; y: number } => {
    if (shape === `icicle`) {
      return {
        x: chart_state.plot_left + (screen.a0 + screen.a1) / 2,
        y: chart_state.pad.t + (screen.r0 + screen.r1) / 2,
      }
    }
    const mid_a = (screen.a0 + screen.a1) / 2
    const mid_r = (screen.r0 + screen.r1) / 2
    return { x: cx + Math.sin(mid_a) * mid_r, y: cy - Math.cos(mid_a) * mid_r }
  }

  const arc_clickable = (arc: PositionedArc<Metadata>): boolean =>
    Boolean(on_node_click) || (zoom_on_click && !arc.is_leaf)

  function handle_center_keydown(event: KeyboardEvent) {
    if (!is_activation_key(event)) return
    event.preventDefault()
    chart_state.zoom_out()
  }

  // Downscale steps tried when no label variant fits at full size: narrow
  // slices keep a (smaller) label instead of losing it entirely.
  const LABEL_FONT_SCALES = [1, 0.85, 0.7]

  // Label text + placement transform for an arc; null = nothing fits, hide the
  // label. Full font size wins over richer text: within each scale the richest
  // variant that fits is used (extended -> label -> label_short). When no variant
  // fits at any scale, the most compact one is cut to an ellipsis at the smallest
  // scale: a ring of unlabeled arcs beside one bucket that still reads "Other" told
  // the reader nothing, while a cropped name is at least a name. Only names are
  // cropped: a value-only mode without a `label_short` would turn "1.2k" into "1…".
  function label_attrs(
    screen: ScreenArc,
  ): { transform: string; text: string; font_scale: number } | null {
    const { variants } = chart_state.node_infos[screen.arc.node_idx]
    // Slots are computed once per scale (not per variant); the loop leaves the
    // smallest scale's slots behind for the ellipsis fallback
    let font_scale = 1
    let slots: { room: number; transform: string }[] = []
    for (font_scale of LABEL_FONT_SCALES) {
      slots = arc_label_slots(
        screen,
        shape,
        label_rotation,
        radius,
        font_scale,
        chart_state.label_font.line_height,
      )
      for (const { text, width: text_w } of variants) {
        const fit = slots.find(({ room }) => text_w * font_scale <= room)
        if (fit) return { transform: fit.transform, text, font_scale }
      }
    }
    const compact = variants.at(-1)?.text
    if (!compact || !(label_text.startsWith(`label`) || screen.arc.label_short)) return null
    for (const slot of slots.toSorted((left, right) => right.room - left.room)) {
      const text = ellipsize_to_width(compact, slot.room / font_scale, chart_state.label_font)
      if (text) return { transform: slot.transform, text, font_scale }
    }
    return null
  }

  let center_label = $derived(
    chart_state.zoom_root?.label ?? (chart_state.zoomed ? `${chart_state.zoom_root?.id}` : ``),
  )
  // Where the center circle takes you on click (parent of the current zoom root)
  let zoom_out_label = $derived.by(() => {
    const parent = chart_state.breadcrumb_arcs.at(-2)
    if (!parent) return ``
    return parent.depth === 0 ? `full chart` : node_display_name(parent)
  })
</script>

<ChartShell
  chart_class="sunburst"
  css_prefix="sunburst"
  css_var_fallbacks={{ flex: `1 1 auto` }}
  bind:wrapper={chart_state.wrapper}
  bind:width
  bind:height
  bind:fullscreen
  {fullscreen_toggle}
  {controls_toggle_props}
  {header_controls}
  {children}
  {...rest}
  class={[rest.class, { icicle: shape === `icicle` }]}
>
  {#snippet controls(toggle_props)}
    <SunburstControls
      chart="sunburst"
      {toggle_props}
      pane_props={controls_pane_props}
      bind:show_controls
      bind:controls_open
      bind:shape
      bind:value_mode
      bind:max_depth
      bind:inner_radius
      bind:pad_angle
      bind:min_fraction
      bind:max_children
      bind:show_labels
      bind:label_rotation
      bind:label_text
      bind:zoom_on_click
      bind:show_breadcrumbs
      {export_buttons}
      on_export={chart_state.export_chart}
    >
      {@render controls_extra?.({ zoom_root_id })}
    </SunburstControls>
  {/snippet}

  {#snippet body()}
    <HierarchyShell
      {chart_state}
      aria_label={rest[`aria-label`] ?? `${shape === `icicle` ? `Icicle` : `Sunburst`} chart`}
      {chart_transform}
      {show_breadcrumbs}
      crumb_separator
      dblclick_target="group"
      {tooltip}
    >
      {#snippet marks()}
        <!-- Arcs -->
        <g class="arcs">
          {#each visible_arcs as screen (screen.arc.node_idx)}
            {#if arc_content}
              {@render arc_content(screen)}
            {:else}
              {@const info = chart_state.node_infos[screen.arc.node_idx]}
              {@const opacity = chart_state.node_dim(screen.arc.node_idx).opacity}
              <!-- svelte-ignore a11y_no_static_element_interactions, a11y_no_noninteractive_tabindex -->
              <path
                d={screen_path(screen)}
                data-sunburst-node-idx={screen.arc.node_idx}
                fill={info.pattern?.url ?? info.fill}
                fill-opacity={opacity}
                role={info.clickable ? `button` : undefined}
                tabindex={screen.arc.node_idx === roving_idx ? 0 : -1}
                aria-label={info.aria}
                style:cursor={info.clickable ? `pointer` : `default`}
              />
            {/if}
          {/each}
        </g>

        {#if hover_veil}
          <path class="hover-veil" d={hover_veil} />
        {/if}

        <!-- Arc labels: selectable text; data-sunburst-node-idx forwards hover/click
      to the underlying arc via the chart-group delegation in the shell -->
        {#if show_labels}
          <g class="arc-labels">
            {#each visible_arcs as screen (screen.arc.node_idx)}
              {@const lbl = label_attrs(screen)}
              {#if lbl}
                {@const info = chart_state.node_infos[screen.arc.node_idx]}
                {@const dim = chart_state.node_dim(screen.arc.node_idx)}
                {@const font_style =
                  lbl.font_scale === 1 ? `` : `; font-size: ${lbl.font_scale}em`}
                {#if info.label_halo}
                  <!-- Blurred halo in the tile backdrop color so the label stays legible over
                  hatch/dot strokes; style not attributes since the halo may be a CSS var -->
                  <text
                    class="arc-label halo"
                    aria-hidden="true"
                    transform={lbl.transform}
                    style="fill: {info.label_halo}; stroke: {info.label_halo}{font_style}"
                    style:opacity={dim.label_opacity}
                  >
                    {lbl.text}
                  </text>
                {/if}
                <text
                  class="arc-label"
                  data-sunburst-node-idx={screen.arc.node_idx}
                  transform={lbl.transform}
                  fill={info.label_fill}
                  fill-opacity={dim.label_opacity}
                  style="cursor: {info.clickable ? `pointer` : `text`}{font_style}"
                >
                  {lbl.text}
                </text>
              {/if}
            {/each}
          </g>
        {/if}

        {#if shape === `sunburst`}
          <!-- Center: zoom-out button + current-root summary -->
          <!-- svelte-ignore a11y_no_static_element_interactions, a11y_no_noninteractive_tabindex -->
          <circle
            bind:this={center_el}
            class="center-circle"
            r={hole_r}
            role={chart_state.zoomed ? `button` : undefined}
            tabindex={chart_state.zoomed ? 0 : undefined}
            aria-label={chart_state.zoomed ? `zoom out to ${zoom_out_label}` : undefined}
            style="cursor: {chart_state.zoomed
              ? `pointer`
              : `default`}; pointer-events: {chart_state.zoomed ? `auto` : `none`}"
            onclick={chart_state.zoom_out}
            onkeydown={handle_center_keydown}
          />
          {#if center_content}
            {@render center_content({
              root: chart_state.zoom_root,
              radius: hole_r,
              zoomed: chart_state.zoomed,
            })}
          {:else if hole_r >= 18 && chart_state.zoom_root}
            <!-- Selectable text overlaying the center circle; clicks forward to the
          same zoom-out action as the circle (which also handles keyboard) -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <text
              class="center-label"
              style:cursor={chart_state.zoomed ? `pointer` : `text`}
              onclick={chart_state.zoom_out}
            >
              {#if center_label}
                <tspan x="0" dy={chart_state.zoom_root.value ? `-0.3em` : `0.35em`}>
                  {center_label}
                </tspan>
              {/if}
              <tspan x="0" dy={center_label ? `1.2em` : `0.35em`} class="center-value">
                {format_value(chart_state.zoom_root.value, value_format)}
              </tspan>
            </text>
          {/if}
        {/if}
      {/snippet}
    </HierarchyShell>
  {/snippet}
</ChartShell>

<style>
  /* fully :global: the wrapper is ChartShell's element and breadcrumbs and chart svg
  are HierarchyShell's, so none carry this component's scope - but their theming stays
  in the chart's variable namespace */
  :global(.sunburst .breadcrumb) {
    background: var(--sunburst-btn-bg, rgba(128, 128, 128, 0.15));
    color: inherit;
    border: none;
    border-radius: 3pt;
    padding: 1px 6px;
    cursor: pointer;
    font: inherit;
  }
  :global(.sunburst .breadcrumb:hover:not(:disabled)) {
    background: var(--sunburst-btn-hover-bg, rgba(128, 128, 128, 0.35));
  }
  :global(.sunburst .breadcrumbs) {
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
  :global(.sunburst .breadcrumb:disabled) {
    cursor: default;
    font-weight: bold;
    background: transparent;
  }
  :global(.sunburst svg[role='application']) {
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
    stroke: var(--sunburst-arc-stroke, var(--page-bg, white));
    stroke-width: var(--sunburst-arc-stroke-width, 0.25);
    transition:
      fill-opacity 0.15s ease,
      transform 0.15s ease;
    /* hover 'pull': scaling about the chart center offsets the arc radially */
    transform-origin: 0 0;
  }
  :global(.sunburst:not(.icicle)) .arcs path:hover {
    transform: scale(var(--sunburst-hover-scale, 1.02));
  }
  .hover-veil {
    /* page background at 70% over an arc reads as the arc at 30% fill-opacity */
    fill: var(--sunburst-dim-veil, var(--page-bg, white));
    fill-opacity: var(--sunburst-dim-veil-opacity, 0.7);
    fill-rule: evenodd;
    pointer-events: none;
  }
  .arc-label {
    text-anchor: middle;
    dominant-baseline: central;
    /* selectable so labels can be copied; clicks/hover still reach the underlying
    arc via data-sunburst-node-idx + delegation on the chart group */
    -webkit-user-select: text;
    user-select: text;
  }
  .arc-label.halo {
    /* slightly see-through so the texture still reads as continuing under the label */
    opacity: 0.9;
    filter: blur(var(--sunburst-label-halo-blur, 1px));
    stroke-width: 0.4em;
    stroke-linejoin: round;
    pointer-events: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .center-label {
    fill: var(--text-color);
    text-anchor: middle;
    font-weight: bold;
    -webkit-user-select: text;
    user-select: text;
  }
  .center-circle {
    fill: var(--sunburst-center-bg, transparent);
  }
  .center-label .center-value {
    font-weight: normal;
    opacity: 0.8;
  }
</style>
