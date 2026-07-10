// @vitest-environment happy-dom
import { flushSync } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { MockModel } from './anywidget-mock-model'
import { latest_stub, reset_stub } from './reactive-renderer-registry'

// Replace the heavy matterviz components with a recording stub so we can exercise
// the real anywidget widget wiring (drive / rename / derived / writeback key names,
// scatter click/hover callbacks + event_id) without mounting WebGL/SVG components or
// pulling the built dist bundle. The theme/css imports are stubbed for the same
// reason (mount_spec never calls into them directly).
vi.mock(`matterviz`, async () => {
  const stub_module = await import(`./reactive-renderer-stub.svelte`)
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
    `Treemap`,
    `XrdPlot`,
  ]
  return Object.fromEntries(component_names.map((name) => [name, stub_module.default]))
})
vi.mock(`matterviz/app.css?raw`, () => ({ default: `` }))
vi.mock(`matterviz/colors`, () => ({ luminance: () => 0 }))
vi.mock(`matterviz/theme`, () => ({ COLOR_THEMES: {} }))
vi.mock(`matterviz/theme/themes`, () => ({}))

const anywidget_module = await import(`../../extensions/anywidget/anywidget`)
const { WIDGETS, WIDGET_MODEL_KEYS, mount_spec } = anywidget_module

type ModelArg = Parameters<typeof mount_spec>[0]
// Cast the mock to the bridge's model type rather than importing anywidget/types.
const as_model = (mock: MockModel) => mock as unknown as ModelArg

// Mount one widget's spec against a mock model + fresh DOM target, returning the
// stub it mounted so the test can read driven props / drive $bindable writeback.
const run_widget = (widget_type: string, model: MockModel) => {
  reset_stub() // clear any prior stub so a failed mount throws instead of returning stale
  const el = document.createElement(`div`)
  document.body.append(el)
  mount_spec(as_model(model), el, WIDGETS[widget_type])
  flushSync() // settle the initial writeback effects (all no-ops)
  return latest_stub()
}

// A model seeded with a unique sentinel for every trait any driven prop depends on,
// so each prop computes to a distinct, defined value.
const seeded_model = (widget_type: string, spec: (typeof WIDGETS)[string]): MockModel => {
  const state: Record<string, unknown> = { widget_type }
  for (const dep of new Set(spec.drive.flatMap((dp) => dp.deps))) state[dep] = `seed:${dep}`
  return new MockModel(state)
}

const widget_entries = Object.entries(WIDGETS)

// Generic engine coverage across every registered widget: uses each spec's own
// compute as the oracle, so it verifies drive seeding + rename + derived recompute
// flow through mount_spec -> reactive_widget -> the mounted component for all widgets.
describe(`drive wiring (all widgets)`, () => {
  test.each(widget_entries)(
    `%s seeds every non-writeback prop from the model`,
    (widget_type, spec) => {
      const model = seeded_model(widget_type, spec)
      const stub = run_widget(widget_type, model)
      for (const dp of spec.drive) {
        if (dp.writeback) continue // covered by writeback round-trip tests below
        expect(stub.read()[dp.prop]).toEqual(dp.compute(as_model(model)))
      }
    },
  )

  test.each(widget_entries)(
    `%s re-drives its props when any dep trait changes`,
    (widget_type, spec) => {
      const model = seeded_model(widget_type, spec)
      const stub = run_widget(widget_type, model)
      for (const dp of spec.drive) {
        if (dp.writeback) continue
        // bump every dep (not just the first) so a missing listener on a multi-dep
        // derived prop is caught, not only deps[0]
        for (const dep of dp.deps) {
          model.push_from_python(dep, `bumped:${dep}`)
          flushSync()
          expect(stub.read()[dp.prop]).toEqual(dp.compute(as_model(model)))
        }
      }
    },
  )
})

