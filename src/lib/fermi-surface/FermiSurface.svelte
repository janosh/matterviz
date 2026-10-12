<script lang="ts">
  import type { FileExportContext } from '#lib/io/file-export.svelte.js'
  import type { MaterialSource } from '#lib/file-viewer/open.js'
  import type { BrillouinZoneData } from '#lib/brillouin/index.js'
  import { compute_brillouin_zone } from '#lib/brillouin/index.js'
  import { reciprocal_lattice } from '#lib/math.js'
  import { normalize_show_controls, type ShowControlsProp } from '#lib/controls.js'
  import EmptyState from '#lib/EmptyState.svelte'
  import type { Spinner } from 'svelte-widgets'
  import ViewerError from '#lib/layout/ViewerError.svelte'
  import LoadingStatus from '#lib/layout/LoadingStatus.svelte'
  import { create_material_loader } from '#lib/file-viewer/material-loader.svelte.js'
  import type { FileLoadCallback } from '#lib/io/index.js'
  import { ViewerChrome } from '#lib/layout/index.js'
  import { PlotTooltip } from '#lib/plot/index.js'
  import { create_renderer, export_scene_as, webgpu_available } from '#lib/scene/index.js'
  import type { SceneExportFormat } from '#lib/scene/index.js'
  import { DEFAULTS } from '#lib/settings.js'
  import type { Vec2, Vec3 } from '#lib/math.js'
  import ColorBar from '#lib/plot/core/components/ColorBar.svelte'
  import type { Crystal } from '#lib/structure/index.js'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { Camera, Scene } from 'three/webgpu'
  import {
    band_grids_prepared,
    detect_irreducible_bz,
    extract_fermi_surface,
    preview_interpolation_factor,
  } from './compute'
  import FermiSurfaceControls from './FermiSurfaceControls.svelte'
  import FermiSurfaceScene from './FermiSurfaceScene.svelte'

  import FermiSurfaceTooltip from './FermiSurfaceTooltip.svelte'
  import { property_label } from './constants'
  import { available_property_names, property_color_range } from './geometry'
  import { normalize_band_grid, normalize_fermi_surface } from './parse'
  import type { BandGridJson, FermiSurfaceJson } from './parse'
  import { to_error } from '#lib/utils.js'
  import { is_editable_event_target } from 'svelte-widgets/utils'
  import type {
    BandGridData,
    FermiErrorData,
    FermiFileLoadData,
    FermiHoverData,
    FermiSurfaceData,
    FermiSurfaceSettings,
    FermiTooltipConfig,
  } from './types'
  import { is_fermi_surface_data } from './types'

  type FermiSurfaceControlName = `filename` | `fullscreen` | `controls`

  type FermiFullscreenData = {
    fermi_data?: FermiSurfaceData
    bz_data?: BrillouinZoneData
    fullscreen?: boolean
  }

  let {
    fermi_data = $bindable(),
    band_data = $bindable(),
    structure,
    bz_data = $bindable(),
    mu: mean = $bindable(DEFAULTS.fermi.mu),
    controls_open = $bindable(false),
    color_property = $bindable(DEFAULTS.fermi.color_property),
    color_scale = $bindable(DEFAULTS.fermi.color_scale),
    property_name = $bindable(),
    color_range = $bindable(),
    show_colorbar = true,
    slice_plane,
    k_marker = null,
    k_path,
    wigner_seitz = false,
    previewing = false,
    custom_property_label,
    representation = $bindable(DEFAULTS.fermi.representation),
    surface_opacity = $bindable(DEFAULTS.fermi.surface_opacity),
    selected_bands = $bindable(),
    show_bz = $bindable(DEFAULTS.fermi.show_bz),
    bz_opacity = $bindable(DEFAULTS.fermi.bz_opacity),
    show_vectors = $bindable(DEFAULTS.fermi.show_vectors),
    tile_bz = $bindable(DEFAULTS.fermi.tile_bz),
    clip_enabled = $bindable(DEFAULTS.fermi.clip_enabled),
    clip_axis = $bindable(DEFAULTS.fermi.clip_axis),
    clip_position = $bindable(DEFAULTS.fermi.clip_position),
    clip_flip = $bindable(DEFAULTS.fermi.clip_flip),
    interpolation_factor = $bindable(DEFAULTS.fermi.interpolation_factor),
    camera_projection = $bindable(DEFAULTS.fermi.camera_projection),
    show_controls,
    fullscreen = $bindable(false),
    wrapper = $bindable(),
    width = $bindable(0),
    height = $bindable(0),
    hovered = $bindable(false),
    dragover = $bindable(false),
    allow_file_drop = true,
    fullscreen_toggle = DEFAULTS.fermi.fullscreen_toggle,
    source,
    spinner_props = {},
    loading = $bindable(false),
    error_msg = $bindable(),
    children,
    tooltip_config,
    on_file_drop,
    on_file_load,
    on_error,
    on_fullscreen_change,
    on_point_hover,
    ...rest
  }: Partial<FermiSurfaceSettings> & {
    // Both accept the typed-array form `parse_fermi_file` returns and the JSON form (plain
    // `vertices`/`faces` rows, nested energies) that pymatviz/anywidget traits can carry
    fermi_data?: FermiSurfaceData | FermiSurfaceJson
    band_data?: BandGridData | BandGridJson
    structure?: Crystal
    bz_data?: BrillouinZoneData
    controls_open?: boolean
    // Per-vertex property coloured by in `property` mode, e.g. `λ` or `Δ (10 K)` of a band grid's
    // `properties`; defaults to the first one present
    property_name?: string
    // Fixed [min, max] of the property colour scale; undefined fits the visible surfaces
    color_range?: Vec2
    // Colour bar over the canvas while surfaces are coloured by a property
    show_colorbar?: boolean
    // 2D slice (e.g. a FermiSlice beside the viewer) to mark as a plane in the 3D view
    slice_plane?: { miller_indices: Vec3; distance: number }
    // k-point (Cartesian Å⁻¹) to mark in 3D, e.g. the cursor position on a FermiSlice
    k_marker?: Vec3 | null
    // band-structure k-path to draw in 3D, e.g. from a band plot beside the viewer
    k_path?: ComponentProps<typeof FermiSurfaceScene>[`k_path`]
    // fold band-grid surfaces into the Wigner-Seitz zone, e.g. to match a k-path through it
    wigner_seitz?: boolean
    // a pointer-driven preview (e.g. hovering a band plot): extract at no more than the
    // k-mesh's auto resolution so updates keep up, then at full resolution once it ends
    previewing?: boolean
    // Label for the unnamed per-vertex property (an IFermi/JSON `properties` array or a scalar
    // FRMSF colour block), e.g. "Fermi velocity", "λ(k)", "DOS"
    custom_property_label?: string
    selected_bands?: number[]
    show_controls?: ShowControlsProp<FermiSurfaceControlName>
    fullscreen?: boolean
    width?: number
    height?: number
    wrapper?: HTMLDivElement
    hovered?: boolean
    dragover?: boolean
    allow_file_drop?: boolean
    fullscreen_toggle?: boolean
    source?: MaterialSource
    spinner_props?: ComponentProps<typeof Spinner>
    loading?: boolean
    error_msg?: string
    children?: Snippet<[{ fermi_data?: FermiSurfaceData; bz_data?: BrillouinZoneData }]>
    on_file_drop?: FileLoadCallback
    on_file_load?: (data: FermiFileLoadData) => void
    on_error?: (data: FermiErrorData) => void
    on_fullscreen_change?: (data: FermiFullscreenData) => void
    tooltip_config?: Snippet<[{ hover_data: FermiHoverData }]> | FermiTooltipConfig
    on_point_hover?: (data: FermiHoverData | null) => void
  } & HTMLAttributes<HTMLDivElement> = $props()

  let scene = $state<Scene | undefined>(undefined)
  let camera = $state<Camera | undefined>(undefined)
  let current_filename = $state<string | undefined>(undefined)
  let hover_data = $state<FermiHoverData | null>(null)

  $effect(() => on_point_hover?.(hover_data))

  let controls_config = $derived(normalize_show_controls(show_controls))

  // Normalise the data props once at the boundary: pymatviz's `fermi_data`/`band_data` traits
  // can only travel as JSON (plain vertex/face rows, nested energies), while everything below
  // consumes typed arrays. Typed input passes through by identity. A malformed payload is
  // reported through error_msg/on_error instead of throwing mid-render.
  const normalized = $derived.by(() => {
    try {
      return {
        surface: fermi_data && normalize_fermi_surface(fermi_data),
        grid: band_data && normalize_band_grid(band_data),
        error: undefined,
      }
    } catch (err) {
      const error = `Invalid Fermi surface data: ${to_error(err).message}`
      return { surface: undefined, grid: undefined, error }
    }
  })
  const surface_data = $derived(normalized.surface)
  const grid_data = $derived(normalized.grid)
  // The notice this effect raised is cleared once a later payload normalises, so a host that
  // sends a bad then a good `fermi_data` sees the surface rather than a sticky error. Errors
  // supplied by the caller are left alone.
  let reported_normalize_error: string | undefined
  $effect(() => {
    const { error } = normalized
    if (!error && reported_normalize_error && error_msg === reported_normalize_error) {
      error_msg = undefined
    }
    reported_normalize_error = error
    if (error) {
      error_msg = error
      untrack(() => on_error?.({ error_msg: error }))
    }
  })

  const drop_zone = create_material_loader<FermiSurfaceData | BandGridData>({
    source: () => source,
    current_value: () => surface_data ?? grid_data,
    allow_file_drop: () => allow_file_drop,
    on_file_drop: () => on_file_drop,
    set_loading: (value) => (loading = value),
    set_error: (message) => (error_msg = message),
    set_dragover: (over) => (dragover = over),
    commit: (opened) => {
      if (opened.type !== `fermi_surface`) {
        throw new Error(`${opened.filename} is ${opened.type}, not Fermi surface data`)
      }
      const parsed = opened.data
      current_filename = opened.filename
      // A band grid leaves fermi_data unset; the extraction effect below derives it
      const loaded = is_fermi_surface_data(parsed)
        ? { fermi_data: parsed, band_data: undefined }
        : { fermi_data: undefined, band_data: parsed }
      fermi_data = loaded.fermi_data
      band_data = loaded.band_data
      on_file_load?.({ ...loaded, ...opened.provenance })
    },
    report_error: (message, metadata) => {
      error_msg = message
      on_error?.({ error_msg: message, ...metadata })
    },
  })

  // Re-extract whenever the band grid or an extraction parameter changes — also on first
  // mount with only `band_data` supplied. A monotonic job id drops superseded runs (bumped on
  // every rerun, including one that clears band_data, so a pending job cannot commit a
  // surface for a grid that is gone). `extracting` overlays a spinner on the Canvas instead
  // of unmounting it.
  let extraction_job_id = 0
  let extracting = $state(false)
  $effect(() => {
    const job_id = ++extraction_job_id
    if (!grid_data) {
      extracting = false
      return
    }
    const grid = grid_data
    const factor = previewing
      ? preview_interpolation_factor(grid, interpolation_factor)
      : interpolation_factor
    const options = { mu: mean, interpolation_factor: factor, wigner_seitz }
    const extract = () => {
      if (job_id !== extraction_job_id) return
      try {
        fermi_data = extract_fermi_surface(grid, options)
        error_msg = undefined
      } catch (err) {
        const message = `Fermi surface extraction failed: ${to_error(err).message}`
        error_msg = message
        untrack(() => on_error?.({ error_msg: message }))
      } finally {
        extracting = false
      }
    }
    // A mu change only reruns marching cubes on the cached grids (~1-12 ms on the demo files),
    // so it extracts next frame and a mu drag tracks the pointer. A grid or factor not yet
    // upsampled first upsamples every band, which takes a while at high factors: the spinner
    // gets one painted frame before that blocks.
    const upsamples = !band_grids_prepared(grid, factor)
    if (upsamples) extracting = true
    let frame = requestAnimationFrame(() => {
      if (upsamples) frame = requestAnimationFrame(extract)
      else extract()
    })
    return () => cancelAnimationFrame(frame)
  })

  async function handle_export(
    format: SceneExportFormat,
    { filename, save }: FileExportContext,
  ) {
    if (!scene) {
      console.error(`No scene available for export`)
      return
    }
    try {
      await export_scene_as(scene, format, filename, save)
    } catch (err) {
      console.error(`Export failed:`, err)
      error_msg = `Export failed: ${to_error(err).message}`
    }
  }

  // Property colouring: the requested property when the surfaces have it, else the first one.
  // The fitted range spans the visible sheets, so hiding a band rescales the colours.
  const available_properties = $derived(available_property_names(surface_data, grid_data))
  const active_property = $derived(
    property_name !== undefined && available_properties.includes(property_name)
      ? property_name
      : available_properties[0],
  )
  const visible_surfaces = $derived(
    surface_data?.isosurfaces.filter(
      (surface) => selected_bands === undefined || selected_bands.includes(surface.band_index),
    ) ?? [],
  )
  const fitted_color_range = $derived<Vec2>(
    color_property === `property`
      ? property_color_range(visible_surfaces, active_property)
      : [0, 1],
  )
  const resolved_color_range = $derived(color_range ?? fitted_color_range)

  // BZ of whichever reciprocal lattice is available (priority order)
  const k_lattice = $derived(
    surface_data?.k_lattice ??
      grid_data?.k_lattice ??
      (structure?.lattice?.matrix
        ? reciprocal_lattice(structure.lattice.matrix, { two_pi: true })
        : null),
  )
  $effect(() => {
    if (!k_lattice) {
      bz_data = undefined
      return
    }
    try {
      bz_data = compute_brillouin_zone(k_lattice, 1)
    } catch (err) {
      const msg = to_error(err).message
      console.warn(`BZ computation failed:`, msg)
      bz_data = undefined
      // Only report error for structure-derived lattice (user-provided data)
      if (structure?.lattice?.matrix) {
        const err_msg = `BZ computation failed: ${msg}`
        error_msg = err_msg
        untrack(() => on_error?.({ error_msg: err_msg }))
      }
    }
  })

  // Auto-enable BZ tiling when irreducible data is detected
  $effect(() => {
    if (surface_data && detect_irreducible_bz(surface_data)) tile_bz = true
  })

  function handle_keydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing) return
    if (is_editable_event_target(event.target)) return
    // Only handle shortcuts when component is focused/hovered or contains focus
    if (!wrapper?.contains(document.activeElement) && !hovered) return

    // `f` is owned by FullscreenButton, which arbitrates it between nested viewers
    if (event.key === `Escape`) controls_open = false
  }
