<script lang="ts">
  import type { BondGroupWithGradients } from '$lib/structure'
  import { T } from '@threlte/core'
  import type { InstancedMesh } from 'three'
  import { Color, InstancedBufferAttribute, Matrix4, ShaderMaterial } from 'three'

  let { group, saturation = 0.5, brightness = 0.6 }: {
    group: BondGroupWithGradients
    saturation?: number
    brightness?: number
  } = $props()
  let mesh: InstancedMesh | undefined = $state()

  // Reusable buffers to avoid reallocation on every update
  let colors_start = new Float32Array(0)
  let colors_end = new Float32Array(0)

  const vertex_shader = `
    attribute vec3 instanceColorStart;
    attribute vec3 instanceColorEnd;
    varying vec3 vColorStart;
    varying vec3 vColorEnd;
    varying float vYPosition;
    varying vec3 vNormal;

    void main() {
      // Colors from Three.js Color class are in linear RGB, pass them through
      vColorStart = instanceColorStart;
      vColorEnd = instanceColorEnd;
      vYPosition = position.y;
      mat3 normalMat = normalMatrix;
      vNormal = normalize(normalMat * normal);
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }
  `

  const fragment_shader = `
    uniform float ambientIntensity;
    uniform float directionalIntensity;
    uniform float saturation;
    uniform float brightness;
    varying vec3 vColorStart;
    varying vec3 vColorEnd;
    varying float vYPosition;
    varying vec3 vNormal;

    // Linear to sRGB conversion (gamma correction)
    vec3 linearTosRGB(vec3 linear) {
      return vec3(
        linear.r <= 0.0031308 ? linear.r * 12.92 : 1.055 * pow(linear.r, 1.0/2.4) - 0.055,
        linear.g <= 0.0031308 ? linear.g * 12.92 : 1.055 * pow(linear.g, 1.0/2.4) - 0.055,
        linear.b <= 0.0031308 ? linear.b * 12.92 : 1.055 * pow(linear.b, 1.0/2.4) - 0.055
      );
    }

    // Desaturate and darken colors for bonds
    vec3 desaturateBondColor(vec3 color) {
      // Convert to grayscale
      float gray = dot(color, vec3(0.299, 0.587, 0.114));
      // Mix with gray (controlled by saturation) and darken (controlled by brightness)
      return mix(vec3(gray), color, saturation) * brightness;
    }

    void main() {
      // Mix colors first: bottom (-0.5) = start color, top (+0.5) = end color
      vec3 baseColor = mix(vColorStart, vColorEnd, vYPosition + 0.5);

      // Desaturate and darken bond colors
      baseColor = desaturateBondColor(baseColor);

      // Apply lighting to the mixed color
      vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
      float diffuse = max(dot(vNormal, lightDir), 0.0);

      vec3 finalColor = baseColor * (ambientIntensity + directionalIntensity * diffuse);

      // Convert to sRGB for display
      gl_FragColor = vec4(linearTosRGB(finalColor), 1.0);
    }
  `

  $effect(() => {
    if (!mesh) return

    const count = group.instances.length
    const matrix = new Matrix4()
    const temp_color = new Color()

    // Reallocate color buffers if needed
    if (colors_start.length !== count * 3) {
      colors_start = new Float32Array(count * 3)
      colors_end = new Float32Array(count * 3)
    }

    // Set matrices and colors in single loop
    for (let idx = 0; idx < count; idx++) {
      const instance = group.instances[idx]

      // Set matrix
      matrix.fromArray(instance.matrix)
      mesh.setMatrixAt(idx, matrix)

      // Set start color
      temp_color.set(instance.color_start)
      colors_start[idx * 3] = temp_color.r
      colors_start[idx * 3 + 1] = temp_color.g
      colors_start[idx * 3 + 2] = temp_color.b

      // Set end color
      temp_color.set(instance.color_end)
      colors_end[idx * 3] = temp_color.r
      colors_end[idx * 3 + 1] = temp_color.g
      colors_end[idx * 3 + 2] = temp_color.b
    }

    mesh.instanceMatrix.needsUpdate = true

    // Update or create color attributes
    const { geometry } = mesh
    for (
      const [name, buffer] of [
        [`instanceColorStart`, colors_start],
        [`instanceColorEnd`, colors_end],
      ] as const
    ) {
      const existing = geometry.getAttribute(name)
      if (existing?.array === buffer) existing.needsUpdate = true
      else geometry.setAttribute(name, new InstancedBufferAttribute(buffer, 3))
    }

    mesh.count = count
  })

  let shader_material = $derived(
    new ShaderMaterial({
      vertexShader: vertex_shader,
      fragmentShader: fragment_shader,
      uniforms: {
        ambientIntensity: { value: group.ambient_light ?? 0.7 },
        directionalIntensity: { value: group.directional_light ?? 0.3 },
        saturation: { value: saturation },
        brightness: { value: brightness },
      },
    }),
  )
</script>

<T.InstancedMesh
  args={[undefined, shader_material, group.instances.length]}
  bind:ref={mesh}
>
  <T.CylinderGeometry args={[group.thickness, group.thickness, 1, 8]} />
</T.InstancedMesh>
