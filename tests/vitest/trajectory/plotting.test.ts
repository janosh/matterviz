import type { DataSeries } from '$lib/plot'
import { create_legend_visibility } from '$lib/plot/core/utils/series-visibility'
import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory'
import {
  available_x_quantities,
  build_x_map,
  generate_axis_labels,
  generate_axis_scale_types,
  generate_plot_series,
  generate_streaming_plot_series,
  get_frame_step_samples,
  get_frame_time_step,
  prepare_trajectory_scatter_series,
  should_hide_plot,
} from '$lib/trajectory/plotting'
import type { PlotSeriesOptions } from '$lib/trajectory/plotting'
import { describe, expect, it } from 'vitest'
import { make_trajectory_frame } from '../setup'

const DEFAULT_PROPERTY_CONFIG = {
  energy: { label: `Energy`, unit: `eV` },
  force_max: { label: `F<sub>max</sub>`, unit: `eV/Å` },
  volume: { label: `Volume`, unit: `Å³` },
} as const

const COMMON_TRAJECTORIES = {
  multi_property: [
    { energy: -10.0, force_max: 0.1, volume: 100.0 },
    { energy: -10.5, force_max: 0.2, volume: 101.0 },
    { energy: -11.0, force_max: 0.3, volume: 102.0 },
  ],
}

const create_trajectory = (property_frames: Record<string, number>[]): TrajectoryType => ({
  frames: property_frames.map((props, step) => make_trajectory_frame(step, 1, props)),
})

function test_extractor(frame: TrajectoryFrame): Record<string, number> {
  const data: Record<string, number> = { Step: frame.step }
  if (frame.metadata) {
    for (const [key, value] of Object.entries(frame.metadata)) {
      if (typeof value === `number`) data[key] = value
    }
  }
  return data
}

type SeriesOptions = Partial<
  Pick<DataSeries, `visible` | `label` | `unit` | `y_axis` | `axis_group`>
>

const create_series = (
  y_values: number[],
  { visible = true, label = `Test`, unit = ``, y_axis = `y1`, axis_group }: SeriesOptions = {},
): DataSeries => ({
  x: y_values.map((_, idx) => idx),
  y: y_values,
  label,
  unit,
  ...(axis_group ? { axis_group } : {}),
  visible,
  y_axis,
  markers: `line` as const,
  metadata: [],
  line_style: { stroke: `blue`, stroke_width: 2 },
  point_style: { fill: `blue`, radius: 4, stroke: `blue`, stroke_width: 1 },
})

const find_series_by_label = (series: DataSeries[], search_term: string) =>
  series.find((srs) => srs.label?.toLowerCase().includes(search_term.toLowerCase()))
const plot_options = (options: PlotSeriesOptions): PlotSeriesOptions => options

