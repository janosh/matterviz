import { materialize_frame_result } from '#lib/trajectory/frame.js'
import { parse_file_content } from '#lib/file-viewer/parse.js'
import type {
  StructureToolPrediction,
  StructureToolOverlay,
  StructureToolProvenance,
  StructureToolRun,
  StructureToolVolume,
} from '#lib/structure/host-tool.svelte.js'
import { create_structure_tool_controller } from '#lib/structure/host-tool.svelte.js'
import {
  apply_tool_geometry,
  prediction_to_json,
  prediction_from_json,
} from '#lib/structure/prediction.js'
import { replace_tool_volumes } from '#lib/structure/host-tool-volumes.js'
import { auto_volume_layer, type IsosurfaceLayer } from '#lib/isosurface/types.js'
import { make_demo_trajectory } from '../../../src/routes/(demos)/structure/host-tool/demo'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import type { AnyStructure } from '#lib/structure/index.js'
import type { StructureToolGeometry } from '#lib/structure/prediction.js'
import { create_frac_to_cart, det_3x3, type Matrix3x3, type Vec3 } from '#lib/math.js'
import {
  fcc_primitive_matrix,
  make_crystal,
  make_grid,
  make_molecule,
  make_volume,
} from '../test-fixtures'

const provenance: StructureToolProvenance = {
  model: `example`,
  version: `1.2`,
  units: { charge: `e`, density: `e/A^3` },
  settings: { seed: 0 },
}
const volume = (identifier: string) => ({
  ...make_volume(make_grid(2, 2, 2, () => 1)),
  id: identifier,
})

const controller_fixture = (
  structure: AnyStructure = make_crystal(1, [{ element: `H`, abc: [0, 0, 0] }]),
) => {
  const state = { structure, owner: {} as object | null }
  const on_prediction = vi.fn<(prediction: StructureToolPrediction | null) => void>()
  const on_view = vi.fn()
  const on_replace_input = vi.fn((geometry: StructureToolGeometry) => {
    state.structure = apply_tool_geometry(state.structure, geometry)
  })
  const controller = create_structure_tool_controller(
    () => state.structure,
    () => state.owner,
    on_prediction,
    on_view,
    () => JSON.stringify(state.structure),
    on_replace_input,
  )
  onTestFinished(() => controller.dispose())
  return { state, on_prediction, on_view, on_replace_input, controller }
}