</script>

<svelte:window onkeydown={handle_keydown} />

<div
  role="region"
  aria-label="Fermi surface viewer"
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  {...rest}
  class={[`fermi-surface`, rest.class, { active: controls_open }]}
  {@attach drop_zone}
>
  {@render children?.({ fermi_data: surface_data, bz_data })}
  {#if loading}
    <LoadingStatus overlay label="Loading Fermi surface..." {...spinner_props} />
  {:else if error_msg}
    <ViewerError bind:message={error_msg} dismissible />
  {:else if surface_data || grid_data}
    {#if extracting}
      <LoadingStatus overlay label="Extracting Fermi surface..." {...spinner_props} />
    {/if}
    <ViewerChrome
      {controls_config}
      filename={current_filename}
      bind:fullscreen
      {fullscreen_toggle}
      {wrapper}
      fullscreen_bg_css_var="--fermi-bg-fullscreen"
      on_fullscreen_change={(value) =>
        on_fullscreen_change?.({ fermi_data: surface_data, bz_data, fullscreen: value })}
    >
      {#if controls_config.visible(`controls`)}
        <FermiSurfaceControls
          bind:controls_open
          fermi_data={surface_data}
          band_data={grid_data}
          bind:mu={mean}
          bind:color_property
          bind:color_scale
          bind:property_name
          bind:color_range
          {fitted_color_range}
          {custom_property_label}
          bind:representation
          bind:surface_opacity
          bind:selected_bands
          bind:show_bz
          bind:bz_opacity
          bind:show_vectors
          bind:tile_bz
          bind:clip_enabled
          bind:clip_axis
          bind:clip_position
          bind:clip_flip
          bind:interpolation_factor
          bind:camera_projection
          on_export={handle_export}
          export_filename={current_filename || `fermi-surface`}
        />
      {/if}
    </ViewerChrome>

    {#if webgpu_available()}
      <Canvas
        createRenderer={create_renderer}
        renderMode="on-demand"
        dpr={Math.min(2, window.devicePixelRatio)}
      >
        <FermiSurfaceScene
          fermi_data={surface_data}
          {bz_data}
          {color_property}
          {color_scale}
          property_name={active_property}
          color_range={resolved_color_range}
          property_label={custom_property_label}
          {slice_plane}
          {k_marker}
          {k_path}
          {representation}
          {surface_opacity}
          {selected_bands}
          {show_bz}
          {bz_opacity}
          {show_vectors}
          {tile_bz}
          {clip_enabled}
          {clip_axis}
          {clip_position}
          {clip_flip}
          {camera_projection}
          {width}
          {height}
          bind:scene
          bind:camera
          bind:hover_data
        />
      </Canvas>

      {#if show_colorbar && color_property === `property` && active_property !== undefined}
        <ColorBar
          title={property_label(active_property, custom_property_label)}
          scale={color_scale}
          range={resolved_color_range}
          snap_ticks={false}
          tick_labels={3}
          orientation="horizontal"
          class="property-colorbar"
          --cbar-font-size="0.75em"
          --cbar-tick-label-font-weight="normal"
        />
      {/if}

      <!-- Hover tooltip -->
      {#if hover_data}
        <PlotTooltip
          x={hover_data.screen_position.x}
          y={hover_data.screen_position.y}
          offset={{ x: 12, y: -12 }}
          bg_color={hover_data.surface_color}
          fixed
          style="z-index: var(--z-index-overlay-nav, 100000001); backdrop-filter: blur(4px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3)"
        >
          <FermiSurfaceTooltip {hover_data} tooltip={tooltip_config} />
        </PlotTooltip>
      {/if}
    {/if}
  {:else}
    <EmptyState>
      <h3>Drop Fermi Surface File</h3>
      <p>Supports BXSF, FRMSF, JSON (+ .gz)</p>
    </EmptyState>
  {/if}
</div>

<style>
  .fermi-surface {
    position: relative;
    container-type: size;
    height: var(--fermi-height, 500px);
    width: var(--fermi-width, 100%);
    max-width: var(--fermi-max-width, 100%);
    min-width: var(--fermi-min-width, 300px);
    border-radius: var(--fermi-border-radius, 0);
    background: var(--fermi-bg, var(--surface-bg));
    color: var(--fermi-text-color, var(--text-color));
    :global(.control-buttons) {
      left: 1ex;
      justify-content: flex-end;
    }
    :global(.filename) {
      margin-right: auto;
      padding: 2px 4px;
    }
  }
  .fermi-surface.active {
    z-index: var(--fermi-active-z-index, 2);
  }
  .fermi-surface:has(:global(.draggable-pane.pane-open)) {
    z-index: var(--z-index-viewer-pane-open, 12);
  }
  .fermi-surface:fullscreen {
    background: var(--fermi-bg-fullscreen, var(--surface-bg));
    overflow: hidden;
  }
  .fermi-surface:fullscreen :global(canvas) {
    height: 100vh !important;
    width: 100vw !important;
  }
  .fermi-surface.dragover {
    background: var(--fermi-dragover-bg, var(--dragover-bg));
    border: var(--fermi-dragover-border, var(--dragover-border));
  }
  .fermi-surface :global(canvas) {
    user-select: none;
  }
  /* bottom-right corner, placed like the structure viewer's atom legend */
  .fermi-surface :global(.property-colorbar) {
    position: absolute;
    bottom: var(--fermi-colorbar-bottom, clamp(4pt, 3cqmin, 8pt));
    right: var(--fermi-colorbar-right, clamp(4pt, 3cqmin, 8pt));
    --cbar-width: var(--fermi-colorbar-width, 140px);
    /* tick labels centre on their ticks: room for the half of the last one past the bar */
    padding-right: 1em;
    z-index: 1;
    pointer-events: none;
  }
</style>