describe(`generate_plot_series`, () => {
  it(`omits frame, step, and time coordinates from eager trajectory series`, () => {
    const series = generate_plot_series(
      create_trajectory([
        { energy: -10, frame_id: 0, production_step: 0, [`Time (ps)`]: 0 },
        { energy: -11, frame_id: 1, production_step: 10, [`Time (ps)`]: 0.25 },
      ]),
      test_extractor,
      { property_config: DEFAULT_PROPERTY_CONFIG },
    )
    expect(series.map(({ label }) => label)).toEqual([`Energy`])
  })

  it(`groups energy and force series by unit`, () => {
    const series = generate_plot_series(
      create_trajectory(COMMON_TRAJECTORIES.multi_property),
      test_extractor,
      {
        property_config: DEFAULT_PROPERTY_CONFIG,
        default_visible_properties: new Set([`energy`, `force_max`]),
      },
    )
    expect(series).toHaveLength(3)
    // Units belong on the axis label, not duplicated in the legend series text
    for (const srs of series) expect(srs.label).not.toMatch(/\([^)]+\)/)

    const energy = find_series_by_label(series, `energy`)
    expect(energy).toMatchObject({
      unit: `eV`,
      y_axis: `y1`,
      visible: true,
      metadata: expect.arrayContaining([expect.objectContaining({ property_key: `energy` })]),
    })
    expect(energy?.metadata).toHaveLength(3)
    expect(find_series_by_label(series, `f`)).toMatchObject({
      unit: `eV/Å`,
      y_axis: `y2`,
      visible: true,
      metadata: expect.arrayContaining([
        expect.objectContaining({ property_key: `force_max` }),
      ]),
    })
    // volume omitted from default_visible_properties, not the 2-group cap
    expect(find_series_by_label(series, `volume`)).toMatchObject({
      visible: false,
      metadata: expect.arrayContaining([expect.objectContaining({ property_key: `volume` })]),
    })
  })

  it.each([
    {
      name: `keeps every series in a selected unit group visible`,
      frames: [
        { selected: 1, same_group: 10, hidden_group: 100 },
        { selected: 2, same_group: 20, hidden_group: 200 },
      ],
      options: plot_options({
        property_config: {
          selected: { label: `Selected`, unit: `shared` },
          same_group: { label: `Same group`, unit: `shared` },
          hidden_group: { label: `Hidden group`, unit: `other` },
        },
        default_visible_properties: new Set([`selected`]),
      }),
      expected: {
        Selected: { visible: true, y_axis: `y1` },
        [`Same group`]: { visible: true, y_axis: `y1` },
        [`Hidden group`]: { visible: false, y_axis: `y1` },
      },
    },
    {
      name: `uses priority rather than property order when visible groups overflow`,
      frames: [
        { temperature: 300, force: 1, energy: -10 },
        { temperature: 310, force: 0.5, energy: -11 },
      ],
      options: plot_options({
        property_config: {
          temperature: { label: `Temperature`, unit: `K` },
          force: { label: `Force`, unit: `eV/Å` },
          energy: { label: `Energy`, unit: `eV` },
        },
        default_visible_properties: new Set([`temperature`, `force`, `energy`]),
      }),
      expected: {
        Energy: { visible: true, y_axis: `y1` },
        Force: { visible: true, y_axis: `y2` },
        Temperature: { visible: false, y_axis: `y1` },
      },
    },
    {
      name: `falls back to the highest-priority group when no property is selected`,
      frames: [
        { temperature: 300, energy: -10 },
        { temperature: 310, energy: -11 },
      ],
      options: plot_options({
        property_config: {
          temperature: { label: `Temperature`, unit: `K` },
          energy: { label: `Energy`, unit: `eV` },
        },
        default_visible_properties: new Set(),
      }),
      expected: {
        Energy: { visible: true, y_axis: `y1` },
        Temperature: { visible: false, y_axis: `y1` },
      },
    },
  ])(`$name`, ({ frames, options, expected }) => {
    const series = generate_plot_series(create_trajectory(frames), test_extractor, options)
    expect(
      Object.fromEntries(
        series.map(({ label, visible, y_axis }) => [label, { visible, y_axis }]),
      ),
    ).toEqual(expected)
  })

  it(`keeps sparse property values aligned to their source frames`, () => {
    const series = generate_plot_series(
      create_trajectory([
        { energy: -10, temperature: 300 },
        { energy: -11 },
        { energy: -12, temperature: 320 },
      ]),
      test_extractor,
    )
    expect(find_series_by_label(series, `temperature`)).toMatchObject({
      x: [0, 2],
      y: [300, 320],
    })
  })

  it(`reuses extraction until extractor, trajectory, or frame identities change`, () => {
    const trajectory = create_trajectory([{ energy: -10 }, { energy: -11 }])
    let call_count = 0
    const counting_extractor = (frame: TrajectoryFrame) => {
      call_count++
      return test_extractor(frame)
    }

    let series = generate_plot_series(trajectory, counting_extractor)
    expect(find_series_by_label(series, `energy`)?.y).toEqual([-10, -11])
    expect(call_count).toBe(trajectory.frames.length)

    generate_plot_series(trajectory, counting_extractor)
    expect(call_count).toBe(trajectory.frames.length)

    trajectory.frames.push(make_trajectory_frame(2, 1, { energy: -12 }))
    series = generate_plot_series(trajectory, counting_extractor)
    expect(find_series_by_label(series, `energy`)?.y).toEqual([-10, -11, -12])
    expect(call_count).toBe(5)

    trajectory.frames[1] = make_trajectory_frame(1, 1, { energy: -20 })
    series = generate_plot_series(trajectory, counting_extractor)
    expect(find_series_by_label(series, `energy`)?.y).toEqual([-10, -20, -12])
    expect(call_count).toBe(8)

    const other_extractor = (frame: TrajectoryFrame) => {
      call_count++
      return test_extractor(frame)
    }
    generate_plot_series(trajectory, other_extractor)
    expect(call_count).toBe(11)

    generate_plot_series(
      create_trajectory(COMMON_TRAJECTORIES.multi_property),
      counting_extractor,
    )
    expect(call_count).toBe(11 + COMMON_TRAJECTORIES.multi_property.length)
  })

  it(`renders long eager data as a smoothed trend over a faint peak-preserving trace`, () => {
    const frames = Array.from({ length: 300 }, (_unused, frame_number) => ({
      energy: frame_number === 150 ? 100 : Math.sin(frame_number),
    }))
    const raw_series = generate_plot_series(create_trajectory(frames), test_extractor)
    expect(raw_series[0].y).toHaveLength(300)
    expect(raw_series[0].line_underlays).toBeUndefined()

    const [smoothed] = prepare_trajectory_scatter_series(raw_series, 64)
    const underlay = smoothed.line_underlays?.[0]
    if (!underlay) throw new Error(`Expected a raw line underlay`)

    expect([smoothed.x.length, underlay.x.length]).toEqual([64, 64])
    expect(Math.max(...smoothed.y)).toBeLessThan(20)
    expect(Math.max(...underlay.y)).toBe(100)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1, 0, -1])(
    `rejects an invalid scatter point budget of %s`,
    (max_points) => {
      expect(() => prepare_trajectory_scatter_series([], max_points)).toThrow(
        `max_points must be finite and at least 2`,
      )
    },
  )

  it.each([
    { name: `empty trajectory`, frames: [], expected_length: 0 },
    { name: `single frame`, frames: [{ energy: -10.0 }], expected_length: 0 },
  ])(`handles edge case: $name`, ({ frames, expected_length }) => {
    expect(generate_plot_series(create_trajectory(frames), test_extractor)).toHaveLength(
      expected_length,
    )
  })

  // oxfmt-ignore
  it.each([
    { name: `constant`, key: `test_prop`, values: [10.0, 10.0, 10.0], should_include: false },
    { name: `nearly constant`, key: `test_prop`, values: [10.000001, 10.000002, 10.000001], should_include: false },
    { name: `varying`, key: `test_prop`, values: [10.0, 10.1, 10.2], should_include: true },
    {
      name: `near-constant energy (always kept)`,
      key: `energy`,
      values: [-789.391026308538, -789.391026308539, -789.39102630854],
      should_include: true,
      match: {
        visible: true,
        unit: `eV`,
        y_axis: `y1`,
        label: `Energy`,
        markers: `line+points`,
      },
    },
  ])(`filters $name properties`, ({ key, values, should_include, match }) => {
    const series = generate_plot_series(
      create_trajectory(values.map((value) => ({ [key]: value }))),
      test_extractor,
    )
    expect(series).toHaveLength(should_include ? 1 : 0)
    if (match) expect(find_series_by_label(series, key)).toMatchObject(match)
  })
})

