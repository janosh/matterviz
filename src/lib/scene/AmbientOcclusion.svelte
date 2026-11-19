<script lang="ts">
  // Screen-space ambient occlusion (three's GTAO, normals reconstructed from depth) for the
  // Threlte scene it mounts in: while mounted, the scene renders through a RenderPipeline
  // instead of Threlte's auto render, and the occlusion multiplies the lit (still untoned)
  // colors before the pipeline's tone mapping. It multiplies the composited color, and
  // transparent surfaces write no depth: a translucent isosurface takes on the occlusion of the
  // opaque atoms behind it, and far atoms the depth cue faded toward the background darken.
  import { useTask, useThrelte } from '@threlte/core'
  import { denoise } from 'three/addons/tsl/display/DenoiseNode.js'
  import { ao } from 'three/addons/tsl/display/GTAONode.js'
  import { pass, vec4 } from 'three/tsl'
  import { type Camera, type Node, RenderPipeline, type WebGPURenderer } from 'three/webgpu'
  import { scene_lights_task, scene_renders } from './lighting'

  const { scene, camera, renderer, autoRender, autoRenderTask, renderStage, invalidate } =
    useThrelte<WebGPURenderer>()

  $effect(() => {
    // The pipeline draws with its own camera that each render copies, so captures can render
    // through it from another camera (camera flights); a projection change rebuilds it
    const view_camera = $camera.clone()
    const scene_pass = pass(scene, view_camera)
    const depth = scene_pass.getTextureNode(`depth`)
    // null normals make GTAO and denoise reconstruct them from depth; @types/three types the
    // argument as required and denoise's result as a bare Node, hence the casts
    const from_depth = null as unknown as Node
    const occlusion = ao(depth, from_depth, view_camera)
    // GTAO's radius is in world units (A): its 0.25 default only shades within an atom
    occlusion.radius.value = 2
    occlusion.scale.value = 1.5
    occlusion.resolutionScale = 0.5
    // GTAO's per-pixel noise pattern, smoothed by a depth-aware blur
    const denoised = denoise(
      occlusion.getTextureNode(),
      depth,
      from_depth,
      view_camera,
    ) as unknown as Node<`vec4`>
    const color = scene_pass.getTextureNode()
    const pipeline = new RenderPipeline(renderer, vec4(color.rgb.mul(denoised.r), color.a))
    // The pass, GTAO and denoise nodes redraw once per node frame, which three's animation loop
    // starts per rAF tick: captures (resized, other cameras) render between ticks, so each
    // render starts its own frame. three exposes the node frame only through a private field.
    const render = (source: Camera) => {
      view_camera.copy(source, false)
      const nodes: { nodeFrame: { update: () => void } } = Reflect.get(renderer, `_nodes`)
      nodes.nodeFrame.update()
      pipeline.render()
    }
    scene_renders.set(scene, render)
    autoRender.set(false)
    invalidate()
    return () => {
      scene_renders.delete(scene)
      autoRender.set(true)
      pipeline.dispose()
      occlusion.dispose()
      denoised.dispose()
      scene_pass.dispose()
      invalidate()
    }
  })
  // After SceneLights' depth-cue update and before the auto render, so tasks that draw over
  // the finished frame after it (the axis Gizmo, which skips the clear) land on top
  useTask(() => scene_renders.get(scene)?.(camera.current), {
    stage: renderStage,
    after: scene_lights_task,
    before: autoRenderTask,
    autoInvalidate: false,
  })
</script>
