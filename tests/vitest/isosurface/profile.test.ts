import {
  ISOSURFACE_MEASURE_PREFIX,
  record_stage,
  set_isosurface_profiling,
  time_stage,
} from '$lib/isosurface/profile'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  set_isosurface_profiling(false)
  vi.restoreAllMocks()
})

// record_stage/time_stage run on the renderer's hot path, so with profiling off (the
// default) they must not touch the User Timing API at all
test(`profiling is off by default and only publishes measures once enabled`, () => {
  const measure = vi.spyOn(performance, `measure`)
  const clear_measures = vi.spyOn(performance, `clearMeasures`)
  const now = vi.spyOn(performance, `now`)

  record_stage(`marching_cubes`, 3, { vertices: 12 })
  expect(time_stage(`build_geometry`, () => 42)).toBe(42)
  expect(measure).not.toHaveBeenCalled()
  expect(now).not.toHaveBeenCalled()

  set_isosurface_profiling(true)
  record_stage(`marching_cubes`, 3, { vertices: 12 })
  expect(
    time_stage(
      `build_geometry`,
      () => 42,
      (result) => ({ result }),
    ),
  ).toBe(42)
  expect(measure.mock.calls.map(([name]) => name)).toEqual([
    `${ISOSURFACE_MEASURE_PREFIX}marching_cubes`,
    `${ISOSURFACE_MEASURE_PREFIX}build_geometry`,
  ])
  expect(measure.mock.calls[0][1]).toMatchObject({ detail: { vertices: 12 } })
  expect(measure.mock.calls[1][1]).toMatchObject({ detail: { result: 42 } })
  // entries are cleared right away so long sessions do not pile up thousands of measures
  expect(clear_measures).toHaveBeenCalledTimes(2)
})