describe(`should_hide_plot`, () => {
  const multi = COMMON_TRAJECTORIES.multi_property

  // oxfmt-ignore
  it.each([
    { name: `no series`, frames: multi, series: [], expected: true },
    { name: `constant series`, frames: multi, series: [create_series([1.0, 1.0, 1.0])], expected: true },
    { name: `varying series`, frames: multi, series: [create_series([1.0, 2.0, 3.0])], expected: false },
    { name: `hidden varying series`, frames: multi, series: [create_series([1.0, 2.0, 3.0], { visible: false })], expected: false },
    { name: `single-frame trajectory`, frames: [{ energy: -10 }], series: [create_series([1.0, 2.0, 3.0])], expected: true },
    { name: `NaN values`, frames: multi, series: [create_series([1.0, NaN, 1.0])], expected: true },
    { name: `Infinity values`, frames: multi, series: [create_series([1.0, Infinity, 1.0])], expected: false },
    { name: `all NaN values`, frames: multi, series: [create_series([NaN, NaN, NaN])], expected: true },
  ])(`$name → hide=$expected`, ({ frames, series, expected }) => {
    expect(should_hide_plot(create_trajectory(frames), series)).toBe(expected)
  })

  it.each([
    { name: `very loose`, tolerance: 1e10, expected: true },
    { name: `zero tolerance`, tolerance: 0, expected: false },
  ])(`tolerance: $name → hide=$expected`, ({ tolerance, expected }) => {
    const series = [create_series([1.0, 1.0000001, 1.0])]
    expect(should_hide_plot(create_trajectory(multi), series, tolerance)).toBe(expected)
  })
})