describe(`host prediction ownership`, () => {
  test.each([`molecule`, `xyz`, `abc`, `both`] as const)(
    `starts predictions from %s JSON with omitted site properties`,
    async (coordinates) => {
      const source = make_crystal(2, [
        { element: `H`, abc: [0, 0, 0] },
        { element: `He`, abc: [0.5, 0.5, 0.5] },
      ])
      Reflect.deleteProperty(source.sites[0], `properties`)
      source.sites[1].properties = { charge: 0.5 }
      if (coordinates === `molecule`) Reflect.deleteProperty(source, `lattice`)
      for (const site of source.sites) {
        if (coordinates === `abc`) Reflect.deleteProperty(site, `xyz`)
        else if (coordinates !== `both`) Reflect.deleteProperty(site, `abc`)
      }
      const parsed = await parse_file_content(JSON.stringify(source), `input.json`)
      if (parsed.type !== `structure`) throw new Error(`Expected parsed structure`)
      const { controller } = controller_fixture(parsed.data)
      const run = controller.start_run(provenance)
      const properties = run.structure.sites.map((site) => site.properties)
      expect(properties).toEqual([{}, { charge: 0.5 }])
    },
  )

  test.each([
    `new run`,
    `input change`,
    `disabled`,
    `unmount`,
    `cancel`,
    `mutated input`,
    `owner change`,
  ] as const)(`rejects stale updates and cleanup after %s`, (cause) => {
    const { state, controller, on_prediction, on_view, on_replace_input } =
      controller_fixture()
    const old_run = controller.start_run(provenance)
    old_run.on_overlay({ site_properties: [{ charge: 1 }] })
    if (cause === `new run`) {
      const latest = controller.start_run(provenance)
      expect(latest.id).toBeGreaterThan(old_run.id)
      latest.on_overlay({ site_properties: [{ charge: 2 }] })
    } else if (cause === `input change`) state.structure = { ...state.structure }
    else if (cause === `disabled`) state.owner = null
    else if (cause === `owner change`) state.owner = {}
    else if (cause === `mutated input`) {
      state.structure.sites[0].xyz[0] = 9
      expect(old_run.structure.sites[0].xyz[0]).toBe(0)
    } else if (cause === `unmount`) controller.dispose()
    else old_run.cancel()
    const prediction_calls = on_prediction.mock.calls.length
    const view_calls = on_view.mock.calls.length
    // Same-turn callbacks before invalidation effects run are stale too.
    old_run.on_overlay({ site_properties: [{ charge: -1 }] })
    old_run.on_view(null)
    old_run.replace_input({ positions: [[1, 1, 1]] })
    old_run.clear()
    old_run.cancel()
    expect(on_replace_input).not.toHaveBeenCalled()
    expect(on_prediction).toHaveBeenCalledTimes(prediction_calls)
    expect(on_view).toHaveBeenCalledTimes(view_calls)
    controller.invalidate_if_changed()
    expect(old_run.signal.aborted).toBe(true)
    expect(on_view).toHaveBeenLastCalledWith(null)
    if (cause === `new run`)
      expect(on_prediction.mock.lastCall?.[0]?.site_properties).toEqual([{ charge: 2 }])
    else expect(on_prediction).toHaveBeenLastCalledWith(null)
    if (cause === `unmount`) expect(() => controller.start_run(provenance)).toThrow(`mounted`)
  })
  test.each([`cancel`, `replace`] as const)(
    `abort handlers can start a newer run during %s`,
    (action) => {
      const { controller, on_prediction, on_view } = controller_fixture()
      const old_run = controller.start_run(provenance)
      let replacement: StructureToolRun | undefined
      old_run.signal.addEventListener(`abort`, () => {
        replacement = controller.start_run(provenance)
        replacement.on_overlay({ site_properties: [{ charge: 3 }] })
      })
      if (action === `cancel`) old_run.cancel()
      else {
        const superseded = controller.start_run(provenance)
        expect(superseded.signal.aborted).toBe(true)
      }
      if (!replacement) throw new Error(`Abort did not start replacement`)
      expect(replacement.signal.aborted).toBe(false)
      expect(on_prediction.mock.lastCall?.[0]?.site_properties).toEqual([{ charge: 3 }])
      replacement.on_overlay({ site_properties: [{ charge: 4 }] })
      expect(on_prediction.mock.lastCall?.[0]?.site_properties).toEqual([{ charge: 4 }])
      expect(on_view).toHaveBeenLastCalledWith(null)
    },
  )

  test.each([false, true])(`exports an owned snapshot with shared density=%s`, (shared) => {
    const { state, controller, on_prediction } = controller_fixture()
    const settings = { seed: 0 }
    const run = controller.start_run({ ...provenance, settings })
    settings.seed = 9
    const result = {
      schema: `example-v1`,
      energy: -5,
      stress: [[1, 0, 0]],
      converged: false,
      history: [{ step: 1 }],
    }
    const overlay = {
      result: structuredClone(result),
      site_properties: [{ charge: 0.5, dipole: [1, 2, 3] }],
      volumes: [volume(`density`)],
    }
    if (shared) {
      overlay.volumes[0].values = new Float64Array(
        new SharedArrayBuffer(8 * Float64Array.BYTES_PER_ELEMENT),
      )
      overlay.volumes[0].values.fill(1)
    }
    run.on_overlay(overlay)
    const prediction = on_prediction.mock.lastCall?.[0]
    if (!prediction) throw new Error(`Missing prediction`)
    for (const site_properties of [[], null, [null], [[]]])
      expect(() =>
        run.on_overlay({ site_properties } as unknown as StructureToolOverlay),
      ).toThrow(`prediction.site_properties`)
    // Published buffers belong to the viewer, even after this run loses ownership.
    controller.start_run(provenance)
    overlay.site_properties[0].dipole[0] = 99
    overlay.volumes[0].values[0] = 99
    overlay.volumes[0].lattice[0][0] = 99
    overlay.result.history[0].step = 99
    run.structure.sites[0].xyz[0] = 8
    const exported = JSON.parse(prediction_to_json(prediction))
    expect(exported.input.sites[0].xyz[0]).toBe(0)
    expect(exported).toMatchObject({
      schema: `matterviz-prediction-v1`,
      run_id: run.id,
      provenance: { ...provenance, settings: { seed: 0 } },
      input: state.structure,
      result,
      site_properties: [{ charge: 0.5, dipole: [1, 2, 3] }],
    })
    expect(exported.volumes[0]).toMatchObject({
      id: `density`,
      dims: [2, 2, 2],
      values: Array(8).fill(1),
      // oxfmt-ignore
      lattice: [[5, 0, 0], [0, 5, 0], [0, 0, 5]],
    })
    expect(state.structure.sites[0].properties?.charge).toBeUndefined()
    expect(prediction_from_json(JSON.stringify(exported)).result).toEqual(exported.result)
  })
})

