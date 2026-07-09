import type { DataSeries } from '$lib/plot'
import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory'
import {
  generate_axis_labels,
  generate_axis_scale_types,
  generate_plot_series,
  should_hide_plot,
} from '$lib/trajectory/plotting'
import { describe, expect, it } from 'vitest'
import { make_trajectory_frame } from '../setup'

// Test data and configuration constants
const DEFAULT_PROPERTY_CONFIG = {
  energy: { label: `Energy`, unit: `eV` },
  force_max: { label: `F<sub>max</sub>`, unit: `eV/Å` },
  volume: { label: `Volume`, unit: `Å³` },
  a: { label: `A`, unit: `Å` },
  b: { label: `B`, unit: `Å` },
  c: { label: `C`, unit: `Å` },
} as const

const COMMON_TRAJECTORIES = {
  multi_property: [
    { energy: -10.0, force_max: 0.1, volume: 100.0 },
    { energy: -10.5, force_max: 0.2, volume: 101.0 },
    { energy: -11.0, force_max: 0.3, volume: 102.0 },
  ],
  lattice_params: [
    { energy: -10.0, a: 5.0, b: 5.1, volume: 100.0 },
    { energy: -10.5, a: 5.1, b: 5.2, volume: 101.0 },
  ],
  four_properties: [
    { prop_a: 1.0, prop_b: 2.0, prop_c: 3.0, prop_d: 4.0 },
    { prop_a: 1.5, prop_b: 2.5, prop_c: 3.5, prop_d: 4.5 },
  ],
}

// Helper functions
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