describe(`generate_axis_labels`, () => {
  it(`excludes hidden series and labels each axis`, () => {
    expect(
      generate_axis_labels([
        create_series([1, 2], { label: `Visible`, unit: `eV` }),
        create_series([3, 4], { visible: false, label: `Hidden`, unit: `eV` }),
        create_series([5, 6], { label: `Another`, unit: `Å`, y_axis: `y2` }),
      ]),
    ).toEqual({ y1: `Visible (eV)`, y2: `Another (Å)` })
    expect(
      generate_axis_labels([create_series([1, 2], { label: `Dimensionless`, unit: `` })]),
    ).toEqual({ y1: `Dimensionless`, y2: `Value` })
  })
})

describe(`generate_axis_scale_types`, () => {
  const all_linear = { y1: `linear`, y2: `linear` }
  // oxfmt-ignore
  it.each([
    { name: `positive non-SCF series spanning >=3 decades stays linear`,
      series: [create_series([1e-6, 1e-4, 1e-2, 1])], expected: all_linear },
    { name: `positive SCF axis group spanning >=3 decades goes log`,
      series: [create_series([1e-6, 1e-4, 1e-2, 1], { label: `SCF`, unit: `eV`, axis_group: `eV (SCF)` })],
      expected: { y1: `log`, y2: `linear` } },
    { name: `per-axis decision: linear energy on y1, log residual on y2`, series: [
      create_series([-10, -11, -12], { label: `Energy`, unit: `eV` }),
      create_series([1, 1e-3, 1e-7], { label: `Residual`, unit: `eV`, y_axis: `y2`, axis_group: `eV (SCF)` }),
    ], expected: { y1: `linear`, y2: `log` } },
  ])(`$name`, ({ series, expected }) => {
    expect(generate_axis_scale_types(series)).toEqual(expected)
  })
})

describe(`auto-assigned legend visibility`, () => {
  it.each([
    {
      name: `automatic axes preserve a dual-axis partner`,
      axes: [undefined, undefined],
      expected_after_restore: [true, true],
    },
    {
      name: `explicit same-axis assignments hide an incompatible partner`,
      axes: [`y1`, `y1`] as const,
      expected_after_restore: [true, false],
    },
  ])(`round-trips visibility when $name`, ({ axes, expected_after_restore }) => {
    let series: DataSeries[] = [
      { x: [0, 1], y: [1, 2], unit: `eV`, visible: true, y_axis: axes[0] },
      { x: [0, 1], y: [3, 4], unit: `GPa`, visible: true, y_axis: axes[1] },
    ]
    const legend_visibility = create_legend_visibility(
      () => series,
      (next_series) => (series = next_series),
    )

    legend_visibility.on_toggle(0)
    expect(series.map((srs) => srs.visible)).toEqual([false, true])
    legend_visibility.on_toggle(0)
    expect(series.map((srs) => srs.visible)).toEqual(expected_after_restore)
  })
})

