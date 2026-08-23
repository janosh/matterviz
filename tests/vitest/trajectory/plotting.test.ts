import type { DataSeries } from '$lib/plot'
import type { TrajectoryMetadata } from '$lib/trajectory'
import {
  available_x_quantities,
  build_x_map,
  generate_axis_labels,
  generate_axis_scale_types,
  generate_plot_series,
  get_frame_step_samples,
  get_frame_time_step,
  prepare_trajectory_scatter_series,
  should_hide_plot,
  summarize_properties,
} from '$lib/trajectory/plotting'
import type { PlotSeriesOptions } from '$lib/trajectory/plotting'
import { describe, expect, it } from 'vitest'

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

const create_rows = (property_frames: Record<string, number>[]): TrajectoryMetadata[] =>
  property_frames.map((properties, frame_number) => ({
    frame_number,
    step: frame_number,
    properties,
  }))

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
      create_rows([
        { energy: -10, frame_id: 0, production_step: 0, time_ps: 0, [`Time (ps)`]: 0 },
        { energy: -11, frame_id: 1, production_step: 10, time_ps: 0.25, [`Time (ps)`]: 0.25 },
      ]),
      { property_config: DEFAULT_PROPERTY_CONFIG },
    )
    expect(series.map(({ label }) => label)).toEqual([`Energy`])
  })

  it(`groups energy and force series by unit`, () => {
    const series = generate_plot_series(create_rows(COMMON_TRAJECTORIES.multi_property), {
      property_config: DEFAULT_PROPERTY_CONFIG,
      default_visible_properties: new Set([`energy`, `force_max`]),
    })
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
    const series = generate_plot_series(create_rows(frames), options)
    expect(
      Object.fromEntries(
        series.map(({ label, visible, y_axis }) => [label, { visible, y_axis }]),
      ),
    ).toEqual(expected)
    // visible series lead the legend regardless of property order
    const visibility = series.map(({ visible }) => visible)
    expect(visibility).toEqual(
      visibility.toSorted((left, right) => Number(right) - Number(left)),
    )
  })

  it(`keeps sparse property values aligned to their source frames`, () => {
    const series = generate_plot_series(
      create_rows([
        { energy: -10, temperature: 300 },
        { energy: -11 },
        { energy: -12, temperature: 320 },
      ]),
    )
    expect(find_series_by_label(series, `temperature`)).toMatchObject({
      x: [0, 2],
      y: [300, 320],
    })
  })

  it(`renders long eager data as a smoothed trend over a faint peak-preserving trace`, () => {
    const frames = Array.from({ length: 24_001 }, (_unused, frame_number) => ({
      energy:
        frame_number === 12_000
          ? 100
          : frame_number === 12_001
            ? Infinity
            : Math.sin(frame_number),
    }))
    const raw_series = generate_plot_series(create_rows(frames))
    expect(raw_series[0].y).toHaveLength(24_001)
    expect(raw_series[0].line_underlays).toBeUndefined()

    const [smoothed] = prepare_trajectory_scatter_series(raw_series, 500)
    const underlay = smoothed.line_underlays?.[0]
    const raw_y = smoothed.raw_y
    if (!underlay || !raw_y) throw new Error(`Expected aligned raw trajectory data`)

    expect([smoothed.x.length, raw_y.length, underlay.x.length]).toEqual([500, 500, 500])
    expect(smoothed.x).toEqual(underlay.x)
    expect(raw_y).toEqual(underlay.y)
    expect(Math.max(...smoothed.y)).toBeLessThan(20)
    expect(Math.max(...underlay.y)).toBe(100)
    expect(raw_y).toEqual(smoothed.x.map((x) => raw_series[0].y[x]))
    expect(smoothed.line_style).toMatchObject({ stroke_width: 2.5, curve: `monotone` })
    expect(underlay.line_style).toEqual({
      stroke: `color-mix(in srgb, #4e79a7 18%, transparent)`,
      stroke_width: 1,
      curve: `linear`,
    })

    const [resampled] = prepare_trajectory_scatter_series([smoothed], 250)
    const resampled_underlay = resampled.line_underlays?.[0]
    if (!resampled_underlay || !resampled.raw_y) {
      throw new Error(`Expected resampled raw trajectory data`)
    }
    expect(resampled.raw_y).toEqual(resampled_underlay.y)
    expect(Math.max(...resampled_underlay.y)).toBe(100)

    const duplicate_x = {
      x: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
      y: [0, 20, -5, 9, 2, 50, -10, 7, 3, 40, -1, 11],
    }
    const [once_sampled] = prepare_trajectory_scatter_series([duplicate_x], 8)
    const [twice_sampled] = prepare_trajectory_scatter_series([once_sampled], 4)
    expect({ x: twice_sampled.x, raw_y: twice_sampled.raw_y }).toEqual({
      x: [0, 2, 3, 5],
      raw_y: [0, 50, -10, 11],
    })

    const large_values = Array(10_000).fill(1e306)
    const [large_smoothed] = prepare_trajectory_scatter_series(
      [{ x: large_values.map((_value, idx) => idx), y: large_values }],
      64,
    )
    expect(large_smoothed.y).toEqual(Array(64).fill(1e306))
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1, 0, -1])(
    `rejects an invalid scatter point budget of %s`,
    (max_points) => {
      expect(() => prepare_trajectory_scatter_series([], max_points)).toThrow(
        `max_points must be finite and at least 2`,
      )
    },
  )

  it(`rejects misaligned raw values before the short-series early return`, () => {
    expect(() =>
      prepare_trajectory_scatter_series([{ x: [0, 1], y: [2, 3], raw_y: [2] }], 100),
    ).toThrow(`aligned arrays`)
  })

  it.each([
    { name: `empty trajectory`, frames: [], expected_length: 0 },
    { name: `single frame`, frames: [{ energy: -10.0 }], expected_length: 0 },
  ])(`handles edge case: $name`, ({ frames, expected_length }) => {
    expect(generate_plot_series(create_rows(frames))).toHaveLength(expected_length)
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
      create_rows(values.map((value) => ({ [key]: value }))),
    )
    expect(series).toHaveLength(should_include ? 1 : 0)
    if (match) expect(find_series_by_label(series, key)).toMatchObject(match)
  })
})

