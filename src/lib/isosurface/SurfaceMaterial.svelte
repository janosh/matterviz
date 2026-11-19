<script lang="ts">
  // Material for one isosurface draw pass (one side of one layer entry, shared by its lobe
  // meshes through `children`) in the chosen `surface_finish`. Under the default AgX tone
  // mapping every finish emits untone_agx(color), so phase colors stay saturated and colormaps
  // match their legend while atoms keep AgX. Color, opacity and exposure are uniforms, so
  // dragging them never recompiles a shader.
  import type { SurfaceFinish } from '#lib/settings.js'
  import type { Snippet } from 'svelte'
  import { T, useThrelte } from '@threlte/core'
  import { depth_cues } from '#lib/scene/lighting'
  import { agx_exposure, untone_agx } from '#lib/scene/tone-mapping'
  import { shell_front_alpha } from './shell-alpha'
  import {
    dot,
    Fn,
    materialOpacity,
    mix,
    normalView,
    output,
    positionViewDirection,
    vec4,
  } from 'three/tsl'
  import {
    AgXToneMapping,
    BackSide,
    MeshBasicNodeMaterial,
    MeshLambertNodeMaterial,
    MeshPhysicalNodeMaterial,
    MeshStandardNodeMaterial,
    type Node,
    type Material,
    type NodeBuilder,
    type Side,
  } from 'three/webgpu'

  let {
    finish,
    color,
    opacity,
    side,
    vertex_colors,
    children,
  }: {
    finish: SurfaceFinish
    color: string
    opacity: number
    side: Side
    vertex_colors: boolean
    children: Snippet<[Material]>
  } = $props()

  const { toneMapping } = useThrelte()
  // The scene's depth cue, looked up from the mesh's root at shader build (SceneLights swaps
  // the scene's fog node with it, which rebuilds every material)
  const with_depth_cue = Fn(([rgb]: [Node<`vec3`>], builder: NodeBuilder) => {
    let root = builder.object
    while (root.parent) root = root.parent
    const cue = depth_cues.get(root)
    return cue ? mix(rgb, cue.color, cue.factor) : rgb
  })

  const transparent = $derived(opacity < 1)
  // The back and front passes split the layer's opacity, so a shell covers `opacity` where
  // both faces overlap rather than 1 - (1 - opacity)², and atoms inside stay readable
  const pass_opacity = $derived(transparent ? 1 - Math.sqrt(1 - opacity) : 1)

  // 1 where the surface faces the viewer, 0 at its silhouette
  const facing = dot(normalView, positionViewDirection).abs().clamp(0, 1)
  // Translucent satin layers take the shell look: a plain lit surface turns muddy where two
  // phases overlap, the shell's rims and view-dependent fade keep each lobe distinct
  const shell = $derived(
    finish === `translucent_shell` || (finish === `satin` && transparent && !vertex_colors),
  )

  const material = $derived.by(() => {
    const props = { side, vertexColors: vertex_colors, transparent, depthWrite: !transparent }
    let rgb: Node<`vec3`> = output.rgb
    let alpha: Node<`float`> = output.a
    let surface
    if (finish === `unlit`) surface = new MeshBasicNodeMaterial(props)
    else if (finish === `chalk`) surface = new MeshLambertNodeMaterial(props)
    else if (shell) {
      surface = new MeshPhysicalNodeMaterial({
        ...props,
        roughness: 0.38,
        specularIntensity: 0.5,
      })
      // Rims darken by up to 22%; translucent front faces thicken toward the rim and back
      // faces fade toward their silhouette, so the shell outlines what it encloses
      rgb = rgb.mul(facing.pow(2).oneMinus().pow(5.4).mul(0.22).oneMinus())
      if (transparent) {
        alpha =
          side === BackSide
            ? facing.smoothstep(0, 0.85).mul(materialOpacity)
            : shell_front_alpha(facing, materialOpacity)
      }
    } else if (vertex_colors) {
      // Colormapped satin: face-on colors match the legend, shading only toward the silhouette
      surface = new MeshBasicNodeMaterial(props)
      rgb = rgb.mul(facing.mul(0.3).add(0.7))
    } else {
      surface = new MeshStandardNodeMaterial({ ...props, roughness: 0.4, metalness: 0 })
    }
    // Scene fog would land after untone_agx and come out re-toned, and on other tone mappings
    // before outputNode, so the rim darkening above would darken the fog color too: the depth
    // cue's fade is applied here instead, after shading and before any untone (see
    // scene/lighting.ts). toneMapping.current is not reactive, so a later change keeps this.
    surface.fog = false
    rgb = with_depth_cue(rgb)
    if (toneMapping.current === AgXToneMapping) rgb = untone_agx(rgb, agx_exposure)
    surface.outputNode = vec4(rgb, alpha)
    return surface
  })
  $effect(() => {
    const current = material
    return () => current.dispose()
  })
</script>

<T is={material} attach={false} {color} opacity={pass_opacity} dispose={false} />
{@render children(material)}
