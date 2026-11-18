<script lang="ts">
  import { T } from '@threlte/core'
  import {
    dot,
    float,
    mix,
    modelViewMatrix,
    normalView,
    output,
    positionView,
    positionViewDirection,
    vec3,
    vec4,
  } from 'three/tsl'
  import {
    BackSide,
    MeshBasicNodeMaterial,
    MeshPhongNodeMaterial,
    MeshPhysicalNodeMaterial,
    type Node,
    type Side,
    type Sphere,
  } from 'three/webgpu'
  import type { SurfaceAppearance } from './types'

  let {
    appearance,
    color,
    vertex_colors,
    opacity,
    side,
    bounds,
  }: {
    appearance: SurfaceAppearance
    color: string
    vertex_colors: boolean
    opacity: number
    side: Side
    bounds: Sphere | null
  } = $props()

  const material = $derived.by(() => {
    const props = {
      color,
      vertexColors: vertex_colors,
      side,
      transparent: opacity < 1,
      depthWrite: opacity >= 1,
      toneMapped: false,
    }
    const inner = Math.max(0, Math.min(1, appearance.inner_share ?? 0.5))
    const share = side === BackSide ? inner : 1 - inner
    const alpha = opacity === 1 ? 1 : 1 - (1 - opacity) ** share
    if (appearance.material === 'unlit')
      return new MeshBasicNodeMaterial({ ...props, opacity: alpha })
    const mat =
      appearance.material === 'glossy'
        ? new MeshPhongNodeMaterial({ ...props, shininess: appearance.shininess ?? 42 })
        : new MeshPhysicalNodeMaterial({
            ...props,
            roughness: appearance.roughness ?? 0.6,
            metalness: appearance.metalness ?? 0,
            specularIntensity: appearance.specular ?? 0.25,
          })
    if (mat instanceof MeshPhongNodeMaterial)
      mat.specular.setScalar(appearance.specular ?? 0.15)
    mat.flatShading = Boolean(appearance.flat_shading)
    const facing = dot(normalView, positionViewDirection).abs().clamp(0, 1)
    const rim = facing
      .pow(2)
      .oneMinus()
      .pow(Math.max(0.001, 32 * (1 - (appearance.outline_width ?? 0.6))))
    let shaded = output.rgb.mul(rim.mul(appearance.outline ?? 0).oneMinus())
    const luminance = dot(shaded, vec3(0.2126, 0.7152, 0.0722))
    shaded = mix(vec3(luminance), shaded, appearance.saturation ?? 1)
    if (bounds && appearance.depth_fade) {
      const center = modelViewMatrix.mul(vec4(vec3(bounds.center), 1)).z
      const distance = center
        .sub(positionView.z)
        .div(Math.max(2 * bounds.radius, 1e-6))
        .add(0.5)
        .saturate()
      shaded = mix(shaded, vec3(1), distance.mul(appearance.depth_fade))
    }
    let coverage: Node<'float'> = float(alpha)
    if (appearance.angle_opacity && opacity > 0 && opacity < 1) {
      coverage =
        side === BackSide
          ? facing.smoothstep(0, 0.85).mul(alpha)
          : facing
              .mul(Math.PI * (1 - alpha))
              .cos()
              .add(1)
              .mul(0.5)
              .pow(2)
    }
    mat.outputNode = vec4(shaded, coverage)
    return mat
  })
  $effect(() => {
    const current = material
    return () => current.dispose()
  })
</script>

<T is={material} attach="material" dispose={false} />
