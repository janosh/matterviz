<script lang="ts">
  // Threlte component that renders isosurface meshes from one or more volumetric
  // datasets using marching cubes. Each layer picks a geometry-source volume and
  // optionally a different color-source volume whose scalar field is sampled at
  // surface vertices and mapped through a colormap (e.g. density colored by ESP).
  // Geometry is cached per layer so colormap/color-range changes never rerun
  // marching cubes, and sampled scalars are cached so they only remap through the
  // colormap LUT.
  import type { Matrix3x3, Vec3 } from '../math'
  import { to_error } from '../utils'
  import { T, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import {
    BackSide,
    BufferAttribute,
    BufferGeometry,
    DoubleSide,
    FrontSide,
    Uint32BufferAttribute,
  } from 'three/webgpu'
  import {
    compute_scalar_range,
    DEFAULT_ISO_COLORMAP,
    is_signed_range,
    scalars_to_vertex_colors,
  } from './coloring'
  import { compute_geometries_async } from './async-geometry.svelte'
  import {
    compute_isosurface_geometries,
    type GeometryResult,
    type GeometryVolumeJob,
  } from './geometry'
  import type { ScalarGrid3D } from './grid'
  import { record_stage, time_stage } from './profile'
  import type { DisplayRange } from './sampling'
  import { resolve_volume_display_range, sample_volume_at_positions } from './sampling'
  import type { IsosurfaceLayer, IsosurfaceSettings, VolumetricData } from './types'
  import { DEFAULT_ISOSURFACE_SETTINGS, MAX_GRID_POINTS, pin_layers } from './types'

  let {
    volumes = [],
    settings = DEFAULT_ISOSURFACE_SETTINGS,
    active_volume_idx = 0,
    tiling = [1, 1, 1],
    on_error,
  }: {
    volumes?: VolumetricData[]
    settings?: IsosurfaceSettings
    // Volume that layers without an explicit volume_idx render from
    active_volume_idx?: number
    // Supercell tiling applied to geometry volumes (color sampling always uses
    // the original volume with periodic wrapping for full fidelity)
    tiling?: Vec3
    // Called when the geometry worker fails after construction (chunk 404, OOM, module
    // import failure) so the host can tell the user why the surfaces did not update. A
    // worker that cannot be constructed at all falls back to the main thread silently.
    on_error?: (message: string) => void
  } = $props()

  // Geometry and colour updates mutate three objects in place (setAttribute, needsUpdate),
  // which bypasses the <T> props Threlte watches, so under the hosts' on-demand render mode
  // nothing would repaint until the next orbit without an explicit invalidate
  const threlte = useThrelte()

  let reference_origin = $derived<Vec3>(volumes[0]?.origin ?? [0, 0, 0])
  let reference_origin_key = $derived(reference_origin.join(`,`))

  type ResolvedLayer = ReturnType<typeof pin_layers>[number]

  // Layers pinned to the (clamped) active volume. Layers with an explicitly out-of-range
  // volume_idx are skipped rather than clamped — silently rendering a different volume's
  // data would be scientifically wrong.
  let resolved_layers = $derived.by((): ResolvedLayer[] => {
    const n_vols = volumes.length
    if (n_vols === 0) return []
    const active_idx = Math.min(Math.max(active_volume_idx, 0), n_vols - 1)
    return pin_layers(settings.layers, active_idx).filter(
      (layer) => layer.volume_idx >= 0 && layer.volume_idx < n_vols,
    )
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

  // Finite extraction range for this volume. Periodic volumes always use one
  // so integer tiling and fractional VESTA-style bounds share exact endpoint
  // semantics; finite volumes only use an explicitly requested crop (the
  // resolver clamps negative halo and only applies it to periodic volumes).
  const effective_range = (vol: VolumetricData): DisplayRange | null =>
    resolve_volume_display_range(vol, {
      display_range: settings.display_range,
      tiling,
      halo: settings.halo,
    })

  // === Prepared geometry grids ===
  // The finite marching-cubes grid of a volume (range extraction or budget downsampling),
  // cached per volume object so isovalue changes reuse it. The range fully determines it:
  // it encodes tiling and halo for periodic volumes and is null/explicit-crop for finite
  // ones (which ignore tiling and halo entirely).
  type PreparedGrid = {
    key: string
    grid: ScalarGrid3D<Float64Array>
    lattice: Matrix3x3
    origin: Vec3
  }
  // Keyed by volume object so removed/replaced volumes release their prepared
  // grids to GC automatically and index shifts never serve stale grids
  const prepared_cache = new WeakMap<VolumetricData, PreparedGrid>()

  const range_key = (vol: VolumetricData): string =>
    effective_range(vol)?.flat().join(`,`) ?? ``

  const prepared_key = (vol: VolumetricData): string =>
    `${range_key(vol)}|${reference_origin_key}`

  const current_prepared = (vol: VolumetricData): PreparedGrid | undefined => {
    const cached = prepared_cache.get(vol)
    return cached?.key === prepared_key(vol) ? cached : undefined
  }

  const geometry_buffer_bytes = (geometry: BufferGeometry): number =>
    [`position`, `normal`, `color`].reduce(
      (total, name) => total + (geometry.getAttribute(name)?.array.byteLength ?? 0),
      geometry.getIndex()?.array.byteLength ?? 0,
    )

  // Build an indexed BufferGeometry from marching-cubes output (null for empty surfaces)
  const build_geometry = (
    positions: Float32Array,
    indices: Uint32Array,
  ): BufferGeometry | null =>
    time_stage(
      `build_geometry`,
      () => {
        if (positions.length === 0 || indices.length === 0) return null
        const geometry = new BufferGeometry()
        geometry.setAttribute(`position`, new BufferAttribute(positions, 3))
        geometry.setIndex(new Uint32BufferAttribute(indices, 1))
        geometry.computeVertexNormals()
        geometry.computeBoundingSphere()
        return geometry
      },
      (geometry) => ({ buffer_bytes: geometry ? geometry_buffer_bytes(geometry) : 0 }),
    )

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
  let rebuild_generation = 0
  // Aborting rejects this component's pending worker request; the shared client tears the
  // worker down once no caller awaits it, so a superseded extraction stops burning CPU
  let geometry_abort: AbortController | undefined

  function cancel_geometry_worker(): void {
    geometry_abort?.abort(new Error(`Isosurface geometry job superseded`))
    geometry_abort = undefined
  }

  function dispose_all() {
    for (const entry of active_entries) entry.geometry.dispose()
    active_entries = []
    colored_keys.clear()
  }

  // Dispose geometries and cancel pending rebuilds on unmount
  $effect(() => () => {
    rebuild_generation++
    clearTimeout(debounce_id)
    cancelAnimationFrame(raf_id)
    cancel_geometry_worker()
    dispose_all()
  })

  // range_key covers halo + tiling (encoded in the range for periodic volumes;
  // irrelevant for finite ones), so the geometry identity needs no other inputs
  const geometry_key = (layer: ResolvedLayer, sign: 1 | -1): string => {
    const vol = volumes[layer.volume_idx]
    return JSON.stringify([
      layer.volume_idx,
      vol ? vol_id(vol) : 0,
      sign * layer.isovalue,
      vol ? range_key(vol) : ``,
      reference_origin_key,
    ])
  }

  type PendingSurface = Pick<MeshEntry, `key` | `geo_key` | `layer_idx` | `sign`> & {
    isovalue: number
    volume: VolumetricData
  }

  const estimated_prepared_points = (vol: VolumetricData): number => {
    const range = effective_range(vol)
    if (!range) return Math.min(vol.values.length, MAX_GRID_POINTS)
    const estimate = range.reduce((total, [lower, upper], axis) => {
      const intervals = vol.periodic ? vol.dims[axis] : Math.max(vol.dims[axis] - 1, 1)
      return total * Math.max(2, Math.round((upper - lower) * intervals) + 1)
    }, 1)
    return Math.min(estimate, MAX_GRID_POINTS)
  }

  // Large grids that still need preparing go to the geometry worker; small ones and
  // already-prepared grids are cheaper on the main thread than a round trip
  const use_geometry_worker = (pending: PendingSurface[]): boolean =>
    typeof window !== `undefined` &&
    typeof Worker !== `undefined` &&
    pending.some(
      (surface) =>
        !current_prepared(surface.volume) &&
        estimated_prepared_points(surface.volume) >= 200_000,
    )

  // One job per volume. A volume whose prepared grid is still valid is posted as that finite
  // grid with no range, which prepare_geometry_grid passes through untouched, so only new or
  // invalidated volumes are re-extracted/downsampled.
  const geometry_jobs = (pending: PendingSurface[]): GeometryVolumeJob[] =>
    [...Map.groupBy(pending, (surface) => surface.volume)].map(([vol, surfaces]) => {
      const prepared = current_prepared(vol)
      return {
        token: vol_id(vol),
        volume: prepared
          ? {
              values: prepared.grid.values,
              dims: prepared.grid.dims,
              order: `z_fastest`,
              lattice: prepared.lattice,
              origin: prepared.origin,
              periodic: false,
            }
          : vol,
        range: prepared ? null : effective_range(vol),
        reference_origin,
        surfaces: surfaces.map(({ key, isovalue }) => ({ token: key, isovalue })),
      }
    })

  // Cache prepared grids and build geometries from one geometry result (worker or sync)
  function ingest_geometry_result(
    response: GeometryResult,
    pending: PendingSurface[],
    worker: boolean,
  ): Map<string, BufferGeometry> {
    const geometries = new Map<string, BufferGeometry>()
    for (const volume_result of response.volumes) {
      const source_volume = pending.find(
        (surface) => vol_id(surface.volume) === volume_result.token,
      )?.volume
      if (source_volume) {
        prepared_cache.set(source_volume, {
          key: prepared_key(source_volume),
          grid: volume_result.grid,
          lattice: volume_result.lattice,
          origin: volume_result.origin,
        })
      }
      record_stage(`prepare_geometry`, volume_result.prepare_geometry_ms, {
        worker,
        output_points: volume_result.grid.values.length,
      })
      for (const surface_result of volume_result.surfaces) {
        record_stage(`marching_cubes`, surface_result.marching_cubes_ms, {
          worker,
          vertices: surface_result.positions.length / 3,
        })
        const geometry = build_geometry(surface_result.positions, surface_result.indices)
        if (geometry) geometries.set(surface_result.token, geometry)
      }
    }
    return geometries
  }

  async function rebuild_geometries(
    layers: ResolvedLayer[],
    generation: number,
  ): Promise<void> {
    const profile_start = performance.now()
    let cache_hits = 0
    // Reuse geometries whose signature is unchanged (take-once so duplicate
    // layers at the same isovalue never share a geometry instance)
    const reusable = new Map(active_entries.map((entry) => [entry.geo_key, entry]))
    const plans: (MeshEntry | PendingSurface)[] = []
    const pending: PendingSurface[] = []

    for (const [layer_idx, layer] of layers.entries()) {
      const vol = volumes[layer.volume_idx]
      if (!vol || !layer.visible || layer.isovalue <= 0) continue

      for (const sign of layer.show_negative ? ([1, -1] as const) : ([1] as const)) {
        const key = `${layer_idx}:${sign}`
        const geo_key = geometry_key(layer, sign)
        const reused = reusable.get(geo_key)
        if (reused) {
          cache_hits++
          reusable.delete(geo_key)
          // Keep only the cached geometry + scalars; key/layer_idx/sign are
          // rebound to the CURRENT loop values (they override the spread)
          plans.push({ ...reused, key, layer_idx, sign })
        } else {
          const surface = {
            key,
            geo_key,
            layer_idx,
            sign,
            isovalue: sign * layer.isovalue,
            volume: vol,
          }
          pending.push(surface)
          plans.push(surface)
        }
      }
    }

    let geometries = new Map<string, BufferGeometry>()
    const jobs = geometry_jobs(pending)
    if (use_geometry_worker(pending)) {
      cancel_geometry_worker()
      const abort = new AbortController()
      geometry_abort = abort
      try {
        const response = await compute_geometries_async(
          { volumes: jobs },
          { signal: abort.signal },
        )
        if (generation !== rebuild_generation) return
        geometries = ingest_geometry_result(response, pending, true)
      } catch (error) {
        if (generation !== rebuild_generation || abort.signal.aborted) return
        console.error(`Isosurface geometry worker failed; keeping previous surfaces`, error)
        on_error?.(`Isosurface geometry failed: ${to_error(error).message}`)
        return
      } finally {
        if (geometry_abort === abort) geometry_abort = undefined
      }
    } else if (jobs.length > 0) {
      geometries = ingest_geometry_result(
        compute_isosurface_geometries({ volumes: jobs }),
        pending,
        false,
      )
    }

    if (generation !== rebuild_generation) {
      for (const geometry of geometries.values()) geometry.dispose()
      return
    }
    // Render outer shells first so per-entry back/front passes interleave
    // roughly back-to-front. Isovalues from different volumes aren't directly
    // comparable, so rank by isovalue as a fraction of each volume's abs_max.
    const shell_fraction = (entry: MeshEntry): number => {
      const layer = layers[entry.layer_idx]
      const abs_max = volumes[layer.volume_idx]?.data_range.abs_max ?? 1
      return layer.isovalue / Math.max(abs_max, 1e-30)
    }
    const entries = plans
      .flatMap((plan): MeshEntry[] => {
        if (`geometry` in plan) return [plan]
        const geometry = geometries.get(plan.key)
        if (!geometry) return []
        const { key, geo_key, layer_idx, sign } = plan
        return [
          {
            key,
            geo_key,
            layer_idx,
            sign,
            geometry,
            render_order: 0,
            scalars: null,
            scalars_volume_id: null,
          },
        ]
      })
      .toSorted((entry_a, entry_b) => shell_fraction(entry_a) - shell_fraction(entry_b))
    entries.forEach((entry, rank) => (entry.render_order = rank * 2))

    // Dispose old geometries that were not reused, then swap in the new list
    const kept = new Set(entries.map((entry) => entry.geometry))
    for (const entry of active_entries) {
      if (!kept.has(entry.geometry)) entry.geometry.dispose()
    }
    // Sync vertex-color flags: reused geometries keep their color attribute;
    // new entries get colored by the color effect after this rebuild
    colored_keys.clear()
    for (const entry of entries) {
      if (entry.geometry.getAttribute(`color`)) colored_keys.add(entry.key)
    }
    active_entries = entries
    let [vertices, triangles, buffer_bytes] = [0, 0, 0]
    for (const entry of entries) {
      vertices += entry.geometry.getAttribute(`position`).count
      triangles += (entry.geometry.getIndex()?.count ?? 0) / 3
      buffer_bytes += geometry_buffer_bytes(entry.geometry)
    }
    record_stage(`rebuild_total`, performance.now() - profile_start, {
      entries: entries.length,
      cache_hits,
      vertices,
      triangles,
      buffer_bytes,
    })
    threlte.invalidate()
  }

  // Geometry-relevant inputs as a string: $derived strings only notify
  // dependents when the value changes, so the rebuild effect below skips
  // color-only updates (colors, opacity, colormap, range are excluded here)
  // without any manual last-signature bookkeeping.
  let geo_sig = $derived(
    resolved_layers
      .map((layer) => {
        const vol = volumes[layer.volume_idx]
        if (!vol || !layer.visible || layer.isovalue <= 0) return `off`
        return `${geometry_key(layer, 1)}.${layer.show_negative}`
      })
      .join(`|`),
  )

  // Rebuild layer geometries when the geometry signature changes (debounced for
  // slider drags). The rAF callback reads resolved_layers fresh, so a rebuild
  // scheduled by an earlier signature still sees the latest layer props.
  $effect(() => {
    void geo_sig
    const generation = ++rebuild_generation
    clearTimeout(debounce_id)
    cancelAnimationFrame(raf_id)
    cancel_geometry_worker()
    if (untrack(() => volumes.length) === 0) {
      untrack(() => dispose_all())
      return
    }
    debounce_id = window.setTimeout(() => {
      // No reactive context inside rAF: reads the freshest layers untracked
      raf_id = requestAnimationFrame(() => {
        void rebuild_geometries(resolved_layers, generation)
      })
    }, 50)
  })

  // === Cross-volume vertex coloring ===

  // Sample the color volume at this entry's vertices. Vertices are in the scene
  // frame (first volume's origin at the grid corner), so shift back to absolute
  // Cartesian coordinates before sampling. The bulk kernel caches each volume's
  // inverse lattice and avoids per-vertex closures or temporary position arrays.
  const sample_entry_scalars = (entry: MeshEntry, color_vol: VolumetricData): Float32Array =>
    time_stage(`sample_scalars`, () => {
      const positions = entry.geometry.getAttribute(`position`).array as Float32Array
      return sample_volume_at_positions(color_vol, positions, {
        out_of_bounds: color_vol.periodic ? `clamp` : `fallback`,
        position_offset: reference_origin,
        out: entry.scalars ?? undefined,
      })
    })

  // The layer's scalar-color-source volume, if any
  const color_vol_of = (layer: IsosurfaceLayer | undefined): VolumetricData | undefined =>
    layer?.color_volume_idx != null ? volumes[layer.color_volume_idx] : undefined

  function apply_vertex_colors(entries: MeshEntry[], layers: ResolvedLayer[]) {
    const profile_start = performance.now()
    const auto_scalars = new Map<number, Float32Array[]>()
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
      if (!layer.color_range) {
        const scalars = auto_scalars.get(entry.layer_idx) ?? []
        scalars.push(entry.scalars)
        auto_scalars.set(entry.layer_idx, scalars)
      }
    }

    // Default color range per layer: fit to the scalars actually present on that
    // layer's surfaces (both lobes) — whole-volume ranges are dominated by
    // extremes near nuclei that the surface never touches. Signed source fields
    // keep a symmetric range so diverging colormaps stay centered on zero.
    const auto_ranges = new Map<number, [number, number]>()
    for (const [layer_idx, layer_scalars] of auto_scalars) {
      const layer = layers[layer_idx]
      const color_vol = color_vol_of(layer)
      auto_ranges.set(
        layer_idx,
        time_stage(`scalar_range`, () =>
          compute_scalar_range(layer_scalars, {
            symmetric: color_vol && is_signed_range(color_vol.data_range) ? true : `auto`,
          }),
        ),
      )
    }

    // Second pass: map scalars through the colormap LUT, reusing the existing
    // color attribute's array where possible to avoid GPU buffer churn
    for (const entry of entries) {
      const layer = layers[entry.layer_idx]
      if (!layer || !entry.scalars) continue
      const color_range = layer.color_range ?? auto_ranges.get(entry.layer_idx) ?? [0, 1]
      const existing = entry.geometry.getAttribute(`color`) as BufferAttribute | undefined
      const colors = time_stage(`apply_colormap`, () =>
        scalars_to_vertex_colors(
          entry.scalars as Float32Array,
          {
            colormap: layer.colormap ?? DEFAULT_ISO_COLORMAP,
            color_range,
            fallback_color: entry.sign > 0 ? layer.color : layer.negative_color,
          },
          existing?.array instanceof Float32Array ? existing.array : undefined,
        ),
      )
      if (existing && existing.array === colors) existing.needsUpdate = true
      else entry.geometry.setAttribute(`color`, new BufferAttribute(colors, 3))
      colored_keys.add(entry.key)
    }
    record_stage(`recolor_total`, performance.now() - profile_start, {
      entries: entries.length,
    })
    threlte.invalidate()
  }

  // Color-relevant layer props as a string, including the color-source volume
  // identity (so replacing a color volume in place resamples) but excluding
  // geometry fields like isovalue and opacity, so e.g. isovalue slider drags
  // don't remap colors on every tick.
  let color_sig = $derived(
    resolved_layers
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
      .join(`|`),
  )

  // Apply/refresh vertex colors when entries are rebuilt or color props change
  $effect(() => {
    void color_sig
    const entries = active_entries
    untrack(() => apply_vertex_colors(entries, resolved_layers))
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
