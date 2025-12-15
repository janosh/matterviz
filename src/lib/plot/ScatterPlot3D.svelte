<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import type { D3ColorSchemeName, D3InterpolateName } from '$lib/colors'
  import { FullscreenToggle } from '$lib/layout'
  import type { Vec3 } from '$lib/math'
  import { ColorBar, PlotLegend } from '$lib/plot'
  import { get_series_color } from '$lib/plot/data-transform'
  import type {
    AxisConfig3D,
    CameraProjection3D,
    ControlsConfig3D,
    DataSeries3D,
    DisplayConfig3D,
    InternalPoint3D,
    LegendConfig,
    ScaleType,
    Scatter3DHandlerEvent,
    Sides,
    StyleOverrides3D,
    Surface3DConfig,
  } from '$lib/plot/types'
  import { Canvas } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { type ComponentProps, onMount, type Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { Camera, Scene } from 'three'
  import { create_color_scale } from './scales'
  import ScatterPlot3DControls from './ScatterPlot3DControls.svelte'
  import ScatterPlot3DScene from './ScatterPlot3DScene.svelte'

  let {
    // Data props
    series = [],
    surfaces = [],
    // Axis configuration (initial values)
    x_axis: x_axis_init = {},
    y_axis: y_axis_init = {},
    z_axis: z_axis_init = {},
    // Display settings (initial value)
    display: display_init = {
      show_axes: true,
      show_grid: true,
      show_axis_labels: true,
    },
    styles = {},
    // Color and size scaling
    color_scale = {
      type: `linear` as ScaleType,
      scheme: `interpolateViridis` as D3InterpolateName,
      value_range: undefined,
    },
    color_bar = {},
    size_scale = {
      type: `linear` as ScaleType,
      radius_range: [0.05, 0.2],
      value_range: undefined,
    },
    // Legend
    legend = {},
    // Camera settings
    camera_position = $bindable([8, 8, 8]),
    camera_projection: camera_projection_init = `perspective` as CameraProjection3D,
    auto_rotate: auto_rotate_init = 0,
    rotation_damping = 0,
    fov = 50,
    min_zoom = 0.1,
    max_zoom = 100,
    rotate_speed = 2,
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
    controls: controls_init = {},
    // State
    hovered = $bindable(false),
    tooltip_point = $bindable(null),
    // Callbacks
    on_point_click,
    on_point_hover,
    on_series_visibility_change,
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
    x_axis?: AxisConfig3D
    y_axis?: AxisConfig3D
    z_axis?: AxisConfig3D
    display?: DisplayConfig3D
    styles?: StyleOverrides3D
    color_scale?: {
      type?: ScaleType
      scheme?: D3ColorSchemeName | D3InterpolateName
      value_range?: [number, number]
    } | D3InterpolateName
    color_bar?: ComponentProps<typeof ColorBar> & { margin?: number | Sides } | null
    size_scale?: {
      type?: ScaleType
      radius_range?: [number, number]
      value_range?: [number, number]
    }
    legend?: LegendConfig | null
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
    gizmo?: boolean | ComponentProps<typeof extras.Gizmo>
    controls?: ControlsConfig3D
    hovered?: boolean
    tooltip_point?: InternalPoint3D<Metadata> | null
    on_point_click?: (data: Scatter3DHandlerEvent<Metadata>) => void
    on_point_hover?: (data: Scatter3DHandlerEvent<Metadata> | null) => void
    on_series_visibility_change?: (series_idx: number, visible: boolean) => void
    fullscreen?: boolean
    fullscreen_toggle?: boolean
    wrapper?: HTMLDivElement
    scene?: Scene
    camera?: Camera
    orbit_controls?: ComponentProps<typeof extras.OrbitControls>[`ref`]
    tooltip?: Snippet<[Scatter3DHandlerEvent<Metadata>]>
    children?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
    header_controls?: Snippet<
      [{ height: number; width: number; fullscreen: boolean }]
    >
    controls_extra?: Snippet
  } = $props()

  let [width, height] = $state([0, 0])

  // Track mounted state to avoid SSR/hydration mismatch with Canvas
  let mounted = $state(false)
  onMount(() => mounted = true)

  // User overrides merged with series.visible defaults
  let visibility_overrides: Record<number, boolean> = $state({})
  let series_visibility = $derived(
    series.map((srs, idx) => visibility_overrides[idx] ?? srs?.visible ?? true),
  )

  // Local state for controls (initialized from props, owned by this component)
  const axis_defaults = { format: `.3~g`, scale_type: `linear` as const }
  let x_axis = $state({ label: `X`, ...axis_defaults, ...x_axis_init })
  let y_axis = $state({ label: `Y`, ...axis_defaults, ...y_axis_init })
  let z_axis = $state({ label: `Z`, ...axis_defaults, ...z_axis_init })
  let display = $state({
    show_axes: true,
    show_grid: true,
    show_axis_labels: true,
    ...display_init,
  })
  let camera_projection = $state(camera_projection_init)
  let auto_rotate = $state(auto_rotate_init)
  let controls = $state({ show: true, open: false, ...controls_init })

  // Normalize color_scale to always be an object
  let normalized_color_scale = $derived(
    typeof color_scale === `string`
      ? { type: `linear` as const, scheme: color_scale }
      : color_scale,
  )

  // Collect all color values for color bar
  let all_color_values = $derived(
    series.filter(Boolean).flatMap((srs) =>
      srs.color_values?.filter((val): val is number => val != null) ?? []
    ),
  )

  let auto_color_range = $derived.by((): [number, number] => {
    if (all_color_values.length === 0) return [0, 1]
    let min = Infinity
    let max = -Infinity
    for (const val of all_color_values) {
      if (val < min) min = val
      if (val > max) max = val
    }
    return [min, max]
  })

  let color_scale_fn = $derived(
    create_color_scale(normalized_color_scale, auto_color_range),
  )

  // Legend data
  let legend_data = $derived(
    series.map((srs, series_idx) => {
      const is_visible = series_visibility[series_idx] ?? true
      const label = srs?.label ?? `Series ${series_idx + 1}`
      const series_color = get_series_color(series_idx)

      return {
        series_idx,
        label,
        visible: is_visible,
        display_style: {
          symbol_type: `Circle` as const,
          symbol_color: srs?.point_style
            ? (Array.isArray(srs.point_style)
              ? srs.point_style[0]?.fill
              : srs.point_style?.fill) ??
              series_color
            : series_color,
        },
        has_explicit_label: Boolean(srs?.label),
        legend_group: srs?.legend_group,
      }
    }),
  )

  // Compute gizmo props - move up when color bar is shown
  let has_color_bar = $derived(color_bar && all_color_values.length > 0)
  let computed_gizmo = $derived.by(() => {
    if (gizmo === false) return false
    const base_offset = { left: 5, bottom: has_color_bar ? 70 : 5 }
    if (gizmo === true) {
      return { background: { enabled: false }, offset: base_offset }
    }
    // Merge user-provided gizmo config with adjusted offset
    return { ...gizmo, offset: { ...base_offset, ...gizmo.offset } }
  })

  function toggle_series_visibility(idx: number) {
    const visible = (visibility_overrides[idx] = !series_visibility[idx])
    on_series_visibility_change?.(idx, visible)
  }

  // Handle point hover
  function handle_point_hover(data: Scatter3DHandlerEvent<Metadata> | null) {
    hovered = data !== null
    tooltip_point = data?.point ?? null
    on_point_hover?.(data)
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === `Escape` && fullscreen) {
      event.preventDefault()
      fullscreen = false
    }
  }}
