// Tests for isosurface type utilities
import {
  auto_isosurface_settings,
  DEFAULT_ISOSURFACE_SETTINGS,
  grid_data_range,
} from '$lib/isosurface/types'
import { describe, expect, test } from 'vitest'

describe(`grid_data_range`, () => {
  test.each([
    {
      grid: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]],
      min: 1,
      max: 8,
      abs_max: 8,
      mean: 4.5,
      label: `all-positive`,
    },
    {
      grid: [[[-5, 2], [3, -1]], [[0, 6], [-7, 4]]],
      min: -7,
      max: 6,
      abs_max: 7,
      mean: 0.25,
      label: `mixed pos/neg`,
    },
    { grid: [[[-10, 1]]], min: -10, max: 1, abs_max: 10, mean: -4.5, label: `abs_max driven by min` },
    { grid: [[[0, 0], [0, 0]]], min: 0, max: 0, abs_max: 0, mean: 0, label: `uniform zero` },
    { grid: [[[42]]], min: 42, max: 42, abs_max: 42, mean: 42, label: `single element` },
    { grid: [[[-3.5]]], min: -3.5, max: -3.5, abs_max: 3.5, mean: -3.5, label: `single negative` },
  ])(`$label: min=$min max=$max abs_max=$abs_max mean=$mean`, ({ grid, min, max, abs_max, mean }) => {
    const range = grid_data_range(grid)
    expect(range.min).toBe(min)
    expect(range.max).toBe(max)
    expect(range.abs_max).toBe(abs_max)
    expect(range.mean).toBeCloseTo(mean)
  })
})

describe(`DEFAULT_ISOSURFACE_SETTINGS`, () => {
  test(`has expected default values and no removed fields`, () => {
    expect(DEFAULT_ISOSURFACE_SETTINGS.isovalue).toBe(0.05)
    expect(DEFAULT_ISOSURFACE_SETTINGS.opacity).toBe(0.6)
    expect(DEFAULT_ISOSURFACE_SETTINGS.show_negative).toBe(false)
    expect(DEFAULT_ISOSURFACE_SETTINGS.wireframe).toBe(false)
    expect(DEFAULT_ISOSURFACE_SETTINGS.positive_color).toBe(`#3b82f6`)
    expect(DEFAULT_ISOSURFACE_SETTINGS.negative_color).toBe(`#ef4444`)
    // smooth field was removed as unused
    expect(`smooth` in DEFAULT_ISOSURFACE_SETTINGS).toBe(false)
  })
})

describe(`auto_isosurface_settings`, () => {
  test.each([
    { min: 0, abs_max: 10, show_neg: false, label: `positive-only` },
    { min: -5, abs_max: 10, show_neg: true, label: `significant negatives` },
    { min: -5, abs_max: 5, show_neg: true, label: `symmetric ±` },
    { min: -0.005, abs_max: 1, show_neg: false, label: `tiny negatives below 1% threshold` },
  ])(`$label: isovalue=20% of abs_max, show_negative=$show_neg`, ({ min, abs_max, show_neg }) => {
    const settings = auto_isosurface_settings({ min, max: abs_max, abs_max, mean: 0 })
    expect(settings.isovalue).toBeCloseTo(abs_max * 0.2)
    expect(settings.show_negative).toBe(show_neg)
  })

  test(`falls back to default isovalue for all-zero grid`, () => {
    const settings = auto_isosurface_settings({ min: 0, max: 0, abs_max: 0, mean: 0 })
    expect(settings.isovalue).toBe(DEFAULT_ISOSURFACE_SETTINGS.isovalue)
    expect(settings.show_negative).toBe(false)
  })

  test(`preserves default opacity, colors, and wireframe`, () => {
    const settings = auto_isosurface_settings({ min: 1, max: 3, abs_max: 3, mean: 2 })
    expect(settings.opacity).toBe(DEFAULT_ISOSURFACE_SETTINGS.opacity)
    expect(settings.positive_color).toBe(DEFAULT_ISOSURFACE_SETTINGS.positive_color)
    expect(settings.negative_color).toBe(DEFAULT_ISOSURFACE_SETTINGS.negative_color)
    expect(settings.wireframe).toBe(DEFAULT_ISOSURFACE_SETTINGS.wireframe)
  })

  test(`returns a fresh object (not a reference to DEFAULT_ISOSURFACE_SETTINGS)`, () => {
    const settings = auto_isosurface_settings({ min: 0, max: 10, abs_max: 10, mean: 5 })
    expect(settings).not.toBe(DEFAULT_ISOSURFACE_SETTINGS)
    // Mutating the result should not affect defaults
    settings.isovalue = 999
    expect(DEFAULT_ISOSURFACE_SETTINGS.isovalue).toBe(0.05)
  })
})
