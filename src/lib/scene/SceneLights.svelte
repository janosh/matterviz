<script lang="ts">
  // One lighting rig for every Threlte scene, so ambient_light / directional_light mean the
  // same everywhere. `fill` adds a dimmer opposite light (a fraction of `directional`) where
  // back faces would go black (Fermi surfaces, scatter cubes). Positions only set direction,
  // in world space unless `camera_space`, where the lights turn with the camera so the side
  // in view is always lit.
  // `depth_cue` fades `depth_points` (flat world xyz) toward the viewer's background, from
  // none at the nearest point along the view axis to a `depth_cue` fraction at the farthest.
  import type { Vec3 } from '#lib/math.js'
  import { DEFAULTS } from '#lib/settings.js'
  import { watch_theme_changes } from '#lib/theme/index.js'
  import { T, useTask, useThrelte } from '@threlte/core'
  import { create_depth_cue, css_background_rgb, depth_cue_fog, depth_cues } from './lighting'
  import { AgXToneMapping, Box3, Group, SRGBColorSpace, Vector3 } from 'three/webgpu'

  let {
    ambient = DEFAULTS.structure.ambient_light,
    directional = DEFAULTS.structure.directional_light,
    fill = 0,
    key_position = [3, 10, 10],
    fill_position = [-3, -5, -10],
    camera_space = false,
    depth_cue = DEFAULTS.structure.depth_cue,
    depth_points,
  }: {
    ambient?: number
    directional?: number
    fill?: number
    key_position?: Vec3
    fill_position?: Vec3
    camera_space?: boolean
    depth_cue?: number
    depth_points?: ArrayLike<number>
  } = $props()

  const { camera, scene, renderer, toneMapping, invalidate, autoRenderTask } = useThrelte()
  const group = new Group()
  const cue = create_depth_cue()
  const fog_on = $derived(Boolean(depth_points?.length) && depth_cue > 0)
  // Background changes (theme, background_color via --struct-bg-override) do not render the
  // scene, so they are watched rather than read per frame
  const read_background = () => {
    const [red, green, blue] = css_background_rgb(renderer.domElement)
    cue.color.value.setRGB(red / 255, green / 255, blue / 255, SRGBColorSpace) // to linear
    invalidate()
  }
  $effect(() => {
    if (!fog_on) return
    const previous = scene.fogNode
    // toneMapping.current is not reactive: a tone-mapping change after mount keeps this fog
    depth_cues.set(scene, cue)
    scene.fogNode = depth_cue_fog(cue, toneMapping.current === AgXToneMapping)
    read_background()
    const unwatch = watch_theme_changes(renderer.domElement, read_background, [
      `--struct-bg-override`,
    ])
    return () => {
      unwatch()
      depth_cues.delete(scene)
      scene.fogNode = previous
      invalidate()
    }
  })
  $effect(() => {
    cue.strength.value = depth_cue
    invalidate()
  })
  // Half the points' bounding diagonal floors the fade's depth span, so a nearly face-on flat
  // molecule fades gently instead of its farthest atom going fully faded, and 1 A floors it
  // absolutely, so a single site or coincident ones never divide by zero
  const min_span = $derived.by(() => {
    if (!depth_points?.length) return 1
    for (let idx = 0; idx < depth_points.length; idx++) {
      if (!Number.isFinite(depth_points[idx]))
        throw new TypeError(`depth_points[${idx}] = ${depth_points[idx]} is not finite`)
    }
    return Math.max(
      1,
      new Box3().setFromArray(depth_points).getSize(new Vector3()).length() / 2,
    )
  })

  const view_dir = new Vector3()
  useTask(
    () => {
      const cam = camera.current
      if (camera_space) group.quaternion.copy(cam.quaternion)
      else group.quaternion.identity()
      if (!fog_on || !depth_points) return
      // Fog measures depth along the view axis (view-space z), as does this
      cam.getWorldDirection(view_dir)
      let [near, far] = [Infinity, -Infinity]
      for (let idx = 0; idx < depth_points.length; idx += 3) {
        const depth =
          (depth_points[idx] - cam.position.x) * view_dir.x +
          (depth_points[idx + 1] - cam.position.y) * view_dir.y +
          (depth_points[idx + 2] - cam.position.z) * view_dir.z
        near = Math.min(near, depth)
        far = Math.max(far, depth)
      }
      cue.near.value = near
      cue.span.value = Math.max(far - near, min_span)
    },
    { before: autoRenderTask, autoInvalidate: false },
  )
</script>

<T.AmbientLight intensity={ambient} />
<T is={group}>
  <T.DirectionalLight position={key_position} intensity={directional} />
  {#if fill > 0}
    <T.DirectionalLight position={fill_position} intensity={directional * fill} />
  {/if}
</T>
