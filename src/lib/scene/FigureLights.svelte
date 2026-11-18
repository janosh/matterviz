<script lang="ts">
  import type { FigureLighting } from '#lib/isosurface/figure-presets.js'
  import { T, useTask, useThrelte } from '@threlte/core'
  import { Fog, Group, Vector3 } from 'three/webgpu'
  import type { Vec3 } from '#lib/math.js'

  let { rig, frame }: { rig: FigureLighting; frame: { center: Vec3; extent: number } } =
    $props()
  const group = new Group()
  const { camera, scene, autoRenderTask } = useThrelte()
  const fog = new Fog(0xffffff)
  const center = new Vector3()
  $effect(() => {
    if (!rig.structure_fade) return
    const previous = scene.fog
    scene.fog = fog
    return () => {
      scene.fog = previous
    }
  })
  const key = $derived.by((): Vec3 => {
    const a = (rig.azimuth * Math.PI) / 180,
      e = (rig.elevation * Math.PI) / 180
    return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]
  })
  useTask(
    () => {
      if (rig.camera_relative !== false) group.quaternion.copy(camera.current.quaternion)
      else group.quaternion.identity()
      if (rig.structure_fade) {
        const depth = -center
          .set(...frame.center)
          .applyMatrix4(camera.current.matrixWorldInverse).z
        fog.near = depth - frame.extent / 2
        fog.far = fog.near + frame.extent / rig.structure_fade
      }
    },
    { before: autoRenderTask, autoInvalidate: false },
  )
</script>

<T.AmbientLight intensity={rig.ambient} />
<T is={group}>
  <T.DirectionalLight
    position={key}
    intensity={rig.key}
    color={rig.warm ? '#fff4e8' : '#ffffff'}
  />
  <T.DirectionalLight
    position={[-0.55, -0.2, 1]}
    intensity={rig.fill}
    color={rig.warm ? '#e2edff' : '#ffffff'}
  />
  <T.DirectionalLight
    position={[0.6, -0.4, 1]}
    intensity={rig.rim}
    color={rig.warm ? '#fff9f0' : '#ffffff'}
  />
</T>
