import {
  type CameraView,
  camera_view_changed,
  rescale_zoom_to_fit,
} from '$lib/chempot-diagram/camera'
import { describe, expect, test } from 'vitest'

const view = (overrides: Partial<CameraView> = {}): CameraView => ({
  position: [1, 2, 3],
  target: [0, 0, 0],
  zoom: 40,
  ...overrides,
})

describe(`camera_view_changed`, () => {
  test.each([
    // a click that moves nothing must not pin the view, or the diagram stops re-fitting
    [`bare click leaves the view identical`, view(), false],
    [`orbit moves the camera`, view({ position: [1, 2, 3.0001] }), true],
    [`wheel changes only zoom`, view({ zoom: 40.5 }), true],
    [`pan moves only the target`, view({ target: [0, 0.2, 0] }), true],
  ] as [string, CameraView, boolean][])(`%s`, (_desc, after, expected) => {
    expect(camera_view_changed(view(), after)).toBe(expected)
  })

  test(`a perspective camera reports no zoom and still compares`, () => {
    const before = view({ zoom: null })
    expect(camera_view_changed(before, view({ zoom: null }))).toBe(false)
    expect(camera_view_changed(before, view({ zoom: null, position: [9, 2, 3] }))).toBe(true)
  })

  // auto-rotate drives `change` without a preceding `start`, so there is no baseline to
  // compare against — and an animation the user never asked for must not pin the framing
  test.each([
    [null, view()],
    [view(), null],
  ] as [CameraView | null, CameraView | null][])(
    `missing view (%#) counts as unchanged`,
    (before, after) => expect(camera_view_changed(before, after)).toBe(false),
  )
})

describe(`rescale_zoom_to_fit`, () => {
  test.each([
    [`unpinned zoom stays unpinned`, null, 10, 20, null],
    [`no baseline yet leaves zoom alone`, 40, null, 20, 40],
    [`zero baseline leaves zoom alone`, 40, 0, 20, 40],
    [`zero fit (container mid-layout) leaves zoom alone`, 40, 20, 0, 40],
    [`halving the fit halves the pinned zoom`, 40, 20, 10, 20],
    [`doubling the fit doubles the pinned zoom`, 40, 20, 40, 80],
  ] as [string, number | null, number | null, number, number | null][])(
    `%s`,
    (_desc, zoom, last_fit, next_fit, expected) => {
      expect(rescale_zoom_to_fit(zoom, last_fit, next_fit)).toBe(expected)
    },
  )

  test(`a resize and its undo return the exact starting zoom`, () => {
    const [wide_fit, narrow_fit] = [213.33, 160]
    const narrowed = rescale_zoom_to_fit(400, wide_fit, narrow_fit)
    expect(narrowed).toBeLessThan(400)
    expect(rescale_zoom_to_fit(narrowed, narrow_fit, wide_fit)).toBeCloseTo(400, 10)
  })

  test(`extent and viewport changes compose into one ratio`, () => {
    // fit = min(width, height) / (extent * 1.6): halve the viewport and double the extent
    const [fit_before, fit_after] = [800 / (10 * 1.6), 400 / (20 * 1.6)]
    expect(rescale_zoom_to_fit(50, fit_before, fit_after)).toBeCloseTo(50 / 4, 10)
  })
})
