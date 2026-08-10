<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import type { D3InterpolateName } from '$lib/colors'
  import { format_value } from '$lib/labels'
  import { DEG_TO_RAD, type Vec2 } from '$lib/math'
  import type {
    BasePlotProps,
    LegendConfig,
    SunburstGroupGap,
    SunburstLabelRotation,
    SunburstLabelText,
    SunburstNode,
    SunburstNodeHandlerProps,
    SunburstShape,
    SunburstSort,
    SunburstValueMode,
  } from '$lib/plot'
  import { ColorBar, SunburstControls } from '$lib/plot'
  import HierarchyShell from '$lib/plot/core/components/HierarchyShell.svelte'
  import type { Sides } from '$lib/plot/core/layout'
  import { SCALE_DEFAULTS } from '$lib/plot/core/types'
  import { type ColorBarSide, is_activation_key } from '$lib/plot/core/utils/hierarchy-chart'
  import {
    HierarchyChartState,
    type HierarchyChartProps,
  } from '$lib/plot/core/utils/hierarchy-state.svelte'
  import { node_display_name } from '$lib/plot/core/utils/hierarchy-labels'
  import {
    arc_label_transform,
    project_arcs,
    type ScreenArc as ScreenArcOf,
  } from '$lib/plot/sunburst/render'
  import type { PositionedArc } from '$lib/plot/sunburst/sunburst'
  import { DEFAULTS } from '$lib/settings'
  import { arc as d3_arc } from 'd3-shape'
  import { type ComponentProps, type Snippet, untrack } from 'svelte'
  import { cubicInOut } from 'svelte/easing'
  import type { HTMLAttributes } from 'svelte/elements'
  import { Tween, type TweenOptions } from 'svelte/motion'

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
    // shared verbatim with Treemap
    HierarchyChartProps<Metadata> & {
      shape?: SunburstShape // polar rings (sunburst) or stacked rows (icicle)
      inner_radius?: number // center hole as fraction of outer radius
      pad_angle?: number // degrees between sibling arcs
      label_rotation?: SunburstLabelRotation
      group_gap?: SunburstGroupGap<Metadata> | null
      tween?: TweenOptions<{ x0: number; x1: number; y0: number; n_rings: number }>
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
    zoom_mode: `branches`, // leaves are terminal here (unlike the treemap)
    default_padding: DEFAULT_PADDING,
    // the center circle/label run their own zoom-out click action, so a fast
    // double-click on them must not compound a full reset on top of it
    dblclick_ignore: `.center-circle, .center-label`,
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
    clickable: (arc) => arc_clickable(arc),
    visible: (idx) => screen_arcs[idx]?.visible ?? false,
    node_center: (idx) => {
      const screen = screen_arcs[idx]
      return screen ? arc_center(screen) : null
    },
    // Place against the settled (target) geometry, not the animated view -
    // placement is stable during zoom tweens and runs once per zoom instead of
    // once per frame
    legend_points: () =>
      project_arcs(chart_state.arcs, view.target, screen_geom, { group_gap }).visible.map(
        arc_center,
      ),
    // In icicle mode focus the new root's first child (pre-order: node_idx + 1):
    // the clicked arc itself collapses to zero height once the zoom tween
    // settles, so focusing it (the roving index) would drop focus to <body>
    // mid-animation. Polar mode hands focus to the center zoom-out button.
    focus_after_zoom: () => {
      if (shape === `sunburst`) center_el?.focus()
      else {
        chart_state.focus_node(
          chart_state.zoom_root ? chart_state.zoom_root.node_idx + 1 : roving_idx,
        )
      }
    },
  })

  // The view window in normalized partition coordinates: the zoom root's angular
  // span + how many rings to show below it
  let view_target = $derived.by(() => {
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
  // tweens, no re-layout). Tween.of seeds it at view_target (charts load fully drawn)
  // then re-targets on change via a render-effect that reads only view_target, never
  // view.current - so the tween can't feed back into its own target. untrack reads the
  // tween options once at init (they're not meant to update reactively).
  const view = Tween.of(
    () => view_target,
    untrack(() => ({ duration: 400, easing: cubicInOut, ...tween })),
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
  // with view.target where settled geometry suffices (e.g. legend placement, which
  // shouldn't rerun per frame)
  let projection = $derived(
    project_arcs(chart_state.arcs, view.current, screen_geom, { group_gap }),
  )
  let screen_arcs = $derived(projection.all)
  // Rendering iterates only non-collapsed arcs - when zoomed into a small subtree of
  // a large hierarchy this keeps per-frame template work proportional to what's on screen
  let visible_arcs = $derived(projection.visible)

  // Roving tabindex: exactly one arc is in the tab order (the last-focused one, else
  // the first visible clickable arc); arrow keys move focus between arcs. Without
  // this, tabbing through a large chart would visit every single arc.
  let roving_idx = $derived.by(() => {
    const { focused_idx } = chart_state
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

  // Label text + placement transform for an arc; null = no variant fits, hide
  // the label. Full font size wins over richer text: within each scale the
  // richest variant that fits is used (extended -> label -> label_short).
  function label_attrs(
    screen: ScreenArc,
  ): { transform: string; text: string; font_scale: number } | null {
    for (const font_scale of LABEL_FONT_SCALES) {
      for (const { text, width: text_w } of chart_state.node_infos[screen.arc.node_idx]
        .variants) {
        const transform = arc_label_transform(
          screen,
          text_w * font_scale,
          shape,
          label_rotation,
          radius,
          font_scale,
        )
        if (transform) return { transform, text, font_scale }
      }
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

<div
  bind:this={chart_state.wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  {...rest}
  class={[`sunburst`, rest.class]}
  class:fullscreen
  class:icicle={shape === `icicle`}
>
  <HierarchyShell
    {chart_state}
    aria_label={rest[`aria-label`] ?? `${shape === `icicle` ? `Icicle` : `Sunburst`} chart`}
    {chart_transform}
    {show_breadcrumbs}
    crumb_separator
    dblclick_target="group"
    {fullscreen_toggle}
    {header_controls}
    {tooltip}
    {children}
  >
    {#snippet controls()}
      {#if show_controls}
        <SunburstControls
          chart="sunburst"
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
          on_export={chart_state.export_chart}
        >
          {@render controls_extra?.({ zoom_root_id })}
        </SunburstControls>
      {/if}
    {/snippet}

    {#snippet body()}
      <!-- Arcs -->
      <g class="arcs">
        {#each visible_arcs as screen (screen.arc.node_idx)}
          {#if arc_content}
            {@render arc_content(screen)}
          {:else}
            <!-- @const so the path is generated (and info looked up) once per
            arc per frame, shared by the base path and the hatch overlay -->
            {@const info = chart_state.node_infos[screen.arc.node_idx]}
            {@const opacity = chart_state.node_dim[screen.arc.node_idx].opacity}
            {@const path_d = screen_path(screen)}
            <!-- svelte-ignore a11y_no_static_element_interactions, a11y_no_noninteractive_tabindex -->
            <path
              d={path_d}
              data-sunburst-node-idx={screen.arc.node_idx}
              fill={info.fill}
              fill-opacity={opacity}
              role={info.clickable ? `button` : undefined}
              tabindex={info.clickable
                ? screen.arc.node_idx === roving_idx
                  ? 0
                  : -1
                : undefined}
              aria-label={info.clickable ? info.aria : undefined}
              style:cursor={info.clickable ? `pointer` : `default`}
            />
            {#if screen.arc.hatch}
              <!-- Decorative texture overlay (e.g. preemptible jobs); rendered as
              the base path's next sibling so the hover 'pull' can track it -->
              <path
                class="arc-hatch"
                aria-hidden="true"
                d={path_d}
                fill="url(#{chart_state.hatch_pattern_id})"
                fill-opacity={opacity}
              />
            {/if}
          {/if}
        {/each}
      </g>

      <!-- Arc labels: selectable text; data-sunburst-node-idx forwards hover/click
      to the underlying arc via the chart-group delegation in the shell -->
      {#if show_labels}
        <g class="arc-labels">
          {#each visible_arcs as screen (screen.arc.node_idx)}
            {@const lbl = label_attrs(screen)}
            {#if lbl}
              {@const info = chart_state.node_infos[screen.arc.node_idx]}
              <text
                class="arc-label"
                data-sunburst-node-idx={screen.arc.node_idx}
                transform={lbl.transform}
                fill={info.label_fill}
                fill-opacity={chart_state.node_dim[screen.arc.node_idx].label_opacity}
                style="cursor: {info.clickable ? `pointer` : `text`}{lbl.font_scale === 1
                  ? ``
                  : `; font-size: ${lbl.font_scale}em`}"
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
    /* Use the plot background by default; set --sunburst-bg to override it. */
    background: var(--sunburst-bg, var(--plot-bg));
    border-radius: var(--sunburst-border-radius, 0);
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
  /* :global for everything HierarchyShell renders (header row, breadcrumbs, the
  chart svg and the hatch pattern): those elements carry the shell's scope, not
  this component's, but their theming stays in the chart's variable namespace */
  .sunburst :global(.breadcrumb) {
    background: var(--sunburst-btn-bg, rgba(128, 128, 128, 0.15));
    color: inherit;
    border: none;
    border-radius: 3pt;
    padding: 1px 6px;
    cursor: pointer;
    font: inherit;
  }
  .sunburst :global(.breadcrumb:hover:not(:disabled)) {
    background: var(--sunburst-btn-hover-bg, rgba(128, 128, 128, 0.35));
  }
  .sunburst :global(.breadcrumbs) {
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
  .sunburst :global(.breadcrumb:disabled) {
    cursor: default;
    font-weight: bold;
    background: transparent;
  }
  .sunburst :global(.pane-toggle),
  .sunburst :global(.header-controls) {
    opacity: 0;
    transition:
      opacity 0.2s,
      background-color 0.2s;
  }
  .sunburst:hover :global(.pane-toggle),
  .sunburst:hover :global(.header-controls),
  .sunburst :global(.pane-toggle:focus-visible),
  .sunburst :global(.pane-toggle[aria-expanded='true']),
  .sunburst :global(.header-controls:has([aria-expanded='true'])),
  .sunburst :global(.header-controls:focus-within) {
    opacity: 1;
  }
  .sunburst :global(svg[role='application']) {
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
  /* the hatch overlay (an arc's next sibling) rides along with its hover 'pull' */
  .sunburst:not(.icicle) .arcs path:hover,
  .sunburst:not(.icicle) .arcs path:hover + path.arc-hatch {
    transform: scale(var(--sunburst-hover-scale, 1.02));
  }
  /* decorative overlay: never intercepts pointer events, no border of its own */
  .arcs path.arc-hatch {
    stroke: none;
    pointer-events: none;
  }
  /* subtle by default: thin stripes inheriting the arc border color (itself
  defaulting to the chart bg) at low opacity, so hatching matches the gaps
  between slices instead of reading as solid white */
  .sunburst :global(.hatch-pattern-line) {
    stroke: var(
      --sunburst-hatch-stroke,
      color-mix(in srgb, var(--sunburst-arc-stroke, var(--plot-bg, white)) 30%, transparent)
    );
    stroke-width: var(--sunburst-hatch-stroke-width, 0.35);
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
  .center-circle {
    fill: var(--sunburst-center-bg, transparent);
  }
  .center-label .center-value {
    font-weight: normal;
    opacity: 0.8;
  }
</style>