describe(`summarize_properties`, () => {
  it(`reports mean, std, range and the least-squares drift per varying property`, () => {
    // energy falls linearly (drift = full change, std > 0), volume jitters around 100 with no
    // trend, force is constant and so not reported; `step` is an axis coordinate, not a property
    const rows = create_rows([
      { energy: -10, volume: 100, force_max: 0.5, step: 0 },
      { energy: -11, volume: 102, force_max: 0.5, step: 10 },
      { energy: -12, volume: 102, force_max: 0.5, step: 20 },
      { energy: -13, volume: 100, force_max: 0.5, step: 30 },
    ])
    const by_key = new Map(summarize_properties(rows).map((stat) => [stat.key, stat]))
    expect([...by_key.keys()].toSorted()).toEqual([`energy`, `volume`])
    expect(by_key.get(`energy`)).toMatchObject({
      n_samples: 4,
      mean: -11.5,
      min: -13,
      max: -10,
    })
    expect(by_key.get(`energy`)?.drift).toBeCloseTo(-3, 12)
    expect(by_key.get(`energy`)?.std).toBeCloseTo(Math.sqrt(5 / 3), 12)
    expect(by_key.get(`volume`)?.drift).toBeCloseTo(0, 12)
    // the drift is slope x span, so it is invariant to the x scale a caller chooses
    const in_steps = summarize_properties(rows, (row) => row.step).find(
      (stat) => stat.key === `energy`,
    )
    expect(in_steps?.drift).toBeCloseTo(-3, 12)
    // Irregular dump steps: energy falls 1 per step; the frame axis sees (0,-10) (1,-11)
    // (2,-13) (3,-19) while the step axis recovers the exact slope x span
    const irregular = create_rows([
      { energy: -10 },
      { energy: -11 },
      { energy: -13 },
      { energy: -19 },
    ])
    for (const [idx, step] of [0, 1, 3, 9].entries()) irregular[idx].step = step
    const [by_frame, by_step] = [undefined, (row: TrajectoryMetadata) => row.step].map(
      (x_of) => summarize_properties(irregular, x_of)[0].drift,
    )
    expect(by_step).toBeCloseTo(-9, 12)
    expect(by_frame).not.toBeCloseTo(-9, 6)
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
    expect(should_hide_plot(frames.length, series)).toBe(expected)
  })

  it.each([
    { name: `very loose`, tolerance: 1e10, expected: true },
    { name: `zero tolerance`, tolerance: 0, expected: false },
  ])(`tolerance: $name → hide=$expected`, ({ tolerance, expected }) => {
    const series = [create_series([1.0, 1.0000001, 1.0])]
    expect(should_hide_plot(multi.length, series, tolerance)).toBe(expected)
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
    const series = generate_plot_series(create_rows(scf_frames))

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
    const series = generate_plot_series(create_rows(relax_frames))

    expect(series.find((srs) => srs.label === `Energy`)?.visible).toBe(true)
    expect(series.find((srs) => srs.label?.includes(`F`))?.visible).toBe(true)
    expect(series.find((srs) => srs.label?.includes(`ΔE`))?.visible).toBe(false)
    expect(generate_axis_scale_types(series)).toEqual({ y1: `linear`, y2: `linear` })
  })
})

// A LAMMPS dump written every 500 steps records steps 0, 500, 1000 …, so plotting against
// the frame index while labelling the axis "Step" misstates the x axis by a factor of 500.
describe(`x axis quantity`, () => {
  const strided_rows = (): TrajectoryMetadata[] =>
    [0, 500, 1000, 1500].map((step, frame_number) => ({
      frame_number,
      step,
      properties: { energy: -10 - frame_number },
    }))

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
    const series = generate_plot_series(strided_rows())
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
    const rows = strided_rows()
    const samples = get_frame_step_samples(rows)
    const x_map = build_x_map(samples, quantity, { time_step: 2, time_unit: `fs` })

    expect(x_map.label).toBe(label)
    expect(x_map.unit).toBe(unit)
    const series = generate_plot_series(rows, { x_map })
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
      const samples = get_frame_step_samples(strided_rows())
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
    const x_map = build_x_map(get_frame_step_samples(plot_metadata), `step`, {})

    const series = generate_plot_series(plot_metadata, { x_map })
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
