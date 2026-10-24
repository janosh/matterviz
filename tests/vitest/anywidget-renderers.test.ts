// @vitest-environment happy-dom
import { DEFAULTS } from '../../src/lib/settings'
import { is_plain_object } from '../../src/lib/utils'
import { flushSync } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { MockModel } from './anywidget-mock-model'
import { latest_stub, reset_stub } from './reactive-renderer-registry'

const { disable_workers, spectral_doc } = vi.hoisted(() => ({
  disable_workers: vi.fn(),
  // the generic wiring test's string seeds count as documents
  spectral_doc: (doc: unknown) =>
    typeof doc === `string` || (doc as { kind?: string } | null)?.kind === `doc`
      ? { normalized: doc }
      : null,
}))
// Swap matterviz components for a recording stub to exercise the real widget wiring
// without mounting WebGL/SVG components or pulling the built dist bundle
vi.mock(`matterviz`, async () => {
  const stub_module = await import(`./reactive-renderer-stub.svelte`)
  const components = `Bands BandsAndDos BarPlot BrillouinZone ChemPotDiagram Composition ConvexHull
    Dos FermiSurface HeatmapMatrix Histogram IsobaricBinaryPhaseDiagram
    PeriodicTable RdfPlot ScatterPlot ScatterPlot3D SpacegroupBarPlot Structure
    Trajectory Treemap XrdPlot`
  return {
    ...Object.fromEntries(components.split(/\s+/).map((name) => [name, stub_module.default])),
    volume_from_json: (raw: unknown) => raw,
    is_plain_object,
    disable_workers,
    // the real one builds a run and throws on malformed payloads (covered in open.test.ts)
    trajectory_from_json: (value: unknown) => {
      if (value === `malformed`) throw new Error(`malformed trajectory`)
      return { run_of: value }
    },
    // like the real ones: a lone document normalizes, a {label: document} map returns null
    normalize_band_structure: spectral_doc,
    normalize_dos: spectral_doc,
  }
})
vi.mock(`matterviz/app.css?raw`, () => ({ default: `` }))
vi.mock(`matterviz/theme`, () => ({ COLOR_THEMES: {} }))
const { stop_theme } = vi.hoisted(() => ({ stop_theme: vi.fn() }))
vi.mock(`matterviz/theme/embedded`, () => ({
  detect_parent_theme: () => `light`,
  watch_theme: () => stop_theme,
}))

const anywidget_module = await import(`../../extensions/anywidget/anywidget`)
const { WIDGETS, WIDGET_MODEL_KEYS, mount_spec } = anywidget_module
// read now: mock call records don't survive into the tests
const disable_workers_calls = disable_workers.mock.calls.length

// blob:/CDN/file:// bundle URLs can't host same-origin workers
test(`importing the widget bundle forces main-thread compute once`, () => {
  expect(disable_workers_calls).toBe(1)
})

const as_model = (mock: MockModel) => mock as unknown as Parameters<typeof mount_spec>[0]
const listener_count = (model: MockModel) =>
  Object.values(model.listeners).reduce((sum, set) => sum + set.size, 0)

// Mount one widget's spec into a fresh DOM target and return the stub it mounted
const run_widget = (widget_type: string, model: MockModel) => {
  reset_stub() // clear any prior stub so a failed mount throws instead of returning stale
  const element = document.createElement(`div`)
  document.body.append(element)
  mount_spec(as_model(model), element, WIDGETS[widget_type])
  flushSync() // settle the initial writeback effects (all no-ops)
  return latest_stub()
}

// Seed a unique sentinel for every drive dep so each prop computes to a distinct value
const seeded_model = (widget_type: string, spec: (typeof WIDGETS)[string]): MockModel => {
  const state: Record<string, unknown> = { widget_type }
  for (const dep of new Set(spec.drive.flatMap((driven_prop) => driven_prop.deps)))
    state[dep] = `seed:${dep}`
  return new MockModel(state)
}

// pymatviz's PlotControlsTraits: every plot widget forwards these flat (never as `controls`)
const controls_traits = {
  show_controls: false,
  controls_open: true,
  controls_toggle_props: { title: `Plot options` },
  controls_pane_props: { style: `width: 20rem` },
}
// The props named in `expected`, for exact (not toMatchObject's partial, nested) comparison
const pick = (props: Record<string, unknown>, expected: object) =>
  Object.fromEntries(Object.keys(expected).map((key) => [key, props[key]]))

