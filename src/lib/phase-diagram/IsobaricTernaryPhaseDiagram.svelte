<script lang="ts">
  import {
    FullscreenToggle,
    set_fullscreen_bg,
    setup_fullscreen_effect,
  } from '$lib/layout'
  import type { Vec3 } from '$lib/math'
  import { PlotTooltip } from '$lib/plot'
  import { Canvas } from '@threlte/core'
  import { type ComponentProps, onMount, type Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { Camera, Scene } from 'three'
  import * as extras from '@threlte/extras'
  import IsobaricTernaryPhaseDiagramScene from './IsobaricTernaryPhaseDiagramScene.svelte'
  import IsothermalSlicePanel from './IsothermalSlicePanel.svelte'
  import PhaseDiagramExportPane from './PhaseDiagramExportPane.svelte'
  import TernaryPhaseDiagramControls from './TernaryPhaseDiagramControls.svelte'
  import VerticalSlicePanel from './VerticalSlicePanel.svelte'
  import type {
    TernaryPhaseDiagramConfig,
    TernaryPhaseDiagramData,
    TernaryPhaseHoverInfo,
    TernaryPhaseRegion,
  } from './types'
  import {
    format_composition,
    format_temperature,
    get_ternary_region_temp_range,
  } from './utils'

  type Props = HTMLAttributes<HTMLDivElement> & {
    data: TernaryPhaseDiagramData
    config?: Partial<TernaryPhaseDiagramConfig>
    // Bindable state
    fullscreen?: boolean
    wrapper?: HTMLDivElement
    hovered_region?: TernaryPhaseRegion | null
    // Display options
    show_labels?: boolean
    show_special_points?: boolean
    show_grid?: boolean
    region_opacity?: number
    render_mode?: `transparent` | `solid`
    // Slice state
    slice_temperature?: number
    slice_ratio?: number
    show_isothermal_panel?: boolean
    show_vertical_panel?: boolean
    // Controls
    fullscreen_toggle?: boolean
    show_controls?: boolean
    controls_open?: boolean
    enable_export?: boolean
    export_pane_open?: boolean
    png_dpi?: number
    export_filename?: string
    // Camera
    camera_position?: Vec3
    auto_rotate?: number
    // Callbacks
    on_region_hover?: (info: TernaryPhaseHoverInfo | null) => void
    // Bindings
    scene?: Scene
    camera?: Camera
    orbit_controls?: ComponentProps<typeof extras.OrbitControls>[`ref`]
    // Custom content snippets
    tooltip?: Snippet<[TernaryPhaseHoverInfo]>
    children?: Snippet<[{ width: number; height: number; fullscreen: boolean }]>
  }

  let {
    data,
    config = {},
    fullscreen = $bindable(false),
    wrapper = $bindable(),
    hovered_region = $bindable(null),
    show_labels = $bindable(true),
    show_special_points = $bindable(true),
    show_grid = $bindable(true),
    region_opacity = $bindable(0.6),
    render_mode = $bindable(`transparent`),
    slice_temperature = $bindable(),
    slice_ratio = $bindable(0.5),
    show_isothermal_panel = $bindable(true),
    show_vertical_panel = $bindable(false),
    fullscreen_toggle = true,
    show_controls = true,
    controls_open = $bindable(false),
    enable_export = true,
    export_pane_open = $bindable(false),
    png_dpi = $bindable(150),
    export_filename = `ternary-phase-diagram`,
    camera_position = [8, 6, 8],
    auto_rotate = 0,
    on_region_hover,
    scene = $bindable(),
    camera = $bindable(),
    orbit_controls = $bindable(),
    tooltip,
    children,
    ...rest
  }: Props = $props()

  // Dimensions
  let width = $state(0)
  let height = $state(0)

  // Track mounted state for SSR
  let mounted = $state(false)
  onMount(() => (mounted = true))

  // Hover state
  let hover_info = $state<TernaryPhaseHoverInfo | null>(null)
  let tooltip_pos = $state({ x: 0, y: 0 })

  function handle_region_hover(info: TernaryPhaseHoverInfo | null) {
    hover_info = info
    hovered_region = info?.region ?? null
    if (info) {
      tooltip_pos = info.position
    }
    on_region_hover?.(info)
  }

  // Temperature unit
  const temp_unit = $derived(data.temperature_unit ?? `K`)
  const comp_unit = $derived(data.composition_unit ?? `at%`)

  // Initialize slice temperature
  $effect(() => {
    if (slice_temperature === undefined) {
      slice_temperature = (data.temperature_range[0] + data.temperature_range[1]) / 2
    }
  })

  // Fullscreen handling
  $effect(() => {
    setup_fullscreen_effect(fullscreen, wrapper)
    set_fullscreen_bg(wrapper, fullscreen, `--ternary-pd-bg-fullscreen`)
  })

  // Document keyboard shortcuts
  function handle_keydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === `E`) {
      event.preventDefault()
      export_pane_open = !export_pane_open
    } else if (event.key === `Escape` && fullscreen) {
      fullscreen = false
    }
  }
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = Boolean(document.fullscreenElement)
  }}
  onkeydown={handle_keydown}
/>

<div
  {...rest}
  class="ternary-phase-diagram {rest.class ?? ``}"
  class:fullscreen
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  role="img"
  aria-label="{data.components.join(`-`)} ternary phase diagram"