test.each<[string, IsosurfaceLayer[], number]>([
  [`an empty viewer`, [], 0],
  [`a viewer with its own surface`, [auto_volume_layer(volume(`base`))], 1],
])(
  `a publication into %s draws only its first field, in the next free color`,
  (_label, layers, color_offset) => {
    const base = volume(`base`)
    const fields = [volume(`density`), volume(`magnetization`)]
    const published = replace_tool_volumes([base], layers, [], fields)
    expect(published.volumes.map(({ id }) => id)).toEqual([`base`, `density`, `magnetization`])
    expect(published.layers).toEqual([...layers, auto_volume_layer(fields[0], color_offset)])
    // Later frames under the same IDs keep that one surface and never add the second field's.
    const next = replace_tool_volumes(
      published.volumes,
      published.layers,
      [`density`, `magnetization`],
      fields.map(({ id }) => volume(id)),
    )
    expect(next.layers).toEqual(published.layers)
  },
)

test(`field IDs preserve geometry and color references across replacement, reorder and removal`, () => {
  const base = volume(`base`)
  const density = volume(`density`)
  const potential = volume(`potential`)
  const layers = [
    { ...auto_volume_layer(base), color_volume_id: `density` },
    {
      ...auto_volume_layer(density),
      isovalue: 0.123,
      opacity: 0.4,
      color: `red`,
      color_volume_id: `potential`,
    },
    { ...auto_volume_layer(density), isovalue: -0.2, visible: false },
  ]
  const incoming = [
    volume(`potential`),
    { ...make_volume(make_grid(3, 3, 3, () => 2)), id: `density`, label: `Renamed` },
    volume(`new`),
  ]
  const result = replace_tool_volumes(
    [base, density, potential],
    layers,
    [density.id, potential.id],
    incoming,
  )
  // Density keeps its surfaces, so neither the new field nor the potential, whose surfaces
  // the user removed, gets a second default surface.
  expect(result.layers).toEqual(layers)
  const removed = replace_tool_volumes(
    result.volumes,
    result.layers,
    incoming.map(({ id: identifier }) => identifier),
    [volume(`density`)],
  )
  expect(removed.layers).toEqual([
    layers[0],
    { ...layers[1], color_volume_id: undefined },
    layers[2],
  ])
})

test(`demo trajectory keeps fractional and Cartesian coordinates consistent`, async () => {
  const crystal = make_crystal(fcc_primitive_matrix(3.61), [
    { element: `Cu`, abc: [0.13, 0.27, 0.41] },
  ])
  const trajectory = make_demo_trajectory(crystal)
  for (const frame_idx of [0, 1, 5]) {
    const frame = await materialize_frame_result(trajectory.read_frame(frame_idx))
    const { abc, xyz } = frame.structure.sites[0]
    const expected = [
      1.805 * abc[1] + 1.805 * abc[2],
      1.805 * abc[0] + 1.805 * abc[2],
      1.805 * abc[0] + 1.805 * abc[1],
    ]
    expect(xyz).toEqual(expected)
  }
  expect(crystal.sites[0].abc).toEqual([0.13, 0.27, 0.41])
})

