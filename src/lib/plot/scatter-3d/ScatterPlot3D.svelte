<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import { type D3InterpolateName, plot_color } from '$lib/colors'
  import type { Vec2, Vec3 } from '$lib/math'
  import ChartShell from '$lib/plot/core/components/ChartShell.svelte'
  import ColorBar from '$lib/plot/core/components/ColorBar.svelte'
  import PlotLegend from '$lib/plot/core/components/PlotLegend.svelte'
  import { build_legend_items, first_point_style } from '$lib/plot/core/data-transform'
  import type {
    AxisConfig3D,
    BasePlotProps,
    CameraProjection3D,
    ColorScaleConfig,
    DataSeries3D,
    DisplayConfig3D,
    InternalPoint3D,
    LegendConfig,
    RefLine3D,
    RefPlane,
    Scatter3DHandlerEvent,
    SizeScaleConfig,
    StyleOverrides3D,
    Surface3DConfig,
  } from '$lib/plot/core/types'
  import { assert_series_lengths, SCALE_DEFAULTS } from '$lib/plot/core/types'
  import { Canvas } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { onMount } from 'svelte'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { Camera, Scene } from 'three/webgpu'
  import { collect_scale_values, create_color_scale } from '$lib/plot/core/scales'
  import {
    create_legend_visibility,
    resolve_legend_visibility,
  } from '$lib/plot/core/utils/series-visibility'
  import { create_renderer, type GizmoOptions, webgpu_available } from '$lib/scene'
  import ScatterPlot3DControls, {
    DISPLAY_DEFAULTS_3D,
  } from '$lib/plot/scatter-3d/ScatterPlot3DControls.svelte'
  import ScatterPlot3DScene from '$lib/plot/scatter-3d/ScatterPlot3DScene.svelte'

  let {
    // Data props
    series: series_in = $bindable([]),
    surfaces = [],
    ref_lines = [],
    ref_planes = [],
    x_axis = $bindable({}),
    y_axis = $bindable({}),
    z_axis = $bindable({}),
    display = $bindable({}),
    styles = {},
    // Color and size scaling
    color_scale = SCALE_DEFAULTS.color,
    color_bar = {},
    size_scale = SCALE_DEFAULTS.size_3d,
    // Legend
    legend = {},
    show_legend,
    // Camera settings
    camera_position = $bindable([8, 8, 8]),
    camera_projection = $bindable(`perspective` as CameraProjection3D),
    auto_rotate = $bindable(0),
    rotation_damping = 0,
    fov = 50,
    min_zoom = 0.1,
    max_zoom = 100,
    rotate_speed = 1,
    zoom_speed = 2,
    pan_speed = 2,
    // Lighting
    ambient_light = 0.6,
    directional_light = 0.8,
    // Rendering quality
    sphere_segments = 16,
    // Gizmo
    gizmo = true,
    // Controls
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    controls_toggle_props,
    controls_pane_props,
    // State
    hovered = $bindable(false),
    tooltip_point = $bindable(null),
    // Callbacks
    on_point_click,
    on_point_hover,
    // Fullscreen
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    // Binding refs
    wrapper = $bindable(),
    scene = $bindable(),
    camera = $bindable(),
    orbit_controls = $bindable(),
    // Snippets
    tooltip,
    children,
    header_controls,
    controls_extra,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    series?: DataSeries3D<Metadata>[]
    surfaces?: Surface3DConfig[]
    ref_lines?: RefLine3D[]
    ref_planes?: RefPlane[]
    x_axis?: AxisConfig3D
    y_axis?: AxisConfig3D
    z_axis?: AxisConfig3D
    display?: DisplayConfig3D
    styles?: StyleOverrides3D
    color_scale?: ColorScaleConfig | D3InterpolateName
    color_bar?: ComponentProps<typeof ColorBar> | null
    size_scale?: SizeScaleConfig
    legend?: LegendConfig | null
    show_legend?: boolean
    camera_position?: Vec3
    camera_projection?: CameraProjection3D
    auto_rotate?: number
    rotation_damping?: number
    fov?: number
    min_zoom?: number
    max_zoom?: number
    rotate_speed?: number
    zoom_speed?: number
    pan_speed?: number
    ambient_light?: number
    directional_light?: number
    sphere_segments?: number
    gizmo?: boolean | GizmoOptions
    tooltip_point?: InternalPoint3D<Metadata> | null
    on_point_click?: (data: Scatter3DHandlerEvent<Metadata>) => void
    on_point_hover?: (data: Scatter3DHandlerEvent<Metadata> | null) => void
    wrapper?: HTMLDivElement
    scene?: Scene
    camera?: Camera
    orbit_controls?: ComponentProps<typeof extras.OrbitControls>[`ref`]
    tooltip?: Snippet<[Scatter3DHandlerEvent<Metadata>]>
    children?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
    header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
    controls_extra?: Snippet
  } & Omit<BasePlotProps, `range_padding` | `padding` | `title` | `children`> = $props()

  // Legend toggles write `visible` into the bindable series prop so bound parents see
  // them, and `series` layers the user's overrides back on whenever the parent
  // replaces the array so hidden series stay hidden
  const legend_vis = create_legend_visibility(
    () => series,
    (next) => (series_in = next),
  )
  let series: DataSeries3D<Metadata>[] = $derived(legend_vis.resolve(series_in))

  let [width, height] = $state([0, 0])

  // Track mounted state to avoid SSR/hydration mismatch with Canvas
  let mounted = $state(false)
  onMount(() => (mounted = true))

  // Points are built inside the Canvas scene, so fail fast on misaligned arrays out here
  $effect.pre(() => series.forEach(assert_series_lengths))

  const axis_defaults = { format: `.3~g`, scale_type: `linear` as const }
  let resolved_x_axis = $derived({ label: `X`, ...axis_defaults, ...x_axis })
  let resolved_y_axis = $derived({ label: `Y`, ...axis_defaults, ...y_axis })
  let resolved_z_axis = $derived({ label: `Z`, ...axis_defaults, ...z_axis })
  let resolved_display = $derived({ ...DISPLAY_DEFAULTS_3D, ...display })
  // Normalize color_scale to always be an object
  let normalized_color_scale = $derived(
    typeof color_scale === `string`
      ? { type: `linear` as const, scheme: color_scale }
      : color_scale,
  )

  // Finite colour extent across all series; [0, 1] when no series carries colour values
  let { color_extent, color_range: auto_color_range } = $derived(collect_scale_values(series))
  let color_scale_fn = $derived(create_color_scale(normalized_color_scale, auto_color_range))

  // Legend data
  let legend_data = $derived(
    build_legend_items(series, (srs, series_idx) => ({
      symbol_type: `Circle` as const,
      symbol_color: first_point_style(srs)?.fill ?? plot_color(series_idx),
    })),
  )
  // Lift the gizmo above the color bar when one is shown; otherwise pass `gizmo` through as-is
  // (SceneCamera takes `true` or GizmoOptions directly; its default offset gap is 5px)
  let has_color_bar = $derived(Boolean(color_bar) && color_extent.n_finite > 0)
  let computed_gizmo = $derived.by(() => {
    if (gizmo === false || !has_color_bar) return gizmo
    const opts = gizmo === true ? {} : gizmo
    return { ...opts, offset: { bottom: 70, ...opts.offset } }
  })

  // Handle point hover
  function handle_point_hover(data: Scatter3DHandlerEvent<Metadata> | null) {
    hovered = data !== null
    tooltip_point = data?.point ?? null
    on_point_hover?.(data)
  }
