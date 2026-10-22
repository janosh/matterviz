<script lang="ts">
  // Marching-cubes isosurface meshes for one or more volumes. Each layer picks a geometry
  // volume and optionally a color volume sampled at the vertices through a colormap (e.g.
  // density colored by ESP). Geometry and sampled scalars are cached, so colormap changes
  // only remap through the LUT and never rerun marching cubes.
  import type { Matrix3x3, Vec3 } from '../math'
  import { to_error } from 'svelte-widgets/utils'
  import { resolve_value_range, to_color_scale_config } from '#lib/plot/core/scales.js'
  import { indexed_mesh_geometry } from '#lib/scene/geometry.svelte.js'
  import { can_create_worker } from '#lib/worker-client.svelte.js'
  import { T, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { BackSide, type BufferGeometry, DoubleSide, FrontSide } from 'three/webgpu'
  import { compute_scalar_range, is_signed_range, set_vertex_colors } from './coloring'
  import { compute_geometries_async } from './async-geometry.svelte'
  import type { GeometryResult, GeometryVolumeJob } from './geometry'
  import { compute_isosurface_geometries } from './geometry'
  import type { ScalarGrid3D } from './grid'
  import { get_isosurface_error_handler, type IsosurfaceErrorHandler } from './context'
  import { record_stage, time_stage } from './profile'
  import type { DisplayRange } from './sampling'
  import {
    range_sample_counts,
    resolve_volume_display_range,
    sample_volume_at_positions,
  } from './sampling'
  import type { IsosurfaceLayer, IsosurfaceSettings, VolumetricData } from './types'
  import { DEFAULT_ISOSURFACE_SETTINGS, MAX_GRID_POINTS, index_volumes } from './types'

  let {
    volumes = [],
    settings = DEFAULT_ISOSURFACE_SETTINGS,
    tiling = [1, 1, 1],
    on_error,
  }: {
    volumes?: VolumetricData[]
    settings?: IsosurfaceSettings
    // Supercell tiling of geometry volumes (color sampling wraps the original volume)
    tiling?: Vec3
    // Geometry worker failures; defaults to the host's set_isosurface_error_handler
    on_error?: IsosurfaceErrorHandler
  } = $props()

  // Context is read once at init: Structure registers its handler before the scene mounts
  const context_on_error = get_isosurface_error_handler()
  const report_error = (message: string): void => (on_error ?? context_on_error)?.(message)

  // In-place geometry/colour updates bypass the <T> props Threlte watches, so on-demand
  // rendering needs an explicit invalidate to repaint
  const threlte = useThrelte()

  type ResolvedLayer = IsosurfaceLayer & { volume: VolumetricData }
  const volume_by_id = $derived(index_volumes(volumes))
  // Missing geometry sources render nothing; they never borrow another volume's data.
  const resolved_layers = $derived(
    settings.layers.flatMap((layer): ResolvedLayer[] => {
      const volume = volume_by_id.get(layer.volume_id)
      return volume ? [{ ...layer, volume }] : []
    }),
  )

  // Stable identity tokens for volume objects so cache keys detect replacement
  let vol_id_counter = 0
  const vol_ids = new WeakMap<VolumetricData, number>()
  const vol_id = (vol: VolumetricData): number => {
    const identifier = vol_ids.get(vol) ?? ++vol_id_counter
    vol_ids.set(vol, identifier)
    return identifier
  }

  // Finite extraction range: always for periodic volumes (tiling and fractional bounds share
  // endpoint semantics), only an explicit crop for finite ones
  const effective_range = (vol: VolumetricData): DisplayRange | null =>
    resolve_volume_display_range(vol, {
      display_range: settings.display_range,
      tiling,
      halo: settings.halo,
    })

  // === Prepared geometry grids ===
  // A volume's finite marching-cubes grid, cached so isovalue changes reuse it. The range
  // fully determines it (it encodes tiling and halo, which finite volumes ignore).
  type PreparedGrid = {
    key: string
    grid: ScalarGrid3D<Float64Array>
    lattice: Matrix3x3
    origin: Vec3
  }
  // Keyed by volume object so removed/replaced volumes release their grids to GC
  const prepared_cache = new WeakMap<VolumetricData, PreparedGrid>()

  const range_key = (vol: VolumetricData): string =>
    effective_range(vol)?.flat().join(`,`) ?? ``

  const current_prepared = (vol: VolumetricData): PreparedGrid | undefined => {
    const cached = prepared_cache.get(vol)
    return cached?.key === range_key(vol) ? cached : undefined
  }

  const geometry_buffer_bytes = (geometry: BufferGeometry): number =>
    [`position`, `normal`, `color`].reduce(
      (total, name) => total + (geometry.getAttribute(name)?.array.byteLength ?? 0),
      geometry.getIndex()?.array.byteLength ?? 0,
    )

  // Indexed BufferGeometry from marching-cubes output (null for empty surfaces); normals
  // are computed here on the main thread rather than in the worker
  const build_geometry = (
    positions: Float32Array,
    indices: Uint32Array,
  ): BufferGeometry | null =>
    time_stage(
      `build_geometry`,
      () => indexed_mesh_geometry(positions, indices),
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
  // Bumped only when every in-flight result must be dropped (unmount, all volumes removed)
  let rebuild_generation = 0
  let rebuild_in_flight: Promise<void> | null = null
  // Aborting rejects this component's pending worker request; the shared client tears the
  // worker down once no caller awaits it, so an extraction nobody needs stops burning CPU
  let geometry_job: { abort: AbortController; volumes: Set<VolumetricData> } | undefined

  function cancel_geometry_worker(): void {
    geometry_job?.abort.abort(new Error(`Isosurface geometry job superseded`))
    geometry_job = undefined
  }

  // Drop pending and in-flight rebuilds and dispose every geometry
  function reset_surfaces() {
    rebuild_generation++
    cancelAnimationFrame(raf_id)
    raf_id = 0
    cancel_geometry_worker()
    for (const entry of active_entries) entry.geometry.dispose()
    active_entries = []
    colored_keys.clear()
  }

  $effect(() => reset_surfaces) // on unmount

  // Any finite isovalue draws: 0 is a signed field's nodal surface and a negative value its
  // negative lobe. show_negative mirrors the surface at -isovalue, which at 0 is the same one.
  const mirror_signs = (layer: ResolvedLayer): readonly (1 | -1)[] =>
    layer.show_negative && layer.isovalue !== 0 ? [1, -1] : [1]
  // A mirrored pair colours each lobe by the sign of the value it is drawn at (with a negative
  // isovalue the mirror is the positive lobe); a lone surface always takes `color`
  const lobe_color = (layer: ResolvedLayer, sign: 1 | -1): string =>
    layer.show_negative && sign * layer.isovalue < 0 ? layer.negative_color : layer.color

  // range_key covers halo + tiling, so the geometry identity needs no other inputs
  const geometry_key = ({ volume_id, volume, isovalue }: ResolvedLayer, sign: 1 | -1) =>
    JSON.stringify([volume_id, vol_id(volume), sign * isovalue, range_key(volume)])

  type PendingSurface = Pick<MeshEntry, `key` | `geo_key` | `layer_idx` | `sign`> & {
    isovalue: number
    volume: VolumetricData
  }

  const estimated_prepared_points = (vol: VolumetricData): number => {
    const range = effective_range(vol)
    const points = range
      ? range_sample_counts(vol, range).reduce((total, count) => total * count, 1)
      : vol.values.length
    return Math.min(points, MAX_GRID_POINTS)
  }

  // Large grids that still need preparing go to the geometry worker; small ones and
  // already-prepared grids are cheaper on the main thread than a round trip
  const use_geometry_worker = (pending: PendingSurface[]): boolean =>
    typeof window !== `undefined` &&
    can_create_worker() &&
    pending.some(
      (surface) =>
        !current_prepared(surface.volume) &&
        estimated_prepared_points(surface.volume) >= 200_000,
    )

  // One job per volume. A still-valid prepared grid is posted as that finite grid with no
  // range, so only new or invalidated volumes are re-extracted.
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
          key: range_key(source_volume),
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
      if (!layer.visible || !Number.isFinite(layer.isovalue)) continue
      for (const sign of mirror_signs(layer)) {
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
            volume: layer.volume,
          }
          pending.push(surface)
          plans.push(surface)
        }
      }
    }

    let geometries = new Map<string, BufferGeometry>()
    const jobs = geometry_jobs(pending)
    if (use_geometry_worker(pending)) {
      const abort = new AbortController()
      geometry_job = { abort, volumes: new Set(pending.map(({ volume }) => volume)) }
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
        report_error(`Isosurface geometry failed: ${to_error(error).message}`)
        return
      } finally {
        if (geometry_job?.abort === abort) geometry_job = undefined
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
    // Render outer shells first so back/front passes interleave roughly back-to-front,
    // ranked by isovalue as a fraction of each volume's abs_max (comparable across volumes)
    const shell_fraction = ({ layer_idx }: MeshEntry): number => {
      const { isovalue, volume } = layers[layer_idx]
      return isovalue / Math.max(volume.data_range.abs_max, 1e-30)
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
    // Reused geometries keep their color attribute; the color effect colors new ones
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

  // Geometry-relevant inputs as a string: a $derived string only notifies on change, so the
  // rebuild effect skips color-only updates (colors, opacity, colormap)
  let geo_sig = $derived(
    resolved_layers
      .map((layer) => {
        if (!layer.visible || !Number.isFinite(layer.isovalue)) return `off`
        return `${geometry_key(layer, 1)}.${layer.show_negative}`
      })
      .join(`|`),
  )

  // At most one rebuild per frame and one in flight: the frame callback reads the freshest
  // layers, and a request during a (worker) rebuild queues one rerun instead of aborting
  // work that also prepares the grid.
  function request_rebuild(): void {
    if (raf_id) return
    raf_id = requestAnimationFrame(() => {
      raf_id = 0
      if (rebuild_in_flight) {
        // a reset (unmount, all volumes removed) drops the queued rerun too
        const generation = rebuild_generation
        void rebuild_in_flight.finally(() => {
          if (generation === rebuild_generation) request_rebuild()
        })
        return
      }
      rebuild_in_flight = rebuild_geometries(resolved_layers, rebuild_generation).finally(
        () => (rebuild_in_flight = null),
      )
    })
  }

  $effect(() => {
    void geo_sig
    if (untrack(() => volumes.length) === 0) {
      untrack(reset_surfaces)
      return
    }
    // A worker job for a volume that left the scene would only hold up the new surfaces
    const live_volumes = new Set(untrack(() => resolved_layers.map(({ volume }) => volume)))
    if (geometry_job && ![...geometry_job.volumes].every((vol) => live_volumes.has(vol))) {
      cancel_geometry_worker()
    }
    request_rebuild()
  })

  // === Cross-volume vertex coloring ===

  // Vertices and volumes share the structure coordinate frame
  const sample_entry_scalars = (entry: MeshEntry, color_vol: VolumetricData): Float32Array =>
    time_stage(`sample_scalars`, () => {
      const positions = entry.geometry.getAttribute(`position`).array as Float32Array
      return sample_volume_at_positions(color_vol, positions, {
        out_of_bounds: color_vol.periodic ? `clamp` : `fallback`,
        out: entry.scalars ?? undefined,
      })
    })

  // The layer's scalar-color-source volume, if any
  const color_vol_of = (layer: IsosurfaceLayer | undefined): VolumetricData | undefined =>
    layer?.color_volume_id != null ? volume_by_id.get(layer.color_volume_id) : undefined

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
      const { value_range } = to_color_scale_config(layer.color_scale ?? {})
      if (value_range?.[0] == null || value_range[1] == null) {
        const scalars = auto_scalars.get(entry.layer_idx) ?? []
        scalars.push(entry.scalars)
        auto_scalars.set(entry.layer_idx, scalars)
      }
    }

    // Default value_range per layer: fit the scalars on its surfaces (both lobes), since
    // whole-volume ranges are dominated by extremes near nuclei. Signed sources stay
    // symmetric so diverging colormaps center on zero.
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

    // Second pass: map scalars through the colormap LUT (the existing color attribute's
    // array is reused, so recolors cause no GPU buffer churn)
    for (const entry of entries) {
      const layer = layers[entry.layer_idx]
      if (!layer || !entry.scalars) continue
      const scalars = entry.scalars
      const color_scale = layer.color_scale ?? {}
      time_stage(`apply_colormap`, () =>
        set_vertex_colors(entry.geometry, scalars, {
          color_scale,
          value_range: resolve_value_range(
            color_scale,
            auto_ranges.get(entry.layer_idx) ?? [0, 1],
          ),
          fallback_color: lobe_color(layer, entry.sign),
        }),
      )
      colored_keys.add(entry.key)
    }
    record_stage(`recolor_total`, performance.now() - profile_start, {
      entries: entries.length,
    })
    threlte.invalidate()
  }

  // Color-relevant layer props incl. the color volume's identity (replacing it resamples) but
  // no geometry fields, so isovalue drags don't remap colors every tick
  let color_sig = $derived(
    resolved_layers
      .map((layer) => {
        const color_vol = color_vol_of(layer)
        return [
          layer.color_volume_id ?? ``,
          color_vol ? vol_id(color_vol) : ``,
          // function schemes compare by source
          JSON.stringify(layer.color_scale ?? ``, (_, val) =>
            typeof val === `function` ? String(val) : val,
          ),
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
    {@const color = vertex_colored ? `#ffffff` : lobe_color(layer, entry.sign)}
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