const cyclic_metadata: Record<string, unknown> = {}
cyclic_metadata.self = cyclic_metadata
const shared_metadata = new Float64Array(new SharedArrayBuffer(8))
test.each([
  [`Map`, new Map([[`key`, 1]])],
  [`Set`, new Set([1])],
  [`Date`, new Date(0)],
  [`BigInt`, 1n],
  [`NaN`, NaN],
  [`Infinity`, Infinity],
  [`typed array`, new Uint8Array([1])],
  [`array hole`, Array(1)],
  [`shared buffer`, shared_metadata],
  [`nested shared buffer`, new Map([[`shared`, shared_metadata]])],
  [`cycle`, cyclic_metadata],
] as const)(
  `rejects %s metadata with a field path without replacing accepted output`,
  (_name, bad) => {
    const { state, on_prediction, controller } = controller_fixture()
    const run = controller.start_run(provenance)
    run.on_overlay({ site_properties: [{ charge: 1 }] })
    expect(() => run.on_overlay(bad as StructureToolOverlay)).toThrow(`prediction`)
    expect(() => run.on_overlay({ site_properties: [{ bad }] })).toThrow(
      `prediction.site_properties[0].bad`,
    )
    expect(() => run.on_overlay({ result: { schema: `example-v1`, bad } })).toThrow(
      `prediction.result.bad`,
    )
    const invalid_volume = { ...volume(`density`), extra: { bad } }
    expect(() => run.on_overlay({ volumes: [invalid_volume] })).toThrow(
      `prediction.volumes[0].extra.bad`,
    )
    expect(() => controller.start_run({ ...provenance, settings: { bad } })).toThrow(
      `provenance.settings.bad`,
    )
    expect(() =>
      prediction_to_json({
        input: state.structure,
        run_id: 1,
        provenance: { ...provenance, settings: { bad } },
      }),
    ).toThrow(`provenance.settings.bad`)
    expect(on_prediction).toHaveBeenCalledTimes(1)
    expect(run.signal.aborted).toBe(false)
  },
)

test.each([
  { id: `` },
  { id: `valid` },
  { dims: [2, 2, 3] },
  { dims: [-2, -2, 2] },
  { dims: [1.5, 2, 2] },
  { dims: [0, 2, 2], values: new Float64Array() },
  { order: `x_fastest` },
  { origin: [NaN, 0, 0] },
  { periodic: `yes` },
  // oxfmt-ignore
  { lattice: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] },
  { values: new Float64Array(8).fill(Infinity) },
  { values: new Float64Array(8).fill(1e308) },
  // oxfmt-ignore
  { lattice: [[1e308, 1e308, 0], [1e308, 1e308, 0], [0, 0, 1]] },
  { values: new Float32Array(8) },
  { signed: `no` },
])(`rejects malformed density atomically: %j`, (overrides) => {
  const { on_prediction, controller } = controller_fixture()
  const run = controller.start_run(provenance)
  run.on_overlay({ volumes: [volume(`valid`)] })
  expect(() => run.on_overlay({ volumes: Array(1) })).toThrow(`prediction.volumes[0]`)
  expect(() =>
    run.on_overlay({
      volumes: [volume(`valid`), { ...volume(`bad`), ...overrides } as StructureToolVolume],
    }),
  ).toThrow(`prediction.volumes[1]`)
  expect(on_prediction).toHaveBeenCalledTimes(1)
})

