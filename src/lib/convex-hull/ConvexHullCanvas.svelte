<script lang="ts">
  // Ternary (dim 3, triangle prism with an energy axis and orientation gizmo) and quaternary
  // (dim 4, tetrahedron) convex hulls on a 2D canvas. Everything dimension-specific comes
  // from the HullCanvasStrategy picked by `dim`; the component never reads camera angles.
  import { add_alpha, default_element_colors } from '$lib/colors'
  import type { Vec2 } from '$lib/math'
  import { ColorBar } from '$lib/plot'
  import { create_renderer, Gizmo, webgpu_available } from '$lib/scene'
  import { clamp01 } from '$lib/utils'
  import { Canvas, T } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
  import { PerspectiveCamera } from 'three/webgpu'
  import type { Projected } from './canvas-draw'
  import {
    build_hull_faces,
    draw_corner_labels,
    draw_dashed_edges,
    draw_hull_faces,
    energy_range_of,
    HULL_CANVAS_STRATEGIES,
    simplex_centroid,
  } from './canvas-draw'
  import { create_canvas_interactions } from './canvas-interactions.svelte'
  import { hull_distance_range, hull_style_css } from './helpers'
  import type { create_hull_data_pipeline } from './hull-state.svelte'
  import type { BaseConvexHullProps, ConvexHullGizmoOptions, Hull3DProps } from './index'
  import { merge_hull_config } from './index'
  import type { Snippet } from 'svelte'
  import type { ShowControlsState } from '$lib/controls'
  import type { HullSelection } from './canvas-interactions.svelte'
  import type { ConvexHullEntry, ConvexHullControlsType } from './types'

  let {
    dim,
    hull_data,
    selection,
    chrome,
    merged_controls,
    controls_config,
    config = {},
    wrapper = $bindable(),
    show_hull_faces,
    hull_face_color,
    hull_face_opacity,
    hull_face_color_mode = `uniform`,
    color_mode = `energy`,
    color_scale = `interpolateViridis`,
    max_hull_dist_show_labels = 0.1,
    show_stable_labels = true,
    show_unstable_labels = false,
    highlighted_entries = [],
    highlight_style = {},
    selected_entry = null,
    gizmo = true,
    children,
    ...rest
  }: Pick<
    BaseConvexHullProps,
    | `config`
    | `wrapper`
    | `color_mode`
    | `color_scale`
    | `max_hull_dist_show_labels`
    | `show_stable_labels`
    | `show_unstable_labels`
    | `highlighted_entries`
    | `highlight_style`
    | `selected_entry`
    | `children`
    | keyof import('svelte/elements').HTMLAttributes<HTMLDivElement>
  > &
    Hull3DProps & {
      dim: 3 | 4
      hull_data: ReturnType<typeof create_hull_data_pipeline>
      selection: HullSelection
      chrome: Snippet<[ReturnType<typeof create_canvas_interactions> | null]>
      merged_controls: ConvexHullControlsType
      controls_config: ShowControlsState
      hull_face_color: string
      hull_face_opacity: number
    } = $props()

  // The strategy (and the data pipeline's arity) is fixed for the component's lifetime;
  // ConvexHull.svelte keys on the element count so a 3 ↔ 4 switch remounts
  // svelte-ignore state_referenced_locally
  const strategy = HULL_CANVAS_STRATEGIES[dim]

  const merged_config = $derived(merge_hull_config(config))

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

  const centroid = simplex_centroid(strategy.corners)
  const project_point = (coord_x: number, coord_y: number, coord_z: number): Projected =>
    interactions.to_screen(
      ...strategy.rotate_point(camera, [coord_x, coord_y, coord_z], energy_range),
    )

  // Shared canvas scaffold (camera zoom/pan, mouse/keyboard handlers, hover/drag/popup
  // state, point styling, canvas sizing, render scheduler)
  const interactions = create_canvas_interactions({
    strategy,
    selection: () => selection,
    canvas: () => canvas,
    overlay_canvas: () => overlay_canvas,
    wrapper: () => wrapper,
    elements: () => elements,
    visible_entries: () => visible_entries,
    plot_entries: () => plot_entries,
    selected_entry: () => selected_entry,
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
    repaint_deps: () => [show_hull_faces, hull_facets, hull_face_color, hull_face_opacity, hull_face_color_mode, energy_range, merged_config],
  })
  export const get_actions = (): Record<string, () => void> => ({
    r: interactions.reset_camera,
    ...strategy.actions?.(camera, interactions.view_scale),
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
        element_colors: default_element_colors,
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
    const { position, up: up_vector } = gizmo_cam_state
    gizmo_cam_ref.position.set(...position)
    gizmo_cam_ref.up.set(...up_vector)
    gizmo_cam_ref.lookAt(0, 0, 0)
    gizmo_orbit_ref?.update?.()
  })

  // Sync: gizmo → hull camera (during and after gizmo animation)
  function sync_gizmo_to_camera(): void {
    if (!gizmo_cam_ref || !strategy.gizmo) return
    const { x: coord_x, y: coord_y, z: coord_z } = gizmo_cam_ref.position
    strategy.gizmo.from_three(camera, [coord_x, coord_y, coord_z], interactions.view_scale)
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
</script>

<svelte:document
  onmousemove={interactions.handle_mouse_move}
  onmouseup={interactions.handle_mouse_up}
/>

<div
  {...rest}
  class={[`convex-hull-canvas`, `convex-hull-${dim}d`, rest.class]}
  {style}
  data-has-selection={selected_entry !== null}
  data-has-hover={selection.hover_data !== null}
  data-is-dragging={interactions.is_dragging}
  {...camera_attrs}
  bind:this={wrapper}
  role="application"
  tabindex="-1"
  onkeydown={selection.handle_keydown}
  {...selection.drop_zone}
  aria-label="{dim === 3 ? `Ternary` : `Quaternary`} convex hull visualization"
>
  {@render children?.({
    model: hull_data.model,
    highlighted_entries,
    selected_entry,
  })}
  <canvas
    bind:this={canvas}
    tabindex="0"
    aria-label={merged_controls.title ||
      hull_data.phase_stats?.chemical_system ||
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

  {@render chrome(interactions)}

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
</style>