</script>

<ChartShell
  chart_class="scatter-3d"
  css_prefix="scatter3d"
  css_var_fallbacks={{ 'min-height': `400px`, 'border-radius': `var(--border-radius, 3pt)` }}
  bind:wrapper
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
    <ScatterPlot3DControls
      bind:show_controls
      bind:controls_open
      {toggle_props}
      pane_props={{
        ...controls_pane_props,
        // z-index must exceed fullscreen z-index to remain clickable in fullscreen mode
        style: `--pane-z-index: var(--z-index-overlay-dialog, 100000002); ${
          controls_pane_props?.style ?? ``
        }`,
      }}
      bind:x_axis={() => resolved_x_axis, (value) => (x_axis = value)}
      bind:y_axis={() => resolved_y_axis, (value) => (y_axis = value)}
      bind:z_axis={() => resolved_z_axis, (value) => (z_axis = value)}
      bind:display={() => resolved_display, (value) => (display = value)}
      bind:camera_projection
      bind:auto_rotate
      {series}
      {surfaces}
      children={controls_extra}
    />
  {/snippet}

  {#snippet body()}
    <!-- Prevent Canvas from rendering during SSR to avoid hydration mismatch -->
    {#if mounted && webgpu_available()}
      <Canvas createRenderer={create_renderer}>
        <ScatterPlot3DScene
          {series}
          {surfaces}
          {ref_lines}
          {ref_planes}
          x_axis={resolved_x_axis}
          y_axis={resolved_y_axis}
          z_axis={resolved_z_axis}
          display={resolved_display}
          {styles}
          {color_scale_fn}
          {size_scale}
          {camera_position}
          {camera_projection}
          {auto_rotate}
          {rotation_damping}
          {fov}
          {min_zoom}
          {max_zoom}
          {rotate_speed}
          {zoom_speed}
          {pan_speed}
          {ambient_light}
          {directional_light}
          {sphere_segments}
          gizmo={computed_gizmo}
          bind:hovered_point={tooltip_point}
          {on_point_click}
          on_point_hover={handle_point_hover}
          bind:scene
          bind:camera
          bind:orbit_controls
          tooltip_portal={wrapper}
          {tooltip}
          {width}
          {height}
        />
      </Canvas>
    {/if}

    <!-- Color Bar -->
    {#if has_color_bar && color_bar}
      {@const color_domain = [
        normalized_color_scale.value_range?.[0] ?? auto_color_range[0],
        normalized_color_scale.value_range?.[1] ?? auto_color_range[1],
      ] as Vec2}
      <!-- spread first, so the corner placement and default bar size below append to the
      caller's styles instead of being dropped by it -->
      <ColorBar
        tick_labels={4}
        tick_side="primary"
        {...color_bar}
        scale={{ fn: color_scale_fn, domain: color_domain }}
        scale_type={normalized_color_scale.type}
        range={color_domain}
        wrapper_style="position: absolute; bottom: 2em; left: 2em; {color_bar?.wrapper_style ??
          ``}"
        bar_style="width: 200px; height: 16px; {color_bar?.bar_style ?? ``}"
      />
    {/if}

    <!-- Legend - positioned below controls to avoid overlap -->
    {#if resolve_legend_visibility(show_legend, legend, legend_data.length)}
      <PlotLegend
        series_data={legend_data}
        active_series_idx={tooltip_point?.series_idx ?? null}
        draggable={legend?.draggable ?? true}
        {...legend}
        on_toggle={legend?.on_toggle ?? legend_vis.on_toggle}
        on_double_click={legend?.on_double_click ?? legend_vis.on_double_click}
        on_group_toggle={legend?.on_group_toggle ?? legend_vis.on_group_toggle}
        style={`position: absolute; top: 2.5em; right: 1em; ${legend?.style ?? ``}`}
      />
    {/if}
  {/snippet}
</ChartShell>

<style>
  :global(.scatter-3d > div:has(> canvas)) {
    flex: 1;
  }
  :global(.scatter-3d canvas) {
    width: 100% !important;
    height: 100% !important;
    flex: 1;
    outline: none;
  }
</style>
