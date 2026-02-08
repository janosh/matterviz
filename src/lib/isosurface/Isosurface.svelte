<script lang="ts">
  // Threlte component that renders isosurface meshes from volumetric data using marching cubes.
  // Supports positive and negative lobes with independent colors and two-pass transparency.
  import { marching_cubes } from '$lib/marching-cubes'
  import type { Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import { T } from '@threlte/core'
  import {
    BackSide,
    BufferAttribute,
    BufferGeometry,
    DoubleSide,
    FrontSide,
  } from 'three'
  import type { IsosurfaceSettings, VolumetricData } from './types'
  import { DEFAULT_ISOSURFACE_SETTINGS } from './types'

  let {
    volume,
    settings = DEFAULT_ISOSURFACE_SETTINGS,
  }: {
    volume: VolumetricData
    settings?: IsosurfaceSettings
  } = $props()

  // Build a BufferGeometry from marching cubes output.
  // Pre-counts triangles to allocate typed arrays directly, avoiding repeated push(...spread).
  function build_geometry(
    vertices: Vec3[],
    faces: number[][],
    normals: Vec3[],
  ): BufferGeometry | null {
    if (vertices.length === 0 || faces.length === 0) return null

    const n_verts = vertices.length

    // First pass: count total triangles for pre-allocation
    let n_triangles = 0
    for (const face of faces) {
      if (face.length >= 3) n_triangles += face.length - 2
    }
    if (n_triangles === 0) return null

    const positions = new Float32Array(n_triangles * 9) // 3 vertices * 3 components
    const norms = new Float32Array(n_triangles * 9)
    let write_idx = 0

    for (const face of faces) {
      if (face.length < 3) continue

      // Fan triangulation for N-gon faces
      for (let fan_idx = 1; fan_idx < face.length - 1; fan_idx++) {
        const idx0 = face[0]
        const idx1 = face[fan_idx]
        const idx2 = face[fan_idx + 1]

        if (
          idx0 < 0 || idx0 >= n_verts ||
          idx1 < 0 || idx1 >= n_verts ||
          idx2 < 0 || idx2 >= n_verts
        ) continue

        const v0 = vertices[idx0]
        const v1 = vertices[idx1]
        const v2 = vertices[idx2]
        positions.set(v0, write_idx)
        positions.set(v1, write_idx + 3)
        positions.set(v2, write_idx + 6)

        if (normals.length > 0) {
          norms.set(normals[idx0] ?? [0, 0, 1], write_idx)
          norms.set(normals[idx1] ?? [0, 0, 1], write_idx + 3)
          norms.set(normals[idx2] ?? [0, 0, 1], write_idx + 6)
        } else {
          // Compute face normal as fallback
          const e1: Vec3 = math.subtract(v1, v0)
          const e2: Vec3 = math.subtract(v2, v0)
          const normal = math.cross_3d(e1, e2)
          const len = Math.hypot(...normal)
          const face_norm: Vec3 = len > 1e-10
            ? [normal[0] / len, normal[1] / len, normal[2] / len]
            : [0, 0, 1]
          norms.set(face_norm, write_idx)
          norms.set(face_norm, write_idx + 3)
          norms.set(face_norm, write_idx + 6)
        }
        write_idx += 9
      }
    }

    // Trim if some triangles were skipped due to out-of-bounds indices
    const final_positions = write_idx < positions.length
      ? positions.subarray(0, write_idx)
      : positions
    const final_norms = write_idx < norms.length
      ? norms.subarray(0, write_idx)
      : norms

    const geometry = new BufferGeometry()
    geometry.setAttribute(`position`, new BufferAttribute(final_positions, 3))
    geometry.setAttribute(`normal`, new BufferAttribute(final_norms, 3))
    geometry.computeBoundingSphere()
    return geometry
  }

  // Run marching cubes at the given isovalue
  function extract_surface(isovalue: number): BufferGeometry | null {
    if (!volume || isovalue === 0) return null
    const result = marching_cubes(
      volume.grid,
      isovalue,
      volume.lattice,
      { periodic: true, interpolate: true, centered: false },
    )
    return build_geometry(result.vertices, result.faces, result.normals)
  }

  // Debounced surface extraction: waits 30ms after last change before recomputing.
  // Prevents excessive marching cubes runs during slider drags.
  let positive_geometry = $state<BufferGeometry | null>(null)
  let negative_geometry = $state<BufferGeometry | null>(null)

  // Dispose WebGL geometries on component unmount (no reactive deps → runs once, cleanup on destroy)
  $effect(() => {
    return () => {
      positive_geometry?.dispose()
      negative_geometry?.dispose()
    }
  })

  $effect(() => {
    const iso = settings.isovalue
    const vol = volume
    if (!vol || iso <= 0) {
      positive_geometry?.dispose()
      positive_geometry = null
      return
    }
    const timeout = setTimeout(() => {
      const old = positive_geometry
      positive_geometry = extract_surface(iso)
      old?.dispose()
    }, 30)
    return () => clearTimeout(timeout)
  })

  $effect(() => {
    const iso = settings.isovalue
    const show_neg = settings.show_negative
    const vol = volume
    if (!vol || !show_neg || iso <= 0) {
      negative_geometry?.dispose()
      negative_geometry = null
      return
    }
    const timeout = setTimeout(() => {
      const old = negative_geometry
      negative_geometry = extract_surface(-iso)
      old?.dispose()
    }, 30)
    return () => clearTimeout(timeout)
  })

  let is_transparent = $derived(settings.opacity < 1)
</script>

<!-- Reusable snippet for rendering a single isosurface lobe -->
{#snippet lobe(geometry: BufferGeometry, color: string, base_render_order: number)}
  {#if settings.wireframe}
    <T.Mesh {geometry} frustumCulled={false}>
      <T.MeshBasicMaterial
        {color}
        wireframe
        transparent={is_transparent}
        opacity={settings.opacity}
      />
    </T.Mesh>
  {:else if is_transparent}
    <!-- Two-pass rendering for correct transparency:
         Pass 1 (back faces first, lower renderOrder) then pass 2 (front faces on top).
         Both use depthWrite=false to avoid blocking other transparent objects. -->
    <T.Mesh {geometry} renderOrder={base_render_order} frustumCulled={false}>
      <T.MeshStandardMaterial
        {color}
        transparent
        opacity={settings.opacity}
        side={BackSide}
        depthWrite={false}
        metalness={0.1}
        roughness={0.6}
      />
    </T.Mesh>
    <T.Mesh {geometry} renderOrder={base_render_order + 1} frustumCulled={false}>
      <T.MeshStandardMaterial
        {color}
        transparent
        opacity={settings.opacity}
        side={FrontSide}
        depthWrite={false}
        metalness={0.1}
        roughness={0.6}
      />
    </T.Mesh>
  {:else}
    <!-- Single pass for opaque surfaces -->
    <T.Mesh {geometry} frustumCulled={false}>
      <T.MeshStandardMaterial
        {color}
        side={DoubleSide}
        metalness={0.1}
        roughness={0.6}
      />
    </T.Mesh>
  {/if}
{/snippet}

{#if positive_geometry}
  {@render lobe(positive_geometry, settings.positive_color, 0)}
{/if}

{#if negative_geometry && settings.show_negative}
  {@render lobe(negative_geometry, settings.negative_color, 2)}
{/if}