// allow_file_drop reaches only viewers that declare it; others would spread it onto a div
const drop_zones = `structure trajectory convex_hull fermi_surface brillouin_zone phase_diagram xrd rdf_plot`
const drop_zone_widgets = new Set(drop_zones.split(` `))

// Each spec's own compute is the oracle; writeback props are covered by the round-trip tests
test.each(Object.entries(WIDGETS))(
  `%s seeds, re-drives on every dep change and gets allow_file_drop iff it has a drop zone`,
  (widget_type, spec) => {
    const model = seeded_model(widget_type, spec)
    const stub = run_widget(widget_type, model)
    expect(stub.read().allow_file_drop).toBe(
      drop_zone_widgets.has(widget_type) ? false : undefined,
    )
    const driven_props = spec.drive.filter((driven_prop) => !driven_prop.writeback)
    for (const { prop, compute } of driven_props)
      expect(stub.read()[prop]).toEqual(compute(as_model(model)))
    // bump every dep, so a missing listener on a multi-dep derived prop is caught
    for (const { prop, compute, deps } of driven_props) {
      for (const dep of deps) {
        model.push_from_python(dep, `bumped:${dep}`)
        flushSync()
        expect(stub.read()[prop]).toEqual(compute(as_model(model)))
      }
    }
  },
)

test(`scatter_plot point callbacks write active_point (monotonic event_id) and hovered_point`, () => {
  const model = new MockModel({ widget_type: `scatter_plot`, series: [] })
  const { on_point_click, on_point_hover } = run_widget(
    `scatter_plot`,
    model,
  ).read() as Record<string, (data: unknown) => void>
  const point = { series_idx: 0, point_idx: 2, x: 1.5, y: 3.5 }
  on_point_click({ point })
  expect(model.state.active_point).toEqual({ ...point, event_id: 1 })
  // re-click the same point -> distinct trait value via incremented event_id
  on_point_click({ point })
  expect(model.state.active_point).toEqual({ ...point, event_id: 2 })
  // hover is leading-edge with no event_id
  on_point_hover({ point: { series_idx: 1, point_idx: 4, x: 2, y: 6 } })
  expect(model.state.hovered_point).toEqual({ series_idx: 1, point_idx: 4, x: 2, y: 6 })
})

describe(`structure wiring`, () => {
  test.each([
    [`single object`, `density`, [`density`]],
    [`array`, [`density`, `spin`], [`density`, `spin`]],
    [`unset`, null, undefined],
  ] as const)(`normalizes %s volumetric_data`, (_shape, raw, expected) => {
    const model = new MockModel({ widget_type: `structure`, volumetric_data: raw })
    expect(run_widget(`structure`, model).read().volumetric_data).toEqual(expected)
  })

  // site labels ride in scene_props (Structure has no top-level prop) and unset
  // auto_rotate/gizmo use the settings defaults so a notebook doesn't spin unlike the page
  test(`scene_props carries defaults, site labels and clears subkeys reactively`, () => {
    const model = new MockModel({
      widget_type: `structure`,
      atom_radius: 0.5,
      show_site_labels: true,
    })
    const stub = run_widget(`structure`, model)
    const { auto_rotate, gizmo } = DEFAULTS.structure
    const scene_props = { atom_radius: 0.5, show_site_labels: true, auto_rotate, gizmo }
    expect(stub.read().scene_props).toMatchObject(scene_props)
    expect(`show_site_labels` in stub.read()).toBe(false)
    model.push_from_python(`atom_radius`, 1.2)
    flushSync()
    expect(stub.read().scene_props).toMatchObject({ atom_radius: 1.2 })
    // cleared -> undefined, re-defaulted downstream by the component
    model.push_from_python(`atom_radius`, null)
    flushSync()
    expect((stub.read().scene_props as { atom_radius?: number }).atom_radius).toBeUndefined()
  })
})

