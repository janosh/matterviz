// @vitest-environment happy-dom
import { is_plain_object } from 'svelte-widgets/utils'
import { DEFAULTS } from '../../src/lib/settings'
import { DATA_PROPS } from '../../extensions/anywidget/reactive.svelte'
import { flushSync } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { inline_workers, widget_scope } from '../../extensions/anywidget/vite.config'
import { widget_components } from '../../src/vite-plugins'
import { COMPONENTS } from '../../src/elements/components'
import { scoped_app_css } from '../../src/elements/scoped-css'
import { MockModel } from './anywidget-mock-model'
import { renderer_stub, reset_stub } from './reactive-renderer-registry'
import { library_prop_docs } from './setup'

const component_name = (path: string): string => path.slice(path.lastIndexOf(`/`) + 1)
const { check_blob_workers, spectral_doc } = vi.hoisted(() => ({
  check_blob_workers: vi.fn(),
  // the generic wiring test's string seeds count as documents
  spectral_doc: (doc: unknown) =>
    typeof doc === `string` || (doc as { kind?: string } | null)?.kind === `doc`
      ? { normalized: doc }
      : null,
}))
const set_moyo_wasm_source = vi.hoisted(() => vi.fn())
// Swap matterviz components for a recording stub to exercise the real widget wiring
// without mounting WebGL/SVG components or pulling the built dist bundle
vi.mock(`matterviz`, async () => {
  const stub_module = await import(`./reactive-renderer-stub.svelte`)
  // the registry's components only (a widget importing any other fails the import), each its
  // own function so a spec mounting the wrong one is caught
  const stubs = Object.values(COMPONENTS).map((path) => [
    component_name(path),
    stub_module.default.bind(null),
  ])
  return {
    ...Object.fromEntries(stubs),
    volume_from_json: (raw: unknown) => raw,
    // binary envelopes dispatch to their own decoders (real ones: anywidget-binary.test.ts)
    volume_from_binary: (raw: unknown) => ({ binary_volume: raw }),
    trajectory_from_binary: (value: unknown) => ({ binary_run_of: value }),
    is_plain_object,
    set_moyo_wasm_source,
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
// The build's per-widget loaders (widget_components), resolving each widget_type's stubbed
// registry component. Tests add loaders for their probe widget types
const load_component = vi.hoisted(
  (): Record<string, () => Promise<{ default: unknown }>> => ({}),
)
vi.mock(`virtual:matterviz-widget-components`, async () => {
  const stubs = await vi.importMock<Record<string, unknown>>(`matterviz`)
  for (const [widget_type, path] of Object.entries(COMPONENTS)) {
    load_component[widget_type] = async () => ({ default: stubs[component_name(path)] })
  }
  return { default: load_component }
})
vi.mock(`matterviz/workers`, () => ({ check_blob_workers }))
vi.stubGlobal(`SCOPED_APP_CSS`, ``) // vite.config.ts defines it as the scoped app.css
vi.mock(`matterviz/theme`, () => ({ COLOR_THEMES: {} }))
const { stop_theme } = vi.hoisted(() => ({ stop_theme: vi.fn() }))
vi.mock(`matterviz/theme/embedded`, () => ({
  detect_parent_theme: () => `light`,
  watch_theme: () => stop_theme,
}))

const anywidget_module = await import(`../../extensions/anywidget/anywidget`)
const { WIDGETS, WIDGET_MODEL_KEYS, mount_spec } = anywidget_module
// not `import()`: its types resolve through dist/, which a lint-only CI job never builds
const matterviz = await vi.importMock<Record<string, unknown>>(`matterviz`)
// read now: mock call records don't survive into the tests
const check_blob_workers_calls = [...check_blob_workers.mock.calls]

test(`importing the widget bundle probes blob: workers once`, () => {
  expect(check_blob_workers_calls).toEqual([[`MatterViz`]])
})

// inline_workers' transform as Vite calls it (it reads nothing from the plugin context)
const transform_inline_workers = inline_workers.transform as (
  code: string,
  identifier: string,
) => { code: string } | null
test(`anywidget inline_workers rewrites new Worker(new URL(...), options) to an inline import`, () => {
  const code = `new Worker(\n  new URL('./b.js', import.meta.url),\n  opts,\n)`
  expect(transform_inline_workers(code, `/x.js`)?.code).toBe(
    `import __inline_worker_0 from "./b.js?worker&inline"\nnew __inline_worker_0(\n  opts,\n)`,
  )
  expect(() =>
    transform_inline_workers(`new Worker(new URL(\`./a.js\`, import.meta.url))`, `/x.js`),
  ).toThrow(/unmatched new Worker/)
})

// each widget loads its own registry component (its own chunk in the split build), and one
// for every spec, so no widget mounts another's component or none
test(`widget_components loads each widget_type's registry component from lib_dir`, () => {
  const load = widget_components(`/lib`).load as (id: string) => string | null
  expect(load(`virtual:matterviz-widget-components`)).toBeNull() // only the resolved \0 id
  const code = load(`\0virtual:matterviz-widget-components`) ?? ``
  // "<widget_type>": () => import("<path>") per loader, whatever the surrounding formatting
  const loaders = [
    ...code.matchAll(/"(?<widget_type>\w+)":\s*\(\)\s*=>\s*import\("(?<file>[^"]+)"\)/g),
  ].map(({ groups }) => [groups?.widget_type, groups?.file])
  expect(Object.fromEntries(loaders)).toEqual(
    Object.fromEntries(
      Object.entries(COMPONENTS).map(([widget_type, path]) => [
        widget_type,
        `/lib/${path}.svelte`,
      ]),
    ),
  )
  expect(loaders).toHaveLength(Object.keys(COMPONENTS).length) // no duplicate keys
  expect(new Set(Object.keys(COMPONENTS))).toEqual(new Set(Object.keys(WIDGETS)))
})

const as_model = (mock: MockModel) => mock as unknown as Parameters<typeof mount_spec>[0]
const listener_count = (model: MockModel) =>
  Object.values(model.listeners).reduce((sum, set) => sum + set.size, 0)

// Mount one widget's spec into a fresh DOM target and return the stub it mounted
const run_widget = (widget_type: string, model: MockModel) => {
  reset_stub() // clear any prior stub so a failed mount throws instead of returning stale
  const element = document.createElement(`div`)
  document.body.append(element)
  const component =
    matterviz[component_name(COMPONENTS[widget_type as keyof typeof COMPONENTS])]
  mount_spec(as_model(model), element, WIDGETS[widget_type], component as never)
  flushSync() // settle the initial writeback effects (all no-ops)
  return renderer_stub()
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

// reactive_widget keeps undefined DATA_PROPS keys, whose setter lets a component write data it
// loads back unproxied, but Svelte throws props_invalid_value for an undefined $bindable with a
// default: the widgets' real components must declare none
// the custom elements define an accessor per prop, which shadows an HTMLElement member of that name
test(`no widget prop binds defaulted data or shadows the DOM`, async () => {
  const library_docs = await library_prop_docs()
  // the registry shared with the custom elements: src/lib paths by widget_type
  const docs = Object.values(COMPONENTS).map((path) => {
    const doc = library_docs[component_name(path)]
    if (!doc) throw new Error(`No prop docs for widget component src/lib/${path}.svelte`)
    return [component_name(path), doc] as const
  })
  const defaulted = docs.flatMap(([component, { props }]) =>
    props
      .filter(({ name, bindable, default: init }) => bindable && DATA_PROPS.has(name) && init)
      .map(({ name, default: init }) => `${component}.${name} = ${init}`),
  )
  expect(defaulted).toEqual([])
  const names = docs.flatMap(([, { props }]) => props.map(({ name }) => name))
  expect(new Set(names.filter((name) => name in HTMLElement.prototype))).toEqual(
    new Set([`children`, `id`, `normalize`, `onkeydown`, `style`, `title`]),
  )
})

// allow_file_drop reaches only viewers that declare it; others would spread it onto a div
const drop_zones = `structure trajectory convex_hull fermi_surface brillouin_zone phase_diagram
  ternary_phase_diagram xrd rdf_plot coordination_bar_plot`
const drop_zone_widgets = new Set(drop_zones.split(/\s+/))

// The stylesheet the bundle injects into the notebook page
test(`scoped_app_css leaves only zero-specificity theme tokens outside the widget scope`, () => {
  const parts = scoped_app_css(widget_scope).split(`@scope (${widget_scope}) {`)
  expect(parts).toHaveLength(2)
  const [tokens, scoped] = parts
  const selectors = [...tokens.matchAll(/^[^{}\n][^{}]*(?=\{)/gm)].map(([selector]) =>
    selector.trim().replaceAll(/\s+/g, ` `),
  )
  expect(selectors).toEqual([
    `:where(:root), :host`,
    `:where(:root[data-theme='white']), :host([data-theme='white'])`,
    `:where(:root[data-theme='black']), :host([data-theme='black'])`,
    `:where(:root)`,
  ])
  // the host page keeps its own color-scheme and body/link/heading styles
  expect(tokens).not.toContain(`color-scheme`)
  expect(scoped).not.toContain(`matterviz-shell`)
  // bare-element rules apply, but only inside a widget
  for (const rule of [`button {`, `input[type='range'] {`, `table {`]) {
    expect(tokens).not.toContain(rule)
    expect(scoped).toContain(rule)
  }
})

// Each spec's own compute is the oracle; writeback props are covered by the round-trip tests
test.each(Object.entries(WIDGETS))(
  `%s mounts its registry component, seeds, re-drives on every dep change and gets allow_file_drop iff it has a drop zone`,
  (widget_type, spec) => {
    const model = seeded_model(widget_type, spec)
    const stub = run_widget(widget_type, model)
    expect(stub.read().allow_file_drop).toBe(
      drop_zone_widgets.has(widget_type) ? false : undefined,
    )
    const driven_props = spec.drive.filter((driven_prop) => !driven_prop.writeback)
    // callbacks are fresh closures per compute, so only their presence can match
    const comparable = (value: unknown) => (typeof value === `function` ? Function : value)
    const expect_driven = (
      prop: string,
      compute: (typeof driven_props)[number][`compute`],
    ) => {
      const expected = comparable(compute(as_model(model)))
      expect(comparable(stub.read()[prop])).toEqual(expected)
    }
    for (const { prop, compute } of driven_props) expect_driven(prop, compute)
    // bump every dep, so a missing listener on a multi-dep derived prop is caught
    for (const { prop, compute, deps } of driven_props) {
      for (const dep of deps) {
        model.push_from_python(dep, `bumped:${dep}`)
        flushSync()
        expect_driven(prop, compute)
      }
    }
  },
)

// unset, a click keeps pinning the tile (tooltip and inset plot): no on_activate reaches it
test(`periodic_table tile clicks toggle active_elements only once Python sets a list`, () => {
  const model = new MockModel({ widget_type: `periodic_table`, active_elements: null })
  const stub = run_widget(`periodic_table`, model)
  expect(stub.read().on_activate).toBeUndefined()
  model.push_from_python(`active_elements`, [`Fe`])
  flushSync()
  const click = (symbol: string) => {
    ;(stub.read().on_activate as (elem: { symbol: string }) => void)({ symbol })
    flushSync()
  }
  click(`O`)
  expect(model.state.active_elements).toEqual([`Fe`, `O`])
  click(`Fe`)
  expect(model.state.active_elements).toEqual([`O`])
  expect(stub.read().active_elements).toEqual([`O`])
})

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
    [
      `binary envelope beside JSON`,
      [{ format: `matterviz-binary-v1`, kind: `volume` }, `density`],
      [{ binary_volume: { format: `matterviz-binary-v1`, kind: `volume` } }, `density`],
    ],
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
    // one spec per component of the registry shared with the custom elements
    expect(new Set(Object.keys(WIDGET_MODEL_KEYS))).toEqual(new Set(Object.keys(COMPONENTS)))
    expect(WIDGET_MODEL_KEYS.structure).toEqual(
      expect.arrayContaining([`atom_radius`, `selected_sites`, `show_controls`]),
    )
    expect(WIDGET_MODEL_KEYS.scatter_plot).toEqual(
      expect.arrayContaining([
        `active_point`,
        `hovered_point`,
        `selected_point`,
        `highlighted_ids`,
        `show_legend`,
        `marker_renderer`,
      ]),
    )
    expect(WIDGET_MODEL_KEYS.scatter_plot_3d).toContain(`show_legend`)
    expect(WIDGET_MODEL_KEYS.binned_scatter_plot).toEqual(
      expect.arrayContaining([`series`, `annotation`, `render_mode`, `color_bar`, `x_range`]),
    )
    expect(WIDGET_MODEL_KEYS.periodic_table).toEqual(
      expect.arrayContaining([
        `tile_plots`,
        `tile_plot_config`,
        `split_layout`,
        `tile_props`,
        `active_elements`,
      ]),
    )
    // computes its own series from the structures
    expect(WIDGET_MODEL_KEYS.coordination_bar_plot).toEqual(
      expect.arrayContaining([`structures`, `split_mode`, `mode`]),
    )
    expect(WIDGET_MODEL_KEYS.coordination_bar_plot).not.toContain(`series`)
    const plot_widgets = `scatter_plot scatter_plot_3d bar_plot histogram treemap band_structure
      dos rdf_plot xrd bands_and_dos sunburst sankey box_plot ternary_plot neb_plot eos_plot
      coordination_bar_plot`
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
    const envelope = { format: `matterviz-binary-v1`, kind: `trajectory`, arrays: {} }
    model.push_from_python(`trajectory`, envelope)
    flushSync()
    expect(stub.read().trajectory).toEqual({ binary_run_of: envelope })
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

  // large series arrive as binary plot-series envelopes and reach the component as typed
  // arrays next to their JSON series and fields; plain JSON series pass through unchanged
  test.each([
    `scatter_plot`,
    `binned_scatter_plot`,
    `bar_plot`,
    `histogram`,
    `box_plot`,
    `scatter_plot_3d`,
    `ternary_plot`,
  ] as const)(`%s decodes binary series`, (widget_type) => {
    const x = Float64Array.of(1, 2, 3)
    const binary = {
      format: `matterviz-binary-v1`,
      kind: `plot-series`,
      arrays: { x: { dtype: `float64`, shape: [3], data: new DataView(x.buffer) } },
      label: `big`,
    }
    const json = { x: [0], y: [1], label: `small` }
    const props = run_widget(
      widget_type,
      new MockModel({ widget_type, series: [binary, json] }),
    ).read()
    expect(props.series).toEqual([{ label: `big`, x }, json])
  })

  // binned_scatter_plot has no settings pane, so no controls traits
  test.each([
    [
      `scatter_plot`,
      `x`,
      { show_legend: false, marker_renderer: `canvas`, ...controls_traits },
    ],
    [`bar_plot`, `y`, controls_traits],
    [`histogram`, `y`, controls_traits],
    [`binned_scatter_plot`, `x`, { annotation: `MAE = 0.1` }],
  ] as const)(`%s maps the %s range trait into axis config`, (widget_type, axis, extra) => {
    const model = new MockModel({
      widget_type,
      series: [],
      [`${axis}_axis`]: { label: `Count` },
      [`${axis}_range`]: [1, 5],
      ...extra,
    })
    const props = run_widget(widget_type, model).read()
    expect(props[`${axis}_axis`]).toEqual({ label: `Count`, range: [1, 5] })
    expect(pick(props, extra)).toEqual(extra)
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
    [`sunburst`, `zoom_root_id`, null, `root/child-a`, `root/child-b`],
    [`ternary_phase_diagram`, `selected_phase`, null, 2, 0],
    [`ternary_phase_diagram`, `pinned_composition`, null, [0.2, 0.3], [0.5, 0.1]],
    [`neb_plot`, `active_path_key`, ``, `path_a`, `path_b`],
    [`neb_plot`, `active_image_idx`, 0, 3, 1],
    [`eos_plot`, `fits`, [], [{ kind: `vinet`, rmse: 0.01 }], [{ kind: `murnaghan` }]],
    [`phonon_mode_explorer`, `selection`, null, { mode_idx: 2 }, { mode_idx: 5 }],
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
  // and hands a host-served moyo WASM to the main thread, which inline workers can't see
  test(`the render() disposer unregisters all model listeners`, async () => {
    const model = new MockModel({ widget_type: `structure` })
    const element = document.createElement(`div`)
    document.body.append(element)
    vi.stubGlobal(`matterviz_moyo_wasm_url`, `http://localhost/moyo.wasm`)
    // as never: RenderProps also wants signal/host/experimental, unused here
    // oxlint-disable-next-line no-unnecessary-type-assertion -- svelte-check needs it
    const dispose = (await anywidget_module.default.render({
      model: as_model(model),
      el: element,
    } as never)) as () => void
    vi.unstubAllGlobals()
    expect(set_moyo_wasm_source).toHaveBeenCalledExactlyOnceWith(`http://localhost/moyo.wasm`)
    flushSync()
    expect(listener_count(model)).toBeGreaterThan(0)
    // the app styles reach only into elements of the scope class, which render() gives the widget
    expect(element.matches(widget_scope)).toBe(true)
    expect(document.querySelector(`style#matterviz-widget-styles`)?.textContent).toBe(
      `.cell-output-ipywidget-background:has(${widget_scope}) { background: transparent !important; }\n`,
    )
    dispose()
    expect(listener_count(model)).toBe(0)
  })

  // regression: a mount throwing on a malformed trait leaked every model listener, and
  // render() left the theme watcher running and the partial DOM in place
  test(`a throwing mount unregisters the model listeners it added`, async () => {
    const model = new MockModel({ widget_type: `throwing`, series: [], _synced_keys: [] })
    const element = document.createElement(`div`)
    const component = () => {
      element.append(document.createElement(`span`))
      throw new Error(`bad trait`)
    }
    WIDGETS.throwing = WIDGETS.scatter_plot
    load_component.throwing = async () => ({ default: component })
    expect(() =>
      mount_spec(as_model(model), element, WIDGETS.throwing, component as never),
    ).toThrow(`bad trait`)
    expect(listener_count(model)).toBe(0)
    stop_theme.mockClear()
    const render_props = { model: as_model(model), el: element } as never
    await expect(anywidget_module.default.render(render_props)).rejects.toThrow(`bad trait`)
    delete WIDGETS.throwing
    delete load_component.throwing
    expect([listener_count(model), stop_theme.mock.calls.length]).toEqual([0, 1])
    // the partial DOM gives way to the error: anywidget itself only logs it, leaving a blank cell
    expect(element.querySelector(`span`)).toBeNull()
    expect(element.textContent).toMatch(/^MatterViz throwing: bad trait/) // + Svelte's dev stack
    const unknown = {
      model: as_model(new MockModel({ widget_type: `toString` })),
      el: element,
    }
    await expect(anywidget_module.default.render(unknown as never)).rejects.toThrow(
      `Unknown or missing`,
    )
    expect(element.textContent).toBe(
      `MatterViz toString: Unknown or missing widget_type: 'toString'`,
    )
  })

  // a wrapper/bundle version mismatch names the traits the bundle would silently drop and
  // both fixes, since either side can be the stale one
  test.each([
    [[`series`, `widget_type`, `style`, `show_controls`, `x_axis`], null],
    [
      [`series`, `ghost_trait`, `other_ghost`],
      `scatter_plot trait(s) ghost_trait, other_ghost. Python wrapper and bundle versions differ`,
    ],
    [`series`, `_synced_keys must be a list of trait names, got string`],
    [undefined, `_synced_keys must be a list of trait names, got undefined`],
  ])(`render() checks _synced_keys %j against the spec`, async (synced_keys, error) => {
    const model = new MockModel({ widget_type: `scatter_plot`, _synced_keys: synced_keys })
    const element = document.createElement(`div`)
    const render_props = { model: as_model(model), el: element } as never
    if (error === null) {
      const dispose = (await anywidget_module.default.render(render_props)) as () => void
      dispose()
      return
    }
    await expect(anywidget_module.default.render(render_props)).rejects.toThrow(error)
    expect(element.textContent).toMatch(/^MatterViz scatter_plot: /)
    expect(element.textContent).toContain(error)
    expect(element.textContent).toMatch(
      /with the Python package version this bundle matches, or load the bundle version matching the Python package\.$/,
    )
    expect(listener_count(model)).toBe(0) // thrown before mount added any
  })

  // the view no longer reflects Python's state, so it gives way to the error instead of
  // the change handler's exception reaching only the console
  test(`a malformed trait update tears the widget down and shows the error`, async () => {
    const console_error = vi.spyOn(console, `error`).mockImplementation(() => {})
    const model = new MockModel({ widget_type: `trajectory` })
    const element = document.createElement(`div`)
    stop_theme.mockClear()
    await anywidget_module.default.render({ model: as_model(model), el: element } as never)
    model.push_from_python(`trajectory`, `malformed`)
    expect(element.textContent).toBe(`MatterViz trajectory: malformed trajectory`)
    expect([listener_count(model), stop_theme.mock.calls.length]).toEqual([0, 1])
    expect(console_error).toHaveBeenCalledOnce()
  })

  // the component loads asynchronously (its own chunks in the split build), so an element
  // rendered again meanwhile must mount only the later widget
  test(`rendering an element again while its component loads cancels the first render`, async () => {
    const element = document.createElement(`div`)
    const [first, second] = [`structure`, `scatter_plot`].map(
      (widget_type) => new MockModel({ widget_type }),
    )
    stop_theme.mockClear()
    const renders = [first, second].map((model) =>
      anywidget_module.default.render({ model: as_model(model), el: element } as never),
    )
    const [first_cleanup, second_cleanup] = [
      await renders[0],
      await renders[1],
    ] as (() => void)[]
    expect([listener_count(first), listener_count(second) > 0]).toEqual([0, true])
    expect(stop_theme).toHaveBeenCalledOnce() // the cancelled render's theme watcher
    first_cleanup() // a no-op: the later widget stays mounted
    expect(listener_count(second)).toBeGreaterThan(0)
    second_cleanup()
    expect([listener_count(second), stop_theme.mock.calls.length]).toEqual([0, 2])
  })
})

describe(`export_svg`, () => {
  afterEach(() => {
    delete WIDGETS.export_probe
    delete load_component.export_probe
  })
  // happy-dom lays nothing out, so each node reports the size its `size` attribute names
  const sized = (tag: string, size: [number, number], ns = `http://www.w3.org/2000/svg`) => {
    const node = document.createElementNS(ns, tag)
    const [width, height] = size
    node.getBoundingClientRect = () => new DOMRect(0, 0, width, height)
    return node
  }
  const render_with = async (spec_extra: object, build: (element: HTMLElement) => void) => {
    const element = document.createElement(`div`)
    document.body.append(element)
    WIDGETS.export_probe = { ...WIDGETS.scatter_plot, ...spec_extra }
    load_component.export_probe = async () => ({ default: () => build(element) })
    const model = new MockModel({ widget_type: `export_probe`, series: [], _synced_keys: [] })
    const dispose = await anywidget_module.default.render({
      model: as_model(model),
      el: element,
    } as never)
    return { element, dispose: dispose as () => void }
  }

  test(`serializes the largest SVG, not icons, through the in-app serializer`, async () => {
    const { element, dispose } = await render_with({}, (root) => {
      const icon = sized(`svg`, [12, 12])
      icon.setAttribute(`id`, `icon`)
      const chart = sized(`svg`, [200, 100])
      chart.setAttribute(`viewBox`, `0 0 200 100`)
      chart.setAttribute(`aria-label`, `Bar chart`)
      const dot = sized(`circle`, [2, 2])
      dot.setAttribute(`cx`, `1.23456`)
      dot.setAttribute(`data-idx`, `0`)
      chart.append(dot)
      root.append(icon, chart)
    })
    const markup = anywidget_module.export_svg(element)
    expect(markup.startsWith(`<?xml version="1.0" encoding="UTF-8"?>\n<svg`)).toBe(true)
    // sized, rounded and stripped of interaction attributes by svg_to_string
    expect(markup).toContain(`width="200"`)
    expect(markup).toContain(`cx="1.23"`)
    expect(markup).not.toMatch(/icon|data-idx|aria-label/)
    // the accessible name survives as a <title>
    expect(markup).toContain(`<title>Bar chart</title>`)
    dispose()
    expect(() => anywidget_module.export_svg(element)).toThrow(`No rendered MatterViz widget`)
  })

  const html_ns = `http://www.w3.org/1999/xhtml`
  test(`HTML figures are redrawn as SVG`, async () => {
    const { element } = await render_with({ html_figure: `.figure` }, (root) => {
      // a tile-sized inset SVG must not be taken for the figure, nor a sibling the
      // component's own Export pane leaves out
      const grid = sized(`div`, [300, 200], html_ns)
      grid.classList.add(`figure`)
      grid.append(sized(`svg`, [40, 40]))
      root.append(sized(`div`, [500, 500], html_ns), grid)
    })
    const markup = anywidget_module.export_svg(element)
    // the grid's own frame, with the inset redrawn inside it
    expect(markup).toContain(`viewBox="0 0 300 200"`)
    expect(markup.match(/<svg/g)).toHaveLength(2)
  })

  const chart = () => sized(`svg`, [200, 100])
  const canvas = () => sized(`canvas`, [200, 100], html_ns)
  const in_node = (node: Element, ...children: Element[]) => {
    node.append(...children)
    return node
  }
  test.each([
    [`a canvas beside the SVG`, {}, () => [chart(), canvas()], `canvas content`],
    [
      `a canvas inside an HTML figure`,
      { html_figure: `div` },
      () => [in_node(sized(`div`, [200, 100], html_ns), canvas())],
      `canvas content`,
    ],
    [`no SVG`, {}, () => [], `no <svg> figure`],
    [`a missing HTML figure`, { html_figure: `.figure` }, () => [], `no .figure figure`],
    // canvas markers: exported as an image
    [
      `a canvas in the SVG's foreignObject`,
      {},
      () => [in_node(chart(), in_node(sized(`foreignObject`, [200, 100]), canvas()))],
      null,
    ],
  ])(`%s`, async (_label, spec_extra, build, message) => {
    const { element } = await render_with(spec_extra, (root) => root.append(...build()))
    const exported = () => anywidget_module.export_svg(element)
    if (message) expect(exported).toThrow(`MatterViz export_probe renders ${message}`)
    else expect(exported()).toContain(`<svg`)
  })
})
