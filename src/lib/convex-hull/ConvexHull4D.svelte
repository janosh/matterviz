<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import { add_alpha, default_element_colors } from '$lib/colors'
  import { normalize_show_controls } from '$lib/controls'
  import { create_pulse_animation } from '$lib/effects.svelte'
  import { ColorBar } from '$lib/plot'
  import { DEFAULTS } from '$lib/settings'
  import { clamp01 } from '$lib/utils'
  import { TETRAHEDRON_VERTICES } from './barycentric-coords'
  import {
    draw_face,
    draw_hull_labels,
    draw_hull_points,
    draw_notice,
    face_color_resolver,
    type HullFace,
    type HullPointOpts,
    type Projected,
  } from './canvas-draw'
  import { create_canvas_interactions } from './canvas-interactions.svelte'
  import ConvexHullChrome from './ConvexHullChrome.svelte'
  import {
    get_energy_color_scale,
    get_point_color_for_entry,
    hull_distance_range,
    hull_style_css,
    is_entry_highlighted,
    merge_highlight_style,
  } from './helpers'
  import { create_hull_data_pipeline } from './hull-state.svelte'
  import type { BaseConvexHullProps, Hull3DProps } from './index'
  import { CONVEX_HULL_STYLE, default_controls, default_hull_config } from './index'
  import MissingConvexHullData from './MissingConvexHullData.svelte'
  import type { ConvexHullEntry, HullFaceColorMode } from './types'
  import { MAGNETIC_ORDERING_CATEGORY } from './types'

  const defaults = DEFAULTS.convex_hull.quaternary
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
    dim: 4,
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

  // Lower hull tetrahedra: vertex entries (x, y, z in the tetrahedron, E_form separate)
  const hull_tetrahedra = $derived(hull_data.hull.facet_entries)
  // Most negative formation energy, for the uniform-mode face opacity
  const e_form_min = $derived(
    Math.min(0, ...hull_data.all_enriched_entries.map((entry) => entry.e_form_per_atom ?? 0)),
  )

  let canvas = $state<HTMLCanvasElement>()
  let overlay_canvas = $state<HTMLCanvasElement>()

  const camera_default = {
    rotation_x: defaults.camera_rotation_x,
    rotation_y: defaults.camera_rotation_y,
    zoom: defaults.camera_zoom,
    center_x: 0,
    center_y: 20, // Slight offset to avoid legend overlap
  }
  let camera = $state({ ...camera_default })
  const reset_camera = () => Object.assign(camera, camera_default)

  let hull_face_color = $state(defaults.hull_face_color)
  const merged_highlight_style = $derived(merge_highlight_style(highlight_style))
  const is_highlighted = (entry: ConvexHullEntry): boolean =>
    is_entry_highlighted(entry, highlighted_entries)
  const energy_color_scale = $derived(
    get_energy_color_scale(color_mode, color_scale, plot_entries),
  )
  const get_point_color = (entry: ConvexHullEntry): string =>
    get_point_color_for_entry(entry, color_mode, merged_config.colors, energy_color_scale)

  // Tetrahedron centroid: rotation centre of the view
  const centroid = [0, 1, 2].map(
    (axis) => TETRAHEDRON_VERTICES.reduce((sum, vertex) => sum + vertex[axis], 0) / 4,
  )

  // Ry(rotation_y) then Rx(rotation_x) about the centroid (Materials Project camera)
  function project_3d_point(x: number, y: number, z: number): Projected {
    const { width, height } = interactions.canvas_dims
    const [cx, cy, cz] = [x - centroid[0], y - centroid[1], z - centroid[2]]
    const [cos_x, sin_x] = [Math.cos(camera.rotation_x), Math.sin(camera.rotation_x)]
    const [cos_y, sin_y] = [Math.cos(camera.rotation_y), Math.sin(camera.rotation_y)]
    const [x1, z1] = [cx * cos_y - cz * sin_y, cx * sin_y + cz * cos_y]
    const [y2, z2] = [cy * cos_x - z1 * sin_x, cy * sin_x + z1 * cos_x]
    const scale = Math.min(width, height) * 0.6 * camera.zoom
    return {
      x: width / 2 + camera.center_x + x1 * scale,
      y: height / 2 + camera.center_y - y2 * scale, // flip y for canvas coordinates
      depth: z2,
    }
  }

  const hull_point_opts = (): HullPointOpts => ({
    scale: interactions.canvas_dims.scale,
    shadow_factor: 2,
    selected_entry,
    is_highlighted,
    get_point_color,
    highlight_style: merged_highlight_style,
  })

  // Shared canvas-interaction scaffold (mouse/keyboard handlers, hover/drag/popup state,
  // canvas sizing, render scheduler). Rotation math + keydown actions stay local.
  const interactions = create_canvas_interactions({
    wheel_clamp: [1.0, 15],
    canvas: () => canvas,
    overlay_canvas: () => overlay_canvas,
    wrapper: () => wrapper,
    entries: () => entries,
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
    zoom: () => camera.zoom,
    set_zoom: (zoom) => (camera.zoom = zoom),
    project_point: project_3d_point,
    render_frame,
    // oxfmt-ignore
    // selected_entry/highlighted_entries included: pulsing points move to the overlay
    // canvas, so the hull has to repaint (once) whenever which points those are changes
    repaint_deps: () => [show_hull_faces, color_mode, color_scale, show_stable_labels, show_unstable_labels, max_hull_dist_show_labels, camera.rotation_x, camera.rotation_y, camera.zoom, camera.center_x, camera.center_y, plot_entries, visible_entries, hull_face_color, hull_face_opacity, hull_face_color_mode, element_colors, highlighted_entries, selected_entry, interactions.text_color, elements, merged_config, merged_highlight_style],
    hull_point_opts,
    pulse: () => ({ time: pulse.time, opacity: 0.3 + 0.4 * pulse.unit }),
    on_drag: (dx, dy, panning) => {
      if (panning) {
        camera.center_x += dx
        camera.center_y += dy
      } else {
        camera.rotation_y += dx * 0.005
        camera.rotation_x = Math.max(
          -Math.PI / 3,
          Math.min(Math.PI / 3, camera.rotation_x - dy * 0.005),
        )
      }
    },
    actions: () => ({
      r: reset_camera,
      b: () => (color_mode = color_mode === `stability` ? `energy` : `stability`),
      s: () => (show_stable = !show_stable),
      u: () => (show_unstable = !show_unstable),
      h: () => (show_hull_faces = !show_hull_faces),
      l: () => (show_stable_labels = !show_stable_labels),
    }),
  })

  // Pulsating highlight for selection/highlights. Ticks repaint only the overlay canvas,
  // and the loop pauses entirely while `wrapper` is off screen.
  const pulse = create_pulse_animation(
    () => selected_entry !== null || highlighted_entries.length > 0,
    { on_tick: interactions.render_overlay_once, element: () => wrapper },
  )

  // === Drawing ===

  // Dashed tetrahedron outline plus corner element labels
  function draw_structure_outline(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = CONVEX_HULL_STYLE.structure_line.color
    ctx.lineWidth = CONVEX_HULL_STYLE.structure_line.line_width
    ctx.setLineDash(CONVEX_HULL_STYLE.structure_line.dash)
    ctx.beginPath()
    for (const [start_idx, start] of TETRAHEDRON_VERTICES.entries()) {
      for (const end of TETRAHEDRON_VERTICES.slice(start_idx + 1)) {
        const proj1 = project_3d_point(start[0], start[1], start[2])
        const proj2 = project_3d_point(end[0], end[1], end[2])
        ctx.moveTo(proj1.x, proj1.y)
        ctx.lineTo(proj2.x, proj2.y)
      }
    }
    ctx.stroke()
    ctx.setLineDash([]) // every later stroke sets its own strokeStyle

    // Element labels just outside each vertex, along the centroid → vertex direction
    ctx.fillStyle = interactions.text_color
    ctx.font = `bold 18px Arial`
    ctx.textAlign = `center`
    ctx.textBaseline = `middle`
    for (const [idx, vertex] of TETRAHEDRON_VERTICES.entries()) {
      const dir = vertex.map((coord, axis) => coord - centroid[axis])
      const len = Math.hypot(...dir) || 1
      const [x, y, z] = vertex.map((coord, axis) => coord + (dir[axis] / len) * 0.06)
      const proj = project_3d_point(x, y, z)
      ctx.fillText(elements[idx], proj.x, proj.y)
    }
  }

  // Each lower-hull tetrahedron contributes its 4 triangular faces, depth sorted
  function draw_convex_hull_faces(ctx: CanvasRenderingContext2D): void {
    if (!show_hull_faces || hull_tetrahedra.length === 0) return
    const faces: HullFace[] = []
    for (const [facet_idx, tetrahedron] of hull_tetrahedra.entries()) {
      const projected = tetrahedron.map((vertex) =>
        project_3d_point(vertex.x, vertex.y, vertex.z),
      )
      for (let skip = 0; skip < 4; skip++) {
        const vertices = tetrahedron.toSpliced(skip, 1)
        const face_projected = projected.toSpliced(skip, 1)
        faces.push({
          vertices,
          projected: face_projected,
          facet_idx,
          e_form: vertices.reduce((sum, vertex) => sum + (vertex.e_form_per_atom ?? 0), 0) / 3,
          depth: face_projected.reduce((sum, point) => sum + point.depth, 0) / 3,
        })
      }
    }
    faces.sort((left, right) => left.depth - right.depth) // back to front
    const face_color = face_color_resolver(faces, {
      mode: hull_face_color_mode,
      uniform_color: hull_face_color,
      color_scale,
      element_colors,
      elements,
    })
    for (const face of faces) {
      // Uniform mode fades faces with their formation energy; other modes use fixed opacity
      const alpha =
        hull_face_color_mode === `uniform`
          ? clamp01(face.e_form / Math.min(e_form_min, -1e-6)) * hull_face_opacity
          : hull_face_opacity
      const color = face_color(face)
      draw_face(
        ctx,
        face.projected,
        add_alpha(color, alpha),
        add_alpha(color, Math.min(0.4, alpha * 4)),
      )
    }
  }

  function render_frame(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.clearRect(0, 0, width, height)
    if (elements.length !== 4) {
      if (elements.length > 0) {
        const notice = `Quaternary convex hull requires exactly 4 elements (got ${elements.length})`
        draw_notice(ctx, notice, interactions.text_color, width, height)
      }
      return
    }
    draw_structure_outline(ctx)
    draw_convex_hull_faces(ctx) // behind points
    draw_hull_points(ctx, interactions.sorted_points_cache, hull_point_opts())
    if (merged_config.show_labels) {
      draw_hull_labels(ctx, visible_entries, {
        project: project_3d_point,
        elements,
        scale: interactions.canvas_dims.scale,
        text_color: interactions.text_color,
        width,
        height,
        show_stable_labels,
        show_unstable_labels,
        max_hull_dist_show_labels,
      })
    }
  }

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
    class={[`convex-hull-4d`, rest.class]}
    {style}
    data-has-selection={selected_entry !== null}
    data-has-hover={interactions.selection.hover_data !== null}
    data-is-dragging={interactions.is_dragging}
    data-rotation-x={camera.rotation_x.toFixed(4)}
    data-rotation-y={camera.rotation_y.toFixed(4)}
    bind:this={wrapper}
    role="application"
    tabindex="-1"
    onkeydown={interactions.selection.handle_keydown}
    {...interactions.selection.drop_zone}
    aria-label="Convex hull visualization"
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
      aria-label={merged_controls.title || phase_stats?.chemical_system || `4D Convex Hull`}
      {...interactions.canvas_handlers}
    ></canvas>
    <canvas bind:this={overlay_canvas} class="pulse-overlay" aria-hidden="true"></canvas>

    {#if color_mode === `energy` && plot_entries.length > 0}
      <ColorBar
        title="Energy above hull (eV/atom)"
        range={hull_distance_range(plot_entries)}
        scale={color_scale}
        wrapper_style="position: absolute; bottom: 2em; left: 1em; width: 200px;"
        bar_style="height: 12px;"
        title_style="margin-bottom: 4px;"
      />
    {/if}

    <ConvexHullChrome
      kind="quaternary"
      selection={interactions.selection}
      {hull_data}
      {controls_config}
      loading={entries.length === 0}
      on_reset={reset_camera}
      {enable_info_pane}
      {phase_stats}
      {label_threshold}
      bind:fullscreen
      {fullscreen_toggle}
      on_fullscreen_change={() => Object.assign(camera, { center_x: 0, center_y: 20 })}
      {camera}
      {merged_controls}
      {stable_entries}
      {unstable_entries}
      {get_point_color}
      {merged_highlight_style}
      {is_highlighted}
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
  </div>
{/if}

<style>
  .convex-hull-4d {
    position: relative;
    container-type: size; /* enable cqh/cqw for responsive sizing */
    width: 100%;
    height: var(--hull-height, 500px);
    background: var(--hull-bg, var(--plot-bg));
    border-radius: var(--hull-border-radius, 0);
  }
  .convex-hull-4d:fullscreen {
    border-radius: 0;
    background: var(--hull-bg-fullscreen, var(--hull-bg, var(--plot-bg)));
    overflow: hidden;
  }
  .convex-hull-4d:global(.dragover) {
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
</style>
