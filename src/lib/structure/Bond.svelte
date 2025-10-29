<script lang="ts">
  import type { BondGroupWithGradients } from '$lib/structure'
  import { T } from '@threlte/core'
  import type { InstancedMesh } from 'three'
  import { Color, InstancedBufferAttribute, Matrix4, ShaderMaterial } from 'three'

  let { group, saturation = 0.5, brightness = 0.7 }: {
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
      vColorStart = instanceColorStart;
      vColorEnd = instanceColorEnd;
      vYPosition = position.y;
      vNormal = normalize(normalMatrix * normal);
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

    vec3 linearTosRGB(vec3 linear) {
      return vec3(
        linear.r <= 0.0031308 ? linear.r * 12.92 : 1.055 * pow(linear.r, 1.0/2.4) - 0.055,
        linear.g <= 0.0031308 ? linear.g * 12.92 : 1.055 * pow(linear.g, 1.0/2.4) - 0.055,
        linear.b <= 0.0031308 ? linear.b * 12.92 : 1.055 * pow(linear.b, 1.0/2.4) - 0.055
      );
    }

    void main() {
      vec3 base_color = mix(vColorStart, vColorEnd, vYPosition + 0.5);

      // Desaturate and darken for visual distinction from atoms
      float gray = dot(base_color, vec3(0.299, 0.587, 0.114));
      base_color = mix(vec3(gray), base_color, saturation) * brightness;

      // Apply lighting
      vec3 light_dir = normalize(vec3(1.0, 1.0, 1.0));
      float diffuse = max(dot(vNormal, light_dir), 0.0);
      vec3 final_color = base_color * (ambientIntensity + directionalIntensity * diffuse);

      gl_FragColor = vec4(linearTosRGB(final_color), 1.0);
    }
  `

  function set_color_buffer(
    buffer: Float32Array,
    idx: number,
    color: string,
    temp_color: Color,
  ) {
    temp_color.set(color).convertSRGBToLinear()
    buffer[idx * 3] = temp_color.r
    buffer[idx * 3 + 1] = temp_color.g
    buffer[idx * 3 + 2] = temp_color.b
  }

  $effect(() => {
    if (!mesh) return

    const count = group.instances.length
    const matrix = new Matrix4()
    const temp_color = new Color()

    // Reallocate buffers if instance count changed
    if (colors_start.length !== count * 3) {
      colors_start = new Float32Array(count * 3)
      colors_end = new Float32Array(count * 3)
    }

    // Update instance matrices and colors
    for (let idx = 0; idx < count; idx++) {
      const instance = group.instances[idx]
      matrix.fromArray(instance.matrix)
      mesh.setMatrixAt(idx, matrix)
      set_color_buffer(colors_start, idx, instance.color_start, temp_color)
      set_color_buffer(colors_end, idx, instance.color_end, temp_color)
    }

    mesh.instanceMatrix.needsUpdate = true

    // Update geometry color attributes
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
