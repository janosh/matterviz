<script lang="ts">
  import type { BrillouinZoneData } from '$lib/brillouin'
  import { compute_brillouin_zone } from '$lib/brillouin'
  import { reciprocal_lattice } from '$lib/math'
  import { normalize_show_controls, type ShowControlsProp } from '$lib/controls'
  import EmptyState from '$lib/EmptyState.svelte'
  import { Spinner, StatusMessage } from 'svelte-widgets'
  import { create_material_loader } from '$lib/file-viewer/material-loader.svelte'
  import type { FileLoadCallback } from '$lib/io'
  import { ViewerChrome } from '$lib/layout'
  import { PlotTooltip } from '$lib/plot'
  import { create_renderer, export_scene_as, webgpu_available } from '$lib/scene'
  import type { SceneExportFormat } from '$lib/scene'
  import { DEFAULTS } from '$lib/settings'
  import type { Crystal } from '$lib/structure'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { Camera, Scene } from 'three/webgpu'
  import { detect_irreducible_bz, extract_fermi_surface } from './compute'
  import FermiSurfaceControls from './FermiSurfaceControls.svelte'
  import FermiSurfaceScene from './FermiSurfaceScene.svelte'

  import FermiSurfaceTooltip from './FermiSurfaceTooltip.svelte'
  import { normalize_band_grid, normalize_fermi_surface } from './parse'
  import type { BandGridJson, FermiSurfaceJson } from './parse'
  import { to_error } from '$lib/utils'
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
    mu = $bindable(DEFAULTS.fermi.mu),
    controls_open = $bindable(false),
    color_property = $bindable(DEFAULTS.fermi.color_property),
    color_scale = $bindable(DEFAULTS.fermi.color_scale),
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
    data_url,
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
    // Label for the per-vertex property colouring (e.g. "Fermi velocity", "λ(k)", "DOS")
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
    data_url?: string
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

  // Yield to browser so spinner can render before heavy computation
  const tick = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )

  const drop_zone = create_material_loader<FermiSurfaceData | BandGridData>({
    data_url: () => data_url,
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
  // mount with only `band_data` supplied, which previously rendered nothing. Debounced so a
  // mu-slider drag does not run marching cubes on every tick; a monotonic job id drops
  // results of superseded runs (bumped on every rerun, including one that clears band_data,
  // so an in-flight job cannot commit a surface for a grid that is gone). `extracting` is
  // tracked separately so the spinner overlays the Canvas instead of unmounting it.
  let extraction_job_id = 0
  let extracting = $state(false)
  $effect(() => {
    const job_id = ++extraction_job_id
    if (!grid_data) {
      extracting = false
      return
    }
    const grid = grid_data
    const options = { mu, interpolation_factor }
    const timeout = setTimeout(async () => {
      extracting = true
      await tick()
      // Superseded while yielding; the job is synchronous from here on, so this is the only
      // point a newer run can slip in
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
    }, 150)
    return () => clearTimeout(timeout)
  })

  async function handle_export(format: SceneExportFormat) {
    if (!scene) {
      console.error(`No scene available for export`)
      return
    }
    try {
      await export_scene_as(scene, format, current_filename || `fermi-surface`)
    } catch (err) {
      console.error(`Export failed:`, err)
      error_msg = `Export failed: ${to_error(err).message}`
    }
  }

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
    <Spinner
      text="Loading Fermi surface..."
      style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%)"
      {...spinner_props}
    />
  {:else if error_msg}
    <StatusMessage
      bind:message={error_msg}
      type="error"
      dismissible
      style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); max-width: 90%; text-align: center"
    />
  {:else if surface_data || grid_data}
    {#if extracting}
      <Spinner
        text="Extracting Fermi surface..."
        style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1"
        {...spinner_props}
      />
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
          bind:mu
          bind:color_property
          bind:color_scale
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
          property_label={custom_property_label}
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
  }
  .fermi-surface.active {
    z-index: var(--fermi-active-z-index, 2);
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
</style>
