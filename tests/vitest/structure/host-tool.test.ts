import { parse_file_content } from '$lib/file-viewer/parse'
import {
  create_structure_tool_controller,
  prediction_to_json,
  prediction_from_json,
} from '$lib/structure/host-tool.svelte'
import type {
  StructureToolPrediction,
  StructureToolOverlay,
  StructureToolProvenance,
  StructureToolRun,
  StructureToolVolume,
} from '$lib/structure/host-tool.svelte'
import { replace_tool_volumes } from '$lib/structure/host-tool-volumes'
import { auto_volume_layer } from '$lib/isosurface'
import { make_demo_trajectory } from '../../../src/routes/(demos)/structure/host-tool/demo'
import { describe, expect, test, vi } from 'vitest'
import { fcc_primitive_matrix, make_crystal, make_grid, make_volume } from '../setup'

const provenance: StructureToolProvenance = {
  model: `example`,
  version: `1.2`,
  units: { charge: `e`, density: `e/A^3` },
  settings: { seed: 0 },
}
const volume = (field_id: string) => ({
  ...make_volume(make_grid(2, 2, 2, () => 1)),
  field_id,
})

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
      const controller = create_structure_tool_controller(
        () => parsed.data,
        () => true,
        () => {},
        () => {},
        () => `input`,
      )
      const run = controller.start_run(provenance)
      expect(run.structure.sites.map(({ properties }) => properties)).toEqual([
        {},
        { charge: 0.5 },
      ])
      controller.dispose()
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
    let structure = make_crystal(1, [{ element: `H`, abc: [0, 0, 0] }])
    let owner: object | null = {}
    const on_prediction = vi.fn()
    const on_view = vi.fn()
    const controller = create_structure_tool_controller(
      () => structure,
      () => owner,
      on_prediction,
      on_view,
      () => JSON.stringify(structure),
    )
    const old_run = controller.start_run(provenance)
    old_run.on_overlay({ site_properties: [{ charge: 1 }] })
    if (cause === `new run`) {
      const latest = controller.start_run(provenance)
      expect(latest.id).toBeGreaterThan(old_run.id)
      latest.on_overlay({ site_properties: [{ charge: 2 }] })
    } else if (cause === `input change`) structure = { ...structure }
    else if (cause === `disabled`) owner = null
    else if (cause === `owner change`) owner = {}
    else if (cause === `mutated input`) {
      structure.sites[0].xyz[0] = 9
      expect(old_run.structure.sites[0].xyz[0]).toBe(0)
    } else if (cause === `unmount`) controller.dispose()
    else old_run.cancel()
    const prediction_calls = on_prediction.mock.calls.length
    const view_calls = on_view.mock.calls.length
    // Same-turn callbacks before invalidation effects run are stale too.
    old_run.on_overlay({ site_properties: [{ charge: -1 }] })
    old_run.on_view(null)
    old_run.clear()
    old_run.cancel()
    expect(on_prediction).toHaveBeenCalledTimes(prediction_calls)
    expect(on_view).toHaveBeenCalledTimes(view_calls)
    controller.invalidate_if_changed()
    expect(old_run.signal.aborted).toBe(true)
    if (cause === `new run`)
      expect(on_prediction.mock.lastCall?.[0].site_properties).toEqual([{ charge: 2 }])
    else expect(on_prediction).toHaveBeenLastCalledWith(null)
    if (cause === `unmount`) expect(() => controller.start_run(provenance)).toThrow(`mounted`)
  })
  test.each([`cancel`, `replace`] as const)(
    `abort handlers can start a newer run during %s`,
    (action) => {
      const structure = make_crystal(1, [{ element: `H`, abc: [0, 0, 0] }])
      const on_prediction = vi.fn()
      const on_view = vi.fn()
      const controller = create_structure_tool_controller(
        () => structure,
        () => true,
        on_prediction,
        on_view,
        () => JSON.stringify(structure),
      )
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
      expect(on_prediction.mock.lastCall?.[0].site_properties).toEqual([{ charge: 3 }])
      replacement.on_overlay({ site_properties: [{ charge: 4 }] })
      expect(on_prediction.mock.lastCall?.[0].site_properties).toEqual([{ charge: 4 }])
      expect(on_view).toHaveBeenLastCalledWith(null)
    },
  )

  test.each([false, true])(`exports an owned snapshot with shared density=%s`, (shared) => {
    const structure = make_crystal(1, [{ element: `H`, abc: [0, 0, 0] }])
    const settings = { seed: 0 }
    let prediction: StructureToolPrediction | null = null
    const controller = create_structure_tool_controller(
      () => structure,
      () => true,
      (value) => {
        prediction = value
      },
      () => {},
      () => JSON.stringify(structure),
    )
    const run = controller.start_run({ ...provenance, settings })
    settings.seed = 9
    const overlay = {
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
    if (!prediction) throw new Error(`Missing prediction`)
    // Published buffers belong to the viewer, even after this run loses ownership.
    controller.start_run(provenance)
    overlay.site_properties[0].dipole[0] = 99
    overlay.volumes[0].values[0] = 99
    overlay.volumes[0].lattice[0][0] = 99
    run.structure.sites[0].xyz[0] = 8
    const exported = JSON.parse(prediction_to_json(prediction))
    expect(exported.input.sites[0].xyz[0]).toBe(0)
    expect(exported).toMatchObject({
      schema: `matterviz-prediction-v1`,
      run_id: run.id,
      provenance: { ...provenance, settings: { seed: 0 } },
      input: structure,
      site_properties: [{ charge: 0.5, dipole: [1, 2, 3] }],
    })
    expect(exported.volumes[0]).toMatchObject({
      field_id: `density`,
      dims: [2, 2, 2],
      values: Array(8).fill(1),
      lattice: [
        [5, 0, 0],
        [0, 5, 0],
        [0, 0, 5],
      ],
    })
    expect(structure.sites[0].properties?.charge).toBeUndefined()
    const latest = controller.start_run(provenance)
    expect(() => latest.on_overlay({ site_properties: [] })).toThrow(`property rows`)
    expect(() => latest.on_overlay({ volumes: [volume(`same`), volume(`same`)] })).toThrow(
      `unique`,
    )
    expect(() => latest.on_overlay({ volumes: [volume(``)] })).toThrow(`nonempty`)
    const shared_property = new Float64Array(new SharedArrayBuffer(8))
    expect(() =>
      latest.on_overlay({
        site_properties: [{ nested: new Map([[`shared`, shared_property]]) }],
      }),
    ).toThrow(`shared buffers`)
    const shared_volume = { ...volume(`density`), extra: { shared_property } }
    expect(() => latest.on_overlay({ volumes: [shared_volume] })).toThrow(`shared buffers`)
    expect(() =>
      controller.start_run({
        ...provenance,
        settings: { shared_property },
      }),
    ).toThrow(`shared buffers`)
  })
})

