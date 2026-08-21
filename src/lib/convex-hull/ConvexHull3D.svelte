<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import { add_alpha, default_element_colors } from '$lib/colors'
  import { normalize_show_controls } from '$lib/controls'
  import { format_num } from '$lib/labels'
  import { to_radians, type Vec2, type Vec3 } from '$lib/math'
  import { ColorBar } from '$lib/plot'
  import { create_renderer, Gizmo, webgpu_available } from '$lib/scene'
  import { DEFAULTS } from '$lib/settings'
  import { clamp01 } from '$lib/utils'
  import { Canvas, T } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { ticks } from 'd3-array'
  import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
  import { PerspectiveCamera } from 'three/webgpu'
  import { TRIANGLE_VERTICES } from './barycentric-coords'
  import {
    build_hull_faces,
    draw_corner_labels,
    draw_dashed_edges,
    draw_face,
    face_color_resolver,
    type Projected,
    simplex_centroid,
  } from './canvas-draw'
  import { create_canvas_interactions } from './canvas-interactions.svelte'
  import ConvexHullChrome from './ConvexHullChrome.svelte'
  import { hull_distance_range, hull_style_css } from './helpers'
  import { create_hull_data_pipeline } from './hull-state.svelte'
  import type { BaseConvexHullProps, ConvexHullGizmoOptions, Hull3DProps } from './index'
  import { CONVEX_HULL_STYLE, default_controls, default_hull_config } from './index'
  import MissingConvexHullData from './MissingConvexHullData.svelte'
  import type { ConvexHullEntry, HullFaceColorMode } from './types'
  import { MAGNETIC_ORDERING_CATEGORY } from './types'

  const defaults = DEFAULTS.convex_hull.ternary
  let {
    entries: entries_prop,
    controls = {},
    config = {},
    show_controls,
    on_point_click,
    on_point_hover,
    fullscreen = $bindable(defaults.fullscreen),
    fullscreen_toggle = true,
    enable_info_pane = true,
    wrapper = $bindable(),
    label_threshold = 50,
    show_stable = $bindable(defaults.show_stable),
    show_unstable = $bindable(defaults.show_unstable),
    entry_category = MAGNETIC_ORDERING_CATEGORY,
    hidden_categories = $bindable([]),
    show_hull_faces = $bindable(defaults.show_hull_faces),
    hull_face_opacity = $bindable(defaults.hull_face_opacity),
    hull_face_color_mode = $bindable(defaults.hull_face_color_mode as HullFaceColorMode),
    element_colors = default_element_colors,
    color_mode = $bindable(defaults.color_mode),
    color_scale = $bindable(defaults.color_scale as D3InterpolateName),
    info_pane_open = $bindable(defaults.info_pane_open),
    controls_open = $bindable(defaults.legend_pane_open),
    max_hull_dist_show_phases = $bindable(defaults.max_hull_dist_show_phases),
    max_hull_dist_show_labels = $bindable(defaults.max_hull_dist_show_labels),
    show_stable_labels = $bindable(defaults.show_stable_labels),
    show_unstable_labels = $bindable(defaults.show_unstable_labels),
    allow_file_drop = true,
    on_file_drop,
    enable_click_selection = true,
    enable_structure_preview = true,
    energy_source_mode = $bindable(`precomputed`),
    phase_stats = $bindable(null),
    stable_entries = $bindable([]),
    unstable_entries = $bindable([]),
    highlighted_entries = $bindable([]),
    highlight_style = {},
    selected_entry = $bindable(null),
    temperature = $bindable(),
    interpolate_temperature = true,
    max_interpolation_gap = 500,
    gizmo = true,
    gas_config,
    gas_pressures = $bindable({}),
    children,
    tooltip,
    ...rest
  }: BaseConvexHullProps<ConvexHullEntry> & Hull3DProps = $props()
  const entries = $derived(entries_prop ?? [])

  const merged_controls = $derived({ ...default_controls, ...controls })
  const controls_config = $derived(normalize_show_controls(show_controls))
  const merged_config = $derived({
    ...default_hull_config,
    ...config,
    colors: { ...default_hull_config.colors, ...config.colors },
  })

  // Shared reactive data pipeline (temperature → gas → energies → coordinates → hull)
  const hull_data = create_hull_data_pipeline({
    dim: 3,
    entries: () => entries,
    temperature: () => temperature,
    interpolate_temperature: () => interpolate_temperature,
    max_interpolation_gap: () => max_interpolation_gap,
    gas_config: () => gas_config,
    gas_pressures: () => gas_pressures,
    energy_source_mode: () => energy_source_mode,
    max_hull_dist_show_phases: () => max_hull_dist_show_phases,
    show_stable: () => show_stable,
    show_unstable: () => show_unstable,
    entry_category: () => entry_category,
    hidden_categories: () => hidden_categories,
    label_threshold: () => label_threshold,
    set_temperature: (next_temp) => (temperature = next_temp),
    set_max_hull_dist_show_phases: (value) => (max_hull_dist_show_phases = value),
    set_stable_entries: (value) => (stable_entries = value),
    set_unstable_entries: (value) => (unstable_entries = value),
    set_phase_stats: (value) => (phase_stats = value),
    hide_labels: () => {
      show_stable_labels = false
      show_unstable_labels = false
    },
  })
  const elements = $derived(hull_data.elements)
  const plot_entries = $derived(hull_data.plot_entries)
  const visible_entries = $derived(hull_data.visible_entries)

  // Lower hull triangles: vertex entries (x, y on the triangle, z = E_form)
  const hull_faces = $derived(hull_data.hull.facet_entries)

  // Formation energy range drives the z scaling (funnel depth) and the energy axis
  const energy_range = $derived.by(() => {
    let [min, max] = [0, 0]
    for (const entry of hull_data.all_enriched_entries) {
      min = Math.min(min, entry.z)
      max = Math.max(max, entry.z)
    }
    return { min, max, center: (min + max) / 2, z_scale: 0.75 / Math.max(max - min, 0.001) }
  })

  let canvas = $state<HTMLCanvasElement>()
  let overlay_canvas = $state<HTMLCanvasElement>()
  let hull_face_color = $state(defaults.hull_face_color)

  // Triangle centroid: rotation centre of the view
  const centroid = simplex_centroid(TRIANGLE_VERTICES)

  // Rz(azimuth) then Rx(-elevation) about the centroid, energy scaled into the view
  function project_3d_point(x: number, y: number, z: number): Projected {
    const [elev, azim] = [to_radians(camera.elevation), to_radians(camera.azimuth)]
    const [cos_az, sin_az, cos_el, sin_el] = [
      Math.cos(azim),
      Math.sin(azim),
      Math.cos(-elev),
      Math.sin(-elev),
    ]
    const { center: e_ctr, z_scale } = energy_range
    const [dx, dy, dz] = [x - centroid[0], y - centroid[1], (z - e_ctr) * z_scale]
    const [x1, y1] = [dx * cos_az - dy * sin_az, dx * sin_az + dy * cos_az]
    const [y2, z2] = [y1 * cos_el - dz * sin_el, y1 * sin_el + dz * cos_el]
    return interactions.to_screen(x1, y2, z2)
  }

  // Shared canvas scaffold (camera zoom/pan, mouse/keyboard handlers, hover/drag/popup
  // state, point styling, canvas sizing, render scheduler). Rotation + keydown actions stay local.
  const interactions = create_canvas_interactions({
    dim: 3,
    camera_default: {
      elevation: defaults.camera_elevation,
      azimuth: defaults.camera_azimuth,
      zoom: defaults.camera_zoom,
      center_x: 0,
      center_y: -50, // Shift up to better show the formation energy funnel
    },
    wheel_clamp: [0.5, 10],
    on_rotate: (cam, dx, dy) => {
      cam.azimuth += dx * 0.3 // drag right rotates clockwise around z
      cam.elevation -= dy * 0.3 // drag down tilts the view down
    },
    shadow_factor: 0.1,
    canvas: () => canvas,
    overlay_canvas: () => overlay_canvas,
    wrapper: () => wrapper,
    entries: () => entries,
    elements: () => elements,
    visible_entries: () => visible_entries,
    plot_entries: () => plot_entries,
    selected_entry: () => selected_entry,
    set_selected_entry: (entry) => (selected_entry = entry),
    enable_click_selection: () => enable_click_selection,
    enable_structure_preview: () => enable_structure_preview,
    allow_file_drop: () => allow_file_drop,
    on_point_click: () => on_point_click,
    on_point_hover: () => on_point_hover,
    on_file_drop: () => on_file_drop,
    entry_category: () => entry_category,
    highlighted_entries: () => highlighted_entries,
    highlight_style: () => highlight_style,
    color_mode: () => color_mode,
    color_scale: () => color_scale,
    colors: () => merged_config.colors,
    labels: () => ({
      show_labels: merged_config.show_labels,
      show_stable_labels,
      show_unstable_labels,
      max_hull_dist_show_labels,
    }),
    project_point: project_3d_point,
    render_frame,
    // oxfmt-ignore
    repaint_deps: () => [show_hull_faces, hull_face_color, hull_face_opacity, hull_face_color_mode, element_colors, energy_range, merged_config],
    actions: (): Record<string, () => void> => ({
      r: interactions.reset_camera,
      t: () => {
        camera.elevation = 0
        camera.azimuth = 0
        center_camera(0)
      },
      b: () => (color_mode = color_mode === `stability` ? `energy` : `stability`),
      s: () => (show_stable = !show_stable),
      u: () => (show_unstable = !show_unstable),
      h: () => (show_hull_faces = !show_hull_faces),
      l: () => (show_stable_labels = !show_stable_labels),
    }),
  })
  const { camera } = interactions

  // === Gizmo: Three.js camera ↔ elevation/azimuth ===
  const GIZMO_CAM_DIST = 5
  const MIN_ELEV_FOR_Z_AXIS = 5 // degrees — below this, z-axis ticks collapse to a point
  let gizmo_cam_ref = $state<PerspectiveCamera>()
  let gizmo_orbit_ref = $state<OrbitControls | undefined>(undefined)
  let gizmo_active = $state(false)

  // Convert elevation/azimuth (degrees) to Three.js camera position + up vector.
  function gizmo_camera(elev_deg: number, azim_deg: number): { position: Vec3; up: Vec3 } {
    const [elev, azim] = [to_radians(elev_deg), to_radians(azim_deg)]
    const [se, ce, sa, ca] = [Math.sin(elev), Math.cos(elev), Math.sin(azim), Math.cos(azim)]
    return {
      position: [-sa * se * GIZMO_CAM_DIST, -ca * se * GIZMO_CAM_DIST, ce * GIZMO_CAM_DIST],
      up: [sa * ce, ca * ce, se],
    }
  }
  const gizmo_cam_state = $derived(gizmo_camera(camera.elevation, camera.azimuth))

  // Center camera on the triangle's visual center for a given elevation. The centroid
  // (rotation center) sits at 1/3 height while the bbox center is at 1/2 height — a
  // difference of sqrt(3)/12 in data units, scaled by cos(elevation) so the offset only
  // applies in near-top-down views.
  function center_camera(elev_deg: number): void {
    camera.center_x = 0
    camera.center_y =
      (Math.sqrt(3) / 12) * interactions.view_scale * Math.cos(to_radians(elev_deg))
  }

  // Sync: main canvas drag → Three.js gizmo camera
  $effect(() => {
    if (gizmo_active || !gizmo_cam_ref) return
    const { position, up } = gizmo_cam_state
    gizmo_cam_ref.position.set(...position)
    gizmo_cam_ref.up.set(...up)
    gizmo_cam_ref.lookAt(0, 0, 0)
    gizmo_orbit_ref?.update?.()
  })

  // Sync: gizmo → ConvexHull3D (during and after gizmo animation)
  function sync_gizmo_to_camera(): void {
    const cam = gizmo_cam_ref
    if (!cam) return
    const { x: cx, y: cy, z: cz } = cam.position
    const dist = Math.hypot(cx, cy, cz)
    if (dist < 1e-6) return
    const elev_rad = Math.acos(Math.max(-1, Math.min(1, cz / dist)))
    const sin_elev = Math.sin(elev_rad)
    const azim_deg =
      Math.abs(sin_elev) > 1e-6
        ? (Math.atan2(-cx / (dist * sin_elev), -cy / (dist * sin_elev)) * 180) / Math.PI
        : 0
    const elev_deg = (elev_rad * 180) / Math.PI
    camera.elevation = elev_deg
    camera.azimuth = azim_deg
    center_camera(elev_deg)
  }

  // `placement` positions the wrapper div, not the gizmo inside its canvas, so it is split
  // off from the appearance options forwarded to <Gizmo> (which fills its own canvas here)
  const { placement: gizmo_placement = `top-right`, ...gizmo_props } =
    $derived<ConvexHullGizmoOptions>(typeof gizmo === `object` && gizmo ? gizmo : {})

  // === Drawing ===

  // Dashed triangle prism: base triangle at E_form = 0, bottom triangle at the most
  // negative formation energy, and vertical edges connecting corresponding corners
  function draw_structure_outline(ctx: CanvasRenderingContext2D): void {
    const { min: e_form_min } = energy_range
    const edges: [Projected, Projected][] = []
    for (const [idx, [vx, vy]] of TRIANGLE_VERTICES.entries()) {
      const [nx, ny] = TRIANGLE_VERTICES[(idx + 1) % 3]
      for (const z_plane of [0, e_form_min]) {
        edges.push([project_3d_point(vx, vy, z_plane), project_3d_point(nx, ny, z_plane)])
      }
      edges.push([project_3d_point(vx, vy, 0), project_3d_point(vx, vy, e_form_min)])
    }
    draw_dashed_edges(ctx, edges)
  }

  function draw_z_axis_ticks(ctx: CanvasRenderingContext2D): void {
    // Hide z-axis in near-top-down views where ticks collapse to a point
    if (Math.abs(camera.elevation) < MIN_ELEV_FOR_Z_AXIS) return
    const { min: e_min, max: e_max, center: e_mid } = energy_range
    if (Math.abs(e_max - e_min) < 1e-6) return
    const { scale } = interactions.canvas_dims

    // Put the axis on whichever vertex currently projects leftmost (changes with rotation)
    const projected_vertices = TRIANGLE_VERTICES.map(([vx, vy]) =>
      project_3d_point(vx, vy, e_mid),
    )
    const leftmost_idx = projected_vertices.reduce(
      (min_idx, proj, idx) => (proj.x < projected_vertices[min_idx].x ? idx : min_idx),
      0,
    )
    const [axis_x, axis_y] = TRIANGLE_VERTICES[leftmost_idx]
    const tick_len = 6 * scale

    ctx.save()
    ctx.fillStyle = interactions.text_color
    ctx.textAlign = `right`
    ctx.textBaseline = `middle`
    ctx.strokeStyle = CONVEX_HULL_STYLE.structure_line.color
    ctx.font = `${merged_config.font_size}px Arial`
    for (const tick of ticks(e_min, e_max, 5)) {
      const { x, y } = project_3d_point(axis_x, axis_y, tick)
      ctx.beginPath()
      ctx.moveTo(x - tick_len, y)
      ctx.lineTo(x, y)
      ctx.stroke()
      ctx.fillText(format_num(tick, `.2~`), x - tick_len - 4, y)
    }

    // Rotated axis label: Eform (eV/atom) with "form" as subscript
    const { x: lx, y: ly } = project_3d_point(axis_x, axis_y, e_mid)
    const fs = merged_config.font_size ?? 12
    const sub_fs = Math.round(fs * 0.75)
    ctx.translate(lx - 50 * scale, ly)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = `left`
    // Measure widths in each font, then draw — ordered to minimize font switches
    ctx.font = `bold ${fs}px Arial`
    const e_width = ctx.measureText(`E`).width
    const suffix_width = ctx.measureText(` (eV/atom)`).width
    ctx.font = `${sub_fs}px Arial`
    const form_width = ctx.measureText(`form`).width
    const offset = -(e_width + form_width + suffix_width) / 2
    ctx.fillText(`form`, offset + e_width, fs * 0.3)
    ctx.font = `bold ${fs}px Arial`
    ctx.fillText(`E`, offset, 0)
    ctx.fillText(` (eV/atom)`, offset + e_width + form_width, 0)
    ctx.restore()
  }

  // Fraction of the funnel depth, mapped onto the face opacity (uniform mode)
  const norm_alpha = (e_form: number): number =>
    clamp01(e_form / Math.min(energy_range.min, -1e-6)) * hull_face_opacity

  function draw_convex_hull_faces(ctx: CanvasRenderingContext2D): void {
    if (!show_hull_faces || hull_faces.length === 0) return
    const faces = build_hull_faces(hull_faces, project_3d_point)
    const face_color = face_color_resolver(faces, {
      mode: hull_face_color_mode,
      uniform_color: hull_face_color,
      color_scale,
      element_colors,
      elements,
    })

    for (const face of faces) {
      const color = face_color(face)
      if (hull_face_color_mode !== `uniform`) {
        const fill = add_alpha(color, hull_face_opacity)
        draw_face(
          ctx,
          face.projected,
          fill,
          add_alpha(color, Math.min(0.6, hull_face_opacity * 3)),
        )
        continue
      }
      // Uniform mode: opacity follows formation energy, as a screen-space linear gradient
      // solving a*x + b*y + c = alpha at the three projected vertices
      const [p1, p2, p3] = face.projected
      const [a1, a2, a3] = face.vertices.map((vertex) => norm_alpha(vertex.z))
      const det = p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y)
      const coef_a = (a1 * (p2.y - p3.y) + a2 * (p3.y - p1.y) + a3 * (p1.y - p2.y)) / det
      const coef_b = (a1 * (p3.x - p2.x) + a2 * (p1.x - p3.x) + a3 * (p2.x - p1.x)) / det
      const mag = Math.hypot(coef_a, coef_b)
      const [alpha_min, alpha_max] = [Math.min(a1, a2, a3), Math.max(a1, a2, a3)]
      let fill: string | CanvasGradient = add_alpha(color, (a1 + a2 + a3) / 3)
      if (Math.abs(det) > 1e-9 && mag > 1e-9) {
        const [vx, vy] = [coef_a / mag, coef_b / mag]
        const cx = (p1.x + p2.x + p3.x) / 3
        const cy = (p1.y + p2.y + p3.y) / 3
        const alpha_c = (a1 + a2 + a3) / 3
        const [s_min, s_max] = [(alpha_min - alpha_c) / mag, (alpha_max - alpha_c) / mag]
        const grad = ctx.createLinearGradient(
          cx + vx * s_min,
          cy + vy * s_min,
          cx + vx * s_max,
          cy + vy * s_max,
        )
        grad.addColorStop(0, add_alpha(color, alpha_min))
        grad.addColorStop(1, add_alpha(color, alpha_max))
        fill = grad
      }
      draw_face(ctx, face.projected, fill, add_alpha(color, Math.min(0.6, alpha_max * 3)))
    }
  }

  function render_frame(ctx: CanvasRenderingContext2D): void {
    draw_structure_outline(ctx)
    draw_convex_hull_faces(ctx) // behind points
    draw_z_axis_ticks(ctx) // after faces for visibility at high opacity
    interactions.draw_points(ctx)
    interactions.draw_labels(ctx)
    draw_corner_labels(ctx, TRIANGLE_VERTICES, centroid, {
      project: project_3d_point,
      elements,
      text_color: interactions.text_color,
      font_size: 16,
      offset: 0.05,
    })
  }

  // Formation energy colour bar for the face shading (uniform / formation_energy modes)
  const e_form_range = $derived<Vec2>([plot_entries.length > 0 ? energy_range.min : -1, 0])
  const e_form_color_scale_fn = $derived.by(() => {
    const [min_fe, max_fe] = e_form_range
    const denom = Math.max(1e-6, max_fe - min_fe)
    // alpha 0 at 0 eV, up to hull_face_opacity at the most negative energy
    return (value: number) =>
      add_alpha(hull_face_color, (1 - clamp01((value - min_fe) / denom)) * hull_face_opacity)
  })

  const style = $derived(`${hull_style_css(merged_config.colors)}; ${rest.style ?? ``}`)
