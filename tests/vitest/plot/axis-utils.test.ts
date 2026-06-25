import type { AxisConfig, AxisLoadError, DataLoaderFn, DataSeries } from '$lib/plot'
import { create_axis_loader, merge_series_state } from '$lib/plot/core/axis-utils'
import { describe, expect, test, vi } from 'vitest'

describe(`merge_series_state`, () => {
  test.each([
    { name: `undefined ids`, id: undefined },
    { name: `empty ids`, id: `` },
  ])(`preserves visibility by index for $name`, ({ id }) => {
    const old_series: DataSeries[] = [
      { id, x: [1], y: [1], visible: false },
      { id, x: [2], y: [2], visible: true },
    ]
    const new_series: DataSeries[] = [
      { id, x: [10], y: [10] },
      { id, x: [20], y: [20] },
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
    const merged = merge_series_state(old_series as DataSeries[], new_series as DataSeries[])
    // Second id should get visibility from old second (true), first from old first (false)
    expect(merged[0].visible).toBe(true)
    expect(merged[1].visible).toBe(false)
  })

  // An unmatched id keeps the new series' own value (true) and never inherits by position (undefined)
  test.each([
    { name: `keeps provided visibility`, visible: true, expected: true },
    { name: `does not inherit by position`, visible: undefined, expected: undefined },
  ])(`for an unmatched id, $name`, ({ visible, expected }) => {
    const merged = merge_series_state(
      [{ id: `a`, x: [1], y: [1], visible: false }],
      [{ id: `c`, x: [30], y: [30], visible }],
    )
    expect(merged[0].visible).toBe(expected)
  })
})

describe(`create_axis_loader`, () => {
  // Create a mock state object for testing. Each axis gets its OWN accessor so tests can
  // verify the change is routed to the correct axis (not hardcoded to `x`).
  function create_mock_state(initial_key: string = `energy`) {
    let series: DataSeries[] = []
    let loading: `x` | `x2` | `y` | `y2` | null = null

    const make_axis = (key: string) => {
      let axis_config: AxisConfig = { selected_key: key }
      return {
        get: vi.fn(() => axis_config),
        set: vi.fn((config: AxisConfig) => {
          axis_config = config
        }),
      }
    }
    return {
      axes: {
        x: make_axis(initial_key),
        x2: make_axis(initial_key),
        y: make_axis(initial_key),
        y2: make_axis(initial_key),
      },
      series: {
        get: vi.fn(() => series),
        set: vi.fn((new_series: DataSeries[]) => {
          series = new_series
        }),
      },
      loading: {
        get: vi.fn(() => loading),
        set: vi.fn((next: `x` | `x2` | `y` | `y2` | null) => {
          loading = next
        }),
      },
    }
  }

  type MockState = ReturnType<typeof create_mock_state>
  type LoaderProps = {
    data_loader?: DataLoaderFn<Record<string, unknown>, DataSeries>
    on_axis_change?: (axis: `x` | `x2` | `y` | `y2`, key: string, series: DataSeries[]) => void
    on_error?: (error: AxisLoadError) => void
  }
  const make_handler = (state: MockState, props: LoaderProps) =>
    create_axis_loader(state, () => props).handle_axis_change

  // Each guard short-circuits before touching state or calling the loader
  test.each([
    {
      name: `key unchanged and series already loaded`,
      arrange: (state: MockState) =>
        (state.series.get = vi.fn(() => [{ x: [1], y: [1] }] as DataSeries[])),
      with_loader: true,
      key: `energy`,
    },
    { name: `data_loader is undefined`, arrange: () => {}, with_loader: false, key: `volume` },
    {
      name: `a load is already in progress`,
      arrange: (state: MockState) => (state.loading.get = vi.fn(() => `y`)),
      with_loader: true,
      key: `volume`,
    },
  ])(`is a no-op when $name`, async ({ arrange, with_loader, key }) => {
    const state = create_mock_state(`energy`)
    arrange(state)
    const data_loader = with_loader ? vi.fn().mockResolvedValue({ series: [] }) : undefined
    const on_axis_change = vi.fn()

    await make_handler(state, { data_loader, on_axis_change })(`x`, key)

    if (data_loader) expect(data_loader).not.toHaveBeenCalled()
    expect(on_axis_change).not.toHaveBeenCalled()
    expect(state.axes.x.set).not.toHaveBeenCalled()
    expect(state.loading.set).not.toHaveBeenCalled()
    expect(state.series.set).not.toHaveBeenCalled()
  })

  // a load fires both when the key changes and when it's unchanged but series are empty (initial
  // lazy load); both commit the series, fire on_axis_change, and clear the loading flag
  test.each([
    { name: `key changes`, key: `volume` },
    { name: `key unchanged but series are empty (initial lazy load)`, key: `energy` },
  ])(`calls data_loader when $name`, async ({ key }) => {
    const state = create_mock_state(`energy`)
    const new_series: DataSeries[] = [{ x: [1], y: [2], label: `loaded` }]
    const data_loader = vi.fn().mockResolvedValue({ series: new_series })
    const on_axis_change = vi.fn()

    await make_handler(state, { data_loader, on_axis_change })(`x`, key)

    expect(data_loader).toHaveBeenCalledWith(`x`, key, [])
    expect(on_axis_change).toHaveBeenCalledWith(`x`, key, new_series)
    expect(state.series.set).toHaveBeenCalledWith(new_series)
    expect(state.loading.set).toHaveBeenCalledWith(`x`)
    expect(state.loading.set).toHaveBeenLastCalledWith(null)
  })

  test(`reverts selection and calls on_error on data_loader failure`, async () => {
    const state = create_mock_state(`energy`)
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
    const data_loader = vi.fn().mockRejectedValue(new Error(`Network error`))
    const on_error = vi.fn()

    await make_handler(state, { data_loader, on_error })(`x`, `volume`)

    expect(on_error).toHaveBeenCalledWith({
      axis: `x`,
      key: `volume`,
      message: `Network error`,
    })
    // set called twice: initial selected_key update, then revert
    expect(state.axes.x.set).toHaveBeenCalledTimes(2)
    expect(state.loading.set).toHaveBeenLastCalledWith(null)

    error_spy.mockRestore()
  })

  // a loader result's axis_label/axis_unit overwrite the axis fields (alongside the selected_key
  // update); empty strings (not just truthy values) overwrite, so a loader can clear them
  test.each([
    {
      name: `updates label/unit when provided`,
      seed: { selected_key: `energy` },
      result: { axis_label: `Volume`, axis_unit: `Å³` },
      expected: { selected_key: `volume`, label: `Volume`, unit: `Å³` },
    },
    {
      name: `clears label/unit when the loader returns empty strings`,
      seed: { selected_key: `energy`, label: `Old`, unit: `eV` },
      result: { axis_label: ``, axis_unit: `` },
      expected: { selected_key: `volume`, label: ``, unit: `` },
    },
  ])(`$name`, async ({ seed, result, expected }) => {
    const state = create_mock_state(`energy`)
    state.axes.x.set(seed) // seed via stateful mock
    const data_loader = vi.fn().mockResolvedValue({ series: [], ...result })

    await make_handler(state, { data_loader })(`x`, `volume`)

    expect(state.axes.x.get()).toEqual(expected)
  })

  // verifies the loader READS the addressed axis (not a hardcoded `x`): y is already on `volume`
  // with series loaded, so the no-op guard fires only if prev_key is read from `y`
  test(`reads the addressed axis when applying the no-op guard`, async () => {
    const state = create_mock_state(`energy`)
    state.axes.y.set({ selected_key: `volume` })
    state.series.set([{ x: [1], y: [1] }] as DataSeries[])
    const data_loader = vi.fn().mockResolvedValue({ series: [] })

    await make_handler(state, { data_loader })(`y`, `volume`)

    // reading `y` sees key unchanged + series present -> no-op; a regression reading `x`
    // (key `energy`) would mismatch `volume` and wrongly trigger a load
    expect(data_loader).not.toHaveBeenCalled()
  })

  test(`a throwing on_axis_change does not trigger the loader rollback`, async () => {
    const state = create_mock_state(`energy`)
    const new_series: DataSeries[] = [{ x: [1], y: [2] }]
    const data_loader = vi.fn().mockResolvedValue({ series: new_series })
    const on_error = vi.fn()
    const on_axis_change = vi.fn(() => {
      throw new Error(`consumer callback blew up`)
    })

    // the load succeeded, so the callback throw must propagate -- not be swallowed as a load failure
    await expect(
      make_handler(state, { data_loader, on_axis_change, on_error })(`x`, `volume`),
    ).rejects.toThrow(`consumer callback blew up`)

    expect(on_error).not.toHaveBeenCalled() // not misclassified as a loader failure
    expect(state.series.set).toHaveBeenCalledWith(new_series) // series stays committed
    // only the selected_key update ran; no revert set call
    expect(state.axes.x.set).toHaveBeenCalledTimes(1)
    expect(state.loading.set).toHaveBeenLastCalledWith(null) // loading still cleared
  })

  // routes the change to the addressed axis only (guards against a hardcoded-axis regression)
  test.each([`x`, `x2`, `y`, `y2`] as const)(
    `routes a load to the %s axis only`,
    async (axis) => {
      const state = create_mock_state(`energy`)
      const new_series: DataSeries[] = [{ x: [1], y: [2] }]
      const data_loader = vi.fn().mockResolvedValue({ series: new_series })
      const on_axis_change = vi.fn()

      await make_handler(state, { data_loader, on_axis_change })(axis, `volume`)

      expect(data_loader).toHaveBeenCalledWith(axis, `volume`, [])
      expect(on_axis_change).toHaveBeenCalledWith(axis, `volume`, new_series)
      expect(state.axes[axis].set).toHaveBeenCalledWith({ selected_key: `volume` })
      for (const other of [`x`, `x2`, `y`, `y2`] as const) {
        if (other !== axis) expect(state.axes[other].set).not.toHaveBeenCalled()
      }
    },
  )

  // try_auto_load picks the first axis (x before y) whose options are populated, once
  test.each([
    { name: `prefers x when both have options`, x_opts: true, y_opts: true, loaded: `x` },
    {
      name: `falls back to y when only y has options`,
      x_opts: false,
      y_opts: true,
      loaded: `y`,
    },
    { name: `no-op when no axis has options`, x_opts: false, y_opts: false, loaded: null },
  ])(`try_auto_load $name`, ({ x_opts, y_opts, loaded }) => {
    const state = create_mock_state(`energy`)
    const with_opts = (key: string) => ({ selected_key: key, options: [{ key, label: key }] })
    state.axes.x.get = vi.fn(() => (x_opts ? with_opts(`energy`) : { selected_key: `energy` }))
    state.axes.y.get = vi.fn(() => (y_opts ? with_opts(`volume`) : { selected_key: `volume` }))
    const data_loader = vi.fn().mockResolvedValue({ series: [{ x: [1], y: [1] }] })

    const { try_auto_load } = create_axis_loader(state, () => ({ data_loader }))
    try_auto_load()

    // data_loader is invoked synchronously up to its first await
    if (loaded) expect(data_loader).toHaveBeenCalledWith(loaded, expect.any(String), [])
    else expect(data_loader).not.toHaveBeenCalled()
  })

  test(`try_auto_load only attempts once even after failure`, async () => {
    const state = create_mock_state(`energy`)
    state.axes.x.get = vi.fn(() => ({
      selected_key: `energy`,
      options: [{ key: `energy`, label: `E` }],
    }))
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
    const data_loader = vi.fn().mockRejectedValue(new Error(`boom`))

    const { try_auto_load } = create_axis_loader(state, () => ({ data_loader }))
    try_auto_load()
    await Promise.resolve()
    try_auto_load()

    expect(data_loader).toHaveBeenCalledTimes(1)
    error_spy.mockRestore()
  })
})
