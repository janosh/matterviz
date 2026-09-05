<script lang="ts">
  import { DEFAULT_PNG_DPI } from '$lib/constants'
  import { normalize_show_controls, type ShowControlsProp } from '$lib/controls'
  import EmptyState from '$lib/EmptyState.svelte'
  import { Spinner, StatusMessage } from 'svelte-widgets'
  import { create_material_loader } from '$lib/file-viewer/material-loader.svelte'
  import type { FileLoadCallback, FileLoadData } from '$lib/io'
  import { ViewerChrome } from '$lib/layout'
  import type { Vec3 } from '$lib/math'
  import { PlotTooltip } from '$lib/plot'
  import { create_renderer, webgpu_available } from '$lib/scene'
  import { DEFAULTS } from '$lib/settings'
  import type { Crystal } from '$lib/structure'
  import { analyze_structure_symmetry } from '$lib/symmetry'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { Camera, Scene } from 'three/webgpu'
  import BrillouinZoneControls from './BrillouinZoneControls.svelte'
  import BrillouinZoneExportPane from './BrillouinZoneExportPane.svelte'
  import BrillouinZoneInfoPane from './BrillouinZoneInfoPane.svelte'
  import BrillouinZoneScene from './BrillouinZoneScene.svelte'

  import BrillouinZoneTooltip from './BrillouinZoneTooltip.svelte'
  import {
    compute_brillouin_zone,
    compute_irreducible_bz,
    extract_point_group_from_operations,
  } from './compute'
  import { clamp, reciprocal_lattice } from '$lib/math'
  import { to_error } from '$lib/utils'
  import { is_editable_event_target, is_modifier_chord } from 'svelte-widgets/utils'
  import type {
    BrillouinZoneData,
    BrillouinZoneSettings,
    BZHoverData,
    BZTooltipProp,
    IrreducibleBZData,
  } from './types'

  type BrillouinControlName =
    | `filename`
    | `fullscreen`
    | `info-pane`
    | `export-pane`
    | `controls`

  type BZHandlerData = FileLoadData & {
    structure?: Crystal
    bz_data?: BrillouinZoneData
    bz_order?: number
    file_size?: number
    error_msg?: string
    fullscreen?: boolean
  }
  let {
    structure = $bindable(),
    bz_order = $bindable(DEFAULTS.brillouin.bz_order),
    // Pre-computed zone; wins over the one derived from `structure`
    bz_data,
    controls_open = $bindable(false),
    info_pane_open = $bindable(false),
    surface_color = $bindable(DEFAULTS.brillouin.surface_color),
    surface_opacity = $bindable(DEFAULTS.brillouin.surface_opacity),
    edge_color = $bindable(DEFAULTS.brillouin.edge_color),
    edge_width = $bindable(DEFAULTS.brillouin.edge_width),
    show_vectors = $bindable(DEFAULTS.brillouin.show_vectors),
    vector_scale = $bindable(DEFAULTS.brillouin.vector_scale),
    camera_projection = $bindable(DEFAULTS.brillouin.camera_projection),
    show_ibz = $bindable(DEFAULTS.brillouin.show_ibz),
    ibz_color = $bindable(DEFAULTS.brillouin.ibz_color),
    ibz_opacity = $bindable(DEFAULTS.brillouin.ibz_opacity),
    ibz_data = $bindable<IrreducibleBZData | null>(null),
    show_controls,
    fullscreen = $bindable(false),
    wrapper = $bindable(),
    width = $bindable(0),
    height = $bindable(0),
    scene = $bindable(),
    camera = $bindable(),
    hovered = $bindable(false),
    dragover = $bindable(false),
    allow_file_drop = true,
    png_dpi = $bindable(DEFAULT_PNG_DPI),
    fullscreen_toggle = DEFAULTS.brillouin.fullscreen_toggle,
    data_url,
    structure_string,
    on_file_drop,
    spinner_props = {},
    loading = $bindable(false),
    error_msg = $bindable(),
    k_path_points = [],
    k_path_labels = [],
    hovered_k_point = null,
    highlighted_k_points = [],
    hovered_qpoint_index = null,
    on_kpath_hover,
    children,
    tooltip_config,
    on_file_load,
    on_error,
    on_fullscreen_change,
    on_point_hover,
    ...rest
  }: Partial<BrillouinZoneSettings> & {
    structure?: Crystal
    bz_data?: BrillouinZoneData
    controls_open?: boolean
    info_pane_open?: boolean
    ibz_data?: IrreducibleBZData | null
    show_controls?: ShowControlsProp<BrillouinControlName>
    fullscreen?: boolean
    width?: number
    height?: number
    scene?: Scene // bindable: Threlte scene, e.g. for custom exports
    camera?: Camera // bindable: active camera, e.g. to read the live orthographic zoom
    wrapper?: HTMLDivElement
    png_dpi?: number
    hovered?: boolean
    dragover?: boolean
    allow_file_drop?: boolean
    fullscreen_toggle?: boolean
    data_url?: string
    structure_string?: string
    on_file_drop?: FileLoadCallback
    spinner_props?: ComponentProps<typeof Spinner>
    loading?: boolean
    error_msg?: string
    // K-path points in Cartesian reciprocal space coordinates (not fractional coords)
    // Should be computed using the reciprocal lattice matrix (includes 2π factor)
    k_path_points?: Vec3[]
    // K-path labels with positions in Cartesian reciprocal space coordinates
    // Each position should match a corresponding point in k_path_points
    k_path_labels?: { position: Vec3; label: string | null }[]
    // Currently hovered k-point in Cartesian reciprocal space coordinates
    hovered_k_point?: Vec3 | null
    // Persistently marked k-points in Cartesian reciprocal coordinates (same treatment as the
    // hovered point; BrillouinZonePopup pins the clicked symmetry point this way)
    highlighted_k_points?: Vec3[]
    // Index of the currently hovered q-point in the band structure
    hovered_qpoint_index?: number | null
    // Called with the q-point index when the user hovers the k-path in the BZ (null on leave)
    on_kpath_hover?: (qpoint_index: number | null) => void
    children?: Snippet<[{ structure?: Crystal; bz_data?: BrillouinZoneData }]>
    tooltip_config?: BZTooltipProp
    on_file_load?: (data: BZHandlerData) => void
    on_error?: (data: BZHandlerData) => void
    on_fullscreen_change?: (data: BZHandlerData) => void
    on_point_hover?: (data: BZHoverData | null) => void
  } & HTMLAttributes<HTMLDivElement> = $props()

  let export_pane_open = $state(false)
  let current_filename = $state<string | undefined>(undefined)
  let hover_data = $state<BZHoverData | null>(null)

  $effect(() => on_point_hover?.(hover_data))

  let controls_config = $derived(normalize_show_controls(show_controls))

  const drop_zone = create_material_loader<Crystal>({
    data_url: () => data_url,
    inline_source: () =>
      structure_string ? { data: structure_string, filename: `string` } : undefined,
    current_value: () => structure,
    allow_file_drop: () => allow_file_drop,
    on_file_drop: () => on_file_drop,
    set_loading: (value) => (loading = value),
    set_error: (message) => (error_msg = message),
    set_dragover: (over) => (dragover = over),
    commit: (opened) => {
      if (opened.type !== `structure`) {
        throw new Error(`${opened.filename} is ${opened.type}, not a structure`)
      }
      structure = opened.data as Crystal // the zone needs a lattice; AnyStructure is wider
      current_filename = opened.filename
      on_file_load?.({
        structure,
        bz_data: zone,
        bz_order,
        ...opened.provenance,
      })
    },
    report_error: (message, metadata) => {
      error_msg = message
      on_error?.({ error_msg: message, ...metadata })
    },
  })

  // Zone derived from the structure at the current order. A caller-supplied `bz_data` (e.g.
  // pymatviz's `BrillouinZoneWidget(structure=..., bz_data=...)`) wins and is never written
  // back; without one the derived zone renders and follows structure/bz_order changes.
  const derived_bz = $derived.by((): { zone?: BrillouinZoneData; error?: string } => {
    if (!structure?.lattice) return {}
    try {
      const k_lattice = reciprocal_lattice(structure.lattice.matrix, { two_pi: true })
      return { zone: compute_brillouin_zone(k_lattice, clamp(bz_order, 1, 3) as 1 | 2 | 3) }
    } catch (err) {
      return { error: `BZ computation failed: ${to_error(err).message}` }
    }
  })
  const zone = $derived(bz_data ?? derived_bz.zone)
  // A derivation failure is reported only while the derived zone is what would render (a
  // caller's zone makes it irrelevant). A structure that derives again clears the notice its
  // predecessor raised — only that one: a file-load error is not this effect's to clear.
  let reported_compute_error: string | undefined
  $effect(() => {
    const error = bz_data ? undefined : derived_bz.error
    if (!error && reported_compute_error && error_msg === reported_compute_error) {
      error_msg = undefined
    }
    reported_compute_error = error
    if (error) {
      error_msg = error
      untrack(() => on_error?.({ error_msg: error, structure, bz_order }))
    }
  })

  // Compute IBZ when show_ibz is enabled and structure changes. The IBZ is an optional
  // overlay, so its failures (symmetry analysis rejecting, a degenerate wedge) are reported
  // through on_error and a dismissible notice while the zone itself keeps rendering — they
  // never go into the fatal `error_msg`, which blanks the whole viewer.
  let ibz_error = $state<string | undefined>()
  $effect(() => {
    if (!show_ibz || !zone || !structure?.lattice) {
      ibz_data = null
      ibz_error = undefined
      return
    }

    let stale = false
    const captured_bz = zone

    analyze_structure_symmetry(structure, {})
      .then((sym_data) => {
        if (stale) return
        const point_group_ops = extract_point_group_from_operations(sym_data.operations)
        ibz_data = compute_irreducible_bz(captured_bz, point_group_ops)
        ibz_error = undefined
      })
      .catch((err) => {
        if (stale) return
        ibz_data = null
        ibz_error = `IBZ computation failed: ${to_error(err).message}`
        on_error?.({ error_msg: ibz_error, structure, bz_order })
      })

    return () => {
      stale = true
    }
  })

  function onkeydown(event: KeyboardEvent) {
    // `f` is owned by FullscreenButton; chords stay the browser's (Cmd/Ctrl+F = find)
    if (is_editable_event_target(event.target) || is_modifier_chord(event)) return
    if (event.repeat) return // holding `i` would flicker the pane

    if (event.key === `i`) info_pane_open = !info_pane_open
    else if (event.key === `Escape`) {
      if (info_pane_open) info_pane_open = false
      else controls_open = false
    }
  }