</script>

<svelte:document
  onmousemove={entries_prop === undefined ? undefined : interactions.handle_mouse_move}
  onmouseup={entries_prop === undefined ? undefined : interactions.handle_mouse_up}
/>

{#if entries_prop === undefined}
  <MissingConvexHullData {...rest} style="{style}; height: var(--hull-height, 500px)" />
{:else}
  <div
    {...rest}
    class={[`convex-hull-3d`, rest.class]}
    {style}
    data-has-selection={selected_entry !== null}
    data-has-hover={interactions.selection.hover_data !== null}
    data-is-dragging={interactions.is_dragging}
    bind:this={wrapper}
    role="application"
    tabindex="-1"
    onkeydown={interactions.selection.handle_keydown}
    {...interactions.selection.drop_zone}
    aria-label="Ternary convex hull visualization"
  >
    {@render children?.({
      stable_entries,
      unstable_entries,
      highlighted_entries,
      selected_entry,
    })}
    <canvas
      bind:this={canvas}
      tabindex="0"
      aria-label={merged_controls.title || phase_stats?.chemical_system || `3D Convex Hull`}
      {...interactions.canvas_handlers}
    ></canvas>
    <canvas bind:this={overlay_canvas} class="pulse-overlay" aria-hidden="true"></canvas>

    {#if color_mode === `energy` && plot_entries.length > 0}
      <ColorBar
        title="Energy above hull (eV/atom)"
        range={hull_distance_range(plot_entries)}
        scale={color_scale}
        wrapper_style="position: absolute; bottom: 16px; left: 1em; width: 200px;"
        bar_style="height: 12px;"
        title_style="margin-bottom: 4px;"
      />
    {/if}

    {#if plot_entries.length > 0 && show_hull_faces && (hull_face_color_mode === `uniform` || hull_face_color_mode === `formation_energy`)}
      <ColorBar
        title="Formation energy (eV/atom)"
        scale={{ fn: e_form_color_scale_fn, domain: e_form_range }}
        range={e_form_range}
        wrapper_style="position: absolute; bottom: 16px; right: 1em; width: 200px;"
        bar_style="height: 12px;"
        title_style="margin-bottom: 4px;"
      />
    {/if}

    <ConvexHullChrome
      kind="ternary"
      selection={interactions.selection}
      {hull_data}
      {controls_config}
      loading={entries.length === 0}
      on_reset={interactions.reset_camera}
      {enable_info_pane}
      {phase_stats}
      {label_threshold}
      bind:fullscreen
      {fullscreen_toggle}
      on_fullscreen_change={interactions.recenter_camera}
      {camera}
      {merged_controls}
      {stable_entries}
      {unstable_entries}
      get_point_color={interactions.get_point_color}
      merged_highlight_style={interactions.highlight_style}
      is_highlighted={interactions.is_highlighted}
      {tooltip}
      {selected_entry}
      bind:temperature
      bind:gas_pressures
      bind:show_hull_faces
      bind:hull_face_color
      bind:hull_face_opacity
      bind:hull_face_color_mode
      bind:info_pane_open
      bind:controls_open
      bind:color_mode
      bind:color_scale
      bind:show_stable
      bind:show_unstable
      {entry_category}
      bind:hidden_categories
      bind:show_stable_labels
      bind:show_unstable_labels
      bind:max_hull_dist_show_phases
      bind:max_hull_dist_show_labels
      bind:energy_source_mode
    />

    <!-- Orientation gizmo (configurable placement, default top-right) -->
    {#if gizmo && webgpu_available()}
      <div class={[`gizmo-wrapper`, controls_config.class]} data-placement={gizmo_placement}>
        <Canvas createRenderer={create_renderer}>
          <T.PerspectiveCamera
            makeDefault
            bind:ref={gizmo_cam_ref}
            position={gizmo_cam_state.position}
            up={gizmo_cam_state.up}
            fov={50}
          >
            <extras.OrbitControls
              bind:ref={gizmo_orbit_ref}
              enableRotate={false}
              enableZoom={false}
              enablePan={false}
            >
              <Gizmo
                {...gizmo_props}
                placement="fill"
                onstart={() => (gizmo_active = true)}
                onchange={sync_gizmo_to_camera}
                onend={() => {
                  sync_gizmo_to_camera()
                  gizmo_active = false
                }}
              />
            </extras.OrbitControls>
          </T.PerspectiveCamera>
        </Canvas>
      </div>
    {/if}
  </div>
{/if}

<style>
  .convex-hull-3d {
    position: relative;
    container-type: size; /* enable cqh/cqw for responsive sizing */
    width: 100%;
    height: var(--hull-height, 500px);
    background: var(--hull-bg, var(--plot-bg));
    border-radius: var(--hull-border-radius, 0);
  }
  .convex-hull-3d:fullscreen {
    border-radius: 0;
    background: var(--hull-bg-fullscreen, var(--hull-bg, var(--plot-bg)));
    overflow: hidden;
  }
  .convex-hull-3d:global(.dragover) {
    border: 2px dashed var(--accent-color, #1976d2);
  }
  canvas {
    width: 100%;
    height: 100%;
    cursor: grab;
  }
  canvas:active {
    cursor: grabbing;
  }
  canvas.pulse-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .gizmo-wrapper {
    position: absolute;
    width: clamp(80px, 18cqmin, 110px);
    height: clamp(80px, 18cqmin, 110px);
    pointer-events: auto;
    transition: opacity 0.2s ease-in-out;
  }
  .gizmo-wrapper[data-placement='top-right'] {
    top: 1.8em;
    right: 1ex;
  }
  .gizmo-wrapper[data-placement='top-left'] {
    top: 1.8em;
    left: 1ex;
  }
  .gizmo-wrapper[data-placement='bottom-right'] {
    bottom: 2.5em;
    right: 1ex;
  }
  .gizmo-wrapper[data-placement='bottom-left'] {
    bottom: 2.5em;
    left: 1ex;
  }
  .gizmo-wrapper.hover-visible {
    opacity: 0;
    pointer-events: none;
  }
  .convex-hull-3d:is(:hover, :focus-within) .gizmo-wrapper.hover-visible {
    opacity: 1;
    pointer-events: auto;
  }
</style>
