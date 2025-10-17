<script lang="ts">
  import type { BondGroupWithGradients } from '$lib/structure'
  import { T } from '@threlte/core'
  import type { InstancedMesh } from 'three'
  import { Color, InstancedBufferAttribute, Matrix4, ShaderMaterial } from 'three'

  let { group }: { group: BondGroupWithGradients } = $props()
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
      mat3 normalMat = transpose(inverse(mat3(modelMatrix * instanceMatrix)));
      vNormal = normalize(normalMat * normal);
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }
  `

  const fragment_shader = `
    uniform float ambientIntensity;
    uniform float directionalIntensity;
    varying vec3 vColorStart;
    varying vec3 vColorEnd;
    varying float vYPosition;
    varying vec3 vNormal;

    void main() {
      vec3 baseColor = mix(vColorStart, vColorEnd, vYPosition + 0.5);
      vec3 lightDirection = normalize(vec3(3.0, 10.0, 10.0));
      float diffuse = max(dot(normalize(vNormal), lightDirection), 0.0);
      float lighting = ambientIntensity + directionalIntensity * diffuse;
      gl_FragColor = vec4(baseColor * lighting, 1.0);
    }
  `

  function set_color_buffer(
    buffer: Float32Array,
    idx: number,
    color: string | number,
  ) {
    const temp_color = new Color(color)
    buffer[idx * 3] = temp_color.r
    buffer[idx * 3 + 1] = temp_color.g
    buffer[idx * 3 + 2] = temp_color.b
  }

  function update_or_create_attribute(
    geometry: InstancedMesh[`geometry`],
    name: string,
    buffer: Float32Array,
  ) {
    const existing_attr = geometry.getAttribute(name) as
      | InstancedBufferAttribute
      | undefined
    if (existing_attr?.array === buffer) {
      existing_attr.needsUpdate = true
    } else {
      geometry.setAttribute(name, new InstancedBufferAttribute(buffer, 3))
    }
  }

  $effect(() => {
    if (!mesh || group.instances.length === 0) return

    const count = group.instances.length
    const matrix = new Matrix4()

    // Set transformation matrices
    for (let idx = 0; idx < count; idx++) {
      matrix.fromArray(group.instances[idx].matrix)
      mesh.setMatrixAt(idx, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true

    // Reallocate color buffers if count changed
    if (colors_start.length !== count * 3) {
      colors_start = new Float32Array(count * 3)
      colors_end = new Float32Array(count * 3)
    }

    // Set per-instance colors
    for (let idx = 0; idx < count; idx++) {
      const instance = group.instances[idx]
      set_color_buffer(colors_start, idx, instance.color_start)
      set_color_buffer(colors_end, idx, instance.color_end)
    }

    // Update or create color attributes
    const { geometry } = mesh
    update_or_create_attribute(geometry, `instanceColorStart`, colors_start)
    update_or_create_attribute(geometry, `instanceColorEnd`, colors_end)

    mesh.count = count
  })

  let shader_material = $derived(
    new ShaderMaterial({
      vertexShader: vertex_shader,
      fragmentShader: fragment_shader,
      uniforms: {
        ambientIntensity: { value: group.ambient_light ?? 1.5 },
        directionalIntensity: { value: group.directional_light ?? 2.2 },
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
