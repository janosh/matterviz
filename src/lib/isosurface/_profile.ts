// Internal, opt-in profiling primitives for the isosurface benchmark route.
// This module is intentionally not re-exported from the public package barrels.

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

export interface IsosurfaceProfileEvent {
  stage: IsosurfaceProfileStage
  duration_ms: number
  meta: IsosurfaceProfileMeta
}

export type IsosurfaceProfiler = (event: IsosurfaceProfileEvent) => void

/** Record a stage whose duration was measured elsewhere. */
export function record_profile(
  profiler: IsosurfaceProfiler | undefined,
  stage: IsosurfaceProfileStage,
  duration_ms: number,
  meta: IsosurfaceProfileMeta = {},
): void {
  profiler?.({ stage, duration_ms, meta })
}

/** Time a synchronous pipeline stage only when an internal profiler is attached. */
export function profile_stage<Result>(
  profiler: IsosurfaceProfiler | undefined,
  stage: IsosurfaceProfileStage,
  operation: () => Result,
  meta: IsosurfaceProfileMeta | ((result: Result) => IsosurfaceProfileMeta) = {},
): Result {
  if (!profiler) return operation()
  const start_time = performance.now()
  const result = operation()
  profiler({
    stage,
    duration_ms: performance.now() - start_time,
    meta: typeof meta === `function` ? meta(result) : meta,
  })
  return result
}

/** Emit an already measured stage event without doing work when profiling is disabled. */
export function emit_profile(
  profiler: IsosurfaceProfiler | undefined,
  stage: IsosurfaceProfileStage,
  start_time: number,
  meta: IsosurfaceProfileMeta = {},
): void {
  record_profile(profiler, stage, performance.now() - start_time, meta)
}
