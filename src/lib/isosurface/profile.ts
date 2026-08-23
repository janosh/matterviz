// Pipeline-stage timings for the isosurface renderer, published on the User Timing timeline
// as `isosurface:<stage>` measures with the stage metadata as `detail`. Consumers (the
// src/routes/test/isosurface-performance benchmark route, DevTools) read them through a
// PerformanceObserver; nothing is threaded through component props. This module is
// intentionally not re-exported from the public package barrels.

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

// Off by default: record_stage/time_stage sit on the per-vertex hot path, so production
// renders skip the performance.measure + clearMeasures round trip entirely. The benchmark
// route switches it on before observing.
let profiling_enabled = false
export const set_isosurface_profiling = (on: boolean): void => {
  profiling_enabled = on
}

// Record a stage whose duration was measured elsewhere. The entry is cleared from the
// timeline buffer right away so long sessions do not accumulate thousands of measures;
// observers are notified regardless.
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