test(`prediction import preserves input, fields and provenance, recomputes ranges, and rejects unsupported schemas`, async () => {
  const input = make_crystal(1, [{ element: `Cu`, abc: [0.1, 0.2, 0.3] }])
  const density = { ...volume(`density`), signed: false }
  density.values[0] = 5 // Deliberately leave the host's cached statistics stale.
  const prediction = {
    input,
    run_id: 3,
    provenance,
    volumes: [density],
    site_properties: [{ charge: 0.5 }],
    color_property: `charge`,
  }
  const text = prediction_to_json(prediction)
  const restored = prediction_from_json(text)
  expect(restored.volumes?.[0].values).toEqual(density.values)
  expect(restored.volumes?.[0].data_range).toEqual({ min: 1, max: 5, abs_max: 5, mean: 1.5 })
  expect(restored.volumes?.[0].signed).toBe(false)
  expect(prediction_to_json(restored)).toBe(text)
  expect(prediction_from_json(JSON.parse(text))).toEqual(restored)
  for (const result of [[], { energy: -5 }]) {
    expect(() => prediction_from_json({ ...JSON.parse(text), result })).toThrow(
      Array.isArray(result) ? `prediction.result` : `prediction.result.schema`,
    )
  }
  for (const [key, value] of [
    [`label`, {}],
    [`properties`, null],
    [`properties`, []],
  ] as const) {
    const malformed = JSON.parse(text)
    malformed.input.sites[0][key] = value
    expect(() => prediction_from_json(malformed)).toThrow(`input.sites[0].${key}`)
  }
  expect(() => prediction_from_json(text.replace(`"Cu"`, `"DefinitelyNotAnElement"`))).toThrow(
    `input.sites[0].species.element`,
  )
  for (const key of [`pbc`, `a`, `volume`]) {
    const malformed = JSON.parse(text)
    Reflect.deleteProperty(malformed.input.lattice, key)
    expect(() => prediction_from_json(malformed)).toThrow(`input.lattice.${key}`)
  }
  const parsed = await parse_file_content(text, `prediction.json`)
  expect(parsed).toMatchObject({ type: `structure`, data: input, prediction: restored })
  await expect(
    parse_file_content(text.replace(`prediction-v1`, `prediction-v2`), `prediction.json`),
  ).rejects.toThrow(`schema`)
  expect(() => prediction_from_json(text.replace(`"run_id":3`, `"run_id":0`))).toThrow(
    `run_id`,
  )
  expect(() => prediction_from_json(text.replace(`"occu":1`, `"occu":-1`))).toThrow(`occu`)
  // Exports leave a run's trail out, so an import carrying one is not an export.
  const trail = [{ positions: input.sites.map(({ xyz }) => xyz) }]
  expect(prediction_to_json({ ...prediction, trail })).toBe(text)
  expect(() => prediction_from_json({ ...JSON.parse(text), trail })).toThrow(
    `prediction.trail: trails are how a viewer draws a run, never exported`,
  )
  expect(() =>
    prediction_from_json(text.replace(`"xyz":[`, `"xyz":null,"old_xyz":[`)),
  ).toThrow(`xyz`)
})

const two_site_crystal = () =>
  make_crystal(4, [
    { element: `H`, abc: [0, 0, 0] },
    { element: `He`, abc: [0.5, 0.5, 0.5] },
  ])
// oxfmt-ignore
const relaxed_cell: Matrix3x3 = [[4.2, 0, 0], [0, 4.2, 0], [0.1, 0, 4.4]]

// oxfmt-ignore
const singular_cell: Matrix3x3 = [[1, 0, 0], [2, 0, 0], [0, 0, 1]]
// oxfmt-ignore
const overflowing_cell: Matrix3x3 = [[1e308, 1e308, 0], [1e308, -1e308, 0], [0, 0, 1]]
const two_row_cell = [
  [1, 0, 0],
  [0, 1, 0],
]
const second_at = (position: number[]) => ({ positions: [[0, 0, 0], position] })
const unit = second_at([1, 1, 1])
const invertible = `prediction.geometry.lattice: lattice must be invertible`
const molecule = make_molecule([
  [`H`, [0, 0, 0]],
  [`H`, [0, 0, 0.74]],
])
test.each<[string, unknown, string, AnyStructure?]>([
  [`a non-object`, [], `prediction.geometry`],
  [`too few positions`, { positions: [[0, 0, 0]] }, `prediction.geometry.positions`],
  [`no positions`, { lattice: relaxed_cell }, `prediction.geometry.positions`],
  [`a non-finite position`, second_at([NaN, 1, 1]), `prediction.geometry.positions[1]`],
  [`a short position`, second_at([1, 1]), `prediction.geometry.positions[1]`],
  [`a singular cell`, { ...unit, lattice: singular_cell }, invertible],
  [`an overflowing cell`, { ...unit, lattice: overflowing_cell }, invertible],
  [`a non-finite cell`, { ...unit, lattice: [[Infinity, 0, 0]] }, `geometry.lattice[0][0]`],
  [`a two-row cell`, { ...unit, lattice: two_row_cell }, `lattice: expected a finite 3x3`],
  [
    `a cell for a molecule`,
    { ...unit, lattice: relaxed_cell },
    `lattice: a molecule`,
    molecule,
  ],
])(`rejects geometry with %s atomically`, (_label, geometry, message, structure) => {
  const input = structure ?? two_site_crystal()
  const { state, on_prediction, on_replace_input, controller } = controller_fixture(input)
  const run = controller.start_run(provenance)
  run.on_overlay({ geometry: { positions: input.sites.map(({ xyz }) => xyz) } })
  expect(() => run.on_overlay({ geometry: geometry as StructureToolGeometry })).toThrow(
    message,
  )
  // Adopting invalid geometry as the input fails before the host writes anything.
  expect(() => run.replace_input(geometry as StructureToolGeometry)).toThrow(TypeError)
  expect(() => run.replace_input(geometry as StructureToolGeometry)).toThrow(message)
  expect(on_replace_input).not.toHaveBeenCalled()
  expect(state.structure).toBe(input)
  expect(on_prediction).toHaveBeenCalledTimes(1)
  expect(run.signal.aborted).toBe(false)
})

