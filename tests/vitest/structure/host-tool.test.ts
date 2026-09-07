import {
  create_structure_tool_controller,
  prediction_to_json,
} from '$lib/structure/host-tool.svelte'
import type {
  StructureToolPrediction,
  StructureToolProvenance,
  StructureToolRun,
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

  test(`exports a captured input and provenance with typed density values`, () => {
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
    run.on_overlay({
      site_properties: [{ charge: 0.5, dipole: [1, 2, 3] }],
      volumes: [volume(`density`)],
    })
    if (!prediction) throw new Error(`Missing prediction`)
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
    })
    expect(structure.sites[0].properties?.charge).toBeUndefined()
    expect(() => run.on_overlay({ site_properties: [] })).toThrow(`property rows`)
    expect(() => run.on_overlay({ volumes: [volume(`same`), volume(`same`)] })).toThrow(
      `unique`,
    )
    expect(() => run.on_overlay({ volumes: [volume(``)] })).toThrow(`nonempty`)
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
