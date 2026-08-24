<script lang="ts">
  // Ternary (dim 3, triangle prism with an energy axis and orientation gizmo) and quaternary
  // (dim 4, tetrahedron) convex hulls on a 2D canvas. Everything dimension-specific comes
  // from the HullCanvasStrategy picked by `dim`; the component never reads camera angles.
  import type { D3InterpolateName } from '$lib/colors'
  import { add_alpha, default_element_colors } from '$lib/colors'
  import { normalize_show_controls } from '$lib/controls'
  import type { Vec2 } from '$lib/math'
  import { ColorBar } from '$lib/plot'
  import { create_renderer, Gizmo, webgpu_available } from '$lib/scene'
  import { DEFAULTS } from '$lib/settings'
  import { clamp01 } from '$lib/utils'
  import { Canvas, T } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
  import { PerspectiveCamera } from 'three/webgpu'
  import {
    build_hull_faces,
    draw_corner_labels,
    draw_dashed_edges,
    draw_hull_faces,
    energy_range_of,
    HULL_CANVAS_STRATEGIES,
    type Projected,
    simplex_centroid,
  } from './canvas-draw'
  import { create_canvas_interactions } from './canvas-interactions.svelte'
  import ConvexHullChrome from './ConvexHullChrome.svelte'
  import { hull_distance_range, hull_style_css } from './helpers'
  import { create_hull_data_pipeline, KIND_LABEL } from './hull-state.svelte'
  import type { BaseConvexHullProps, ConvexHullGizmoOptions, Hull3DProps } from './index'
  import { default_controls, merge_hull_config } from './index'
  import MissingConvexHullData from './MissingConvexHullData.svelte'
  import type { ConvexHullEntry, HullFaceColorMode } from './types'
  import { MAGNETIC_ORDERING_CATEGORY } from './types'

  // Bindable props default to the dimension's DEFAULTS.convex_hull section
  const hull_defaults = (dim: 3 | 4) => DEFAULTS.convex_hull[HULL_CANVAS_STRATEGIES[dim].kind]
  let {
    dim,
    entries: entries_prop,
    controls = {},
    config = {},
    show_controls,
    on_point_click,
    on_point_hover,
    fullscreen = $bindable(hull_defaults(dim).fullscreen),
    fullscreen_toggle = true,
    enable_info_pane = true,
    wrapper = $bindable(),
    label_threshold = 50,
    show_stable = $bindable(hull_defaults(dim).show_stable),
    show_unstable = $bindable(hull_defaults(dim).show_unstable),
    entry_category = MAGNETIC_ORDERING_CATEGORY,
    hidden_categories = $bindable([]),
    show_hull_faces = $bindable(hull_defaults(dim).show_hull_faces),
    hull_face_opacity = $bindable(hull_defaults(dim).hull_face_opacity),
    hull_face_color_mode = $bindable(
      hull_defaults(dim).hull_face_color_mode as HullFaceColorMode,
    ),
    element_colors = default_element_colors,
    color_mode = $bindable(hull_defaults(dim).color_mode),
    color_scale = $bindable(hull_defaults(dim).color_scale as D3InterpolateName),
    info_pane_open = $bindable(hull_defaults(dim).info_pane_open),
    controls_open = $bindable(hull_defaults(dim).legend_pane_open),
    max_hull_dist_show_phases = $bindable(hull_defaults(dim).max_hull_dist_show_phases),
    max_hull_dist_show_labels = $bindable(hull_defaults(dim).max_hull_dist_show_labels),
    show_stable_labels = $bindable(hull_defaults(dim).show_stable_labels),
    show_unstable_labels = $bindable(hull_defaults(dim).show_unstable_labels),
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
  }: BaseConvexHullProps<ConvexHullEntry> & Hull3DProps & { dim: 3 | 4 } = $props()

  // The strategy (and the data pipeline's arity) is fixed for the component's lifetime;
  // ConvexHull.svelte keys on the element count so a 3 ↔ 4 switch remounts
  // svelte-ignore state_referenced_locally
  const strategy = HULL_CANVAS_STRATEGIES[dim]
  const defaults = DEFAULTS.convex_hull[strategy.kind]

  const entries = $derived(entries_prop ?? [])
  const merged_controls = $derived({ ...default_controls, ...controls })
  const controls_config = $derived(normalize_show_controls(show_controls))
  const merged_config = $derived(merge_hull_config(config))

  // Shared reactive data pipeline (temperature → gas → energies → coordinates → hull)
  const hull_data = create_hull_data_pipeline({
    dim: strategy.dim,
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
  // Lower hull facets (triangles in 3D, tetrahedra in 4D) as vertex entries
  const hull_facets = $derived(hull_data.hull.facet_entries)
  // Formation energy range drives the 3D depth scaling (funnel depth), the energy axis and
  // the uniform-mode face opacity
  const energy_range = $derived(energy_range_of(hull_data.all_enriched_entries))

  let canvas = $state<HTMLCanvasElement>()
  let overlay_canvas = $state<HTMLCanvasElement>()
  let hull_face_color = $state(defaults.hull_face_color)

  const centroid = simplex_centroid(strategy.corners)
  const project_point = (x: number, y: number, z: number): Projected =>
    interactions.to_screen(...strategy.rotate_point(camera, [x, y, z], energy_range))

  // Shared canvas scaffold (camera zoom/pan, mouse/keyboard handlers, hover/drag/popup
  // state, point styling, canvas sizing, render scheduler)
  const interactions = create_canvas_interactions({
    strategy,
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
    project_point,
    render_frame,
    // oxfmt-ignore
    repaint_deps: () => [show_hull_faces, hull_facets, hull_face_color, hull_face_opacity, hull_face_color_mode, element_colors, energy_range, merged_config],
    actions: (): Record<string, () => void> => ({
      r: interactions.reset_camera,
      b: () => (color_mode = color_mode === `stability` ? `energy` : `stability`),
      s: () => (show_stable = !show_stable),
      u: () => (show_unstable = !show_unstable),
      h: () => (show_hull_faces = !show_hull_faces),
      l: () => (show_stable_labels = !show_stable_labels),
      ...strategy.actions?.(camera, interactions.view_scale),
    }),
  })
  const { camera } = interactions
  // Current camera as data attributes (data-zoom, data-rotation-x, ...) for tests and styling.
  // Machine-readable, so an ASCII minus (format_num emits U+2212, which Number() rejects)
  const camera_attrs = $derived(
    Object.fromEntries(
      Object.entries(camera).map(([key, value]) => [
        `data-${key.replaceAll(`_`, `-`)}`,
        value.toFixed(4),
      ]),
    ),
  )

  // === Drawing ===

  function render_frame(ctx: CanvasRenderingContext2D): void {
    draw_dashed_edges(ctx, strategy.outline_edges(energy_range), project_point)
    if (show_hull_faces && hull_facets.length > 0) {
      draw_hull_faces(ctx, build_hull_faces(hull_facets, project_point), {
        mode: hull_face_color_mode,
        uniform_color: hull_face_color,
        color_scale,
        element_colors,
        elements,
        opacity: hull_face_opacity,
        e_form_min: energy_range.min,
        gradient: strategy.face_gradient,
        stroke_alpha: strategy.face_stroke_alpha,
      })
    }
    // After the faces so the axis stays legible at high face opacity
    strategy.draw_axes?.(ctx, camera, {
      project: project_point,
      energy_range,
      text_color: interactions.text_color,
      font_size: merged_config.font_size ?? 12,
      scale: interactions.canvas_dims.scale,
    })
    interactions.draw_points(ctx)
    interactions.draw_labels(ctx)
    draw_corner_labels(ctx, strategy.corners, centroid, {
      project: project_point,
      elements,
      text_color: interactions.text_color,
      width: interactions.canvas_dims.width,
      height: interactions.canvas_dims.height,
      ...strategy.corner_labels,
    })
  }

  // === Gizmo: Three.js camera ↔ strategy camera angles (3D only) ===
  let gizmo_cam_ref = $state<PerspectiveCamera>()
  let gizmo_orbit_ref = $state<OrbitControls | undefined>(undefined)
  let gizmo_active = $state(false)
  const gizmo_cam_state = $derived(strategy.gizmo?.to_three(camera))

  // Sync: main canvas drag → Three.js gizmo camera
  $effect(() => {
    if (gizmo_active || !gizmo_cam_ref || !gizmo_cam_state) return
    const { position, up } = gizmo_cam_state
    gizmo_cam_ref.position.set(...position)
    gizmo_cam_ref.up.set(...up)
    gizmo_cam_ref.lookAt(0, 0, 0)
    gizmo_orbit_ref?.update?.()
  })

  // Sync: gizmo → hull camera (during and after gizmo animation)
  function sync_gizmo_to_camera(): void {
    if (!gizmo_cam_ref || !strategy.gizmo) return
    const { x, y, z } = gizmo_cam_ref.position
    strategy.gizmo.from_three(camera, [x, y, z], interactions.view_scale)
  }

  // `placement` positions the wrapper div, not the gizmo inside its canvas, so it is split
  // off from the appearance options forwarded to <Gizmo> (which fills its own canvas here)
  const { placement: gizmo_placement = `top-right`, ...gizmo_props } =
    $derived<ConvexHullGizmoOptions>(typeof gizmo === `object` && gizmo ? gizmo : {})

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
  // Missing or invalid entries render the empty state instead of the canvas
  const show_plot = $derived(entries_prop !== undefined && hull_data.error === null)
</script>

<svelte:document
  onmousemove={show_plot ? interactions.handle_mouse_move : undefined}
  onmouseup={show_plot ? interactions.handle_mouse_up : undefined}
/>

{#if !show_plot}
  <MissingConvexHullData
    {...rest}
    error={hull_data.error}
    style="{style}; height: var(--hull-height, 500px)"
  />
{:else}
  <div
    {...rest}
    class={[`convex-hull-canvas`, `convex-hull-${dim}d`, rest.class]}
    {style}
    data-has-selection={selected_entry !== null}
    data-has-hover={interactions.selection.hover_data !== null}
    data-is-dragging={interactions.is_dragging}
    {...camera_attrs}
    bind:this={wrapper}
    role="application"
    tabindex="-1"
    onkeydown={interactions.selection.handle_keydown}
    {...interactions.selection.drop_zone}
    aria-label="{KIND_LABEL[strategy.kind]} convex hull visualization"
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
      aria-label={merged_controls.title ||
        phase_stats?.chemical_system ||
        `${dim}D Convex Hull`}
      {...interactions.canvas_handlers}
    ></canvas>
    <canvas bind:this={overlay_canvas} class="pulse-overlay" aria-hidden="true"></canvas>

    {#if color_mode === `energy` && plot_entries.length > 0}
      <ColorBar
        title="Energy above hull (eV/atom)"
        range={hull_distance_range(plot_entries)}
        scale={color_scale}
        wrapper_style="position: absolute; bottom: 1em; left: 1em; width: min(200px, 50cqw - 2.5em);"
        bar_style="height: 12px;"
        title_style="margin-bottom: 4px;"
      />
    {/if}

    {#if plot_entries.length > 0 && show_hull_faces && (hull_face_color_mode === `uniform` || hull_face_color_mode === `formation_energy`)}
      <ColorBar
        title="Formation energy (eV/atom)"
        scale={{ fn: e_form_color_scale_fn, domain: e_form_range }}
        range={e_form_range}
        wrapper_style="position: absolute; bottom: 1em; right: 1em; width: min(200px, 50cqw - 2.5em);"
        bar_style="height: 12px;"
        title_style="margin-bottom: 4px;"
      />
    {/if}

    <ConvexHullChrome
      kind={strategy.kind}
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
    {#if gizmo && gizmo_cam_state && webgpu_available()}
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
                on_start={() => (gizmo_active = true)}
                on_change={sync_gizmo_to_camera}
                on_end={() => {
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
  .convex-hull-canvas {
    position: relative;
    container-type: size; /* enable cqh/cqw for responsive sizing */
    width: 100%;
    height: var(--hull-height, 500px);
    background: var(--hull-bg, var(--plot-bg));
    border-radius: var(--hull-border-radius, 0);
  }
  .convex-hull-canvas:fullscreen {
    border-radius: 0;
    background: var(--hull-bg-fullscreen, var(--hull-bg, var(--plot-bg)));
    overflow: hidden;
  }
  .convex-hull-canvas:global(.dragover) {
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
  .convex-hull-canvas:is(:hover, :focus-within) .gizmo-wrapper.hover-visible {
    opacity: 1;
    pointer-events: auto;
  }
  @media (hover: none) {
    .gizmo-wrapper.hover-visible {
      opacity: 1;
      pointer-events: auto;
    }
  }
</style>
