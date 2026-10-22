<script lang="ts">
  import ExportPane from '#lib/io/ExportPane.svelte'
  import { canvas_sources, type ExportProps } from '#lib/io/export.js'
  import type { MaterialSource } from '#lib/file-viewer/open.js'
  import type { BrillouinZoneData } from '#lib/brillouin/index.js'
  import BrillouinZoneTooltip from '#lib/brillouin/BrillouinZoneTooltip.svelte'
  import { compute_brillouin_zone, KPATH_COLORS } from '#lib/brillouin/index.js'
  import { reciprocal_lattice } from '#lib/math.js'
  import { normalize_show_controls, type ShowControlsProp } from '#lib/controls.js'
  import EmptyState from 'svelte-widgets/EmptyState.svelte'
  import type { Spinner } from 'svelte-widgets'
  import ViewerError from '#lib/layout/ViewerError.svelte'
  import { derived_error_notice } from '#lib/layout/error-notice.svelte.js'
  import LiveMessage from 'svelte-widgets/LiveMessage.svelte'
  import TaskStatus from 'svelte-widgets/TaskStatus.svelte'
  import { create_material_loader } from '#lib/file-viewer/material-loader.svelte.js'
  import type { FileLoadCallback } from '#lib/io/index.js'
  import type { FileSaver } from '#lib/io/file-export.svelte.js'
  import { ViewerChrome } from '#lib/layout/index.js'
  import { PlotTooltip } from '#lib/plot/index.js'
  import {
    create_renderer,
    key_walk_root,
    wheel_zoom_gate,
    export_scene_as,
    webgpu_available,
  } from '#lib/scene/index.js'
  import { DEFAULTS } from '#lib/settings.js'
  import type { Vec2, Vec3 } from '#lib/math.js'
  import ColorBar from '#lib/plot/core/components/ColorBar.svelte'
  import { resolve_color_scale } from '#lib/plot/core/scales.js'
  import type { Crystal } from '#lib/structure/index.js'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { Camera, Scene } from 'three/webgpu'
  import { detect_irreducible_bz, preview_interpolation_factor } from './compute'
  import * as extraction from './extract-async'
  import FermiSurfaceControls from './FermiSurfaceControls.svelte'
  import FermiSurfaceScene from './FermiSurfaceScene.svelte'
  import FermiSurfaceTooltip from './FermiSurfaceTooltip.svelte'
  import { property_label } from './constants'
  import {
    available_property_names,
    property_value_range,
    visible_isosurfaces,
  } from './geometry'
  import { normalize_band_grid, normalize_fermi_surface } from './parse'
  import type { BandGridJson, FermiSurfaceJson } from './parse'
  import { to_error } from 'svelte-widgets/utils'
  import { can_create_worker } from '#lib/worker-client.svelte.js'
  import { viewer_keys } from '#lib/shortcuts.js'
  import { mark_pin } from '#lib/tooltip/pin.svelte.js'
  import { reset_scene_cameras } from '#lib/scene/camera-reset.js'
  import type {
    BandGridData,
    FermiErrorData,
    FermiFileLoadData,
    FermiHover,
    FermiHoverData,
    FermiSurfaceData,
    FermiSurfaceSettings,
    FermiTooltipProp,
    SpinChannel,
  } from './types'
  import { is_fermi_surface_data } from './types'

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
    color_bar = {},
    slice_plane,
    k_marker = null,
    k_path,
    wigner_seitz = false,
    previewing = false,
    custom_property_label,
    representation = $bindable(DEFAULTS.fermi.representation),
    surface_opacity = $bindable(DEFAULTS.fermi.surface_opacity),
    selected_bands = $bindable(),
    selected_spins,
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
    tooltip,
    on_file_drop,
    on_file_load,
    on_error,
    on_fullscreen_change,
    on_point_hover,
    export_formats,
    export_filename,
    on_export,
    ...rest
  }: Partial<FermiSurfaceSettings> &
    ExportProps & {
      // Both accept the typed-array form `parse_fermi_file` returns and the JSON form (plain
      // `vertices`/`faces` rows, nested energies) that pymatviz/anywidget traits can carry
      fermi_data?: FermiSurfaceData | FermiSurfaceJson
      band_data?: BandGridData | BandGridJson
      structure?: Crystal
      bz_data?: BrillouinZoneData
      controls_open?: boolean
      property_name?: string // coloured by in `property` mode (default: the first present)
      // property color bar, shown in `property` mode; null hides it
      color_bar?: Partial<ComponentProps<typeof ColorBar>> | null
      slice_plane?: { miller_indices: Vec3; distance: number } // e.g. a FermiSlice's, drawn in 3D
      k_marker?: Vec3 | null // k-point (Cartesian Å⁻¹) to mark, e.g. a FermiSlice's cursor
      k_path?: ComponentProps<typeof FermiSurfaceScene>[`k_path`] // e.g. a band plot's path
      wigner_seitz?: boolean // fold band-grid surfaces into the zone, e.g. to match a k-path
      // pointer-driven preview (e.g. band plot hover): extract at most at the auto resolution
      previewing?: boolean
      // Label of the unnamed per-vertex property, e.g. "Fermi velocity", "λ(k)", "DOS"
      custom_property_label?: string
      selected_bands?: number[]
      selected_spins?: SpinChannel[] // spin channels whose sheets are shown (all when unset)
      show_controls?: ShowControlsProp<`filename` | `fullscreen` | `controls` | `export-pane`>
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
      on_fullscreen_change?: (data: {
        fermi_data?: FermiSurfaceData
        bz_data?: BrillouinZoneData
        fullscreen: boolean
      }) => void
      tooltip?: FermiTooltipProp
      on_point_hover?: (data: FermiHoverData | null) => void
    } & HTMLAttributes<HTMLDivElement> = $props()

  let scene = $state<Scene | undefined>(undefined)
  let camera = $state<Camera | undefined>(undefined)
  let current_filename = $state<string | undefined>(undefined)
  // A click pins the hovered sheet tile's or k-path point's tooltip where it was (see TooltipPin)
  const pin = mark_pin<FermiHover>()
  let hovered_mark = $state.raw<FermiHover | null>(null)
  const shown = $derived(pin.shown(hovered_mark))
  const hover_data = $derived(shown && `band_index` in shown.data ? shown.data : null)

  $effect(() => on_point_hover?.(hover_data))

  let controls_config = $derived(normalize_show_controls(show_controls))

  const attempt = <T>(prefix: string, compute: () => T): { value?: T; error?: string } => {
    try {
      return { value: compute() }
    } catch (err) {
      return { error: `${prefix}: ${to_error(err).message}` }
    }
  }
  // Normalise the data props once at the boundary: pymatviz's `fermi_data`/`band_data` traits
  // can only travel as JSON (plain vertex/face rows, nested energies), while everything below
  // consumes typed arrays. Typed input passes through by identity. A malformed payload is
  // reported through error_msg/on_error instead of throwing mid-render. Separate deriveds, so
  // committing an extracted fermi_data does not re-normalise a JSON band_data into a new grid
  // (which re-ran the extraction every frame).
  const invalid = `Invalid Fermi surface data`
  const surface_result = $derived(
    attempt(invalid, () => fermi_data && normalize_fermi_surface(fermi_data)),
  )
  const grid_result = $derived(
    attempt(invalid, () => band_data && normalize_band_grid(band_data)),
  )
  const surface_data = $derived(surface_result.value)
  const grid_data = $derived(grid_result.value)

  // BZ of whichever reciprocal lattice is available (priority order)
  const k_lattice = $derived(
    surface_data?.k_lattice ??
      grid_data?.k_lattice ??
      (structure?.lattice?.matrix
        ? reciprocal_lattice(structure.lattice.matrix, { two_pi: true })
        : null),
  )
  const bz_result = $derived(
    attempt(`BZ computation failed`, () => k_lattice && compute_brillouin_zone(k_lattice, 1)),
  )
  $effect(() => {
    bz_data = bz_result.value ?? undefined
  })

  // Only a structure's (user input) zone failure is reported
  derived_error_notice(
    () =>
      surface_result.error ??
      grid_result.error ??
      (structure?.lattice?.matrix ? bz_result.error : undefined),
    { get: () => error_msg, set: (message) => (error_msg = message) },
    (error) => on_error?.({ error_msg: error }),
  )

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
  // mount with only `band_data` supplied — latest-wins in a worker (create_latest_extractor).
  // Results commit in job order and only for the current grid; only the newest job reports
  // errors and clears `extracting`, a spinner while a grid or factor upsamples first.
  const extract_latest = extraction.create_latest_extractor()
  let extraction_job_id = 0
  let committed_job_id = 0
  let extracting = $state(false)
  // nothing commits, reports or clears the spinner after unmount
  $effect(() => {
    const unregister = extraction.register_fermi_viewer()
    return () => {
      committed_job_id = Infinity
      extraction_job_id = Infinity
      extract_latest.cancel()
      unregister()
    }
  })
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
    const cold = !extraction.fermi_extraction_warm(grid, factor)
    extracting = cold
    const extract = () =>
      extract_latest(grid, options)
        .then(
          (result) => {
            if (!result || job_id < committed_job_id || grid !== grid_data) return
            committed_job_id = job_id
            fermi_data = result
            error_msg = undefined
          },
          (err: unknown) => {
            if (job_id !== extraction_job_id) return
            error_msg = `Fermi surface extraction failed: ${to_error(err).message}`
            on_error?.({ error_msg })
          },
        )
        .finally(() => {
          if (job_id === extraction_job_id) extracting = false
        })
    if (can_create_worker()) {
      extract()
      return
    }
    // On the main thread (no workers, e.g. anywidget) extraction blocks: mu changes batch per
    // frame, and a grid or factor still to upsample first gives the spinner a painted frame
    let frame = requestAnimationFrame(() => {
      if (cold) frame = requestAnimationFrame(extract)
      else extract()
    })
    return () => cancelAnimationFrame(frame)
  })

  // PNG of the view plus the visible sheets as 3D models (OBJ also writes its .mtl)
  const model_formats = [
    [`STL`, `stl`, `3D printing`],
    [`OBJ`, `obj`, `Wavefront`],
    [`GLB`, `glb`, `web/AR`],
  ] as const
  const export_sections = $derived([
    {
      title: `3D model`,
      tooltip: `Visible Fermi surfaces`,
      items: model_formats.map(([label, format, hint]) => ({
        label,
        hint,
        disabled: !scene,
        disabled_reason: scene ? undefined : `Waiting for the 3D view to render`,
        on_download: ({ filename, save }: { filename: string; save: FileSaver }) =>
          scene && export_scene_as(scene, format, filename, save),
      })),
    },
  ])

  // The requested property when present, else the first; the fitted range spans visible sheets
  // and fills the ends color_scale.value_range leaves unset
  const available_properties = $derived(available_property_names(surface_data, grid_data))
  const active_property = $derived(
    property_name !== undefined && available_properties.includes(property_name)
      ? property_name
      : available_properties[0],
  )
  const fitted_value_range = $derived<Vec2>(
    color_property === `property`
      ? property_value_range(
          visible_isosurfaces(surface_data?.isosurfaces, selected_bands, selected_spins),
          active_property,
        )
      : [0, 1],
  )
  // Shared by the surface and its ColorBar so both draw the same colors
  const resolved_color_scale = $derived(
    resolve_color_scale(color_scale, fitted_value_range).color_scale,
  )

  // Auto-enable BZ tiling when irreducible data is detected
  $effect(() => {
    if (surface_data && detect_irreducible_bz(surface_data)) tile_bz = true
  })

  // `f` is owned by FullscreenButton, Escape by the open pane, else it unpins the tooltip
  const keys = viewer_keys(() => ({
    r: () => reset_scene_cameras(wrapper),
    Escape: pin.unpin,
  }))
  const key_walk = key_walk_root() // the sheets, by keyboard (see KeyWalk)
  const wheel_gate = wheel_zoom_gate()
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  role="application"
  tabindex="0"
  aria-label="Fermi surface viewer"
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  {...rest}
  class={[`fermi-surface`, rest.class, { active: controls_open }]}
  {@attach drop_zone}
  {@attach keys}
  {@attach key_walk.attach}
  {@attach wheel_gate}
