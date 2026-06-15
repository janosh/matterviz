// @vitest-environment happy-dom
import { flushSync } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { MockModel } from './anywidget-mock-model'
import { latest_stub, reset_stub } from './reactive-renderer-registry'

// Replace the heavy matterviz components with a recording stub so we can exercise
// the real anywidget renderer wiring (drive vs writeback key names, scatter
// click/hover callbacks + event_id) without mounting WebGL/SVG components or
// pulling the built dist bundle. The theme/css imports are stubbed for the same
// reason (the renderers under test never call into them directly).
vi.mock(`matterviz`, async () => {
  const Stub = (await import(`./reactive-renderer-stub.svelte`)).default
  const component_names = [
    `Bands`,
    `BandsAndDos`,
    `BarPlot`,
    `BrillouinZone`,
    `ChemPotDiagram`,
    `Composition`,
    `ConvexHull`,
    `Dos`,
    `FermiSurface`,
    `HeatmapMatrix`,
    `Histogram`,
    `IsobaricBinaryPhaseDiagram`,
    `PeriodicTable`,
    `RdfPlot`,
    `ScatterPlot`,
    `ScatterPlot3D`,
    `SpacegroupBarPlot`,
    `Structure`,
    `Trajectory`,
    `XrdPlot`,
  ]
  return Object.fromEntries(component_names.map((name) => [name, Stub]))
})
vi.mock(`matterviz/app.css?raw`, () => ({ default: `` }))
vi.mock(`matterviz/colors`, () => ({ luminance: () => 0 }))
vi.mock(`matterviz/theme`, () => ({ COLOR_THEMES: {} }))
vi.mock(`matterviz/theme/themes`, () => ({}))

const anywidget_module = await import(`../../extensions/anywidget/anywidget`)
const { renderers } = anywidget_module

type RenderArgs = Parameters<(typeof renderers)[string]>[0]
// Derive AnyModel from the renderer arg type rather than importing anywidget/types
const as_model = (mock: MockModel) => mock as unknown as RenderArgs[`model`]

// Run a renderer against a mock model + fresh DOM target, returning the stub the
// renderer mounted so the test can read driven props / drive $bindable writeback.
const run_renderer = (widget_type: string, model: MockModel) => {
  reset_stub() // clear any prior stub so a failed mount throws instead of returning stale
  const el = document.createElement(`div`)
  document.body.append(el)
  void renderers[widget_type]({ model: as_model(model), el } as unknown as RenderArgs)
  flushSync() // settle the initial writeback effects (all no-ops)
  return latest_stub()
}

describe(`render_scatter_plot wiring`, () => {
  test(`on_point_click writes active_point with a monotonic event_id`, () => {
    const model = new MockModel({ widget_type: `scatter_plot`, series: [] })
    const stub = run_renderer(`scatter_plot`, model)
    const on_point_click = stub.read().on_point_click as (data: unknown) => void
    expect(typeof on_point_click).toBe(`function`)

    on_point_click({ point: { series_idx: 0, point_idx: 2, x: 1.5, y: 3.5 } })
    expect(model.state.active_point).toEqual({
      series_idx: 0,
      point_idx: 2,
      x: 1.5,
      y: 3.5,
      event_id: 1,
    })

    // re-click the same point -> distinct trait value via incremented event_id
    on_point_click({ point: { series_idx: 0, point_idx: 2, x: 1.5, y: 3.5 } })
    expect((model.state.active_point as { event_id: number }).event_id).toBe(2)
  })

  test(`on_point_hover writes hovered_point (no event_id, leading-edge)`, () => {
    const model = new MockModel({ widget_type: `scatter_plot`, series: [] })
    const stub = run_renderer(`scatter_plot`, model)
    const on_point_hover = stub.read().on_point_hover as (data: unknown) => void
    expect(typeof on_point_hover).toBe(`function`)

    on_point_hover({ point: { series_idx: 1, point_idx: 4, x: 2, y: 6 } })
    expect(model.state.hovered_point).toEqual({
      series_idx: 1,
      point_idx: 4,
      x: 2,
      y: 6,
    })
  })

  test(`selected_point is a drive key (Python -> view)`, () => {
    const model = new MockModel({
      widget_type: `scatter_plot`,
      series: [],
      selected_point: { series_idx: 0, point_idx: 0 },
    })
    const stub = run_renderer(`scatter_plot`, model)
    expect(stub.read().selected_point).toEqual({ series_idx: 0, point_idx: 0 })

    model.push_from_python(`selected_point`, { series_idx: 0, point_idx: 3 })
    flushSync()
    expect(stub.read().selected_point).toEqual({ series_idx: 0, point_idx: 3 })
  })
})