describe(`scatter_plot wiring`, () => {
  test(`range traits and show_controls are mapped into consumed config props`, () => {
    const model = new MockModel({
      widget_type: `scatter_plot`,
      series: [],
      x_axis: { label: `Energy` },
      x_range: [0, 10],
      controls: { open: true },
      show_controls: false,
    })
    const stub = run_widget(`scatter_plot`, model)
    expect(stub.read().x_axis).toEqual({ label: `Energy`, range: [0, 10] })
    expect(stub.read().controls).toEqual({ open: true, show: false })
    expect(`x_range` in stub.read()).toBe(false)
    expect(`show_controls` in stub.read()).toBe(false)
  })

  test(`on_point_click writes active_point with a monotonic event_id`, () => {
    const model = new MockModel({ widget_type: `scatter_plot`, series: [] })
    const stub = run_widget(`scatter_plot`, model)
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
    const stub = run_widget(`scatter_plot`, model)
    const on_point_hover = stub.read().on_point_hover as (data: unknown) => void
    expect(typeof on_point_hover).toBe(`function`)

    on_point_hover({ point: { series_idx: 1, point_idx: 4, x: 2, y: 6 } })
    expect(model.state.hovered_point).toEqual({ series_idx: 1, point_idx: 4, x: 2, y: 6 })
  })

  test(`selected_point is a drive key (Python -> view)`, () => {
    const model = new MockModel({
      widget_type: `scatter_plot`,
      series: [],
      selected_point: { series_idx: 0, point_idx: 0 },
    })
    const stub = run_widget(`scatter_plot`, model)
    expect(stub.read().selected_point).toEqual({ series_idx: 0, point_idx: 0 })

    model.push_from_python(`selected_point`, { series_idx: 0, point_idx: 3 })
    flushSync()
    expect(stub.read().selected_point).toEqual({ series_idx: 0, point_idx: 3 })
  })
})

describe(`structure wiring`, () => {
  test(`highlighted_sites is drive-only`, () => {
    const model = new MockModel({
      widget_type: `structure`,
      highlighted_sites: [],
    })
    const stub = run_widget(`structure`, model)
    model.push_from_python(`highlighted_sites`, [1, 4])
    flushSync()
    expect(stub.read().highlighted_sites).toEqual([1, 4])
  })

  test(`scene_props recomputes reactively when a constituent trait changes`, () => {
    const model = new MockModel({ widget_type: `structure`, atom_radius: 0.5 })
    const stub = run_widget(`structure`, model)
    expect((stub.read().scene_props as { atom_radius: number }).atom_radius).toBe(0.5)

    model.push_from_python(`atom_radius`, 1.2)
    flushSync()
    expect((stub.read().scene_props as { atom_radius: number }).atom_radius).toBe(1.2)

    // cleared -> subkey becomes undefined; the component re-defaults it downstream
    // (StructureScene $bindable defaults + Structure ?? guards)
    model.push_from_python(`atom_radius`, null)
    flushSync()
    expect((stub.read().scene_props as { atom_radius?: number }).atom_radius).toBeUndefined()
  })

  test(`show_site_labels rides in scene_props, not a dead top-level prop`, () => {
    // Structure forwards label settings to StructureScene via {...scene_props}; it has
    // no top-level show_site_labels prop, so a top-level drive key would be dropped.
    const model = new MockModel({ widget_type: `structure`, show_site_labels: true })
    const stub = run_widget(`structure`, model)
    expect((stub.read().scene_props as { show_site_labels?: boolean }).show_site_labels).toBe(
      true,
    )
    expect(`show_site_labels` in stub.read()).toBe(false)
  })
})

describe(`trajectory wiring`, () => {
  test(`property_labels trait is delivered to the component as ELEM_PROPERTY_LABELS`, () => {
    // Trajectory.svelte consumes ELEM_PROPERTY_LABELS, not property_labels.
    const labels = { energy: `Energy (eV)` }
    const model = new MockModel({ widget_type: `trajectory`, property_labels: labels })
    const stub = run_widget(`trajectory`, model)
    expect(stub.read().ELEM_PROPERTY_LABELS).toEqual(labels)
    expect(`property_labels` in stub.read()).toBe(false) // renamed, not passed raw
  })
})

describe(`WIDGET_MODEL_KEYS contract`, () => {
  test(`includes drive deps and interaction keys`, () => {
    // spot-check: derived-prop deps, writeback traits and interaction-written
    // traits all surface in the contract
    expect(WIDGET_MODEL_KEYS.structure).toEqual(
      expect.arrayContaining([`atom_radius`, `selected_sites`, `show_controls`]),
    )
    expect(WIDGET_MODEL_KEYS.scatter_plot).toEqual(
      expect.arrayContaining([`active_point`, `hovered_point`, `selected_point`]),
    )
    expect(WIDGET_MODEL_KEYS.treemap).toEqual(
      expect.arrayContaining([
        `label_fit`,
        `label_max_font_size`,
        `label_min_font_size`,
        `parent_label_font_size`,
        `zoom_root_id`,
      ]),
    )
  })
})