>
  <LiveMessage message={key_walk.message} />
  {@render children?.({ fermi_data: surface_data, bz_data })}
  {#if loading}
    <TaskStatus overlay spinner label="Loading Fermi surface..." {spinner_props} />
  {:else if error_msg}
    <ViewerError bind:message={error_msg} dismissible />
  {:else if surface_data || grid_data}
    {#if extracting}
      <TaskStatus overlay spinner label="Extracting Fermi surface..." {spinner_props} />
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
          {fitted_value_range}
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
          shortcut_scopes={[`viewer`, `camera`]}
        />
      {/if}
      {#if export_formats?.length !== 0 && controls_config.visible(`export-pane`)}
        <ExportPane
          filename={export_filename ?? (current_filename || `fermi-surface`)}
          sources={canvas_sources(() => wrapper?.querySelector(`canvas`))}
          sections={export_sections}
          {export_formats}
          {on_export}
          toggle_props={{ class: `fermi-export-toggle`, title: `Export Fermi surface` }}
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
          color_scale={resolved_color_scale}
          property_name={active_property}
          property_label={custom_property_label}
          {slice_plane}
          {k_marker}
          {k_path}
          {representation}
          {surface_opacity}
          {selected_bands}
          {selected_spins}
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
          bind:hovered={hovered_mark}
          {pin}
        />
      </Canvas>

      {#if color_bar && color_property === `property` && active_property !== undefined}
        <ColorBar
          title={property_label(active_property, custom_property_label)}
          color_scale={resolved_color_scale}
          snap_ticks={false}
          tick_labels={3}
          orientation="horizontal"
          {...color_bar}
          class={[`property-colorbar`, color_bar.class]}
          --cbar-font-size="0.75em"
          --cbar-tick-label-font-weight="normal"
        />
      {/if}

      <!-- Hover tooltip; a k-path point reads like a Brillouin zone hover, in its tint -->
      {#if shown && tooltip !== false}
        {@const { data } = shown}
        <PlotTooltip
          {...data.screen_position}
          offset={{ x: 12, y: -12 }}
          bg_color={`band_index` in data ? data.surface_color : KPATH_COLORS.hover}
          pinned={pin.value !== null}
          fixed
          style="z-index: var(--z-index-overlay-nav, 100000001)"
        >
          {#if `band_index` in data}
            <FermiSurfaceTooltip hover_data={data} {tooltip} />
          {:else}
            <BrillouinZoneTooltip hover_data={data} />
          {/if}
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