describe(`WIDGET_MODEL_KEYS contract`, () => {
  test(`includes drive deps and interaction keys`, () => {
    expect(WIDGET_MODEL_KEYS.structure).toEqual(
      expect.arrayContaining([`atom_radius`, `selected_sites`, `show_controls`]),
    )
    expect(WIDGET_MODEL_KEYS.scatter_plot).toEqual(
      expect.arrayContaining([
        `active_point`,
        `hovered_point`,
        `selected_point`,
        `show_legend`,
        `marker_renderer`,
      ]),
    )
    expect(WIDGET_MODEL_KEYS.scatter_plot_3d).toContain(`show_legend`)
    const plot_widgets = `scatter_plot scatter_plot_3d bar_plot histogram treemap band_structure
      dos rdf_plot xrd bands_and_dos`
    for (const widget_type of plot_widgets.split(/\s+/)) {
      expect(WIDGET_MODEL_KEYS[widget_type], widget_type).toEqual(
        expect.arrayContaining(Object.keys(controls_traits)),
      )
      expect(WIDGET_MODEL_KEYS[widget_type]).not.toContain(`controls`)
    }
    expect(WIDGET_MODEL_KEYS.treemap).toEqual(
      expect.arrayContaining([
        `label_fit`,
        `label_max_font_size`,
        `label_min_font_size`,
        `parent_label_font_size`,
        `zoom_root_id`,
      ]),
    )
    for (const key of [`color_scale`, `color_bar`])
      expect(WIDGET_MODEL_KEYS.treemap).not.toContain(key)
  })
})