test.each([
  [`positions only`, undefined],
  [`a relaxed cell`, relaxed_cell],
])(`final geometry with %s is owned, exported and reopened`, (_label, lattice) => {
  const input = two_site_crystal()
  const { state, controller, on_prediction } = controller_fixture(input)
  const run = controller.start_run(provenance)
  const positions: Vec3[] = [
    [0.1, 0, 0],
    [2.2, 2.1, 2.3],
  ]
  const geometry = lattice ? { positions, lattice } : { positions }
  run.on_overlay({ geometry })
  const prediction = on_prediction.mock.lastCall?.[0]
  if (!prediction) throw new Error(`Missing prediction`)
  positions[0][0] = 99 // the viewer owns its copy
  const exported = JSON.parse(prediction_to_json(prediction))
  expect(exported.geometry.positions[0]).toEqual([0.1, 0, 0])
  expect(exported.geometry.lattice).toEqual(lattice)
  // The input, not the geometry, stays the run's identity.
  expect(exported.input).toEqual(state.structure)
  const restored = prediction_from_json(JSON.stringify(exported))
  expect(restored.geometry).toEqual(exported.geometry)
  expect(prediction_to_json(restored)).toBe(prediction_to_json(prediction))
  // Displayed sites take the geometry, with fractional coordinates in the (relaxed) cell.
  const moved = apply_tool_geometry(restored.input, exported.geometry)
  if (!(`lattice` in moved)) throw new Error(`Expected a crystal`)
  const cell = lattice ?? input.lattice.matrix
  expect(moved.lattice.matrix).toEqual(cell)
  expect(moved.lattice.volume).toBeCloseTo(Math.abs(det_3x3(cell)), 12)
  const to_cart = create_frac_to_cart(cell)
  for (const [idx, site] of moved.sites.entries()) {
    expect(site.xyz).toEqual(exported.geometry.positions[idx])
    to_cart(site.abc).forEach((coord, axis) => expect(coord).toBeCloseTo(site.xyz[axis], 12))
  }
  expect(state.structure.sites[1].xyz).toEqual([2, 2, 2])
  // Adopting the geometry as the input keeps the run current: later publications carry the
  // new input and the run's structure follows it.
  run.replace_input(exported.geometry)
  expect(state.structure).toEqual(moved)
  exported.geometry.positions[0][0] = 99 // the host received its own copy
  expect(state.structure.sites[0].xyz).toEqual([0.1, 0, 0])
  controller.invalidate_if_changed()
  expect(run.signal.aborted).toBe(false)
  expect(run.structure).toEqual(state.structure)
  run.on_overlay({ site_properties: [{ charge: 1 }, { charge: 2 }] })
  const rebased = on_prediction.mock.lastCall?.[0]
  expect(rebased?.input).toEqual(state.structure)
  expect(rebased?.run_id).toBe(run.id)
  // A publication still validates against the run's input: one position per site.
  expect(() => run.on_overlay({ geometry: { positions: [[0, 0, 0]] } })).toThrow(
    `prediction.geometry.positions`,
  )
})

test(`molecule geometry moves xyz and mirrors it into abc`, () => {
  const positions: Vec3[] = [
    [0, 0.1, 0],
    [0, 0, 0.8],
  ]
  expect(apply_tool_geometry(molecule, { positions })).toEqual({
    ...molecule,
    sites: molecule.sites.map((site, idx) => ({
      ...site,
      xyz: positions[idx],
      abc: positions[idx],
    })),
  })
})
