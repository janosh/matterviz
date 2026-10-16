// Isosurface pipeline-stage timings as User Timing `isosurface:<stage>` measures (metadata in
// `detail`), read via PerformanceObserver by the isosurface-performance route and DevTools.
// Intentionally not re-exported from the public package barrels.

export const ISOSURFACE_MEASURE_PREFIX = `isosurface:`

export type IsosurfaceProfileStage =
  | `prepare_geometry`
  | `marching_cubes`
  | `build_geometry`
  | `sample_scalars`
  | `scalar_range`
  | `apply_colormap`
  | `rebuild_total`
  | `recolor_total`

export type IsosurfaceProfileMeta = Record<string, boolean | number | string>

// Off by default: record_stage/time_stage sit on the hot path, so production renders skip
// performance.measure entirely; the benchmark route switches it on
let profiling_enabled = false
export const set_isosurface_profiling = (enabled: boolean): void => {
  profiling_enabled = enabled
}

// Record a stage measured elsewhere. Cleared from the timeline buffer right away so long
// sessions don't accumulate measures; observers are notified regardless.
export function record_stage(
  stage: IsosurfaceProfileStage,
  duration_ms: number,
  meta: IsosurfaceProfileMeta = {},
): void {
  if (!profiling_enabled) return
  const name = `${ISOSURFACE_MEASURE_PREFIX}${stage}`
  const end = performance.now()
  performance.measure(name, { start: end - duration_ms, end, detail: meta })
  performance.clearMeasures(name)
}

// Time a synchronous pipeline stage
export function time_stage<Result>(
  stage: IsosurfaceProfileStage,
  operation: () => Result,
  meta: IsosurfaceProfileMeta | ((result: Result) => IsosurfaceProfileMeta) = {},
): Result {
  if (!profiling_enabled) return operation()
  const start_time = performance.now()
  const result = operation()
  record_stage(
    stage,
    performance.now() - start_time,
    typeof meta === `function` ? meta(result) : meta,
  )
  return result
}