describe(`streaming visibility characterization`, () => {
  const property_frames = [
    { temperature: 300, volume: 100, energy: -10 },
    { temperature: 301, volume: 101, energy: -11 },
  ]
  const property_config = {
    temperature: { label: `Temperature`, unit: `K` },
    volume: { label: `Volume`, unit: `Å³` },
    energy: { label: `Energy`, unit: `eV` },
  }
  const plot_metadata = property_frames.map((properties, frame_number) => ({
    frame_number,
    step: frame_number,
    properties,
  }))
  const assignments = (series: DataSeries[]) =>
    series
      .map(({ label, unit, visible, x, y, y_axis }) => ({
        label,
        unit,
        visible,
        x,
        y,
        y_axis,
      }))
      .toSorted((left, right) => left.label?.localeCompare(right.label ?? ``) ?? -1)

  it(`keeps eager and streaming axis assignment in parity for matching visibility inputs`, () => {
    const default_visible_properties = new Set(Object.keys(property_config))
    const eager = generate_plot_series(create_trajectory(property_frames), test_extractor, {
      property_config,
      default_visible_properties,
    })
    const streaming = generate_streaming_plot_series(plot_metadata, {
      property_config,
      default_visible_properties,
    })
    expect(assignments(streaming)).toEqual(assignments(eager))
  })

  it(`limits default visibility to two prioritized axis groups`, () => {
    const series = generate_streaming_plot_series(plot_metadata, {
      property_config,
      default_visible_properties: new Set([`energy`]),
    })
    const axis_assignments = series
      .map(({ label, visible, y_axis }) => ({ label, visible, y_axis }))
      .toSorted((left, right) => left.label?.localeCompare(right.label ?? ``) ?? -1)

    expect(axis_assignments).toEqual([
      { label: `Energy`, visible: true, y_axis: `y1` },
      { label: `Temperature`, visible: true, y_axis: `y2` },
      { label: `Volume`, visible: false, y_axis: `y1` },
    ])
  })

  it(`omits navigation coordinates instead of plotting time against time`, () => {
    const coordinate_metadata = [0, 1, 2].map((frame_number) => ({
      frame_number,
      step: 10 * frame_number,
      properties: {
        time_ps: frame_number * 0.25,
        production_step: 10 * frame_number,
        energy: -10 - frame_number,
        temperature: 300 + frame_number,
      },
    }))

    const series = generate_streaming_plot_series(coordinate_metadata, {
      property_config,
    })
    expect(
      series
        .map(({ label }) => label)
        .toSorted((left, right) => (left ?? ``).localeCompare(right ?? ``)),
    ).toEqual([`Energy`, `Temperature`])
    expect(series.every(({ visible }) => visible)).toBe(true)
  })

  it.each([`energy`, `total_energy`, `potential_energy`])(
    `renders long noisy %s as a smoothed trend over a faint peak-preserving trace`,
    (energy_key) => {
      const energy_metadata = Array.from({ length: 24_001 }, (_unused, frame_number) => ({
        frame_number,
        step: frame_number,
        properties: {
          [energy_key]: frame_number === 12_000 ? 100 : Math.sin(frame_number),
        },
      }))

      const raw_series = generate_streaming_plot_series(energy_metadata, {
        property_config,
      })
      const [smoothed] = prepare_trajectory_scatter_series(raw_series, 64)
      const underlay = smoothed.line_underlays?.[0]
      if (!underlay) throw new Error(`Expected a raw line underlay`)
      expect([smoothed.x.length, underlay.x.length]).toEqual([64, 64])
      expect([smoothed.x[0], smoothed.x.at(-1)]).toEqual([0, 24_000])
      expect([underlay.x[0], underlay.x.at(-1)]).toEqual([0, 24_000])
      expect(Math.max(...smoothed.y)).toBeLessThan(2)
      expect(Math.max(...underlay.y)).toBe(100)
      expect(smoothed.line_style).toMatchObject({ stroke_width: 2.5, curve: `monotone` })
      expect(underlay.line_style).toEqual({
        stroke: `color-mix(in srgb, #63b3ed 18%, transparent)`,
        stroke_width: 1,
        curve: `linear`,
      })
    },
  )
})

