<script lang="ts">
  import type { MaterialSource } from '#lib/file-viewer/open.js'
  import { DEFAULT_PNG_DPI } from '#lib/constants.js'
  import { normalize_show_controls, type ShowControlsProp } from '#lib/controls.js'
  import EmptyState from 'svelte-widgets/EmptyState.svelte'
  import type { Spinner } from 'svelte-widgets'
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'
  import LiveMessage from 'svelte-widgets/LiveMessage.svelte'
  import TaskStatus from 'svelte-widgets/TaskStatus.svelte'
  import ViewerError from '#lib/layout/ViewerError.svelte'
  import ViewerNotices from '#lib/layout/ViewerNotices.svelte'
  import { derived_error_notice } from '#lib/layout/error-notice.svelte.js'
  import { create_material_loader } from '#lib/file-viewer/material-loader.svelte.js'
  import type { FileLoadCallback, FileLoadData } from '#lib/io/index.js'
  import { ViewerChrome } from '#lib/layout/index.js'
  import { format_num } from '#lib/labels.js'
  import type { InfoPaneCard, InfoPaneRow } from '#lib/overlays/index.js'
  import { info_pane_icon, ViewerPane } from '#lib/overlays/index.js'
  import InfoPaneCards from '#lib/overlays/InfoPaneCards.svelte'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
  import { PlotTooltip } from '#lib/plot/index.js'
  import {
    create_renderer,
    key_walk_root,
    wheel_zoom_gate,
    webgpu_available,
  } from '#lib/scene/index.js'
  import { DEFAULTS } from '#lib/settings.js'
  import { join_hover_link } from '#lib/tooltip/index.js'
  import { mark_pin } from '#lib/tooltip/pin.svelte.js'
  import type { Crystal } from '#lib/structure/index.js'
  import { analyze_structure_symmetry, point_group_rotations } from '#lib/symmetry/index.js'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { Camera, Scene } from 'three/webgpu'
  import ExportPane from '#lib/io/ExportPane.svelte'
  import { canvas_sources, json_source } from '#lib/io/export.js'
  import BrillouinZoneControls from './BrillouinZoneControls.svelte'
  import BrillouinZoneScene from './BrillouinZoneScene.svelte'
  import BrillouinZoneTooltip from './BrillouinZoneTooltip.svelte'
  import { compute_brillouin_zone, compute_irreducible_bz } from './compute'
  import { clamp, reciprocal_lattice } from '#lib/math.js'
  import { to_error } from 'svelte-widgets/utils'
  import { shortcut_attrs, viewer_keys } from '#lib/shortcuts.js'
  import { reset_scene_cameras } from '#lib/scene/camera-reset.js'
  import type {
    BrillouinZoneData,
    BrillouinZoneSettings,
    BZHover,
    BZHoverData,
    BZTooltipProp,
    IrreducibleBZData,
    KPathData,
  } from './types'
  import { ordinal_label } from './types'

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
    // Pre-computed zone; wins over the one derived from `k_lattice` or `structure`
    bz_data,
    k_lattice,
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
    source,
    on_file_drop,
    spinner_props = {},
    loading = $bindable(false),
    error_msg = $bindable(),
    k_path,
    hovered_k_point = null,
    highlighted_k_points = [],
    hovered_qpoint_index = null,
    highlighted_qpoint_range = null,
    on_kpath_hover,
    link_hover,
    children,
    tooltip,
    on_file_load,
    on_error,
    on_fullscreen_change,
    on_point_hover,
    ...rest
  }: Partial<BrillouinZoneSettings> & {
    structure?: Crystal
    bz_data?: BrillouinZoneData
    // reciprocal lattice (rows b_i, 2π included) to derive the zone from instead of `structure`
    k_lattice?: Matrix3x3
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
    source?: MaterialSource
    on_file_drop?: FileLoadCallback
    spinner_props?: ComponentProps<typeof Spinner>
    loading?: boolean
    error_msg?: string
    // Band-structure k-path to draw, in Cartesian reciprocal coordinates from the reciprocal
    // lattice incl. 2π (spectral's band_k_path builds it from a band structure)
    k_path?: KPathData
    // Currently hovered k-point in Cartesian reciprocal space coordinates
    hovered_k_point?: Vec3 | null
    // Persistently marked k-points in Cartesian reciprocal coordinates (same treatment as the
    // hovered point; BrillouinZonePopup pins the clicked symmetry point this way)
    highlighted_k_points?: Vec3[]
    // Index of the currently hovered q-point in the band structure
    hovered_qpoint_index?: number | null
    // First and last q-point index of a k-path stretch to tint, e.g. the hovered path branch
    highlighted_qpoint_range?: Vec2 | null
    // Called with the q-point index on hovering the k-path or a symmetry label (null on leave)
    on_kpath_hover?: (qpoint_index: number | null) => void
    // Channel of an enclosing hover_links() the k-path's hover joins by q-point index, e.g. the
    // Bands plotting the band structure k_path came from: a q-point hovered there marks its
    // k-point and branch here, and the hovered k-path q-point there
    link_hover?: string
    children?: Snippet<[{ structure?: Crystal; bz_data?: BrillouinZoneData }]>
    tooltip?: BZTooltipProp
    on_file_load?: (data: BZHandlerData) => void
    on_error?: (data: BZHandlerData) => void
    on_fullscreen_change?: (data: BZHandlerData) => void
    on_point_hover?: (data: BZHoverData | null) => void
  } & HTMLAttributes<HTMLDivElement> = $props()

  let export_pane_open = $state(false)
  let current_filename = $state<string | undefined>(undefined)
  // A click pins the hovered mark's tooltip where it was (see TooltipPin)
  const pin = mark_pin<BZHover>()
  let hovered_mark = $state.raw<BZHover | null>(null)
  const hover_data = $derived(pin.shown(hovered_mark)?.data ?? null)

  $effect(() => on_point_hover?.(hover_data))

  // A q-point hovered in a linked view marks its k-point and k-path branch
  const qpoint_link = join_hover_link(() => link_hover, `number`)
  const linked = $derived.by(() => {
    const qpoint_idx = qpoint_link.linked
    if (qpoint_idx === null || !k_path) return null
    const in_branch = ([start, end]: Vec2) => start <= qpoint_idx && qpoint_idx <= end
    return {
      qpoint_idx,
      k_point: k_path.points[qpoint_idx] ?? null,
      range: k_path.branches.find(in_branch) ?? null,
    }
  })
  const handle_kpath_hover = (qpoint_idx: number | null): void => {
    qpoint_link.publish(qpoint_idx)
    on_kpath_hover?.(qpoint_idx)
  }

  let controls_config = $derived(normalize_show_controls(show_controls))

  const drop_zone = create_material_loader<Crystal>({
    source: () => source,
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
    const real = structure?.lattice?.matrix
    try {
      const lattice = k_lattice ?? (real && reciprocal_lattice(real, { two_pi: true }))
      if (!lattice) return {}
      return { zone: compute_brillouin_zone(lattice, clamp(bz_order, 1, 3) as 1 | 2 | 3) }
    } catch (err) {
      return { error: `BZ computation failed: ${to_error(err).message}` }
    }
  })
  const zone = $derived(bz_data ?? derived_bz.zone)
  // A derivation failure is reported only while the derived zone is what would render (a
  // caller's zone makes it irrelevant); a structure that derives again clears its notice
  derived_error_notice(
    () => (bz_data ? undefined : derived_bz.error),
    { get: () => error_msg, set: (message) => (error_msg = message) },
    (error) => on_error?.({ error_msg: error, structure, bz_order }),
  )

  // One symmetry analysis serves the IBZ wedge and the info pane's space group, run while
  // either is shown; a result for a replaced structure never lands, and the previous one's
  // wedge and space group do not linger while it runs
  const needs_symmetry = $derived(
    show_ibz || (info_pane_open && controls_config.visible(`info-pane`)),
  )
  let symmetry = $state<{ data?: MoyoDataset; error?: unknown }>({})
  $effect(() => {
    symmetry = {}
    if (!needs_symmetry || !structure?.lattice) return
    let stale = false
    analyze_structure_symmetry(structure, {}).then(
      (data) => {
        if (!stale) symmetry = { data }
      },
      (error: unknown) => {
        if (!stale) symmetry = { error }
      },
    )
    return () => {
      stale = true
    }
  })
  // The IBZ is an optional overlay, so its failures (symmetry analysis rejecting, a degenerate
  // wedge) are a dismissible notice and on_error while the zone keeps rendering, never the
  // fatal `error_msg` that blanks the whole viewer
  const ibz_result = $derived.by((): { data: IrreducibleBZData | null; error?: string } => {
    const failed = (err: unknown) => ({
      data: null,
      error: `IBZ computation failed: ${to_error(err).message}`,
    })
    if (!show_ibz || !zone) return { data: null }
    if (`error` in symmetry) return failed(symmetry.error)
    if (!symmetry.data) return { data: null }
    try {
      return {
        data: compute_irreducible_bz(zone, point_group_rotations(symmetry.data.operations)),
      }
    } catch (err) {
      return failed(err)
    }
  })
  let ibz_error = $state<string | undefined>()
  $effect(() => {
    const { data, error } = ibz_result
    ibz_data = data
    ibz_error = error
    if (error) untrack(() => on_error?.({ error_msg: error, structure, bz_order }))
  })

  // A zone without a structure (caller-supplied `bz_data` only) shows the zone and reciprocal
  // lattice rows; the space group and real lattice need the structure
  const info_cards = $derived.by((): InfoPaneCard[] => {
    if (!zone) return []
    const fmt = (values: number[], spec: string) =>
      values.map((val) => format_num(val, spec)).join(`, `)
    const zone_rows: InfoPaneRow[] = [
      { label: `Order`, value: ordinal_label(zone.order), key: `bz-order` },
      {
        label: `Volume`,
        value: `${format_num(zone.volume, `.3f`)} Å<sup>−3</sup>`,
        key: `bz-volume`,
      },
      {
        label: `Vertices / Faces`,
        value: `${zone.vertices.length} / ${zone.faces.length}`,
        key: `bz-vertices`,
      },
    ]
    const cards: InfoPaneCard[] = [{ title: `Brillouin Zone`, rows: zone_rows }]
    const lattice = structure?.lattice
    if (lattice) {
      const { number, hm_symbol } = symmetry.data ?? {}
      const value = `${number ?? ``} ${hm_symbol ? `(${hm_symbol})` : ``}`.trim()
      zone_rows.push({ label: `Space Group`, value, key: `space-group` })
      const { a, b, c, alpha, beta, gamma } = lattice
      cards.push({
        title: `Real Lattice`,
        rows: [
          { label: `a, b, c`, value: `${fmt([a, b, c], `.3~f`)} Å`, key: `real-lattice-abc` },
          {
            label: `α, β, γ`,
            value: `${fmt([alpha, beta, gamma], `.2~f`)}°`,
            key: `real-lattice-angles`,
          },
        ],
      })
    }
    cards.push({
      title: `Reciprocal Lattice (Å<sup>−1</sup>)`,
      rows: zone.k_lattice.map((vec, idx) => ({
        label: [`b₁`, `b₂`, `b₃`][idx],
        value: `(${fmt(vec, `.3~f`)})`,
        key: `reciprocal-b${idx + 1}`,
      })),
    })
    return cards
  })

  // PNG re-renders the scene at the export DPI; JSON holds the zone and its reciprocal lattice
  const export_sources = $derived({
    ...canvas_sources(() => wrapper?.querySelector(`canvas`)),
    ...(zone && {
      json: json_source(() => {
        const { order, volume, vertices, faces, edges, k_lattice: recip } = zone
        return { order, volume, vertices, faces, edges, reciprocal_lattice: recip }
      }),
    }),
  })

  // `f` is owned by FullscreenButton, Escape by the open pane, else it unpins the tooltip
  const keys = viewer_keys(() => ({
    i: () => {
      info_pane_open = !info_pane_open
    },
    r: () => reset_scene_cameras(wrapper),
    Escape: pin.unpin,
  }))
  const key_walk = key_walk_root() // the zone's faces, by keyboard (see KeyWalk)
  const wheel_gate = wheel_zoom_gate()
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class:active={info_pane_open || controls_open || export_pane_open}
  role="application"
  tabindex="0"
  aria-label="Brillouin zone viewer"
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  {...rest}
  class={[`brillouin-zone`, rest.class]}
  {@attach drop_zone}
  {@attach keys}
  {@attach key_walk.attach}
  {@attach wheel_gate}