describe(`plot-family config wiring`, () => {
  test.each([`bar_plot`, `histogram`] as const)(
    `%s maps range traits into axis config while keeping top-level show_controls`,
    (widget_type) => {
      const model = new MockModel({
        widget_type,
        series: [],
        y_axis: { label: `Count` },
        y_range: [1, 5],
        controls: { open: true },
        show_controls: false,
      })
      const stub = run_widget(widget_type, model)
      expect(stub.read().y_axis).toEqual({ label: `Count`, range: [1, 5] })
      expect(stub.read().show_controls).toBe(false)
      expect(`y_range` in stub.read()).toBe(false)
      expect(`controls` in stub.read()).toBe(false)
    },
  )

  test.each([`scatter_plot_3d`, `rdf_plot`, `xrd`] as const)(
    `%s maps show_controls into controls.show`,
    (widget_type) => {
      const model = new MockModel({
        widget_type,
        controls: { open: true },
        show_controls: false,
      })
      const stub = run_widget(widget_type, model)
      expect(stub.read().controls).toEqual({ open: true, show: false })
      expect(`show_controls` in stub.read()).toBe(false)
    },
  )

  test(`bands_and_dos forwards show_controls into both child prop bags`, () => {
    const model = new MockModel({
      widget_type: `bands_and_dos`,
      band_type: `line`,
      show_legend: false,
      show_controls: false,
    })
    const stub = run_widget(`bands_and_dos`, model)
    expect(stub.read().bands_props).toEqual({
      band_type: `line`,
      show_legend: false,
      show_controls: false,
    })
    expect((stub.read().dos_props as Record<string, unknown>).show_controls).toBe(false)
    expect(`show_controls` in stub.read()).toBe(false)
  })
})

// A missing/None writeback trait must seed (and revert to) the component's own
// fallback, not null -- null would crash components that call .length/.includes
// or do arithmetic on these props (see reactive_widget writeback_prop fallback).
describe(`writeback wiring`, () => {
  test.each([
    [`structure`, `selected_sites`, [], [3], [5, 6]],
    [`structure`, `hovered_site_idx`, null, 2, 9],
    [`trajectory`, `current_step_idx`, 0, 7, 3],
    [`trajectory`, `display_mode`, `structure+scatter`, `scatter`, `structure`],
    [`treemap`, `zoom_root_id`, null, `root/child-a`, `root/child-b`],
  ] as const)(
    `%s %s round-trips and falls back when cleared`,
    (widget_type, key, default_value, local_value, python_value) => {
      const model = new MockModel({ widget_type }) // omit trait -> bridge seeds default
      const stub = run_widget(widget_type, model)
      expect(stub.read()[key]).toEqual(default_value)
      expect(model.save_count).toBe(0) // initial writeback effects are no-ops

      // component interaction -> model (writeback)
      stub.write(key, local_value)
      flushSync()
      expect(model.state[key]).toEqual(local_value)

      // Python -> component (drive), without a writeback echo
      const save_count = model.save_count
      model.push_from_python(key, python_value)
      flushSync()
      expect(stub.read()[key]).toEqual(python_value)
      expect(model.save_count).toBe(save_count)

      model.push_from_python(key, null) // cleared -> revert to default, still no echo
      flushSync()
      expect(stub.read()[key]).toEqual(default_value)
      expect(model.save_count).toBe(save_count)
    },
  )
})

describe(`render() lifecycle`, () => {
  // Drive through the real entry point (not mount_spec directly) so this also covers
  // cleanup_element + reactive_disposers wiring: the returned disposer must
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

    // as never: anywidget's RenderProps also wants signal/host/experimental,
    // which the drive-listener assertions below don't need
    const dispose = anywidget_module.default.render({
      model: as_model(model),
      el,
    } as never) as () => void
    flushSync()
    expect(listener_count()).toBeGreaterThan(0) // drive listeners registered

    dispose()
    expect(listener_count()).toBe(0) // cleanup_element -> reactive disposer -> model.off
  })
})