describe(`SCF convergence series axis grouping and log scale`, () => {
  // Mirrors vaspout.h5 single-point SCF pseudo-frames: monotonic energy plus
  // |dE| and density residuals spanning many decades (uses the built-in
  // trajectory_property_config where scf_energy_delta has its own axis_group)
  const scf_frames = [
    { energy: -10.1, scf_energy_delta: 2.5, scf_rms: 0.9, scf_charge_rms: 0.5 },
    { energy: -10.6, scf_energy_delta: 5e-2, scf_rms: 1e-2, scf_charge_rms: 8e-3 },
    { energy: -10.62, scf_energy_delta: 3e-4, scf_rms: 2e-4, scf_charge_rms: 9e-5 },
    { energy: -10.6201, scf_energy_delta: 8e-7, scf_rms: 4e-7, scf_charge_rms: 2e-7 },
  ]

  it(`puts scf_energy_delta on its own log-scaled axis next to linear energy`, () => {
    const series = generate_plot_series(create_trajectory(scf_frames), test_extractor)

    const energy_series = series.find((srs) => srs.label === `Energy`)
    const delta_series = series.find((srs) => srs.label?.includes(`ΔE`))
    expect(energy_series?.visible).toBe(true)
    expect(energy_series?.y_axis).toBe(`y1`)
    expect(delta_series?.visible).toBe(true)
    expect(delta_series?.y_axis).toBe(`y2`)
    // axis_group separates it from the eV energy group while unit stays displayable
    expect(delta_series?.unit).toBe(`eV`)
    expect(delta_series?.axis_group).toBe(`eV (SCF)`)
    // log-scale decision for the SCF axis_group is covered by the
    // generate_axis_scale_types table above
  })

  it(`keeps energy + force on the axes for relax trajectories (scf delta hidden)`, () => {
    const relax_frames = [
      { energy: -20.0, force_max: 1.2, scf_energy_delta: 1e-1 },
      { energy: -20.5, force_max: 0.6, scf_energy_delta: 1e-3 },
      { energy: -20.7, force_max: 0.1, scf_energy_delta: 1e-6 },
    ]
    const series = generate_plot_series(create_trajectory(relax_frames), test_extractor)

    expect(series.find((srs) => srs.label === `Energy`)?.visible).toBe(true)
    expect(series.find((srs) => srs.label?.includes(`F`))?.visible).toBe(true)
    expect(series.find((srs) => srs.label?.includes(`ΔE`))?.visible).toBe(false)
    expect(generate_axis_scale_types(series)).toEqual({ y1: `linear`, y2: `linear` })
  })
})