>
  <LiveMessage message={key_walk.message} />
  {@render children?.({ structure, bz_data: zone })}
  {#if loading}
    <TaskStatus overlay spinner label="Loading structure..." {spinner_props} />
  {:else if error_msg}
    <ViewerError bind:message={error_msg} dismissible />
  {:else if zone || structure?.lattice}
    <!-- A caller-supplied zone renders on its own (the file viewer hands over {k_lattice,
         vertices, faces} with no structure) -->
    <ViewerNotices>
      <StatusMessage bind:message={ibz_error} type="warning" dismissible />
    </ViewerNotices>
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
      {#if zone && controls_config.visible(`info-pane`)}
        <ViewerPane
          bind:open={info_pane_open}
          pane_name="Brillouin zone info"
          class_prefix="bz-info"
          closed_icon={info_pane_icon}
          toggle_props={shortcut_attrs(`info_pane`)}
          shortcut_scopes={[`viewer`, `camera`, `brillouin`]}
        >
          <InfoPaneCards cards={info_cards} empty_label="Brillouin zone info" />
        </ViewerPane>
      {/if}

      {#if controls_config.visible(`export-pane`)}
        <ExportPane
          filename="{current_filename || `brillouin-zone`}-bz-order-{zone?.order ?? 1}"
          bind:export_pane_open
          bind:png_dpi
          sources={export_sources}
          toggle_props={{
            class: `bz-export-toggle`,
            title: export_pane_open ? `` : `Export Brillouin zone`,
          }}
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
          {k_path}
          hovered_k_point={hovered_k_point ?? linked?.k_point ?? null}
          {highlighted_k_points}
          hovered_qpoint_index={hovered_qpoint_index ?? linked?.qpoint_idx ?? null}
          highlighted_qpoint_range={highlighted_qpoint_range ?? linked?.range ?? null}
          on_kpath_hover={handle_kpath_hover}
          {show_ibz}
          {ibz_data}
          {ibz_color}
          {ibz_opacity}
          {width}
          {height}
          bind:scene
          bind:camera
          bind:hovered={hovered_mark}
          {pin}
        />
      </Canvas>

      {#if hover_data && tooltip !== false}
        <PlotTooltip
          x={hover_data.screen_position.x}
          y={hover_data.screen_position.y}
          bg_color={hover_data.is_ibz ? ibz_color : surface_color}
          pinned={pin.value !== null}
          fixed
          style="z-index: calc(var(--z-index-overlay-controls, 100000000) + 1)"
        >
          <BrillouinZoneTooltip {hover_data} {tooltip} />
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
  .brillouin-zone:has(:global(.draggable-pane.pane-open)) {
    z-index: var(--z-index-viewer-pane-open, 12);
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
