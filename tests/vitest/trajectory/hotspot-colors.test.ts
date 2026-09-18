import { atom_field_color } from '$lib/structure/atom-color-field'
import {
  hotspot_field_geometry,
  hotspot_colors,
  hotspot_cloud_colors,
  hotspot_scale,
  hotspot_probe,
} from '$lib/trajectory/hotspot-colors'
import {
  hotspot_bin,
  hotspot_display_values,
  type HotspotResult,
} from '$lib/trajectory/hotspots'
import { encode_frame } from '$lib/trajectory/frame'
import { make_trajectory_frame } from '../test-fixtures'
import { Color, Vector3 } from 'three/webgpu'
import { expect, it } from 'vitest'
import type { Vec3 } from '$lib/math'
import { make_lattice } from '$lib/structure/parsers/shared'
import { parse_linear_rgb } from '$lib/scene/colors'
import { interpolateInferno } from 'd3-scale-chromatic'

const result = (): HotspotResult => ({
  grid: {
    dims: [2, 3, 4],
    origin: [10, -20, 30],
    cell: [
      [4, 0, 0],
      [1, 6, 0],
      [2, 1, 8],
    ],
    pbc: [true, false, true],
  },
  energy: Float64Array.from({ length: 24 }, (_unused, idx) => idx),
  population: new Float64Array(24).fill(2),
  dof: new Float64Array(24).fill(6),
  occupied_frames: new Uint32Array(24).fill(1),
  time_weight: 1,
  frames: 1,
  first_step: 0,
  last_step: 0,
  weighting: `MD steps`,
  excluded_atoms: 0,
  reserved_buffer_bytes: 0,
  options: {},
})

const scale_for = (mean: number, threshold = 1.25) => {
  const scale = hotspot_scale(mean, `energy`, threshold)
  if (!scale) throw new Error(`Invalid test mean ${mean}`)
  return scale
}

it.each([0, 0.5, 300])(`heatmap palette matches D3 at every boundary for mean=%s`, (mean) => {
  const scale = Math.max(mean * 2, Number.EPSILON)
  const values = Float32Array.from([
    -1,
    0,
    scale,
    scale * 2,
    NaN,
    Infinity,
    -Infinity,
    ...Array.from({ length: 256 }, (_, idx) =>
      [-1e-6, 0, 1e-6].map((offset) => (idx / 256 + offset) * scale),
    ).flat(),
  ])
  const colors = hotspot_colors({ values, mean }, scale_for(mean))
  for (let idx = 0; idx < values.length; idx++) {
    const scaled = Math.min(1, Math.max(0, values[idx] / scale))
    const expected = Number.isFinite(values[idx])
      ? [...parse_linear_rgb(interpolateInferno(scaled)), 1]
      : [0, 0, 0, 0]
    expect(colors.slice(idx * 4, idx * 4 + 4)).toEqual(new Float32Array(expected))
  }
  expect(hotspot_scale(NaN, `energy`, 1.25)).toBeUndefined()
})