>
  {#if width > 0 && height > 0}
    <!-- Header controls -->
    <div class="header-controls">
      {#if show_controls}
        <TernaryPhaseDiagramControls
          {data}
          bind:controls_open
          bind:show_labels
          bind:show_special_points
          bind:show_grid
          bind:region_opacity
          bind:render_mode
          bind:slice_temperature
          bind:slice_ratio
          bind:show_isothermal_panel
          bind:show_vertical_panel
        />
      {/if}
      {#if enable_export}
        <PhaseDiagramExportPane
          bind:export_pane_open
          bind:png_dpi
          data={undefined}
          {wrapper}
          filename={export_filename}
        />
      {/if}
      {#if fullscreen_toggle}
        <FullscreenToggle bind:fullscreen />
      {/if}
    </div>

    <!-- 3D Canvas -->
    {#if mounted && typeof WebGLRenderingContext !== `undefined`}
      <Canvas>
        <IsobaricTernaryPhaseDiagramScene
          {data}
          {config}
          bind:slice_temperature
          bind:slice_ratio
          show_isothermal_plane={show_isothermal_panel}
          show_vertical_plane={show_vertical_panel}
          {show_labels}
          {show_special_points}
          {show_grid}
          {region_opacity}
          {render_mode}
          {camera_position}
          {auto_rotate}
          bind:hovered_region
          on_region_hover={handle_region_hover}
          bind:scene
          bind:camera
          bind:orbit_controls
        />
      </Canvas>
    {/if}

    <!-- Isothermal Slice Panel (right side) -->
    {#if show_isothermal_panel && slice_temperature !== undefined}
      <IsothermalSlicePanel
        {data}
        temperature={slice_temperature}
        bind:is_open={show_isothermal_panel}
        on_temperature_change={(temp) => (slice_temperature = temp)}
      />
    {/if}

    <!-- Vertical Slice Panel (left side) -->
    {#if show_vertical_panel}
      <VerticalSlicePanel
        {data}
        ratio={slice_ratio}
        bind:is_open={show_vertical_panel}
        on_ratio_change={(ratio) => (slice_ratio = ratio)}
      />
    {/if}

    <!-- Hover Tooltip -->
    {#if hover_info}
      <PlotTooltip x={tooltip_pos.x} y={tooltip_pos.y} offset={{ x: 15, y: -10 }} fixed>
        {#if tooltip}
          {@render tooltip(hover_info)}
        {:else}
          <div class="tooltip-content">
            <strong>{hover_info.region.name}</strong>
            <div class="tooltip-row">
              <span>Temperature:</span>
              <span>{format_temperature(hover_info.temperature, temp_unit)}</span>
            </div>
            <div class="tooltip-row">
              <span>{data.components[0]}:</span>
              <span>{format_composition(hover_info.composition[0], comp_unit)}</span>
            </div>
            <div class="tooltip-row">
              <span>{data.components[1]}:</span>
              <span>{format_composition(hover_info.composition[1], comp_unit)}</span>
            </div>
            <div class="tooltip-row">
              <span>{data.components[2]}:</span>
              <span>{format_composition(hover_info.composition[2], comp_unit)}</span>
            </div>
            {#if get_ternary_region_temp_range(hover_info.region)}
              {@const range = get_ternary_region_temp_range(hover_info.region)}
              <div class="tooltip-row range">
                <span>T range:</span>
                <span>{format_temperature(range?.t_min ?? 0, temp_unit)} - {
                    format_temperature(range?.t_max ?? 0, temp_unit)
                  }</span>
              </div>
            {/if}
          </div>
        {/if}
      </PlotTooltip>
    {/if}

    <!-- Title -->
    {#if data.title}
      <h3 class="diagram-title">{data.title}</h3>
    {/if}

    <!-- Custom children -->
    {@render children?.({ width, height, fullscreen })}
  {/if}
</div>

<style>
  .ternary-phase-diagram {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 500px;
    background: var(--ternary-pd-bg, var(--plot-bg, transparent));
    border-radius: var(--ternary-pd-border-radius, var(--border-radius, 3pt));
    container-type: size;
    overflow: hidden;
  }
  .ternary-phase-diagram.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw !important;
    height: 100vh !important;
    z-index: var(--ternary-pd-fullscreen-z-index, 100000001);
    margin: 0;
    border-radius: 0;
    background: var(--ternary-pd-bg-fullscreen, var(--page-bg, #1a1a2e)) !important;
  }
  .ternary-phase-diagram :global(canvas) {
    width: 100% !important;
    height: 100% !important;
    outline: none;
  }
  .header-controls {
    position: absolute;
    top: var(--ctrl-btn-top, 10px);
    right: var(--ctrl-btn-right, 10px);
    display: flex;
    align-items: center;
    gap: 6px;
    z-index: 10;
  }
  .header-controls
    :global(:is(.fullscreen-toggle, .ternary-controls-toggle, .pane-toggle)) {
    position: static;
  }
  .header-controls :global(.fullscreen-toggle) {
    opacity: 1;
  }
  /* Hide controls by default, show on hover */
  .ternary-phase-diagram :global(.pane-toggle),
  .ternary-phase-diagram .header-controls {
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  .ternary-phase-diagram:is(:hover, :focus-within)
    :is(:global(.pane-toggle), .header-controls),
  .ternary-phase-diagram
    :global(.pane-toggle:is(:focus-visible, [aria-expanded='true'])) {
    opacity: 1;
  }
  .diagram-title {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-color, #333);
    text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
    pointer-events: none;
  }
  .tooltip-content {
    font-size: 13px;
    line-height: 1.4;
  }
  .tooltip-content strong {
    display: block;
    margin-bottom: 6px;
    font-size: 14px;
  }
  .tooltip-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .tooltip-row.range {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid rgba(128, 128, 128, 0.3);
    font-size: 12px;
    opacity: 0.9;
  }
</style>