/>

<div
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  {...rest}
  class="scatter-3d {rest.class ?? ``}"
  class:fullscreen
>
  {#if width && height}
    <div class="header-controls">
      {@render header_controls?.({ height, width, fullscreen })}
      {#if fullscreen_toggle}
        <FullscreenToggle bind:fullscreen />
      {/if}
    </div>

    <!-- Prevent Canvas from rendering during SSR to avoid hydration mismatch -->
    {#if mounted && typeof WebGLRenderingContext !== `undefined`}
      <Canvas>
        <ScatterPlot3DScene
          {series}
          {series_visibility}
          {surfaces}
          {x_axis}
          {y_axis}
          {z_axis}
          {display}
          {styles}
          color_scale={normalized_color_scale}
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
          {tooltip}
          {width}
          {height}
        />
      </Canvas>
    {/if}

    <!-- Control pane -->
    {#if controls.show}
      <ScatterPlot3DControls
        toggle_props={{
          ...controls.toggle_props,
          style: `--ctrl-btn-right: var(--fullscreen-btn-offset, 36px); top: 4px; ${
            controls.toggle_props?.style ?? ``
          }`,
        }}
        pane_props={controls.pane_props}
        bind:x_axis
        bind:y_axis
        bind:z_axis
        bind:display
        bind:camera_projection
        bind:auto_rotate
        {series}
        {surfaces}
        children={controls_extra}
      />
    {/if}

    <!-- Color Bar -->
    {#if color_bar && all_color_values.length > 0}
      {@const color_domain = [
      normalized_color_scale.value_range?.[0] ?? auto_color_range[0],
      normalized_color_scale.value_range?.[1] ?? auto_color_range[1],
    ] as [number, number]}
      <ColorBar
        tick_labels={4}
        tick_side="primary"
        {color_scale_fn}
        color_scale_domain={color_domain}
        scale_type={normalized_color_scale.type}
        range={color_domain?.every((val) => val != null) ? color_domain : undefined}
        wrapper_style="position: absolute; bottom: 2em; left: 2em; {color_bar?.wrapper_style ?? ``}"
        bar_style="width: 200px; height: 16px; {color_bar?.style ?? ``}"
        {...color_bar}
      />
    {/if}

    <!-- Legend - positioned below controls to avoid overlap -->
    {#if legend != null && legend_data.length > 1}
      <PlotLegend
        series_data={legend_data}
        on_toggle={toggle_series_visibility}
        draggable={legend?.draggable ?? true}
        {...legend}
        wrapper_style="position: absolute; top: 2.5em; right: 1em; {legend?.wrapper_style ?? ``}"
      />
    {/if}

    <!-- User-provided children -->
    {@render children?.({ height, width, fullscreen })}
  {/if}
</div>

<style>
  div.scatter-3d {
    position: relative;
    width: var(--scatter3d-width, 100%);
    height: var(--scatter3d-height, auto);
    min-height: var(--scatter3d-min-height, 400px);
    container-type: size;
    container-name: scatter-plot-3d;
    z-index: var(--scatter3d-z-index);
    flex: var(--scatter3d-flex, 1);
    display: var(--scatter3d-display, flex);
    flex-direction: column;
    background: var(--scatter3d-bg, var(--plot-bg));
    border-radius: var(--scatter3d-border-radius, var(--border-radius, 3pt));
    overflow: hidden;
  }
  div.scatter-3d.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw !important;
    height: 100vh !important;
    z-index: var(--scatter3d-fullscreen-z-index, 100000001);
    margin: 0;
    border-radius: 0;
    max-height: none !important;
    overflow: hidden;
    /* Add padding to prevent titles from being cropped at top */
    padding-top: var(--plot-fullscreen-padding-top, 2em);
    box-sizing: border-box;
  }
  div.scatter-3d :global(canvas) {
    width: 100% !important;
    height: 100% !important;
    flex: 1;
    outline: none;
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
  /* Position the pane toggle in top right, next to fullscreen button */
  div.scatter-3d :global(.pane-toggle) {
    position: absolute;
    top: var(--ctrl-btn-top, 5pt);
    right: var(--ctrl-btn-right, 36px);
    z-index: var(--pane-toggle-z-index, 10);
  }
  /* Hide controls on default, show on hover */
  div.scatter-3d :global(.pane-toggle),
  div.scatter-3d .header-controls {
    opacity: 0;
    transition: opacity 0.2s, background-color 0.2s;
  }
  div.scatter-3d:hover :global(.pane-toggle),
  div.scatter-3d:hover .header-controls,
  div.scatter-3d :global(.pane-toggle:focus-visible),
  div.scatter-3d :global(.pane-toggle[aria-expanded='true']),
  div.scatter-3d .header-controls:focus-within {
    opacity: 1;
  }
</style>
