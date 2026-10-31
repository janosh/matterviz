<script lang="ts">
  // Dual perspective/orthographic camera with OrbitControls + axis Gizmo, shared by
  // BrillouinZoneScene, FermiSurfaceScene, ChemPotScene3D, ScatterPlot3DScene,
  // TernaryPrismScene and StructureScene
  import type { Vec3 } from '#lib/math.js'
  import { type CameraProjection, DEFAULTS } from '#lib/settings.js'
  import { T, useThrelte } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { type ComponentProps, untrack } from 'svelte'
  import type { GizmoOptions } from './gizmo'
  import Gizmo from './Gizmo.svelte'
  import { attach_pan_gesture, clear_pan_offset, read_pan_offset, set_pan_offset } from './pan'
  import type { build_orbit_props } from './props.svelte'
  import { camera_flight_registry, create_camera_flight_controller } from './camera-flight'
  import { camera_resets } from './camera-reset'
  import { lock_fly_to } from './fly-to'
  import { join_orbit_link, release_orbit_root } from './orbit-link.svelte'
  import { wheel_zoom_surface } from './wheel-zoom.svelte'
  import { OrthographicCamera, PerspectiveCamera } from 'three/webgpu'

  let {
    camera_projection = `perspective`,
    position = [0, 0, 0],
    fov = DEFAULTS.structure.fov,
    zoom = DEFAULTS.structure.initial_zoom,
    near = 0.1,
    ortho_near = -100,
    far = 2000,
    up = [0, 1, 0],
    orbit_props,
    gizmo = false,
    reset_zoom,
    orbit_controls = $bindable(undefined),
  }: {
    camera_projection?: CameraProjection
    position?: Vec3 // camera position; may be unset while the scene measures its bounds
    fov?: number // perspective field of view
    zoom?: number // orthographic zoom level
    near?: number // perspective near plane (three's default when omitted)
    // Orthographic near plane. The default sits behind the camera so nothing in front of it can
    // clip; a positive value clips geometry nearer than that distance (ChemPotDiagram3D).
    ortho_near?: number
    far?: number // far plane for either projection (three's default when omitted)
    // World direction drawn as screen up, also the axis OrbitControls orbits about
    up?: Vec3
    orbit_props: ReturnType<typeof build_orbit_props>
    gizmo?: boolean | GizmoOptions
    // Drops a stored user zoom before a camera reset reads `zoom` (scene_camera.reset_to_fit)
    reset_zoom?: () => void
    orbit_controls?: ComponentProps<typeof extras.OrbitControls>[`ref`]
  } = $props()

  // OrbitControls sets touch-action: none on its canvas, so on a phone a one-finger swipe
  // over a 500px-tall viewer orbits instead of scrolling and the page is stuck under the
  // thumb. pan-y hands vertical one-finger swipes to the browser (page scroll) while
  // horizontal swipes and pinches still orbit/zoom; once a gesture has gone to the viewer
  // it keeps it. Fullscreen has no page to scroll, so full capture comes back there.
  $effect(() => {
    const dom_element = orbit_controls?.domElement
    if (!(dom_element instanceof HTMLElement)) return
    const apply_touch_policy = () => {
      const fullscreen = document.fullscreenElement?.contains(dom_element) ?? false
      dom_element.style.touchAction = fullscreen ? `none` : `pan-y`
    }
    apply_touch_policy()
    document.addEventListener(`fullscreenchange`, apply_touch_policy)
    return () => document.removeEventListener(`fullscreenchange`, apply_touch_policy)
  })

  // A host's orbit link (e.g. a structure beside its Fermi surface) turns its other scenes along
  join_orbit_link(() => orbit_controls)
  $effect(() => orbit_controls && release_orbit_root(orbit_controls))

  // The enclosing viewer's WheelZoomGate decides which wheels reach OrbitControls' listener
  wheel_zoom_surface(
    () => orbit_controls?.domElement,
    () => orbit_props.enableZoom,
  )

  // Pan as a view offset on the camera (see pan.ts) so the orbit target stays the pivot;
  // OrbitControls' own pan is disabled below and its enablePan/panSpeed drive this gesture.
  const { size, invalidate, renderer } = useThrelte()
  let flight_active = $state(false)
  $effect(() => {
    const controls = orbit_controls
    const canvas = renderer.domElement
    const camera = controls?.object
    if (
      !(canvas instanceof HTMLCanvasElement) ||
      !controls ||
      !(camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera)
    )
      return
    const controller = create_camera_flight_controller(
      { object: camera, target: controls.target },
      () => size.current,
      (active) => {
        lock_fly_to(controls, active) // no gizmo or zone-axis swing fights the flight
        flight_active = active
        // the landed (or restored) pose, which the flight set on the camera directly, reaches
        // an orbit link now rather than on the next orbit
        if (!active) controls.update()
      },
      invalidate,
    )
    camera_flight_registry.set(canvas, controller)
    return () => {
      controller.dispose()
      if (camera_flight_registry.get(canvas) === controller)
        camera_flight_registry.delete(canvas)
    }
  })
  $effect(() => {
    const dom_element = orbit_controls?.domElement
    if (!(dom_element instanceof HTMLElement)) return
    return attach_pan_gesture(dom_element, {
      controls: () => orbit_controls,
      speed: () => (orbit_props.enablePan ? orbit_props.panSpeed : 0),
      size: () => size.current,
    })
  })
  // Camera reset (reset_scene_cameras): back to the position, orbit target and zoom the props
  // describe, without pan. Props are read when it runs, so it follows their current values.
  $effect(() => {
    const controls = orbit_controls
    const canvas = renderer.domElement
    if (!controls || !(canvas instanceof HTMLCanvasElement)) return
    const reset = () => {
      reset_zoom?.()
      const camera = controls.object
      camera.position.set(...position)
      controls.target.set(...orbit_props.target)
      if (camera instanceof OrthographicCamera) {
        camera.zoom = zoom
        camera.updateProjectionMatrix()
      }
      clear_pan_offset(camera)
      controls.update()
      invalidate()
    }
    camera_resets.set(canvas, reset)
    return () => {
      if (camera_resets.get(canvas) === reset) camera_resets.delete(canvas)
    }
  })
  // A resize changes the pixel grid the offset is defined on; re-apply it at the new size
  $effect(() => {
    const { width, height } = $size
    const camera = untrack(() => orbit_controls?.object)
    if (!camera) return
    const offset = read_pan_offset(camera)
    if (offset[0] !== 0 || offset[1] !== 0) set_pan_offset(camera, offset, width, height)
  })
</script>

<!-- OrbitControls reads camera.up only when constructed, so a new up vector rebuilds them -->
{#snippet camera_contents()}
  {#key up.join(`,`)}
    <extras.OrbitControls
      bind:ref={orbit_controls}
      {...orbit_props}
      enablePan={false}
      enabled={!flight_active}
      enableDamping={!flight_active && orbit_props.enableDamping}
      autoRotate={!flight_active && orbit_props.autoRotate}
    >
      {#if gizmo && !flight_active}
        <Gizmo
          {...typeof gizmo === `object` ? gizmo : {}}
          on_start={orbit_props.onstart}
          on_end={orbit_props.onend}
        />
      {/if}
    </extras.OrbitControls>
  {/key}
{/snippet}

{#if camera_projection === `perspective`}
  <T.PerspectiveCamera makeDefault {position} {fov} {near} {far} {up}>
    {@render camera_contents()}
  </T.PerspectiveCamera>
{:else}
  <T.OrthographicCamera makeDefault {position} {zoom} near={ortho_near} {far} {up}>
    {@render camera_contents()}
  </T.OrthographicCamera>
{/if}
