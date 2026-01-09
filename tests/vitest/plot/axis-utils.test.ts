import type { AxisConfig, DataSeries } from '$lib/plot'
import { create_axis_change_handler, merge_series_state } from '$lib/plot/axis-utils'
import { describe, expect, test, vi } from 'vitest'

describe(`merge_series_state`, () => {
  test(`preserves visibility from old series by index when no id`, () => {
    const old_series: DataSeries[] = [
      { x: [1], y: [1], visible: false },
      { x: [2], y: [2], visible: true },
    ]
    const new_series: DataSeries[] = [
      { x: [10], y: [10] },
      { x: [20], y: [20] },
    ]
    const merged = merge_series_state(old_series, new_series)
    expect(merged[0].visible).toBe(false)
    expect(merged[1].visible).toBe(true)
  })

  test.each([
    {
      name: `string ids`,
      old_series: [
        { id: `a`, x: [1], y: [1], visible: false },
        { id: `b`, x: [2], y: [2], visible: true },
      ],
      new_series: [
        { id: `b`, x: [20], y: [20] },
        { id: `a`, x: [10], y: [10] },
      ],
    },
    {
      name: `numeric ids`,
      old_series: [
        { id: 1, x: [1], y: [1], visible: false },
        { id: 2, x: [2], y: [2], visible: true },
      ],
      new_series: [
        { id: 2, x: [20], y: [20] },
        { id: 1, x: [10], y: [10] },
      ],
    },
  ])(`matches by id when available ($name)`, ({ old_series, new_series }) => {
    const merged = merge_series_state(
      old_series as DataSeries[],
      new_series as DataSeries[],
    )
    // Second id should get visibility from old second (true), first from old first (false)
    expect(merged[0].visible).toBe(true)
    expect(merged[1].visible).toBe(false)
  })

  test(`handles new series without matching old (falls back to index)`, () => {
    const old_series: DataSeries[] = [{ id: `a`, x: [1], y: [1], visible: false }]
    const new_series: DataSeries[] = [
      { id: `c`, x: [30], y: [30] }, // no matching id, falls back to index 0
    ]
    const merged = merge_series_state(old_series, new_series)
    // Falls back to index match: old_series[0].visible = false
    expect(merged[0].visible).toBe(false)
  })
})

describe(`create_axis_change_handler`, () => {
  /** Create a mock state object for testing. */
  function create_mock_state(initial_key: string = `energy`) {
    let axis_config: AxisConfig = { selected_key: initial_key }
    let series: DataSeries[] = []
    let loading: `x` | `y` | `y2` | null = null

    return {
      get_axis: vi.fn((_axis: `x` | `y` | `y2`) => axis_config),
      set_axis: vi.fn((_axis: `x` | `y` | `y2`, config: AxisConfig) => {
        axis_config = config
      }),
      get_series: vi.fn(() => series),
      set_series: vi.fn((new_series: DataSeries[]) => {
        series = new_series
      }),
      get_loading: vi.fn(() => loading),
      set_loading: vi.fn((axis: `x` | `y` | `y2` | null) => {
        loading = axis
      }),
    }
  }

  test(`does not call data_loader when key unchanged and series loaded (no-op guard)`, async () => {
    const state = create_mock_state(`energy`)
    // Initialize with existing series so no-op guard is active
    state.get_series = vi.fn(() => [{ x: [1], y: [1] }] as DataSeries[])
    const data_loader = vi.fn().mockResolvedValue({ series: [] })
    const on_axis_change = vi.fn()

    const handler = create_axis_change_handler(state, data_loader, on_axis_change)

    // Call with the same key as currently selected
    await handler(`x`, `energy`)

    // data_loader should NOT be called because key didn't change and series exists
    expect(data_loader).not.toHaveBeenCalled()
    expect(on_axis_change).not.toHaveBeenCalled()
    expect(state.set_loading).not.toHaveBeenCalled()
  })

  test(`calls data_loader when key changes`, async () => {
    const state = create_mock_state(`energy`)
    const new_series: DataSeries[] = [{ x: [1], y: [2], label: `test` }]
    const data_loader = vi.fn().mockResolvedValue({ series: new_series })
    const on_axis_change = vi.fn()

    const handler = create_axis_change_handler(state, data_loader, on_axis_change)

    await handler(`x`, `volume`)

    expect(data_loader).toHaveBeenCalledWith(`x`, `volume`, [])
    expect(on_axis_change).toHaveBeenCalledWith(`x`, `volume`, new_series)
    expect(state.set_loading).toHaveBeenCalledWith(`x`)
    expect(state.set_loading).toHaveBeenLastCalledWith(null)
  })

  test(`returns early when data_loader is undefined`, async () => {
    const state = create_mock_state(`energy`)
    const on_axis_change = vi.fn()

    const handler = create_axis_change_handler(state, undefined, on_axis_change)

    await handler(`x`, `volume`)

    expect(state.set_axis).not.toHaveBeenCalled()
    expect(on_axis_change).not.toHaveBeenCalled()
  })

  test(`returns early when loading in progress`, async () => {
    const state = create_mock_state(`energy`)
    // Simulate loading in progress
    state.get_loading = vi.fn(() => `y`)
    const data_loader = vi.fn().mockResolvedValue({ series: [] })

    const handler = create_axis_change_handler(state, data_loader)

    await handler(`x`, `volume`)

    expect(data_loader).not.toHaveBeenCalled()
  })

  test(`reverts selection and calls on_error on data_loader failure`, async () => {
    const state = create_mock_state(`energy`)
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
    const data_loader = vi.fn().mockRejectedValue(new Error(`Network error`))
    const on_error = vi.fn()

    const handler = create_axis_change_handler(state, data_loader, undefined, on_error)

    await handler(`x`, `volume`)

    expect(on_error).toHaveBeenCalledWith({
      axis: `x`,
      key: `volume`,
      message: `Network error`,
    })
    // Check that set_axis was called to revert (second call after initial update)
    expect(state.set_axis).toHaveBeenCalledTimes(2)
    expect(state.set_loading).toHaveBeenLastCalledWith(null)

    error_spy.mockRestore()
  })

  test(`updates axis label and unit when provided in result`, async () => {
    const state = create_mock_state(`energy`)
    const data_loader = vi.fn().mockResolvedValue({
      series: [],
      axis_label: `Volume`,
      axis_unit: `Å³`,
    })

    const handler = create_axis_change_handler(state, data_loader)

    await handler(`x`, `volume`)

    // set_axis called twice: selected_key update + label/unit update
    expect(state.set_axis).toHaveBeenCalledTimes(2)
    expect(state.set_axis).toHaveBeenCalledWith(
      `x`,
      expect.objectContaining({ label: `Volume`, unit: `Å³` }),
    )
  })

  test(`calls data_loader when key unchanged but series empty (initial lazy load)`, async () => {
    const state = create_mock_state(`energy`)
    // Series is empty (default), simulating initial state before any data loaded
    const new_series: DataSeries[] = [{ x: [1], y: [2], label: `loaded` }]
    const data_loader = vi.fn().mockResolvedValue({ series: new_series })
    const on_axis_change = vi.fn()

    const handler = create_axis_change_handler(state, data_loader, on_axis_change)

    // Call with the SAME key as selected_key - should still load since series empty
    await handler(`x`, `energy`)

    expect(data_loader).toHaveBeenCalledWith(`x`, `energy`, [])
    expect(on_axis_change).toHaveBeenCalledWith(`x`, `energy`, new_series)
    expect(state.set_series).toHaveBeenCalledWith(new_series)
  })
})