describe(`render_structure wiring`, () => {
  test(`selected_sites + hovered_site_idx are two-way; highlighted_sites is drive-only`, () => {
    const model = new MockModel({
      widget_type: `structure`,
      selected_sites: [],
      hovered_site_idx: null,
      highlighted_sites: [],
    })
    const stub = run_renderer(`structure`, model)
    expect(model.save_count).toBe(0) // initial writeback effects are no-ops

    // component interaction -> model (writeback)
    stub.write(`selected_sites`, [3])
    flushSync()
    expect(model.state.selected_sites).toEqual([3])

    stub.write(`hovered_site_idx`, 2)
    flushSync()
    expect(model.state.hovered_site_idx).toBe(2)

    // Python -> component (drive)
    model.push_from_python(`selected_sites`, [5, 6])
    flushSync()
    expect(stub.read().selected_sites).toEqual([5, 6])

    model.push_from_python(`hovered_site_idx`, 9)
    flushSync()
    expect(stub.read().hovered_site_idx).toBe(9)

    model.push_from_python(`highlighted_sites`, [1, 4])
    flushSync()
    expect(stub.read().highlighted_sites).toEqual([1, 4])
  })
})

describe(`render_trajectory wiring`, () => {
  test.each([
    [`current_step_idx`, 7, 3],
    [`display_mode`, `scatter`, `structure`],
  ] as const)(`%s is two-way (writeback + drive)`, (key, local_value, python_value) => {
    const model = new MockModel({
      widget_type: `trajectory`,
      current_step_idx: 0,
      display_mode: `structure+scatter`,
    })
    const stub = run_renderer(`trajectory`, model)
    expect(model.save_count).toBe(0)

    stub.write(key, local_value)
    flushSync()
    expect(model.state[key]).toBe(local_value)

    model.push_from_python(key, python_value)
    flushSync()
    expect(stub.read()[key]).toBe(python_value)
  })
})

// A missing/None writeback trait must seed (and revert to) the component's own
// fallback, not null -- null would crash components that call .length/.includes
// or do arithmetic on these props (see reactive_widget writeback_defaults).
describe(`writeback fallback defaults`, () => {
  test.each([
    [`structure`, `selected_sites`, [], [1, 2]],
    [`trajectory`, `current_step_idx`, 0, 3],
    [`trajectory`, `display_mode`, `structure+scatter`, `scatter`],
  ] as const)(
    `%s %s falls back to its default when missing/cleared`,
    (widget_type, key, default_value, driven_value) => {
      const model = new MockModel({ widget_type }) // omit trait -> bridge seeds default
      const stub = run_renderer(widget_type, model)
      expect(stub.read()[key]).toEqual(default_value)

      model.push_from_python(key, driven_value) // Python -> component (drive)
      flushSync()
      expect(stub.read()[key]).toEqual(driven_value)

      model.push_from_python(key, null) // cleared -> revert to default
      flushSync()
      expect(stub.read()[key]).toEqual(default_value)
    },
  )
})

describe(`render() lifecycle`, () => {
  // Drive through the real entry point (not renderers[...] directly) so this also
  // covers cleanup_element + reactive_disposers wiring: the returned disposer must
  // unregister every model listener, else re-rendering an element leaks them.
  test(`the render() disposer unregisters all model listeners`, () => {
    const model = new MockModel({
      widget_type: `structure`,
      selected_sites: [],
      hovered_site_idx: null,
    })
    const el = document.createElement(`div`)
    document.body.append(el)
    const listener_count = () =>
      Object.values(model.listeners).reduce((sum, set) => sum + set.size, 0)

    const dispose = anywidget_module.default.render({
      model: as_model(model),
      el,
    } as unknown as RenderArgs) as () => void
    flushSync()
    expect(listener_count()).toBeGreaterThan(0) // drive listeners registered

    dispose()
    expect(listener_count()).toBe(0) // cleanup_element -> reactive disposer -> model.off
  })
})
