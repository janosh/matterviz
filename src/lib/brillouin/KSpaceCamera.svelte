<script lang="ts">
  // Orbit camera and lights of a reciprocal-space scene (BrillouinZoneScene, FermiSurfaceScene):
  // orbits the zone's centroid from a distance set by `size`, fitting `fit_extent` to the
  // viewport, and mirrors the Threlte scene and camera into bindables (see bind_renderer)
  import type { Vec3 } from '#lib/math.js'
  import { bind_renderer } from '#lib/scene/bind-renderer.svelte.js'
  import { create_scene_camera, resolve_scene_controls } from '#lib/scene/props.svelte.js'
  import type { SceneControlProps } from '#lib/scene/props.svelte.js'
  import SceneCamera from '#lib/scene/SceneCamera.svelte'
  import SceneLights from '#lib/scene/SceneLights.svelte'
  import type { CameraProjection } from '#lib/settings.js'
  import { ortho_zoom_for_extent } from '#lib/structure/camera-fit.js'
  import { default_camera_position, polyhedron_centroid } from './geometry'

  let {
    camera_projection,
    scene = $bindable(),
    camera = $bindable(),
    zone_vertices,
    size,
    fit_extent,
    width,
    height,
    fill,
    set_camera_is_moving,
    ...scene_controls // camera/lighting/interaction props, resolved against shared defaults
  }: SceneControlProps & {
    camera_projection: CameraProjection
    zone_vertices?: Vec3[]
    size: number // characteristic k-space size (k_space_size)
    fit_extent: number // passed to ortho_zoom_for_extent
    width: number // viewport size, needed to turn the relative initial_zoom into a fit
    height: number
    fill?: number // SceneLights' fill light
    set_camera_is_moving: (moving: boolean) => void
  } = $props()

  bind_renderer((threlte_scene, threlte_camera) => {
    scene = threlte_scene
    camera = threlte_camera
  })
  const controls = $derived(resolve_scene_controls(scene_controls))
  const target = $derived(polyhedron_centroid(zone_vertices))
  const position = $derived(default_camera_position(size))

  // initial_zoom is relative (50 = fit to the shorter viewport edge), so it has to go through
  // ortho_zoom_for_extent — handing it to the camera raw treats it as an absolute zoom and
  // renders the zone several times too small.
  const measured = $derived(width > 0 && height > 0)
  const scene_camera = create_scene_camera({
    controls: () => ({ ...controls, camera_projection }),
    target: () => target,
    fit_zoom: () =>
      measured
        ? ortho_zoom_for_extent(fit_extent, width, height, controls.initial_zoom)
        : controls.initial_zoom,
    measured: () => measured,
    camera: () => camera,
    set_camera_is_moving: (moving) => set_camera_is_moving(moving),
  })
</script>

<SceneCamera
  {camera_projection}
  {position}
  fov={controls.fov}
  zoom={scene_camera.zoom}
  reset_zoom={scene_camera.reset_to_fit}
  orbit_props={scene_camera.orbit_props}
  gizmo={controls.gizmo}
/>

<SceneLights
  ambient={controls.ambient_light}
  directional={controls.directional_light}
  {fill}
/>