it(`cloud density grows with heat, honors colors and leaves absent data transparent`, () => {
  const data = result()
  data.grid.dims = [4, 1, 1]
  data.energy = new Float64Array([0, 1, 2, 5])
  data.population = new Float64Array(4).fill(1)
  data.dof = new Float64Array(4).fill(3)
  data.occupied_frames = new Uint32Array(4).fill(1)
  const before = structuredClone(data)
  const display = hotspot_display_values(data, `energy`, 1)
  const colors = hotspot_cloud_colors(display, scale_for(display.mean, 2), `blue`, `red`)
  if (!colors) throw new Error(`Expected a populated cloud`)
  expect([colors[3], colors[7], colors[11], colors[15]]).toEqual([
    0,
    Math.fround(0.015),
    Math.fround(0.03),
    1,
  ])
  expect(colors.slice(8, 11)).toEqual(new Float32Array([0, 0, 1]))
  expect(colors.slice(12, 15)).toEqual(new Float32Array([1, 0, 0]))
  const raised = hotspot_cloud_colors(display, scale_for(display.mean, 4), `blue`, `#00ff00`)
  if (!raised) throw new Error(`Expected a populated cloud`)
  expect(raised[15]).toBeLessThan(colors[15])
  expect(raised[15]).toBe(Math.fround(0.515))
  expect(raised.slice(12, 15)).toEqual(new Float32Array([0, 0.5, 0.5]))
  expect(hotspot_cloud_colors(display, scale_for(display.mean, 1), `blue`, `red`)?.[11]).toBe(
    1,
  )
  expect(display).toEqual({ values: new Float32Array([0, 1, 2, 5]), mean: 2 })
  expect(data).toEqual(before)
  data.occupied_frames[3] = 0
  expect(
    hotspot_cloud_colors(
      hotspot_display_values(data, `energy`, 1),
      scale_for(display.mean, 2),
      `blue`,
      `red`,
    )?.slice(12),
  ).toEqual(new Float32Array(4))
  expect(
    hotspot_cloud_colors(
      hotspot_display_values(data, `energy`, 2),
      scale_for(display.mean, 2),
      `blue`,
      `red`,
    ),
  ).toBeUndefined()
  data.energy.fill(0)
  expect(
    hotspot_cloud_colors(
      hotspot_display_values(data, `energy`, 1),
      scale_for(0, 2),
      `blue`,
      `red`,
    ),
  ).toBeUndefined()
})

it.each([`energy`, `temperature`] as const)(
  `%s colors preserve zero energy and leave missing observations uncolored`,
  (metric) => {
    const data = result()
    data.occupied_frames[1] = 0
    data.population[2] = 0.5
    const display = hotspot_display_values(data, metric, 1)
    const colors = hotspot_colors(display, scale_for(display.mean))
    expect(colors).toHaveLength(24 * 4)
    expect(Array.from(colors).every(Number.isFinite)).toBe(true)
    expect([colors[3], colors[7], colors[11], colors[15]]).toEqual([1, 0, 0, 1])
    expect(colors.slice(0, 3)).not.toEqual(colors.slice(12, 15))
    const cloud = hotspot_cloud_colors(display, scale_for(display.mean), `blue`, `red`)
    if (!cloud) throw new Error(`Expected a populated cloud`)
    const alphas = [...cloud].filter((_value, idx) => idx % 4 === 3)
    expect(alphas.slice(0, 3)).toEqual([0, 0, 0])
    for (let idx = 4; idx < alphas.length; idx++)
      expect(alphas[idx]).toBeGreaterThanOrEqual(alphas[idx - 1])
    expect(alphas.at(-1)).toBe(1)
    expect(alphas.some((alpha) => alpha > 0.03 && alpha < 1)).toBe(true)
    const field = {
      ...hotspot_field_geometry(data, encode_frame(make_trajectory_frame(0, 0))),
      colors,
    }
    // Nonperiodic out-of-grid and missing-data atoms retain their base color.
    expect(atom_field_color(field, [10, -21, 30], `blue`)).toEqual(new Color(`blue`))
    const empty_position = new Vector3(0.1, 0.1, 0.3).applyMatrix4(
      field.cartesian_to_fractional.clone().invert(),
    )
    expect(atom_field_color(field, empty_position.toArray(), `blue`)).toEqual(
      new Color(`blue`),
    )
    data.energy.fill(0)
    data.time_weight = 2
    data.frames = 4
    const populated_position = new Vector3(0.1, 0.1, 0.1).applyMatrix4(
      field.cartesian_to_fractional.clone().invert(),
    )
    expect(
      hotspot_probe(
        data,
        hotspot_display_values(data, metric, 1),
        field,
        populated_position.toArray(),
      ),
    ).toEqual({
      value: 0,
      ratio: NaN,
      average_atoms: 1,
      occupied_frames: 1,
    })
  },
)

