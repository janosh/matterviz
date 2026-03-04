<script lang="ts">
  // Threlte component that renders isosurface meshes from volumetric data using marching cubes.
  // Supports multiple layers at different isovalues with independent colors,
  // plus positive/negative lobes and two-pass transparency.
  import { marching_cubes } from '$lib/marching-cubes'
  import type { Matrix3x3, Vec3 } from '$lib/math'
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
  import {
    DEFAULT_ISOSURFACE_SETTINGS,
    downsample_grid,
    pad_periodic_grid,
  } from './types'

  let { volume, settings = DEFAULT_ISOSURFACE_SETTINGS }: {
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

  // Run marching cubes at the given isovalue with pre-prepared grid/lattice/shift.
  function extract_surface(
    isovalue: number,
    mc_grid: number[][][],
    mc_lattice: Matrix3x3,
    origin_shift: Vec3 | null,
  ): BufferGeometry | null {
    if (isovalue === 0) return null

    const result = marching_cubes(mc_grid, isovalue, mc_lattice, {
      periodic: false,
      interpolate: true,
      centered: false,
      normals: false,
    })

    if (origin_shift) {
      for (const vert of result.vertices) {
        vert[0] += origin_shift[0]
        vert[1] += origin_shift[1]
        vert[2] += origin_shift[2]
      }
    }

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
    if (!volume || !ds_result) return
    const old = active_geometries
    const entries: GeoEntry[] = []

    // Prepare grid/lattice/shift once for all layers.
    // When halo > 0 for periodic volumes, the downsampled grid is padded with
    // halo cells from the opposite face so isosurfaces extend beyond the unit
    // cell and close into complete enclosed shapes around boundary atoms.
    let mc_grid = ds_result.grid
    let mc_lattice: Matrix3x3 = volume.lattice
    let origin_shift: Vec3 | null = null

    if (settings.halo > 0 && volume.periodic) {
      const padded = pad_periodic_grid(ds_result.grid, ds_result.dims, settings.halo)
      mc_grid = padded.grid
      // marching_cubes maps [0,1] fractional -> Cartesian via lattice.
      // The padded grid covers a wider fractional range, so scale the lattice
      // to match. Then shift all vertices by the fractional offset.
      const [la, lb, lc] = volume.lattice
      const sx = padded.dims[0] / ds_result.dims[0]
      const sy = padded.dims[1] / ds_result.dims[1]
      const sz = padded.dims[2] / ds_result.dims[2]
      mc_lattice = [
        [la[0] * sx, la[1] * sx, la[2] * sx],
        [lb[0] * sy, lb[1] * sy, lb[2] * sy],
        [lc[0] * sz, lc[1] * sz, lc[2] * sz],
      ]
      const [ox, oy, oz] = padded.offset
      origin_shift = [
        ox * la[0] + oy * lb[0] + oz * lc[0],
        ox * la[1] + oy * lb[1] + oz * lc[1],
        ox * la[2] + oy * lb[2] + oz * lc[2],
      ]
    }

    const surface_at = (isovalue: number) =>
      extract_surface(isovalue, mc_grid, mc_lattice, origin_shift)

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

      const pos_geo = surface_at(layer.isovalue)
      if (pos_geo) {
        entries.push({
          geometry: pos_geo,
          color: layer.color,
          opacity: layer.opacity,
          render_order: base_order,
        })
      }

      if (layer.show_negative) {
        const neg_geo = surface_at(-layer.isovalue)
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
    void settings.halo
    if (!ds_result) {
      dispose_all()
      return
    }
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
