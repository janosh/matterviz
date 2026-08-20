<script lang="ts">
  import type { BrillouinZoneData } from '$lib/brillouin'
  import { compute_brillouin_zone } from '$lib/brillouin'
  import { reciprocal_lattice } from '$lib/math'
  import type { D3InterpolateName } from '$lib/colors'
  import { normalize_show_controls, type ShowControlsProp } from '$lib/controls'
  import EmptyState from '$lib/EmptyState.svelte'
  import { StatusMessage } from '$lib/feedback'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import * as io from '$lib/io'
  import { ViewerChrome } from '$lib/layout'
  import { PlotTooltip } from '$lib/plot'
  import { create_renderer, webgpu_available } from '$lib/scene'
  import type { CameraProjection } from '$lib/settings'
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
  import { parse_fermi_file } from './parse'
  import { to_error } from '$lib/utils'
  import type {
    BandGridData,
    ColorProperty,
    FermiErrorData,
    FermiFileLoadData,
    FermiHoverData,
    FermiSurfaceData,
    FermiTooltipConfig,
    RepresentationMode,
  } from './types'

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
    // Clipping plane
    clip_enabled = $bindable(DEFAULTS.fermi.clip_enabled),
    clip_axis = $bindable(DEFAULTS.fermi.clip_axis),
    clip_position = $bindable(DEFAULTS.fermi.clip_position),
    clip_flip = $bindable(DEFAULTS.fermi.clip_flip),
    // Interpolation
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
    on_mu_change,
    on_point_hover,
    ...rest
  }: {
    fermi_data?: FermiSurfaceData
    band_data?: BandGridData
    structure?: Crystal
    bz_data?: BrillouinZoneData
    mu?: number
    controls_open?: boolean
    color_property?: ColorProperty
    color_scale?: D3InterpolateName
    // Label for custom property coloring (e.g. "λ(k)", "DOS", etc.)
    custom_property_label?: string
    representation?: RepresentationMode
    surface_opacity?: number
    selected_bands?: number[]
    show_bz?: boolean
    bz_opacity?: number
    show_vectors?: boolean
    tile_bz?: boolean
    clip_enabled?: boolean
    clip_axis?: `x` | `y` | `z`
    clip_position?: number
    clip_flip?: boolean
    interpolation_factor?: number
    camera_projection?: CameraProjection
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
    on_file_drop?: io.FileLoadCallback
    on_file_load?: (data: FermiFileLoadData) => void
    on_error?: (data: FermiErrorData) => void
    on_fullscreen_change?: (data: FermiFullscreenData) => void
    on_mu_change?: (mu: number) => void
    tooltip_config?: Snippet<[{ hover_data: FermiHoverData }]> | FermiTooltipConfig
    on_point_hover?: (data: FermiHoverData | null) => void
  } & HTMLAttributes<HTMLDivElement> = $props()

  let scene = $state<Scene | undefined>(undefined)
  let camera = $state<Camera | undefined>(undefined)
  let current_filename = $state<string | undefined>(undefined)
  let recompute_job_id = 0 // monotonic counter to track latest recompute call
  let hover_data = $state<FermiHoverData | null>(null)

  $effect(() => on_point_hover?.(hover_data))

  let controls_config = $derived(normalize_show_controls(show_controls))

  // Yield to browser so spinner can render before heavy computation
  const tick = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )

  // Parse and load Fermi surface with error handling
  async function safe_parse(
    content: string | ArrayBuffer,
    filename: string,
    metadata?: io.FileLoadMeta,
    // False once a newer data_url request superseded this one, so a slow URL A cannot
    // overwrite URL B's surface or report its parse error over B's
    is_current: () => boolean = () => true,
  ): Promise<boolean> {
    try {
      await tick()
      if (!is_current()) return false
      // parse_fermi_file throws a descriptive error when parsing fails
      const parsed = parse_fermi_file(io.as_text(content), filename)

      const file_size = io.content_byte_size(content)
      current_filename = filename

      // Check if it's already FermiSurfaceData or BandGridData
      if (`isosurfaces` in parsed) {
        fermi_data = parsed
        band_data = undefined
      } else {
        band_data = parsed
        fermi_data = extract_fermi_surface(parsed, { mu, wigner_seitz: true })
      }

      on_file_load?.({ fermi_data, band_data, filename, ...metadata, file_size })
      return true
    } catch (err) {
      if (!is_current()) return false
      error_msg = `Failed to parse ${filename}: ${to_error(err).message}`
      on_error?.({ error_msg, filename, ...metadata })
      return false
    }
  }

  // Re-extract Fermi surface from band data with current settings
  async function recompute_fermi_surface() {
    if (!band_data) return
    const job_id = ++recompute_job_id // capture this job's ID
    await tick() // yield to check for newer jobs before committing to work
    // Check if this job is still the latest before proceeding
    // If stale, return without setting loading - the superseding job handles it
    if (job_id !== recompute_job_id) return
    // Only set loading after stale check to avoid orphaned loading states
    loading = true
    try {
      const result = extract_fermi_surface(band_data, {
        mu,
        wigner_seitz: true,
        interpolation_factor,
      })
      // Only update state if this is still the latest job
      if (job_id === recompute_job_id) {
        fermi_data = result
        // Re-extraction edits URL-loaded data in place; without re-claiming it the loader
        // would read the new object as caller-supplied and stop defending its URL.
        if (data_url_loader.loaded_url) data_url_loader.claim(fermi_data)
      }
    } catch (err) {
      console.error(`Failed to re-extract Fermi surface:`, err)
    } finally {
      // Only clear loading if this is still the latest job
      if (job_id === recompute_job_id) loading = false
    }
  }

  // Debounce recompute to avoid excessive re-computation during rapid slider drags
  let recompute_timeout: ReturnType<typeof setTimeout>

  function handle_mu_change(new_mu: number) {
    mu = new_mu
    clearTimeout(recompute_timeout)
    recompute_timeout = setTimeout(() => void recompute_fermi_surface(), 150)
    on_mu_change?.(new_mu)
  }

  function handle_interpolation_change(new_factor: number) {
    interpolation_factor = new_factor
    clearTimeout(recompute_timeout)
    recompute_timeout = setTimeout(() => void recompute_fermi_surface(), 150)
  }

  // Export Fermi surface to various formats
  async function handle_export(format: `stl` | `obj` | `gltf`) {
    if (!scene) {
      console.error(`No scene available for export`)
      return
    }
    try {
      const { export_scene } = await import(`./export`)
      await export_scene(scene, format, current_filename || `fermi-surface`)
    } catch (err) {
      console.error(`Export failed:`, err)
      error_msg = `Export failed: ${to_error(err).message}`
    }
  }

  // Compute BZ when structure or fermi_data changes
  $effect(() => {
    // Get k_lattice from available sources (priority order)
    const k_lattice =
      fermi_data?.k_lattice ??
      band_data?.k_lattice ??
      (structure?.lattice?.matrix
        ? reciprocal_lattice(structure.lattice.matrix, { two_pi: true })
        : null)

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
    if (fermi_data && detect_irreducible_bz(fermi_data)) {
      tile_bz = true
    }
  })

  // Load from URL
  const data_url_loader = io.create_data_url_loader()

  $effect(() =>
    data_url_loader.request({
      url: data_url,
      current_value: fermi_data ?? band_data,
      set_loading: (value) => (loading = value),
      clear_error: () => (error_msg = undefined),
      on_load: async ({ content, filename, metadata, is_current, mark_owned }) => {
        if (await safe_parse(content, filename, metadata, is_current)) {
          mark_owned(fermi_data ?? band_data)
        }
      },
      on_error: (err, filename) => {
        error_msg = err.message
        on_error?.({ error_msg, filename })
      },
    }),
  )

  const file_drop_zone = io.file_drop_zone({
    allow: () => allow_file_drop,
    on_drop: async (content, filename, metadata) => {
      await (on_file_drop || safe_parse)(content, filename, metadata)
    },
    on_error: (msg) => {
      error_msg = msg
      on_error?.({ error_msg: msg })
    },
    set_loading: (val) => {
      loading = val
      if (val) error_msg = undefined
    },
    on_dragover: (over) => (dragover = over),
  })

  function handle_keydown(event: KeyboardEvent) {
    const target = event.target
    if (target instanceof HTMLElement && [`INPUT`, `TEXTAREA`].includes(target.tagName)) return
    // Only handle shortcuts when component is focused/hovered or contains focus
    if (!wrapper?.contains(document.activeElement) && !hovered) return

    if (event.key === `f` && fullscreen_toggle) fullscreen = !fullscreen
    else if (event.key === `Escape`) controls_open = false
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
  {@attach file_drop_zone}
>
  {@render children?.({ fermi_data, bz_data })}
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
  {:else if fermi_data || band_data}
    <ViewerChrome
      {controls_config}
      filename={current_filename}
      bind:fullscreen
      {fullscreen_toggle}
      {wrapper}
      fullscreen_bg_css_var="--fermi-bg-fullscreen"
      on_fullscreen_change={(value) =>
        on_fullscreen_change?.({ fermi_data, bz_data, fullscreen: value })}
    >
      {#if controls_config.visible(`controls`)}
        <FermiSurfaceControls
          bind:controls_open
          {fermi_data}
          {band_data}
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
          on_mu_change={handle_mu_change}
          on_interpolation_change={handle_interpolation_change}
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
          {fermi_data}
          {bz_data}
          {color_property}
          {color_scale}
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