test(`field IDs preserve layers and both index references across replacement, reorder and removal`, () => {
  const base = volume(`base`)
  const density = volume(`density`)
  const potential = volume(`potential`)
  const layers = [
    { ...auto_volume_layer(base, 0), color_volume_idx: 1 },
    {
      ...auto_volume_layer(density, 1),
      isovalue: 0.123,
      opacity: 0.4,
      color: `red`,
      color_volume_idx: 2,
    },
    { ...auto_volume_layer(density, 1), isovalue: -0.2, visible: false },
  ]
  const incoming = [
    volume(`potential`),
    { ...make_volume(make_grid(3, 3, 3, () => 2)), field_id: `density`, label: `Renamed` },
    volume(`new`),
  ]
  const result = replace_tool_volumes(
    [base, density, potential],
    layers,
    [density, potential],
    incoming,
    1,
  )
  expect(result.active_idx).toBe(2)
  expect(result.layers).toEqual([
    { ...layers[0], color_volume_idx: 2 },
    { ...layers[1], volume_idx: 2, color_volume_idx: 1 },
    { ...layers[2], volume_idx: 2 },
    auto_volume_layer(incoming[2], 3),
  ])
  // No auto-layer is resurrected for a field whose surfaces the user removed.
  expect(result.layers.filter(({ volume_idx }) => volume_idx === 1)).toEqual([])
  const removed = replace_tool_volumes(
    result.volumes,
    result.layers,
    incoming,
    [volume(`density`)],
    2,
  )
  expect(removed.layers).toEqual([
    { ...layers[0], color_volume_idx: 1 },
    { ...layers[1], color_volume_idx: undefined },
    layers[2],
  ])
})