it.each([`device`, `cell`] as const)(
  `%s grid maps triclinic cells, periodic images and moving box origins`,
  (coordinates) => {
    const data = result()
    data.options.coordinates = coordinates
    // Give each bin its own exactly representable color for an unambiguous lookup.
    const colors = Float32Array.from({ length: 96 }, (_unused, idx) =>
      idx % 4 === 3 ? 1 : Math.floor(idx / 4) / 32,
    )
    const frame = encode_frame(make_trajectory_frame(0, 0))
    frame.header.metadata = { box_origin: [8, -21, 31] }
    const lattice = make_lattice([
      [8, 0, 0],
      [2, 12, 0],
      [4, 2, 16],
    ])
    frame.structure.lattice = lattice
    lattice.pbc = [true, false, true]
    const grid =
      coordinates === `cell`
        ? { ...data.grid, cell: lattice.matrix, origin: [8, -21, 31] as Vec3 }
        : data.grid
    const field = { ...hotspot_field_geometry(data, frame), colors }
    const display = hotspot_display_values(data, `energy`, 1)
    const first_color = atom_field_color(field, [0, 0, 0], `blue`)
    const first_components = first_color.toArray()
    for (let idx = 0; idx < 24; idx++) {
      for (const image of [-1, 0, 1]) {
        const fractional = [
          (Math.floor(idx / 12) + 0.5) / 2 + image,
          ((Math.floor(idx / 4) % 3) + 0.5) / 3,
          ((idx % 4) + 0.5) / 4 - image,
        ]
        const absolute = grid.origin.map(
          (value, axis) =>
            value +
            fractional.reduce((sum, coord, basis) => sum + coord * grid.cell[basis][axis], 0),
        ) as Vec3
        const relative = absolute.map((value, axis) => value - [8, -21, 31][axis]) as Vec3
        expect(hotspot_bin(absolute, 0, grid)).toBe(idx)
        expect(hotspot_probe(data, display, field, relative)).toEqual({
          value: idx / 2,
          ratio: idx / 11.5,
          average_atoms: 2,
          occupied_frames: 1,
        })
        expect(atom_field_color(field, relative, `blue`).toArray()).toEqual([
          idx / 32,
          idx / 32,
          idx / 32,
        ])
      }
    }
    // The closed, nonperiodic upper cell face belongs to the final bin.
    const endpoint = new Vector3(0.25, 1, 0.125).applyMatrix4(
      field.cartesian_to_fractional.clone().invert(),
    )
    expect(atom_field_color(field, endpoint.toArray(), `blue`).toArray()).toEqual([
      8 / 32,
      8 / 32,
      8 / 32,
    ])
    expect(first_color.toArray()).toEqual(first_components)
    expect(hotspot_probe(data, display, field, [0, -100, 0])).toBeUndefined()
    data.occupied_frames[8] = 0
    expect(
      hotspot_probe(
        data,
        hotspot_display_values(data, `energy`, 1),
        field,
        endpoint.toArray(),
      ),
    ).toBeUndefined()
    data.occupied_frames[8] = 1
    expect(
      hotspot_probe(
        data,
        hotspot_display_values(data, `energy`, 3),
        field,
        endpoint.toArray(),
      ),
    ).toBeUndefined()
  },
)

it(`locked numeric domains keep atom and cloud colors fixed as the mean changes`, () => {
  const values = new Float32Array([0, 1, 2, 3, 4, NaN])
  const scale = scale_for(2)
  const initial = { values, mean: 2 }
  const updated = { values, mean: 4 }
  expect(scale).toMatchObject({
    atom_max: 4,
    cloud_min: 2,
    cloud_max: 2.5,
    threshold: 2.5,
    unit: `eV/atom`,
  })
  expect(hotspot_colors(initial, scale)).toEqual(hotspot_colors(updated, scale))
  expect(hotspot_cloud_colors(initial, scale, `blue`, `red`)).toEqual(
    hotspot_cloud_colors(updated, scale, `blue`, `red`),
  )
  expect(hotspot_colors(updated, scale_for(4))).not.toEqual(hotspot_colors(updated, scale))
  expect(hotspot_scale(300, `temperature`, 1.25)).toMatchObject({
    unit: `K`,
    atom_max: 600,
    cloud_min: 300,
    cloud_max: 375,
    threshold: 375,
  })
})
