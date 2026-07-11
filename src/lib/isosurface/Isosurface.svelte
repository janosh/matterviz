<script lang="ts">
  // Threlte component that renders isosurface meshes from one or more volumetric
  // datasets using marching cubes. Each layer picks a geometry-source volume and
  // optionally a different color-source volume whose scalar field is sampled at
  // surface vertices and mapped through a colormap (e.g. density colored by ESP).
  // Geometry is cached per layer so colormap/color-range changes never rerun
  // marching cubes, and sampled scalars are cached so they only remap through the
  // colormap LUT.
  import { marching_cubes } from '$lib/marching-cubes'
  import type { Matrix3x3, Vec3 } from '$lib/math'
  import { T } from '@threlte/core'
  import { untrack } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import {
    BackSide,
    BufferAttribute,
    BufferGeometry,
    DoubleSide,
    FrontSide,
    Uint32BufferAttribute,
  } from 'three'
  import {
    compute_scalar_range,
    DEFAULT_ISO_COLORMAP,
    is_signed_range,
    scalars_to_vertex_colors,
  } from './coloring'
  import type { DisplayRange } from './sampling'
  import {
    create_volume_sampler,
    extract_volume_range,
    sanitize_display_range,
  } from './sampling'
  import type { IsosurfaceLayer, IsosurfaceSettings, VolumetricData } from './types'
  import {
    DEFAULT_ISOSURFACE_SETTINGS,
    downsample_grid,
    pad_periodic_grid,
    tile_volumetric_data,
  } from './types'

  let {
    volumes = [],
    volume = undefined,
    settings = DEFAULT_ISOSURFACE_SETTINGS,
    active_volume_idx = 0,
    tiling = [1, 1, 1],
  }: {
    volumes?: VolumetricData[]
    // Deprecated single-volume alias (kept for backwards compatibility)
    volume?: VolumetricData
    settings?: IsosurfaceSettings
    // Volume that implicit single-isovalue settings apply to when no explicit
    // layers are set (also the fallback for layers without volume_idx)
    active_volume_idx?: number
    // Supercell tiling applied to geometry volumes (color sampling always uses
    // the original volume with periodic wrapping for full fidelity)
    tiling?: Vec3
  } = $props()

  let all_volumes = $derived(volumes.length ? volumes : volume ? [volume] : [])

  type ResolvedLayer = IsosurfaceLayer & { volume_idx: number }

  // Resolve layers: explicit layers array if provided (an empty array means zero
  // surfaces), else one implicit layer from single-isovalue settings bound to
  // the active volume. Layers with an explicitly out-of-range volume_idx are
  // skipped rather than clamped — silently rendering a different volume's data
  // would be scientifically wrong.
  let resolved_layers = $derived.by((): ResolvedLayer[] => {
    const n_vols = all_volumes.length
    if (n_vols === 0) return []
    const clamp_idx = (idx: number) => Math.min(Math.max(idx, 0), n_vols - 1)
    if (settings.layers) {
      return settings.layers
        .filter(
          (layer) =>
            layer.volume_idx === undefined ||
            (layer.volume_idx >= 0 && layer.volume_idx < n_vols),
        )
        .map((layer) => ({
          ...layer,
          volume_idx: layer.volume_idx ?? clamp_idx(active_volume_idx),
        }))
    }
    return [
      {
        isovalue: settings.isovalue,
        color: settings.positive_color,
        opacity: settings.opacity,
        visible: true,
        show_negative: settings.show_negative,
        negative_color: settings.negative_color,
        volume_idx: clamp_idx(active_volume_idx),
      },
    ]
  })

  // Stable identity tokens for volume objects so cache keys detect replacement
  let vol_id_counter = 0
  const vol_ids = new WeakMap<VolumetricData, number>()
  const vol_id = (vol: VolumetricData): number => {
    let id = vol_ids.get(vol)
    if (id === undefined) {
      id = ++vol_id_counter
      vol_ids.set(vol, id)
    }
    return id
  }

  // Halo only applies to periodic volumes (matches previous behavior)
  const effective_halo = (vol: VolumetricData): number =>
    vol.periodic ? Math.max(0, settings.halo) : 0

  // Fractional display range for this volume (VESTA-style non-integer supercell),
  // expanded by the halo so surfaces can close beyond the requested bounds.
  // Only periodic volumes repeat; null = follow the integer supercell tiling.
  const effective_range = (vol: VolumetricData): DisplayRange | null => {
    if (!settings.display_range || !vol.periodic) return null
    const halo = effective_halo(vol)
    return sanitize_display_range(settings.display_range, true).map(([lo, hi]) => [
      lo - halo,
      hi + halo,
    ]) as DisplayRange
  }

  // === Geometry-volume preparation (tile/range-extract → downsample → halo pad) ===
  type PreparedGrid = {
    tiling_key: string
    halo: number
    range_key: string
    ref_origin_key: string
    grid: number[][][]
    lattice: Matrix3x3
    // Cartesian shift applied to marching-cubes vertices: halo/range offset plus
    // this volume's origin delta relative to the scene reference (first volume's origin)
    vertex_shift: Vec3 | null
  }
  // Keyed by volume object so removed/replaced volumes release their prepared
  // grids to GC automatically and index shifts never serve stale grids
  const prepared_cache = new WeakMap<VolumetricData, PreparedGrid>()

  const range_key = (vol: VolumetricData): string =>
    effective_range(vol)?.flat().join(`,`) ?? ``

  function prepare_geometry_volume(vol: VolumetricData): PreparedGrid {
    const halo = effective_halo(vol)
    const tiling_key = tiling.join(`x`)
    const vol_range_key = range_key(vol)
    const ref_origin = all_volumes[0]?.origin ?? [0, 0, 0]
    const ref_origin_key = ref_origin.join(`,`)
    const cached = prepared_cache.get(vol)
    if (
      cached &&
      cached.tiling_key === tiling_key &&
      cached.halo === halo &&
      cached.range_key === vol_range_key &&
      cached.ref_origin_key === ref_origin_key
    )
      return cached

    // Both branches yield the marching-cubes grid, the lattice spanning it, and
    // the Cartesian position of its corner; the vertex shift falls out uniformly.
    let mc_grid: number[][][]
    let mc_lattice: Matrix3x3
    let origin: Vec3 = vol.origin

    const range = effective_range(vol)
    if (range) {
      // Fractional display range: resample the periodic volume over the range so
      // marching cubes clips exactly at the requested fractional bounds
      ;({ grid: mc_grid, lattice: mc_lattice, origin } = extract_volume_range(vol, range))
    } else {
      const is_unit_tiling = tiling[0] === 1 && tiling[1] === 1 && tiling[2] === 1
      const tiled = is_unit_tiling ? vol : tile_volumetric_data(vol, tiling)
      const ds = downsample_grid(tiled.grid, tiled.grid_dims)

      mc_grid = ds.grid
      mc_lattice = tiled.lattice

      if (halo > 0) {
        const padded = pad_periodic_grid(ds.grid, ds.dims, halo)
        mc_grid = padded.grid
        // marching_cubes maps [0,1] fractional -> Cartesian via lattice. The padded
        // grid covers a wider fractional range, so scale the lattice to match and
        // move the corner origin by the (negative) fractional padding offset.
        const [la, lb, lc] = tiled.lattice
        const scales = padded.dims.map((dim, axis) => dim / ds.dims[axis])
        mc_lattice = [la, lb, lc].map((row, axis) =>
          row.map((comp) => comp * scales[axis]),
        ) as Matrix3x3
        const [ox, oy, oz] = padded.offset
        origin = [
          vol.origin[0] + ox * la[0] + oy * lb[0] + oz * lc[0],
          vol.origin[1] + ox * la[1] + oy * lb[1] + oz * lc[1],
          vol.origin[2] + ox * la[2] + oy * lb[2] + oz * lc[2],
        ]
      }
    }

    const shift: Vec3 = [
      origin[0] - ref_origin[0],
      origin[1] - ref_origin[1],
      origin[2] - ref_origin[2],
    ]
    const has_shift = shift[0] !== 0 || shift[1] !== 0 || shift[2] !== 0
    const prepared: PreparedGrid = {
      tiling_key,
      halo,
      range_key: vol_range_key,
      ref_origin_key,
      grid: mc_grid,
      lattice: mc_lattice,
      vertex_shift: has_shift ? shift : null,
    }
    prepared_cache.set(vol, prepared)
    return prepared
  }

  // Build indexed BufferGeometry from marching cubes output
  function build_geometry(vertices: Vec3[], faces: number[][]): BufferGeometry | null {
    if (vertices.length === 0 || faces.length === 0) return null
    const positions = new Float32Array(vertices.length * 3)
    for (let idx = 0; idx < vertices.length; idx++) {
      const vert = vertices[idx]
      positions[idx * 3] = vert[0]
      positions[idx * 3 + 1] = vert[1]
      positions[idx * 3 + 2] = vert[2]
    }
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

  function extract_surface(isovalue: number, prepared: PreparedGrid): BufferGeometry | null {
    if (isovalue === 0) return null
    const result = marching_cubes(prepared.grid, isovalue, prepared.lattice, {
      periodic: false,
      interpolate: true,
      centered: false,
      normals: false,
    })
    if (prepared.vertex_shift) {
      const [sx, sy, sz] = prepared.vertex_shift
      for (const vert of result.vertices) {
        vert[0] += sx
        vert[1] += sy
        vert[2] += sz
      }
    }
    return build_geometry(result.vertices, result.faces)
  }

  // === Mesh entry management ===
  // Each visible layer produces up to 2 entries (positive + optional negative lobe).
  type MeshEntry = {
    key: string // unique per (layer, sign) — template/each + colored_keys key
    geo_key: string // geometry signature — cache/reuse key
    layer_idx: number
    sign: 1 | -1
    geometry: BufferGeometry
    render_order: number
    // Cached per-vertex scalars from the color-source volume, so colormap and
    // color-range changes only remap through the LUT without resampling
    scalars: Float32Array | null
    scalars_volume_id: number | null
  }
  // $state.raw: entries hold Three.js objects that must not be proxied; the array
  // is replaced wholesale on rebuild so the template stays reactive.
  let active_entries = $state.raw<MeshEntry[]>([])
  // keys of entries that currently carry a vertex-color attribute (drives
  // vertexColors on materials reactively without proxying entries)
  const colored_keys = new SvelteSet<string>()
  let raf_id = 0
  let debounce_id = 0
  let last_geo_sig = ``

  function dispose_all() {
    for (const entry of active_entries) entry.geometry.dispose()
    active_entries = []
    colored_keys.clear()
  }

  // Dispose geometries and cancel pending rebuilds on unmount
  $effect(() => () => {
    clearTimeout(debounce_id)
    cancelAnimationFrame(raf_id)
    dispose_all()
  })

  // Vertices are shifted by (vol.origin − reference origin), so the reference
  // (first volume's origin) is part of the geometry identity too
  const ref_origin_sig = (): string => (all_volumes[0]?.origin ?? [0, 0, 0]).join(`,`)

  const geometry_key = (layer: ResolvedLayer, sign: 1 | -1): string => {
    const vol = all_volumes[layer.volume_idx]
    return `${layer.volume_idx}.${vol ? vol_id(vol) : 0}.${sign * layer.isovalue}.${
      vol ? effective_halo(vol) : 0
    }.${vol ? range_key(vol) : ``}.${tiling.join(`x`)}.${ref_origin_sig()}`
  }

  function rebuild_geometries(layers: ResolvedLayer[]) {
    // Reuse geometries whose signature is unchanged (take-once so duplicate
    // layers at the same isovalue never share a geometry instance)
    const reusable = new Map(active_entries.map((entry) => [entry.geo_key, entry]))
    const entries: MeshEntry[] = []

    for (let layer_idx = 0; layer_idx < layers.length; layer_idx++) {
      const layer = layers[layer_idx]
      const vol = all_volumes[layer.volume_idx]
      if (!vol || !layer.visible || layer.isovalue <= 0) continue

      const signs: (1 | -1)[] = layer.show_negative ? [1, -1] : [1]
      for (const sign of signs) {
        const key = `${layer_idx}:${sign}`
        const geo_key = geometry_key(layer, sign)
        const reused = reusable.get(geo_key)
        if (reused) {
          reusable.delete(geo_key)
          entries.push({ ...reused, key, layer_idx, sign })
          continue
        }
        const geometry = extract_surface(sign * layer.isovalue, prepare_geometry_volume(vol))
        if (!geometry) continue
        entries.push({
          key,
          geo_key,
          layer_idx,
          sign,
          geometry,
          render_order: 0,
          scalars: null,
          scalars_volume_id: null,
        })
      }
    }

    // Render outer shells first so per-entry back/front passes interleave
    // roughly back-to-front. Isovalues from different volumes aren't directly
    // comparable, so rank by isovalue as a fraction of each volume's abs_max.
    const shell_fraction = (entry: MeshEntry): number => {
      const layer = layers[entry.layer_idx]
      const abs_max = all_volumes[layer.volume_idx]?.data_range.abs_max ?? 1
      return layer.isovalue / Math.max(abs_max, 1e-30)
    }
    ;[...entries]
      .sort((entry_a, entry_b) => shell_fraction(entry_a) - shell_fraction(entry_b))
      .forEach((entry, rank) => (entry.render_order = rank * 2))

    // Dispose old geometries that were not reused, then swap in the new list
    const kept = new Set(entries.map((entry) => entry.geometry))
    for (const entry of active_entries) {
      if (!kept.has(entry.geometry)) entry.geometry.dispose()
    }
    // Sync vertex-color flags: reused geometries keep their color attribute;
    // new entries get colored by the color effect after this rebuild
    const now_colored = new Set(
      entries
        .filter((entry) => entry.geometry.getAttribute(`color`))
        .map((entry) => entry.key),
    )
    // Deleting during Set iteration is safe: removed entries are simply skipped
    for (const key of colored_keys) {
      if (!now_colored.has(key)) colored_keys.delete(key)
    }
    for (const key of now_colored) colored_keys.add(key)
    active_entries = entries
  }

  // Rebuild layer geometries when geometry-relevant inputs change. The signature
  // (per-layer geometry_key + lobe flag) deliberately excludes colors, opacity,
  // colormap, and color range so those update without rerunning marching cubes.
  // Debounced for slider drags.
  $effect(() => {
    const layers = resolved_layers
    const geo_sig = layers
      .map((layer) => {
        const vol = all_volumes[layer.volume_idx]
        if (!vol || !layer.visible || layer.isovalue <= 0) return `off`
        return `${geometry_key(layer, 1)}.${layer.show_negative}`
      })
      .join(`|`)

    if (all_volumes.length === 0) {
      last_geo_sig = geo_sig
      // Cancel any pending rebuild — its stale closure would otherwise fire
      // against the emptied (or since-repopulated) volume list
      clearTimeout(debounce_id)
      cancelAnimationFrame(raf_id)
      untrack(() => dispose_all())
      return
    }
    // Skip when nothing geometry-relevant changed (e.g. color-only updates).
    // A pending debounced rebuild stays scheduled — it must not be cancelled by
    // unrelated reruns, so the timer is cleared here rather than in a cleanup.
    if (geo_sig === last_geo_sig) return
    last_geo_sig = geo_sig

    clearTimeout(debounce_id)
    cancelAnimationFrame(raf_id)
    debounce_id = window.setTimeout(() => {
      raf_id = requestAnimationFrame(() => rebuild_geometries(layers))
    }, 50)
  })

  // === Cross-volume vertex coloring ===

  // Samplers cached per volume object (lattice/origin/grid are immutable for a
  // given VolumetricData) so multiple entries coloring from the same volume
  // don't re-invert the lattice matrix
  const sampler_cache = new WeakMap<VolumetricData, (position: Vec3) => number>()
  const volume_sampler = (vol: VolumetricData): ((position: Vec3) => number) => {
    let sample = sampler_cache.get(vol)
    if (!sample) {
      sample = create_volume_sampler(vol, {
        out_of_bounds: vol.periodic ? `clamp` : `fallback`,
      })
      sampler_cache.set(vol, sample)
    }
    return sample
  }

  // Sample the color volume at this entry's vertices. Vertices are in the scene
  // frame (first volume's origin at the grid corner), so shift back to absolute
  // Cartesian coordinates before sampling.
  function sample_entry_scalars(entry: MeshEntry, color_vol: VolumetricData): Float32Array {
    const positions = entry.geometry.getAttribute(`position`).array as Float32Array
    const [ref_x, ref_y, ref_z] = all_volumes[0]?.origin ?? [0, 0, 0]
    const sample = volume_sampler(color_vol)
    const n_verts = positions.length / 3
    const scalars = new Float32Array(n_verts)
    const pos: Vec3 = [0, 0, 0]
    for (let idx = 0; idx < n_verts; idx++) {
      pos[0] = positions[idx * 3] + ref_x
      pos[1] = positions[idx * 3 + 1] + ref_y
      pos[2] = positions[idx * 3 + 2] + ref_z
      scalars[idx] = sample(pos)
    }
    return scalars
  }

  // The layer's scalar-color-source volume, if any
  const color_vol_of = (layer: IsosurfaceLayer | undefined): VolumetricData | undefined =>
    layer?.color_volume_idx != null ? all_volumes[layer.color_volume_idx] : undefined

  function apply_vertex_colors(entries: MeshEntry[], layers: ResolvedLayer[]) {
    // First pass: (re)sample scalars for entries with a color source
    for (const entry of entries) {
      const layer = layers[entry.layer_idx]
      const color_vol = color_vol_of(layer)
      if (!layer || !color_vol) {
        if (entry.geometry.getAttribute(`color`)) entry.geometry.deleteAttribute(`color`)
        entry.scalars = null
        entry.scalars_volume_id = null
        colored_keys.delete(entry.key)
        continue
      }
      const color_vol_id = vol_id(color_vol)
      if (!entry.scalars || entry.scalars_volume_id !== color_vol_id) {
        entry.scalars = sample_entry_scalars(entry, color_vol)
        entry.scalars_volume_id = color_vol_id
      }
    }

    // Default color range per layer: fit to the scalars actually present on that
    // layer's surfaces (both lobes) — whole-volume ranges are dominated by
    // extremes near nuclei that the surface never touches. Signed source fields
    // keep a symmetric range so diverging colormaps stay centered on zero.
    const auto_ranges = new Map<number, [number, number]>()
    for (const entry of entries) {
      const layer = layers[entry.layer_idx]
      if (!layer || layer.color_range || !entry.scalars) continue
      if (auto_ranges.has(entry.layer_idx)) continue
      const layer_scalars = entries
        .filter((other) => other.layer_idx === entry.layer_idx && other.scalars)
        .map((other) => other.scalars as Float32Array)
      const color_vol = color_vol_of(layer)
      auto_ranges.set(
        entry.layer_idx,
        compute_scalar_range(layer_scalars, {
          symmetric: color_vol ? is_signed_range(color_vol.data_range) : false,
        }),
      )
    }

    // Second pass: map scalars through the colormap LUT, reusing the existing
    // color attribute's array where possible to avoid GPU buffer churn
    for (const entry of entries) {
      const layer = layers[entry.layer_idx]
      if (!layer || !entry.scalars) continue
      const color_range = layer.color_range ?? auto_ranges.get(entry.layer_idx) ?? [0, 1]
      const existing = entry.geometry.getAttribute(`color`) as BufferAttribute | undefined
      const colors = scalars_to_vertex_colors(
        entry.scalars,
        {
          colormap: layer.colormap ?? DEFAULT_ISO_COLORMAP,
          color_range,
          fallback_color: entry.sign > 0 ? layer.color : layer.negative_color,
        },
        existing?.array instanceof Float32Array ? existing.array : undefined,
      )
      if (existing && existing.array === colors) existing.needsUpdate = true
      else entry.geometry.setAttribute(`color`, new BufferAttribute(colors, 3))
      colored_keys.add(entry.key)
    }
  }

  // Apply/refresh vertex colors when entries or color-relevant layer props change.
  // The signature includes the color-source volume identity (so replacing a color
  // volume in place resamples) but excludes geometry fields like isovalue and
  // opacity, so e.g. isovalue slider drags don't remap colors on every tick.
  let last_color_sig = ``
  let last_colored_entries: MeshEntry[] = []
  $effect(() => {
    const entries = active_entries
    const layers = resolved_layers
    const color_sig = layers
      .map((layer) => {
        const color_vol = color_vol_of(layer)
        return [
          layer.color_volume_idx ?? ``,
          color_vol ? vol_id(color_vol) : ``,
          layer.colormap ?? ``,
          layer.color_range?.join(`,`) ?? ``,
          layer.color,
          layer.negative_color,
        ].join(`.`)
      })
      .join(`|`)
    if (entries === last_colored_entries && color_sig === last_color_sig) return
    last_colored_entries = entries
    last_color_sig = color_sig
    untrack(() => apply_vertex_colors(entries, layers))
  })
</script>

<!-- Render each mesh entry; material props react to layer changes without geometry rebuilds -->
{#each active_entries as entry (entry.key)}
  {@const layer = resolved_layers[entry.layer_idx]}
  {#if layer}
    {@const vertex_colored = colored_keys.has(entry.key)}
    {@const color = vertex_colored
      ? `#ffffff`
      : entry.sign > 0
        ? layer.color
        : layer.negative_color}
    {@const opacity = layer.opacity}
    {@const transparent = opacity < 1}
    <!-- Recreate materials when vertexColors toggles (needs shader recompile) -->
    {#key vertex_colored}
      {#if settings.wireframe}
        <T.Mesh geometry={entry.geometry} frustumCulled={false}>
          <T.MeshBasicMaterial
            {color}
            vertexColors={vertex_colored}
            wireframe
            {transparent}
            {opacity}
          />
        </T.Mesh>
      {:else}
        <!-- Transparent surfaces render back then front faces in two passes for
          correct blending; opaque surfaces need a single double-sided pass -->
        {#each transparent ? [BackSide, FrontSide] : [DoubleSide] as side, pass_idx (side)}
          <T.Mesh
            geometry={entry.geometry}
            renderOrder={entry.render_order + pass_idx}
            frustumCulled={false}
          >
            <T.MeshStandardMaterial
              {color}
              vertexColors={vertex_colored}
              {transparent}
              {opacity}
              {side}
              depthWrite={!transparent}
              metalness={0.1}
              roughness={0.6}
            />
          </T.Mesh>
        {/each}
      {/if}
    {/key}
  {/if}
{/each}