// A LAMMPS dump written every 500 steps records steps 0, 500, 1000 …, so plotting against
// the frame index while labelling the axis "Step" misstates the x axis by a factor of 500.
describe(`x axis quantity`, () => {
  const strided_trajectory = (): TrajectoryType => ({
    frames: [0, 500, 1000, 1500].map((step, frame_idx) =>
      make_trajectory_frame(step, 1, { energy: -10 - frame_idx }),
    ),
  })

  // oxfmt-ignore
  it.each([
    { steps: [0, 1, 2, 3], time_step: undefined, time_unit: undefined, expected: [`frame`] },
    { steps: [0, 1, 2, 3], time_step: 2, time_unit: `fs`, expected: [`frame`, `time`] },
    { steps: [0, 500, 1000, 1500], time_step: 2, time_unit: undefined, expected: [`frame`, `step`] },
    { steps: [0, 500, 1000, 1500], time_step: 2, time_unit: `fs`, expected: [`frame`, `step`, `time`] },
    // non-monotonic steps cannot be interpolated in either direction
    { steps: [0, 500, 200, 1500], time_step: 2, time_unit: `fs`, expected: [`frame`] },
    { steps: [7], time_step: 2, time_unit: `fs`, expected: [`frame`] },
  ])(
    `offers $expected for steps $steps with time_step $time_step`,
    ({ steps, time_step, time_unit, expected }) => {
      const samples = { frame_numbers: steps.map((_step, idx) => idx), steps }
      expect(available_x_quantities(samples, time_step, time_unit)).toEqual(expected)
    },
  )

  it(`plots against frame index by default`, () => {
    const series = generate_plot_series(strided_trajectory(), test_extractor)
    expect(find_series_by_label(series, `energy`)?.x).toEqual([0, 1, 2, 3])
  })

  it.each([
    { quantity: `frame` as const, expected_x: [0, 1, 2, 3], label: `Frame`, unit: `` },
    { quantity: `step` as const, expected_x: [0, 500, 1000, 1500], label: `Step`, unit: `` },
    {
      quantity: `time` as const,
      expected_x: [0, 1000, 2000, 3000],
      label: `Time`,
      unit: `fs`,
    },
  ])(`plots $quantity on the x axis`, ({ quantity, expected_x, label, unit }) => {
    const trajectory = strided_trajectory()
    const samples = get_frame_step_samples(trajectory)
    const x_map = build_x_map(samples, quantity, { time_step: 2, time_unit: `fs` })

    expect(x_map.label).toBe(label)
    expect(x_map.unit).toBe(unit)
    const series = generate_plot_series(trajectory, test_extractor, { x_map })
    expect(find_series_by_label(series, `energy`)?.x).toEqual(expected_x)
  })

  it(`falls back to frame numbering when the data cannot support the request`, () => {
    const samples = { frame_numbers: [0, 1, 2], steps: [0, 1, 2] }
    // no timestep recorded, and steps that merely repeat the frame index add nothing
    const x_map = build_x_map(samples, `time`, {})
    expect(x_map.quantity).toBe(`frame`)
    expect(x_map.to_x(2)).toBe(2)
  })

  // Plot skimming feeds the hovered x back in to pick a frame, so to_frame must invert
  // to_x exactly at sampled points and land on the nearest frame in between
  it.each([`frame`, `step`, `time`] as const)(
    `round-trips %s x values to frames`,
    (quantity) => {
      const samples = get_frame_step_samples(strided_trajectory())
      const x_map = build_x_map(samples, quantity, { time_step: 2, time_unit: `fs` })

      for (const frame_idx of [0, 1, 2, 3]) {
        expect(x_map.to_frame(x_map.to_x(frame_idx))).toBe(frame_idx)
      }
      // a value between two frames snaps to the closer one
      const midpoint = (x_map.to_x(1) + x_map.to_x(2)) / 2
      expect([1, 2]).toContain(x_map.to_frame(midpoint))
      // out-of-range values clamp instead of indexing past the ends
      expect(x_map.to_frame(x_map.to_x(0) - 1e6)).toBe(0)
      expect(x_map.to_frame(x_map.to_x(3) + 1e6)).toBe(3)
    },
  )

  // An indexed trajectory only records steps at sampled frames, so intermediate frames
  // have to be interpolated rather than dropped
  it(`interpolates steps between sampled frames of an indexed trajectory`, () => {
    const samples = { frame_numbers: [0, 10, 20], steps: [0, 1000, 2000] }
    const x_map = build_x_map(samples, `step`, {})
    expect(x_map.to_x(0)).toBe(0)
    expect(x_map.to_x(5)).toBe(500)
    expect(x_map.to_x(15)).toBe(1500)
    expect(x_map.to_frame(500)).toBe(5)
    expect(x_map.to_frame(1500)).toBe(15)
  })

  it(`maps streaming series x values through the same axis`, () => {
    const plot_metadata = [0, 10, 20].map((frame_number) => ({
      frame_number,
      step: frame_number * 100,
      properties: { energy: -10 - frame_number },
    }))
    const trajectory: TrajectoryType = { frames: [], plot_metadata }
    const x_map = build_x_map(get_frame_step_samples(trajectory), `step`, {})

    const series = generate_streaming_plot_series(plot_metadata, { x_map })
    expect(find_series_by_label(series, `energy`)?.x).toEqual([0, 1000, 2000])
  })

  it.each([
    { frame_numbers: [0, 1, 2], steps: [0, 500, 1000], time_step: 2, expected: 1000 },
    { frame_numbers: [0, 1, 2], steps: [0, 500, 1000], time_step: undefined, expected: null },
    // Indexed: a step recorded only every 10th frame spans 10 frames, so the per-frame dt
    // is a tenth of the per-sample one. Reading steps alone reports 1000 here.
    { frame_numbers: [0, 10, 20], steps: [0, 500, 1000], time_step: 2, expected: 100 },
    // Sampling that thins out mid-file: the step/frame ratio still holds, so dt survives
    { frame_numbers: [0, 10, 30], steps: [0, 500, 1500], time_step: 2, expected: 100 },
    // Same frame spacing but a step delta that jumps: genuinely non-uniform
    { frame_numbers: [0, 10, 20], steps: [0, 500, 1500], time_step: 2, expected: null },
  ])(
    `derives frame timestep $expected from steps $steps at frames $frame_numbers`,
    ({ frame_numbers, steps, time_step, expected }) => {
      expect(get_frame_time_step({ frame_numbers, steps }, time_step)).toBe(expected)
    },
  )
})