describe(`widget config wiring`, () => {
  test(`trajectory builds a run from the JSON trait and feeds data_url to the file viewer as source`, () => {
    const payload = { frames: [{ step: 0, structure: { sites: [] } }] }
    const model = new MockModel({
      widget_type: `trajectory`,
      trajectory: payload,
      data_url: `/a.xyz`,
    })
    const stub = run_widget(`trajectory`, model)
    expect(stub.read().trajectory).toEqual({ run_of: payload })
    expect(stub.read().source).toBe(`/a.xyz`)
    expect(`data_url` in stub.read()).toBe(false)
    model.push_from_python(`trajectory`, null)
    flushSync()
    expect(stub.read().trajectory).toBeUndefined()
    // a malformed trait fails the mount instead of rendering an empty viewer
    const malformed = new MockModel({ widget_type: `trajectory`, trajectory: `malformed` })
    expect(() => run_widget(`trajectory`, malformed)).toThrow(`malformed trajectory`)
  })

  // LAMMPS atom-type names travel inside loading_options, never as a top-level prop
  test(`trajectory folds atom_type_mapping into loading_options`, () => {
    const mapping = { 1: `Si`, 2: `O` }
    const model = new MockModel({ widget_type: `trajectory`, data_url: `/dump.lammpstrj` })
    const stub = run_widget(`trajectory`, model)
    expect(`loading_options` in stub.read()).toBe(false)
    expect(`atom_type_mapping` in stub.read()).toBe(false)
    model.push_from_python(`atom_type_mapping`, mapping)
    flushSync()
    expect(stub.read().loading_options).toEqual({ atom_type_mapping: mapping })
    expect(`atom_type_mapping` in stub.read()).toBe(false)
    // None or {} drops loading_options entirely, no `{ atom_type_mapping: null }` shell
    for (const cleared of [null, {}]) {
      model.push_from_python(`atom_type_mapping`, mapping)
      flushSync()
      model.push_from_python(`atom_type_mapping`, cleared)
      flushSync()
      expect(`loading_options` in stub.read()).toBe(false)
    }
    expect(WIDGET_MODEL_KEYS.trajectory).toContain(`atom_type_mapping`)
  })

  test.each([
    [`trajectory`, `property_labels`, { energy: `Energy (eV)` }],
    [`bands_and_dos`, `fermi_level`, 0],
    [`periodic_table`, `color_scale`, { type: `log`, value_range: [1, null] }],
    [`periodic_table`, `color_bar`, null],
    [`heatmap_matrix`, `color_bar`, { orientation: `vertical` }],
    [`fermi_surface`, `color_bar`, null],
    [`fermi_surface`, `color_bar`, { title: `Velocity` }],
    [`composition`, `patterns`, { Fe: `/`, O: { shape: `dots`, size: 6 } }],
    [`scatter_plot_3d`, `point_tween`, { duration: 300, delay: 50 }],
    [`structure`, `cutaway`, { mode: `slab`, axis: 2, position: 0.5, thickness: 0.2 }],
    [`structure`, `highlighted_sites`, [1, 4]],
    [`scatter_plot`, `selected_point`, { series_idx: 0, point_idx: 3 }],
    // None must reach the component (hides it), not fall back to its default
    [`scatter_plot`, `color_bar`, null],
    [`scatter_plot`, `size_legend`, null],
    [`scatter_plot`, `density_contours`, { levels: 3, filled: true }],
    [`chem_pot_diagram`, `width`, 480],
    [`chem_pot_diagram`, `height`, 360],
    [`bands_and_dos`, `bz_props`, { show_ibz: true }],
  ] as const)(`%s forwards %s directly`, (widget_type, prop, value) => {
    const stub = run_widget(widget_type, new MockModel({ widget_type, [prop]: value }))
    expect(stub.read()[prop]).toEqual(value)
  })

  // Trajectory has no top-level cutaway: it reaches the embedded Structure via structure_props
  test(`trajectory forwards cutaway inside structure_props`, () => {
    const cutaway = { mode: `plane`, axis: 0, position: 0.3, thickness: 0.25 }
    const props = run_widget(
      `trajectory`,
      new MockModel({ widget_type: `trajectory`, cutaway }),
    ).read()
    expect(props.structure_props).toMatchObject({ cutaway })
    expect(`cutaway` in props).toBe(false)
  })

  test.each([
    [`scatter_plot`, `x`, { show_legend: false, marker_renderer: `canvas` }],
    [`bar_plot`, `y`, {}],
    [`histogram`, `y`, {}],
  ] as const)(`%s maps the %s range trait into axis config`, (widget_type, axis, extra) => {
    const model = new MockModel({
      widget_type,
      series: [],
      [`${axis}_axis`]: { label: `Count` },
      [`${axis}_range`]: [1, 5],
      ...controls_traits,
      ...extra,
    })
    const props = run_widget(widget_type, model).read()
    expect(props[`${axis}_axis`]).toEqual({ label: `Count`, range: [1, 5] })
    expect(pick(props, { ...controls_traits, ...extra })).toEqual({
      ...controls_traits,
      ...extra,
    })
    expect(`${axis}_range` in props).toBe(false)
    expect(`controls` in props).toBe(false)
  })

  // the Bands/Dos/RdfPlot/XrdPlot wrappers hand the pane attribute props to PlotControls
  test.each([`scatter_plot_3d`, `band_structure`, `dos`, `rdf_plot`, `xrd`] as const)(
    `%s forwards flat controls including the pane attribute props`,
    (widget_type) => {
      const props = run_widget(
        widget_type,
        new MockModel({ widget_type, ...controls_traits }),
      ).read()
      expect(pick(props, controls_traits)).toEqual(controls_traits)
      expect(`controls` in props).toBe(false)
    },
  )

  // pymatgen as_dict() documents reach Bands/Dos normalized, as {label: document} records
  test.each([
    [`band_structure`, [`band_structs`]],
    [`dos`, [`doses`]],
    [`bands_and_dos`, [`band_structs`, `doses`]],
  ] as const)(`%s normalizes lone and labeled spectral documents`, (widget_type, keys) => {
    const doc = { kind: `doc` }
    // mount with every spectral trait of the widget set to value
    const read_with = (value: unknown) => {
      const traits = Object.fromEntries(keys.map((key) => [key, value]))
      return run_widget(widget_type, new MockModel({ widget_type, ...traits })).read()
    }
    const lone = read_with(doc)
    for (const key of keys) expect(lone[key]).toEqual({ '': { normalized: doc } })
    const labeled = read_with({ DFT: doc, MACE: doc })
    for (const key of keys)
      expect(labeled[key]).toEqual({ DFT: { normalized: doc }, MACE: { normalized: doc } })
    expect(() => read_with({ DFT: 1 })).toThrow(`"DFT"`)
  })

  test(`bands_and_dos forwards controls into both child prop bags`, () => {
    const model = new MockModel({
      widget_type: `bands_and_dos`,
      show_legend: false,
      ...controls_traits,
    })
    const props = run_widget(`bands_and_dos`, model).read()
    expect(props.bands_props).toEqual({ show_legend: false, ...controls_traits })
    expect(props.dos_props).toMatchObject(controls_traits)
    expect(`show_controls` in props).toBe(false)
  })
})