test(`demo trajectory keeps fractional and Cartesian coordinates consistent`, async () => {
  const crystal = make_crystal(fcc_primitive_matrix(3.61), [
    { element: `Cu`, abc: [0.13, 0.27, 0.41] },
  ])
  const trajectory = make_demo_trajectory(crystal)
  for (const frame_idx of [0, 1, 5]) {
    const frame = await trajectory.read_frame(frame_idx)
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

const publication_fixture = () => {
  const input = make_crystal(1, [{ element: `H`, abc: [0, 0, 0] }])
  const accepted = vi.fn()
  const controller = create_structure_tool_controller(
    () => input,
    () => true,
    accepted,
    () => {},
    () => ``,
  )
  const run = controller.start_run(provenance)
  return { input, accepted, controller, run }
}

test.each([
  [`Map`, (): unknown => new Map([[`key`, 1]])],
  [`Set`, (): unknown => new Set([1])],
  [`Date`, (): unknown => new Date(0)],
  [`BigInt`, (): unknown => 1n],
  [`NaN`, (): unknown => NaN],
  [`Infinity`, (): unknown => Infinity],
  [`typed array`, (): unknown => new Uint8Array([1])],
  [`array hole`, (): unknown => Array(1)],
  [
    `cycle`,
    (): unknown => {
      const value: { self?: unknown } = {}
      value.self = value
      return value
    },
  ],
] as const)(
  `rejects %s metadata with a field path without replacing accepted output`,
  (_name, make_bad) => {
    const { input, accepted, controller, run } = publication_fixture()
    run.on_overlay({ site_properties: [{ charge: 1 }] })
    const bad = make_bad()
    expect(() => run.on_overlay(bad as StructureToolOverlay)).toThrow(`prediction`)
    expect(() => run.on_overlay({ site_properties: [{ bad }] })).toThrow(
      `prediction.site_properties[0].bad`,
    )
    expect(() => controller.start_run({ ...provenance, settings: { bad } })).toThrow(
      `provenance.settings.bad`,
    )
    expect(() =>
      prediction_to_json({
        input,
        run_id: 1,
        provenance: { ...provenance, settings: { bad } },
      }),
    ).toThrow(`provenance.settings.bad`)
    expect(accepted).toHaveBeenCalledTimes(1)
    expect(run.signal.aborted).toBe(false)
  },
)

test.each([
  { dims: [2, 2, 3] },
  { dims: [-2, -2, 2] },
  { dims: [1.5, 2, 2] },
  { dims: [0, 2, 2], values: new Float64Array() },
  { order: `x_fastest` },
  { origin: [NaN, 0, 0] },
  { periodic: `yes` },
  {
    lattice: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
  },
  { values: new Float64Array(8).fill(Infinity) },
  { values: new Float64Array(8).fill(1e308) },
  {
    lattice: [
      [1e308, 1e308, 0],
      [1e308, 1e308, 0],
      [0, 0, 1],
    ],
  },
  { values: new Float32Array(8) },
])(`rejects malformed density atomically: %j`, (overrides) => {
  const { accepted, run } = publication_fixture()
  run.on_overlay({ volumes: [volume(`valid`)] })
  const previous = accepted.mock.lastCall?.[0]
  expect(() => run.on_overlay({ volumes: Array(1) })).toThrow(`prediction.volumes[0]`)
  expect(() =>
    run.on_overlay({
      volumes: [volume(`valid`), { ...volume(`bad`), ...overrides } as StructureToolVolume],
    }),
  ).toThrow(`prediction.volumes[1]`)
  expect(accepted).toHaveBeenCalledTimes(1)
  expect(accepted.mock.lastCall?.[0]).toBe(previous)
})

test(`prediction import preserves input, fields and provenance, recomputes ranges, and rejects unsupported schemas`, async () => {
  const input = make_crystal(1, [{ element: `Cu`, abc: [0.1, 0.2, 0.3] }])
  const density = volume(`density`)
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
  expect(restored).toMatchObject({
    input,
    run_id: 3,
    provenance,
    site_properties: prediction.site_properties,
  })
  expect(restored.volumes?.[0].values).toEqual(density.values)
  expect(restored.volumes?.[0].data_range).toEqual({ min: 1, max: 5, abs_max: 5, mean: 1.5 })
  expect(prediction_to_json(restored)).toBe(text)
  expect(prediction_from_json(JSON.parse(text))).toEqual(restored)
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
  expect(() =>
    prediction_from_json(text.replace(`"xyz":[`, `"xyz":null,"old_xyz":[`)),
  ).toThrow(`xyz`)
})