const create_series = (
  y_values: number[],
  visible = true,
  label = `Test`,
  unit = ``,
  y_axis: `y1` | `y2` = `y1`,
  axis_group?: string,
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

// Test assertion helpers
function assert_unit_group_constraints(series: DataSeries[]): void {
  const visible_units = new Set(
    series.filter((srs) => srs.visible ?? true).map((srs) => srs.unit),
  )
  expect(visible_units.size).toBeLessThanOrEqual(2)
}

const find_series_by_label = (series: DataSeries[], search_term: string) =>
  series.find((srs) => srs.label?.toLowerCase().includes(search_term.toLowerCase()))

describe(`generate_plot_series`, () => {
  it(`should handle basic trajectory generation with unit grouping`, () => {
    const trajectory = create_trajectory(COMMON_TRAJECTORIES.multi_property)
    const series = generate_plot_series(trajectory, test_extractor, {
      property_config: DEFAULT_PROPERTY_CONFIG,
      default_visible_properties: new Set([`energy`, `force_max`]),
    })

    expect(series).toHaveLength(3)

    const energy_series = find_series_by_label(series, `energy`)
    const force_series = find_series_by_label(series, `f`)
    const volume_series = find_series_by_label(series, `volume`)

    // Verify axis assignments and visibility
    expect(energy_series?.unit).toBe(`eV`)
    expect(energy_series?.y_axis).toBe(`y1`)
    expect(energy_series?.visible).toBe(true)

    expect(force_series?.unit).toBe(`eV/Å`)
    expect(force_series?.y_axis).toBe(`y2`)
    expect(force_series?.visible).toBe(true)

    expect(volume_series?.visible).toBe(false) // Hidden (max 2 unit groups)
    expect(energy_series?.point_style).toMatchObject({ stroke_width: 1 })
    expect(energy_series?.point_style).not.toHaveProperty(`radius`)
    assert_unit_group_constraints(series)
  })

  it(`memoizes extraction until extractor, trajectory, or frame identities change`, () => {
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

    const before_other_trajectory = call_count
    generate_plot_series(
      create_trajectory(COMMON_TRAJECTORIES.lattice_params),
      counting_extractor,
    )
    expect(call_count).toBeGreaterThan(before_other_trajectory)
  })

  it.each([
    { name: `empty trajectory`, frames: [], expected_length: 0 },
    { name: `single frame`, frames: [{ energy: -10.0 }], expected_length: 0 },
  ])(`should handle edge case: $name`, ({ frames, expected_length }) => {
    const trajectory = create_trajectory(frames)
    const series = generate_plot_series(trajectory, test_extractor)
    expect(series).toHaveLength(expected_length)
  })

  it.each([
    { name: `constant`, values: [10.0, 10.0, 10.0], should_include: false },
    {
      name: `nearly constant`,
      values: [10.000001, 10.000002, 10.000001],
      should_include: false,
    },
    { name: `varying`, values: [10.0, 10.1, 10.2], should_include: true },
  ])(`should filter $name properties`, ({ values, should_include }) => {
    const trajectory = create_trajectory(values.map((value) => ({ test_prop: value })))
    const series = generate_plot_series(trajectory, test_extractor)
    expect(series.length > 0).toBe(should_include)
  })

  it(`should always include energy series regardless of variance`, () => {
    const trajectory = create_trajectory([
      { energy: -789.391026308538 },
      { energy: -789.391026308539 },
      { energy: -789.39102630854 },
    ])

    const series = generate_plot_series(trajectory, test_extractor)
    const energy_series = find_series_by_label(series, `energy`)
    expect(series).toHaveLength(1)
    expect(energy_series?.visible).toBe(true)
    expect(energy_series?.unit).toBe(`eV`)
    expect(energy_series?.y_axis).toBe(`y1`)
    expect(energy_series?.label).toBe(`Energy`)
    expect(energy_series?.markers).toBe(`line+points`)
  })

  it(`should maintain priority-based axis assignment and unit grouping`, () => {
    const trajectory = create_trajectory(COMMON_TRAJECTORIES.lattice_params)
    const series = generate_plot_series(trajectory, test_extractor, {
      property_config: DEFAULT_PROPERTY_CONFIG,
      default_visible_properties: new Set([`energy`, `a`]),
    })

    const energy_series = find_series_by_label(series, `energy`)
    const a_series = find_series_by_label(series, `A`)

    // Energy gets y1 (higher priority), lattice params get y2
    expect(energy_series?.y_axis).toBe(`y1`)
    expect(a_series?.y_axis).toBe(`y2`)
    expect(energy_series?.visible).toBe(true)
    expect(a_series?.visible).toBe(true)
    assert_unit_group_constraints(series)
  })

  it(`should enforce strict maximum 2 visible unit groups constraint`, () => {
    const trajectory = create_trajectory(COMMON_TRAJECTORIES.four_properties)
    const series = generate_plot_series(trajectory, test_extractor, {
      property_config: {
        prop_a: { label: `Prop A`, unit: `unit_a` },
        prop_b: { label: `Prop B`, unit: `unit_b` },
        prop_c: { label: `Prop C`, unit: `unit_c` },
        prop_d: { label: `Prop D`, unit: `unit_d` },
      },
      default_visible_properties: new Set([`prop_a`, `prop_b`, `prop_c`, `prop_d`]),
    })

    assert_unit_group_constraints(series)
    // 4 distinct units, all requested visible -> exactly 2 unit groups survive
    expect(series.filter((srs) => srs.visible)).toHaveLength(2)
  })
})

describe(`should_hide_plot`, () => {
  const trajectory = create_trajectory(COMMON_TRAJECTORIES.multi_property)

  it.each([
    { name: `no series`, series: [], expected: true },
    { name: `constant series`, series: [create_series([1.0, 1.0, 1.0])], expected: true },
    { name: `varying series`, series: [create_series([1.0, 2.0, 3.0])], expected: false },
    {
      name: `hidden varying series`,
      series: [create_series([1.0, 2.0, 3.0], false)],
      expected: false,
    },
  ])(`should hide plot for $name`, ({ series, expected }) => {
    expect(should_hide_plot(trajectory, series)).toBe(expected)
  })

  it(`hides plot for single-frame trajectory despite a varying series`, () => {
    const single_frame = create_trajectory([{ energy: -10 }])
    expect(should_hide_plot(single_frame, [create_series([1.0, 2.0, 3.0])])).toBe(true)
  })

  it.each([
    { name: `NaN values`, values: [1.0, NaN, 1.0], expected: true },
    { name: `Infinity values`, values: [1.0, Infinity, 1.0], expected: false },
    { name: `all NaN values`, values: [NaN, NaN, NaN], expected: true },
  ])(`should handle edge case: $name`, ({ values, expected }) => {
    const series = [create_series(values)]
    expect(should_hide_plot(trajectory, series)).toBe(expected)
  })

  it.each([
    { name: `very strict`, tolerance: 1e-10, expected: false },
    { name: `very loose`, tolerance: 1e10, expected: true },
    { name: `zero tolerance`, tolerance: 0, expected: false },
    { name: `default (undefined) tolerance`, tolerance: undefined, expected: false },
  ])(`should handle tolerance: $name`, ({ tolerance, expected }) => {
    const series = [create_series([1.0, 1.0000001, 1.0])]
    expect(should_hide_plot(trajectory, series, tolerance)).toBe(expected)
  })
})

describe(`generate_axis_labels`, () => {
  it.each([
    {
      name: `single series with unit`,
      series: [create_series([1, 2], true, `Energy`, `eV`)],
      expected: { y1: `Energy (eV)`, y2: `Value` },
    },
    {
      name: `multiple series same unit`,
      series: [
        create_series([1, 2], true, `A`, `Å`),
        create_series([3, 4], true, `B`, `Å`),
        create_series([5, 6], true, `C`, `Å`),
      ],
      expected: { y1: `A / B / C (Å)`, y2: `Value` },
    },
    {
      name: `series without units`,
      series: [create_series([1, 2], true, `Dimensionless`, ``)],
      expected: { y1: `Dimensionless`, y2: `Value` },
    },
    {
      name: `only hidden series`,
      series: [create_series([1, 2], false, `Hidden`, `eV`)],
      expected: { y1: `Value`, y2: `Value` },
    },
    {
      name: `mixed visibility (hidden series excluded from labels)`,
      series: [
        create_series([1, 2], true, `Visible`, `eV`, `y1`),
        create_series([3, 4], false, `Hidden`, `eV`, `y1`), // Same unit, but hidden
        create_series([5, 6], true, `Another`, `Å`, `y2`),
      ],
      expected: { y1: `Visible (eV)`, y2: `Another (Å)` },
    },
    {
      name: `series split across y1 and y2`,
      series: [
        create_series([1, 2], true, `Energy`, `eV`, `y1`),
        create_series([3, 4], true, `Force`, `eV/Å`, `y2`),
      ],
      expected: { y1: `Energy (eV)`, y2: `Force (eV/Å)` },
    },
    {
      name: `multiple series concatenated on y1 with separate y2`,
      series: [
        create_series([5.0, 5.1], true, `A`, `Å`, `y1`),
        create_series([5.1, 5.2], true, `B`, `Å`, `y1`),
        create_series([1.0, 2.0], true, `Energy`, `eV`, `y2`),
      ],
      expected: { y1: `A / B (Å)`, y2: `Energy (eV)` },
    },
  ])(`should generate axis labels for $name`, ({ series, expected }) => {
    const labels = generate_axis_labels(series)
    expect(labels).toEqual(expected)
  })
})

describe(`generate_axis_scale_types`, () => {
  it.each([
    {
      name: `positive non-SCF series spanning >=3 decades stays linear`,
      series: [create_series([1e-6, 1e-4, 1e-2, 1])],
      expected: { y1: `linear`, y2: `linear` },
    },
    {
      name: `positive SCF axis group spanning >=3 decades goes log`,
      series: [create_series([1e-6, 1e-4, 1e-2, 1], true, `SCF`, `eV`, `y1`, `eV (SCF)`)],
      expected: { y1: `log`, y2: `linear` },
    },
    {
      name: `negative values stay linear despite decade span`,
      series: [create_series([-10, 1e-4, 1])],
      expected: { y1: `linear`, y2: `linear` },
    },
    {
      name: `zero values stay linear`,
      series: [create_series([0, 1e-4, 1])],
      expected: { y1: `linear`, y2: `linear` },
    },
    {
      name: `positive but narrow span stays linear`,
      series: [create_series([1, 5, 100])],
      expected: { y1: `linear`, y2: `linear` },
    },
    {
      name: `hidden series don't affect the axis scale`,
      series: [
        create_series([-10, -11, -12], true, `Energy`, `eV`),
        create_series([1e-6, 1], false, `Residual`, `a.u.`),
      ],
      expected: { y1: `linear`, y2: `linear` },
    },
    {
      name: `per-axis decision: linear energy on y1, log residual on y2`,
      series: [
        create_series([-10, -11, -12], true, `Energy`, `eV`, `y1`),
        create_series([1, 1e-3, 1e-7], true, `Residual`, `eV`, `y2`, `eV (SCF)`),
      ],
      expected: { y1: `linear`, y2: `log` },
    },
    {
      name: `mixed-sign axis stays linear even when one series qualifies`,
      series: [
        create_series([-10, -11, -12], true, `Energy`, `eV`, `y1`),
        create_series([1, 1e-3, 1e-7], true, `Residual`, `a.u.`, `y1`),
      ],
      expected: { y1: `linear`, y2: `linear` },
    },
    { name: `no series`, series: [], expected: { y1: `linear`, y2: `linear` } },
    {
      name: `NaN values are ignored for the decision`,
      series: [create_series([NaN, 1e-5, 1], true, `SCF`, `eV`, `y1`, `eV (SCF)`)],
      expected: { y1: `log`, y2: `linear` },
    },
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
    const trajectory = create_trajectory(scf_frames)
    const series = generate_plot_series(trajectory, test_extractor)

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

describe(`integration and regression tests`, () => {
  it(`should not show duplicate units in legend and handle priority correctly`, () => {
    const trajectory = create_trajectory(COMMON_TRAJECTORIES.lattice_params)
    const series = generate_plot_series(trajectory, test_extractor, {
      property_config: DEFAULT_PROPERTY_CONFIG,
    })

    // Series labels should not include units (units added by axis labeling)
    series.forEach((srs) => expect(srs.label).not.toMatch(/\([^)]+\)/))

    // But unit field should be properly set
    const energy_series = find_series_by_label(series, `energy`)
    const a_series = find_series_by_label(series, `A`)
    expect(energy_series?.unit).toBe(`eV`)
    if (a_series) expect(a_series.unit).toBe(`Å`)
  })

  it.each([
    { label_search: `energy`, expected_key: `energy` },
    { label_search: `f`, expected_key: `force_max` },
    { label_search: `volume`, expected_key: `volume` },
  ])(
    `should store property_key=$expected_key in $label_search series metadata`,
    ({ label_search, expected_key }) => {
      const trajectory = create_trajectory(COMMON_TRAJECTORIES.multi_property)
      const series = generate_plot_series(trajectory, test_extractor, {
        property_config: DEFAULT_PROPERTY_CONFIG,
      })

      const found_series = find_series_by_label(series, label_search)
      expect(found_series).toBeDefined()
      const meta_arr = found_series?.metadata as Record<string, unknown>[] | undefined
      expect(meta_arr).toBeInstanceOf(Array)
      expect(meta_arr).toHaveLength(3) // 3 frames in COMMON_TRAJECTORIES.multi_property

      expect(meta_arr?.[0]?.property_key).toBe(expected_key)
    },
  )
})
