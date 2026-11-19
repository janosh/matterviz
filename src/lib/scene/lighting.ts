// Depth cueing, shared by SceneLights and SurfaceMaterial: a scene fog node with a linear
// fade from none at the content's nearest point to `strength` at its farthest, toward the
// viewer's CSS background color (the canvas is clear).
import { agxToneMapping, mix, output, positionView, uniform, vec4 } from 'three/tsl'
import {
  type Camera,
  Color,
  type Node,
  type Object3D,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu'
import { agx_exposure, untone_agx } from './tone-mapping'

// color: background in linear sRGB; the fade starts at view depth `near` and reaches
// `strength` `span` deeper; `shown` is 0 while a PNG capture suspends the cue, kept apart from
// `strength` so a strength change during the capture survives its release
const cue_uniforms = () => ({
  color: uniform(new Color(1, 1, 1)),
  near: uniform(0),
  span: uniform(1),
  strength: uniform(0),
  shown: uniform(1),
})
export type DepthCue = ReturnType<typeof cue_uniforms> & { factor: Node<`float`> }
// Each scene's active DepthCue (set by SceneLights while its fog is on), so materials that
// tone-map themselves (SurfaceMaterial) can apply the same fade before their own untone_agx
// step, and PNG export can suspend it. Keyed by the scene (an Object3D root).
export const depth_cues = new WeakMap<Object3D, DepthCue>()

// Scenes drawn through a post-processing pipeline (AmbientOcclusion), by scene: captures
// (PNG, video, thumbnails) draw through render_scene so they keep the effect
export const scene_renders = new WeakMap<Object3D, (camera: Camera) => void>()
// Key of SceneLights' per-frame camera and depth-cue update, so AmbientOcclusion's render task
// can run after it (both run in the render stage, before Threlte's auto render)
export const scene_lights_task = Symbol(`matterviz-scene-lights`)
export const render_scene = (renderer: WebGPURenderer, scene: Scene, camera: Camera) => {
  const render = scene_renders.get(scene)
  if (render) render(camera)
  else renderer.render(scene, camera)
}

export const create_depth_cue = (): DepthCue => {
  const uniforms = cue_uniforms()
  const { near, span, strength, shown } = uniforms
  const factor = positionView.z
    .negate()
    .sub(near)
    .div(span)
    .clamp(0, 1)
    .mul(strength)
    .mul(shown)
  return { ...uniforms, factor }
}

// Under AgX the fade mixes displayed colors: AgX compresses highlights, so mixing toward an
// untoned background before the tone map would wash out even a slight fade
export const depth_cue_fog = (cue: DepthCue, agx: boolean): Node => {
  const { color, factor } = cue
  // @types/three declares agxToneMapping's result as a bare Node
  const toned = agxToneMapping(output.rgb, agx_exposure) as Node<`vec3`>
  const rgb = agx
    ? untone_agx(mix(toned, color, factor), agx_exposure)
    : mix(output.rgb, color, factor)
  return vec4(rgb, output.a)
}

// The canvas is transparent, so its background is its ancestors' backgrounds composited down
// to the first opaque one (or the white page canvas). Painting each into a 1px canvas resolves
// any CSS color syntax (color-mix, oklch) to sRGB bytes.
let probe: CanvasRenderingContext2D | null | undefined
export function css_background_rgb(element: Element): [number, number, number] {
  probe ??= document.createElement(`canvas`).getContext(`2d`, { willReadFrequently: true })
  if (!probe) throw new Error(`css_background_rgb needs a 2D canvas context`)
  const layers: Uint8ClampedArray[] = []
  for (let node = element.parentElement; node; node = node.parentElement) {
    probe.clearRect(0, 0, 1, 1)
    // an unparsable color leaves fillStyle unchanged, so reset it to paint nothing instead
    probe.fillStyle = `transparent`
    probe.fillStyle = getComputedStyle(node).backgroundColor
    probe.fillRect(0, 0, 1, 1)
    const rgba = probe.getImageData(0, 0, 1, 1).data
    if (rgba[3] > 0) layers.push(rgba)
    if (rgba[3] === 255) break
  }
  return layers.reduceRight<[number, number, number]>(
    (under, [red, green, blue, alpha]) => {
      const weight = alpha / 255
      return [red, green, blue].map(
        (channel, idx) => channel * weight + under[idx] * (1 - weight),
      ) as [number, number, number]
    },
    [255, 255, 255],
  )
}
