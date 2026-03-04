<script lang="ts">
  // Threlte component that renders isosurface meshes from volumetric data using marching cubes.
  // Supports multiple layers at different isovalues with independent colors,
  // plus positive/negative lobes and two-pass transparency.
  import { marching_cubes } from '$lib/marching-cubes'
  import type { Vec3 } from '$lib/math'
  import { T } from '@threlte/core'
  import {
    BackSide,
    BufferAttribute,
    BufferGeometry,
    DoubleSide,
    FrontSide,
    Uint32BufferAttribute,
  } from 'three'
  import type { IsosurfaceLayer, IsosurfaceSettings, VolumetricData } from './types'
  import { DEFAULT_ISOSURFACE_SETTINGS, downsample_grid } from './types'

  let {
    volume,
    settings = DEFAULT_ISOSURFACE_SETTINGS,
  }: {
    volume: VolumetricData
    settings?: IsosurfaceSettings
  } = $props()

  // Resolve layers: use explicit layers array if provided, else build from single-isovalue settings
  let resolved_layers = $derived.by((): IsosurfaceLayer[] => {
    if (settings.layers?.length) return settings.layers
    return [{
      isovalue: settings.isovalue,
      color: settings.positive_color,
      opacity: settings.opacity,
      visible: true,
      show_negative: settings.show_negative,
      negative_color: settings.negative_color,
    }]
  })

  // Build indexed BufferGeometry from marching cubes output.
  // Uses Three.js index buffer to avoid tripling vertex data, and
  // computeVertexNormals() for fast GPU-friendly normals.
  function build_geometry(
    vertices: Vec3[],
    faces: number[][],
  ): BufferGeometry | null {
    if (vertices.length === 0 || faces.length === 0) return null

    // Flatten vertices: Vec3[] → Float32Array
    const positions = new Float32Array(vertices.length * 3)
    for (let idx = 0; idx < vertices.length; idx++) {
      const vert = vertices[idx]
      positions[idx * 3] = vert[0]
      positions[idx * 3 + 1] = vert[1]
      positions[idx * 3 + 2] = vert[2]
    }

    // Flatten face indices: number[][] → Uint32Array
    const indices = new Uint32Array(faces.length * 3)
    for (let idx = 0; idx < faces.length; idx++) {
      const face = faces[idx]
      indices[idx * 3] = face[0]
      indices[idx * 3 + 1] = face[1]
      indices[idx * 3 + 2] = face[2]
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute(`position`, new BufferAttribute(positions, 3))
    geometry.setIndex(new Uint32BufferAttribute(indices, 1))
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    return geometry
  }

  // Downsample large grids once when volume changes to keep marching cubes interactive
  let ds_result = $derived.by(() => {
    if (!volume) return undefined
    return downsample_grid(volume.grid, volume.grid_dims)
  })

  // Run marching cubes at the given isovalue.
  // Always use periodic=false so the isosurface is clipped at cell boundaries
  // (matching VESTA behavior). With periodic=true, marching cubes wraps the last
  // grid layer back to the first, creating triangles that span the full cell.
  function extract_surface(isovalue: number): BufferGeometry | null {
    if (!volume || !ds_result || isovalue === 0) return null
    const result = marching_cubes(
      ds_result.grid,
      isovalue,
      volume.lattice,
      { periodic: false, interpolate: true, centered: false, normals: false },
    )
    return build_geometry(result.vertices, result.faces)
  }

  // === Multi-layer geometry management ===
  // Each layer produces up to 2 geometries (positive + optional negative lobe).
  // Keyed by "layer_idx:sign" for cache invalidation.
  type GeoEntry = {
    geometry: BufferGeometry
    color: string
    opacity: number
    render_order: number
  }
  let active_geometries = $state<GeoEntry[]>([])
  let raf_id = 0
  let debounce_id = 0

  // Dispose all current geometries
  function dispose_all() {
    for (const entry of active_geometries) entry.geometry.dispose()
    active_geometries = []
  }

  // Dispose on unmount
  $effect(() => () => dispose_all())

  function rebuild_geometries(layers: IsosurfaceLayer[]) {
    const old = active_geometries
    const entries: GeoEntry[] = []
    // Render lower-isovalue (outer) shells earlier so per-layer back/front passes
    // interleave back-to-front across shells and reduce transparency artefacts.
    const layer_render_rank = new Map<number, number>(
      layers
        .map((layer, layer_idx) => ({ layer_idx, isovalue: layer.isovalue }))
        .sort((layer_a, layer_b) => layer_a.isovalue - layer_b.isovalue)
        .map(({ layer_idx }, rank) => [layer_idx, rank]),
    )

    for (let layer_idx = 0; layer_idx < layers.length; layer_idx++) {
      const layer = layers[layer_idx]
      if (!layer.visible || layer.isovalue <= 0) continue

      // Each layer gets 4 slots (positive back/front + negative back/front).
      const base_order = (layer_render_rank.get(layer_idx) ?? layer_idx) * 4

      const pos_geo = extract_surface(layer.isovalue)
      if (pos_geo) {
        entries.push({
          geometry: pos_geo,
          color: layer.color,
          opacity: layer.opacity,
          render_order: base_order,
        })
      }

      if (layer.show_negative) {
        const neg_geo = extract_surface(-layer.isovalue)
        if (neg_geo) {
          entries.push({
            geometry: neg_geo,
            color: layer.negative_color,
            opacity: layer.opacity,
            render_order: base_order + 2,
          })
        }
      }
    }

    active_geometries = entries
    for (const entry of old) entry.geometry.dispose()
  }

  // Rebuild all layer geometries when layers or volume change.
  // Debounces rapid changes (e.g. slider drags) to avoid repeated expensive marching cubes.
  $effect(() => {
    const layers = resolved_layers
    if (!ds_result) {
      dispose_all()
      return
    }
    clearTimeout(debounce_id)
    cancelAnimationFrame(raf_id)
    debounce_id = window.setTimeout(() => {
      raf_id = requestAnimationFrame(() => rebuild_geometries(layers))
    }, 50)
    return () => {
      clearTimeout(debounce_id)
      cancelAnimationFrame(raf_id)
    }
  })
</script>

<!-- Render each geometry entry with appropriate material -->
{#each active_geometries as entry (entry)}
  {#if settings.wireframe}
    <T.Mesh geometry={entry.geometry} frustumCulled={false}>
      <T.MeshBasicMaterial
        color={entry.color}
        wireframe
        transparent={entry.opacity < 1}
        opacity={entry.opacity}
      />
    </T.Mesh>
  {:else if entry.opacity < 1}
    <!-- Two-pass rendering for correct transparency -->
    <T.Mesh
      geometry={entry.geometry}
      renderOrder={entry.render_order}
      frustumCulled={false}
    >
      <T.MeshStandardMaterial
        color={entry.color}
        transparent
        opacity={entry.opacity}
        side={BackSide}
        depthWrite={false}
        metalness={0.1}
        roughness={0.6}
      />
    </T.Mesh>
    <T.Mesh
      geometry={entry.geometry}
      renderOrder={entry.render_order + 1}
      frustumCulled={false}
    >
      <T.MeshStandardMaterial
        color={entry.color}
        transparent
        opacity={entry.opacity}
        side={FrontSide}
        depthWrite={false}
        metalness={0.1}
        roughness={0.6}
      />
    </T.Mesh>
  {:else}
    <T.Mesh geometry={entry.geometry} frustumCulled={false}>
      <T.MeshStandardMaterial
        color={entry.color}
        side={DoubleSide}
        metalness={0.1}
        roughness={0.6}
      />
    </T.Mesh>
  {/if}
{/each}