// A missing/None writeback trait seeds (and reverts to) the component fallback, never null
describe(`writeback wiring`, () => {
  test.each([
    [`structure`, `selected_sites`, [], [3], [5, 6]],
    [`structure`, `hovered_site_idx`, null, 2, 9],
    [`structure`, `active_volume_id`, null, `potential`, `spin`],
    [`structure`, `display_mode`, `structure`, `slice`, `structure`],
    [`structure`, `slice_settings`, {}, { position: 0.25 }, { position: 0.75 }],
    [`structure`, `active_pane`, null, `flight`, `export`],
    [`trajectory`, `current_step_idx`, 0, 7, 3],
    [`trajectory`, `display_mode`, `auto`, `plot`, `structure`],
    [`trajectory`, `plot_type`, `time-series`, `distribution`, `time-series`],
    [`trajectory`, `distribution_property`, null, `energy`, `force_max`],
    [`trajectory`, `active_pane`, null, `hotspots`, `flight`],
    [`trajectory`, `data_inspector_open`, true, false, true],
    [`scatter_plot`, `controls_open`, false, true, false],
    [`histogram`, `selected_series_idx`, 0, 2, 1],
    [`treemap`, `zoom_root_id`, null, `root/child-a`, `root/child-b`],
  ] as const)(
    `%s %s round-trips and falls back when cleared`,
    (widget_type, key, default_value, local_value, python_value) => {
      const model = new MockModel({ widget_type })
      const stub = run_widget(widget_type, model)
      expect(stub.read()[key]).toEqual(default_value)
      expect(model.save_count).toBe(0) // initial writeback effects are no-ops
      stub.write(key, local_value)
      flushSync()
      expect(model.state[key]).toEqual(local_value)
      // Python -> component without a writeback echo
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
  // via the real entry point, so cleanup_element + cleanups wiring is covered too
  test(`the render() disposer unregisters all model listeners`, () => {
    const model = new MockModel({ widget_type: `structure` })
    const element = document.createElement(`div`)
    document.body.append(element)
    // as never: RenderProps also wants signal/host/experimental, unused here
    // oxlint-disable-next-line no-unnecessary-type-assertion -- svelte-check needs it
    const dispose = anywidget_module.default.render({
      model: as_model(model),
      el: element,
    } as never) as () => void
    flushSync()
    expect(listener_count(model)).toBeGreaterThan(0)
    dispose()
    expect(listener_count(model)).toBe(0)
  })

  // regression: a mount throwing on a malformed trait leaked every model listener, and
  // render() left the theme watcher running and the partial DOM in place
  test(`a throwing mount unregisters the model listeners it added`, () => {
    const model = new MockModel({ widget_type: `throwing`, series: [] })
    const element = document.createElement(`div`)
    const component = () => {
      element.append(document.createElement(`span`))
      throw new Error(`bad trait`)
    }
    WIDGETS.throwing = { ...WIDGETS.scatter_plot, component }
    expect(() => mount_spec(as_model(model), element, WIDGETS.throwing)).toThrow(`bad trait`)
    expect(listener_count(model)).toBe(0)
    stop_theme.mockClear()
    const render_props = { model: as_model(model), el: element } as never
    expect(() => anywidget_module.default.render(render_props)).toThrow(`bad trait`)
    delete WIDGETS.throwing
    expect([listener_count(model), stop_theme.mock.calls.length]).toEqual([0, 1])
    // the partial DOM gives way to the error: anywidget itself only logs it, leaving a blank cell
    expect(element.querySelector(`span`)).toBeNull()
    expect(element.textContent).toMatch(/^MatterViz throwing: bad trait/) // + Svelte's dev stack
    const unknown = {
      model: as_model(new MockModel({ widget_type: `toString` })),
      el: element,
    }
    expect(() => anywidget_module.default.render(unknown as never)).toThrow(
      `Unknown or missing`,
    )
    expect(element.textContent).toBe(
      `MatterViz toString: Unknown or missing widget_type: 'toString'`,
    )
  })

  // the view no longer reflects Python's state, so it gives way to the error instead of
  // the change handler's exception reaching only the console
  test(`a malformed trait update tears the widget down and shows the error`, () => {
    const console_error = vi.spyOn(console, `error`).mockImplementation(() => {})
    const model = new MockModel({ widget_type: `trajectory` })
    const element = document.createElement(`div`)
    stop_theme.mockClear()
    void anywidget_module.default.render({ model: as_model(model), el: element } as never)
    model.push_from_python(`trajectory`, `malformed`)
    expect(element.textContent).toBe(`MatterViz trajectory: malformed trajectory`)
    expect([listener_count(model), stop_theme.mock.calls.length]).toEqual([0, 1])
    expect(console_error).toHaveBeenCalledOnce()
  })
})
