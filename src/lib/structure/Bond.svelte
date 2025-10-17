<script lang="ts">
  import { T } from '@threlte/core'
  import type { InstancedMesh } from 'three'
  import { Color, InstancedBufferAttribute, Matrix4, ShaderMaterial } from 'three'

  interface BondInstance {
    matrix: Float32Array
    color_start: string
    color_end: string
  }
  interface BondGroupWithGradients {
    thickness: number
    instances: BondInstance[]
    ambient_light?: number
    directional_light?: number
  }
  let { group }: { group: BondGroupWithGradients } = $props()
  let mesh: InstancedMesh | undefined = $state()

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
      float t = vYPosition + 0.5;
      vec3 baseColor = mix(vColorStart, vColorEnd, t);

      vec3 lightDirection = normalize(vec3(3.0, 10.0, 10.0));
      vec3 normal = normalize(vNormal);

      float diffuse = max(dot(normal, lightDirection), 0.0);
      float lighting = ambientIntensity + directionalIntensity * diffuse;

      vec3 finalColor = baseColor * lighting;

      gl_FragColor = vec4(finalColor, 1.0);
    }
  `

  $effect(() => {
    if (mesh && group.instances.length > 0) {
      const count = group.instances.length
      const matrix = new Matrix4()

      // Set transformation matrices
      for (let idx = 0; idx < count; idx++) {
        matrix.fromArray(group.instances[idx].matrix)
        mesh.setMatrixAt(idx, matrix)
      }
      mesh.instanceMatrix.needsUpdate = true

      // Set per-instance colors as attributes
      const colors_start = new Float32Array(count * 3)
      const colors_end = new Float32Array(count * 3)
      const temp_color = new Color()

      for (let idx = 0; idx < count; idx++) {
        const instance = group.instances[idx]

        // Start color
        temp_color.set(instance.color_start)
        colors_start[idx * 3 + 0] = temp_color.r
        colors_start[idx * 3 + 1] = temp_color.g
        colors_start[idx * 3 + 2] = temp_color.b

        // End color
        temp_color.set(instance.color_end)
        colors_end[idx * 3 + 0] = temp_color.r
        colors_end[idx * 3 + 1] = temp_color.g
        colors_end[idx * 3 + 2] = temp_color.b
      }

      mesh.geometry.setAttribute(
        `instanceColorStart`,
        new InstancedBufferAttribute(colors_start, 3),
      )
      mesh.geometry.setAttribute(
        `instanceColorEnd`,
        new InstancedBufferAttribute(colors_end, 3),
      )

      mesh.count = count
    }
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