</script>

<div
  class:active={info_pane_open || controls_open || export_pane_open}
  role="region"
  aria-label="Brillouin zone viewer"
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  {onkeydown}
  {...rest}
  class={[`brillouin-zone`, rest.class]}
  {@attach drop_zone}
>
  {@render children?.({ structure, bz_data: zone })}
  {#if loading}
    <Spinner text="Loading structure..." {...spinner_props} />
  {:else if error_msg}
    <StatusMessage bind:message={error_msg} type="error" dismissible />
  {:else if zone || structure?.lattice}
    <!-- A caller-supplied zone renders on its own (the file viewer hands over {k_lattice,
         vertices, faces} with no structure) -->
    <StatusMessage
      bind:message={ibz_error}
      type="warning"
      dismissible
      style="position: absolute; top: 0.5em; left: 50%; transform: translateX(-50%); max-width: 90%; z-index: 1"
    />
    <ViewerChrome
      {controls_config}
      filename={current_filename}
      bind:fullscreen
      {fullscreen_toggle}
      {wrapper}
      fullscreen_bg_css_var="--bz-bg-fullscreen"
      on_fullscreen_change={(value) =>
        on_fullscreen_change?.({ structure, bz_data: zone, bz_order, fullscreen: value })}
    >
      {#if controls_config.visible(`info-pane`)}
        <BrillouinZoneInfoPane {structure} bz_data={zone} bind:pane_open={info_pane_open} />
      {/if}

      {#if controls_config.visible(`export-pane`)}
        <BrillouinZoneExportPane
          bind:export_pane_open
          bz_data={zone}
          {wrapper}
          {scene}
          {camera}
          bind:png_dpi
          filename={current_filename || `brillouin-zone`}
        />
      {/if}

      {#if controls_config.visible(`controls`)}
        <BrillouinZoneControls
          bind:controls_open
          bind:bz_order
          bind:surface_color
          bind:surface_opacity
          bind:edge_color
          bind:edge_width
          bind:show_vectors
          bind:camera_projection
          bind:show_ibz
          bind:ibz_color
          bind:ibz_opacity
        />
      {/if}
    </ViewerChrome>

    {#if webgpu_available()}
      <Canvas createRenderer={create_renderer}>
        <BrillouinZoneScene
          bz_data={zone}
          {surface_color}
          {surface_opacity}
          {edge_color}
          {edge_width}
          {show_vectors}
          {vector_scale}
          {camera_projection}
          {k_path_points}
          {k_path_labels}
          {hovered_k_point}
          {highlighted_k_points}
          {hovered_qpoint_index}
          {on_kpath_hover}
          {show_ibz}
          {ibz_data}
          {ibz_color}
          {ibz_opacity}
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
          bg_color={hover_data.is_ibz ? ibz_color : surface_color}
          fixed
          style="z-index: calc(var(--z-index-overlay-controls, 100000000) + 1); backdrop-filter: blur(4px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3)"
        >
          <BrillouinZoneTooltip {hover_data} tooltip={tooltip_config} />
        </PlotTooltip>
      {/if}
    {/if}
  {:else if structure}
    <p class="warn">Structure must have a lattice to compute Brillouin zone</p>
  {:else}
    <EmptyState>
      <h3>Drop Structure File</h3>
      <p>Supports CIF, POSCAR, JSON, (ext)XYZ, (+ .gz)</p>
    </EmptyState>
  {/if}
</div>

<style>
  .brillouin-zone {
    position: relative;
    container-type: size;
    height: var(--bz-height, 500px);
    width: var(--bz-width, 100%);
    max-width: var(--bz-max-width, 100%);
    min-width: var(--bz-min-width, 300px);
    border-radius: var(--bz-border-radius, 0);
    background: var(--bz-bg, var(--surface-bg));
    color: var(--bz-text-color, var(--text-color));
  }
  .brillouin-zone.active {
    z-index: var(--bz-active-z-index, 2);
  }
  .brillouin-zone:fullscreen {
    background: var(--bz-bg-fullscreen, var(--surface-bg));
    overflow: hidden;
  }
  .brillouin-zone:fullscreen :global(canvas) {
    height: 100vh !important;
    width: 100vw !important;
  }
  .brillouin-zone.dragover {
    background: var(--bz-dragover-bg, var(--dragover-bg));
    border: var(--bz-dragover-border, var(--dragover-border));
  }
  .brillouin-zone :global(canvas) {
    user-select: none;
  }
  p.warn {
    text-align: center;
    padding: 2rem;
  }
</style>
