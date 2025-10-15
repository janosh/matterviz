import type { DataSeries } from '$lib/plot'
import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory'
import {
  generate_axis_labels,
  generate_plot_series,
  should_hide_plot,
  toggle_series_visibility,
} from '$lib/trajectory/plotting'
import { describe, expect, it } from 'vitest'

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
function create_trajectory(property_frames: Record<string, number>[]): TrajectoryType {
  return {
    frames: property_frames.map((props, step) => ({
      structure: {
        sites: [{
          species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [0, 0, 0],
          label: `H1`,
          properties: {},
        }],
        charge: 0,
      },
      step,
      metadata: props,
    })),
  }
}

function test_extractor(frame: TrajectoryFrame): Record<string, number> {
  const data: Record<string, number> = { Step: frame.step }
  if (frame.metadata) {
    for (const [key, value] of Object.entries(frame.metadata)) {
      if (typeof value === `number`) data[key] = value
    }
  }
  return data
}

function create_series(
  y_values: number[],
  visible = true,
  label = `Test`,
  unit = ``,
  y_axis: `y1` | `y2` = `y1`,
): DataSeries {
  return {
    x: y_values.map((_, idx) => idx),
    y: y_values,
    label,
    unit,
    visible,
    y_axis,
    markers: `line` as const,
    metadata: [],
    line_style: { stroke: `blue`, stroke_width: 2 },
    point_style: { fill: `blue`, radius: 4, stroke: `blue`, stroke_width: 1 },
  }
}

// Test assertion helpers
function assert_unit_group_constraints(series: DataSeries[]): void {
  const visible_units = new Set(
    series.filter((srs) => srs.visible ?? true).map((srs) => srs.unit),
  )
  expect(visible_units.size).toBeLessThanOrEqual(2)
}

function find_series_by_label(
  series: DataSeries[],
  search_term: string,
): DataSeries | undefined {
  return series.find((s) => s.label?.toLowerCase().includes(search_term.toLowerCase()))
}

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
    assert_unit_group_constraints(series)
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
      { energy: -789.391026308540 },
    ])

    const series = generate_plot_series(trajectory, test_extractor)
    const energy_series = find_series_by_label(series, `energy`)
    expect(series.length).toBe(1)
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
    const a_series = series.find((s) => s.label === `A`)

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
    expect(series.filter((srs) => srs.visible).length).toBeGreaterThan(0)
  })

  describe(`unit group priority system`, () => {
    it(`should prioritize energy units for y1 axis`, () => {
      const trajectory = create_trajectory([
        { energy: -10.0, volume: 100.0, pressure: 1.0 },
        { energy: -10.5, volume: 101.0, pressure: 1.1 },
      ])

      const series = generate_plot_series(trajectory, test_extractor, {
        property_config: {
          energy: { label: `Energy`, unit: `eV` },
          volume: { label: `Volume`, unit: `Å³` },
          pressure: { label: `Pressure`, unit: `GPa` },
        },
        default_visible_properties: new Set([`energy`, `volume`]),
      })

      const energy_series = find_series_by_label(series, `energy`)
      expect(energy_series?.y_axis).toBe(`y1`) // Energy gets highest priority
      expect(energy_series?.visible).toBe(true)
    })

    it(`should enforce initial 2-unit-group constraint`, () => {
      const trajectory = create_trajectory([
        {
          energy: -10.0,
          force_max: 0.1,
          volume: 100.0,
          pressure: 1.0,
          temperature: 300.0,
        },
        {
          energy: -10.5,
          force_max: 0.2,
          volume: 101.0,
          pressure: 1.1,
          temperature: 301.0,
        },
      ])

      const series = generate_plot_series(trajectory, test_extractor, {
        property_config: {
          energy: { label: `Energy`, unit: `eV` },
          force_max: { label: `F<sub>max</sub>`, unit: `eV/Å` },
          volume: { label: `Volume`, unit: `Å³` },
          pressure: { label: `Pressure`, unit: `GPa` },
          temperature: { label: `Temperature`, unit: `K` },
        },
        default_visible_properties: new Set([
          `energy`,
          `force_max`,
          `volume`,
          `pressure`,
          `temperature`,
        ]),
      })

      assert_unit_group_constraints(series)

      // Should prioritize energy and force_max over others
      const energy_series = find_series_by_label(series, `energy`)
      const force_series = find_series_by_label(series, `f`)
      expect(energy_series?.visible).toBe(true)
      expect(force_series?.visible).toBe(true)
    })
  })
})

describe(`toggle_series_visibility`, () => {
  const create_test_series = () => [
    create_series([1, 2, 3], true, `Energy`, `eV`),
    create_series([0.1, 0.2, 0.3], true, `Force`, `eV/Å`),
    create_series([100, 101, 102], false, `Volume`, `Å³`),
  ]

  it(`should toggle visibility while respecting unit group constraints`, () => {
    const initial_series = create_test_series()
    const updated_series = toggle_series_visibility(initial_series, 2) // Toggle Volume

    // Volume shown, Force hidden (smart replacement), Energy kept (highest priority)
    expect(updated_series[0].visible).toBe(true) // Energy
    expect(updated_series[1].visible).toBe(false) // Force (hidden to make room)
    expect(updated_series[2].visible).toBe(true) // Volume (newly shown)

    const visible_units = new Set(
      updated_series.filter((srs) => srs.visible).map((srs) => srs.unit),
    )
    expect(visible_units.size).toBe(2)
    expect(visible_units).toEqual(new Set([`eV`, `Å³`]))
  })

  it.each([
    { name: `negative index`, index: -1 },
    { name: `out-of-bounds index`, index: 10 },
    { name: `empty series array`, series: [], index: 0 },
  ])(`should handle invalid input: $name`, ({ series = create_test_series(), index }) => {
    const result = toggle_series_visibility(series, index)
    expect(result).toEqual(series)
  })

  it(`should handle single series toggle`, () => {
    const single_series = [create_series([1, 2, 3], true, `Energy`, `eV`)]

    const hidden_result = toggle_series_visibility(single_series, 0)
    expect(hidden_result[0].visible).toBe(false)

    const visible_result = toggle_series_visibility(hidden_result, 0)
    expect(visible_result[0].visible).toBe(true)
  })

  it(`should not hide series with same unit when toggling (regression test)`, () => {
    const initial_series = [
      create_series([5.0, 5.1, 5.2], true, `A`, `Å`, `y2`),
      create_series([5.2, 5.3, 5.4], false, `B`, `Å`, `y2`), // Same unit as A
      create_series([1.0, 2.0, 3.0], true, `Energy`, `eV`, `y1`),
    ]

    const updated_series = toggle_series_visibility(initial_series, 1)

    // A should NOT be hidden when B is shown (same unit group)
    expect(updated_series.find((s) => s.label === `A`)?.visible).toBe(true)
    expect(updated_series.find((s) => s.label === `B`)?.visible).toBe(true)
    expect(updated_series.find((s) => s.label === `Energy`)?.visible).toBe(true)

    const visible_units = new Set(
      updated_series.filter((srs) => srs.visible).map((srs) => srs.unit),
    )
    expect(visible_units).toEqual(new Set([`Å`, `eV`]))
  })

  describe(`smart unit group replacement`, () => {
    const create_replacement_test_series = () => [
      create_series([1.0, 2.0], true, `Energy`, `eV`, `y1`),
      create_series([5.0, 5.1], true, `A`, `Å`, `y2`),
      create_series([5.1, 5.2], false, `B`, `Å`, `y2`), // Same unit as A
      create_series([100, 101], false, `Volume`, `Å³`, `y1`),
    ]

    it(`should not trigger replacement when showing series with same unit`, () => {
      const initial_series = create_replacement_test_series()
      const updated = toggle_series_visibility(initial_series, 2) // Show B (same unit as A)

      expect(updated.find((s) => s.label === `Energy`)?.visible).toBe(true)
      expect(updated.find((s) => s.label === `A`)?.visible).toBe(true)
      expect(updated.find((s) => s.label === `B`)?.visible).toBe(true)
      expect(updated.find((s) => s.label === `Volume`)?.visible).toBe(false)

      const visible_units = new Set(
        updated.filter((srs) => srs.visible).map((srs) => srs.unit),
      )
      expect(visible_units).toEqual(new Set([`eV`, `Å`]))
    })

    it(`should trigger smart replacement when showing series with new unit`, () => {
      const initial_series = create_replacement_test_series()
      // First show B to have both A and B visible (same unit)
      let updated = toggle_series_visibility(initial_series, 2)
      // Then show Volume (new unit) - should trigger smart replacement
      updated = toggle_series_visibility(updated, 3)

      expect(updated.find((s) => s.label === `Energy`)?.visible).toBe(true)
      expect(updated.find((s) => s.label === `Volume`)?.visible).toBe(true)
      expect(updated.find((s) => s.label === `A`)?.visible).toBe(false)
      expect(updated.find((s) => s.label === `B`)?.visible).toBe(false)

      const visible_units = new Set(
        updated.filter((srs) => srs.visible).map((srs) => srs.unit),
      )
      expect(visible_units).toEqual(new Set([`eV`, `Å³`]))
    })

    it(`should maintain 2-unit-group constraint during replacement`, () => {
      const initial_series = create_replacement_test_series()
      let updated = toggle_series_visibility(initial_series, 2) // Show B
      updated = toggle_series_visibility(updated, 3) // Show Volume

      assert_unit_group_constraints(updated)
      expect(updated.filter((s) => s.visible).length).toBeGreaterThan(0)
    })
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

  it(`should handle single frame trajectory and custom tolerance`, () => {
    const single_frame = create_trajectory([{}])
    expect(should_hide_plot(single_frame, [])).toBe(true) // Single frame should hide plot

    const series = [create_series([1.0, 1.000001, 1.0])]
    expect(should_hide_plot(trajectory, series)).toBe(false) // Default tolerance
    expect(should_hide_plot(trajectory, series, 1e-2)).toBe(true) // Loose tolerance
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
  ])(`should handle extreme tolerance: $name`, ({ tolerance, expected }) => {
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
  ])(`should generate axis labels for $name`, ({ series, expected }) => {
    const labels = generate_axis_labels(series)
    expect(labels).toEqual(expected)
  })

  it(`should handle different axes assignments`, () => {
    const series = [
      { ...create_series([1, 2], true, `Energy`, `eV`), y_axis: `y1` as const },
      { ...create_series([3, 4], true, `Force`, `eV/Å`), y_axis: `y2` as const },
    ]
    const labels = generate_axis_labels(series)
    expect(labels.y1).toBe(`Energy (eV)`)
    expect(labels.y2).toBe(`Force (eV/Å)`)
  })

  it(`should concatenate multiple series on same axis`, () => {
    const series = [
      { ...create_series([5.0, 5.1], true, `A`, `Å`), y_axis: `y1` as const },
      { ...create_series([5.1, 5.2], true, `B`, `Å`), y_axis: `y1` as const },
      { ...create_series([1.0, 2.0], true, `Energy`, `eV`), y_axis: `y2` as const },
    ]

    const labels = generate_axis_labels(series)
    expect(labels.y1).toBe(`A / B (Å)`)
    expect(labels.y2).toBe(`Energy (eV)`)
  })
})

describe(`integration and regression tests`, () => {
  it(`should not show duplicate units in legend and handle priority correctly`, () => {
    const trajectory = create_trajectory(COMMON_TRAJECTORIES.lattice_params)
    const series = generate_plot_series(trajectory, test_extractor, {
      property_config: DEFAULT_PROPERTY_CONFIG,
    })

    // Series labels should not include units (units added by axis labeling)
    series.forEach((s) => expect(s.label).not.toMatch(/\([^)]+\)/))

    // But unit field should be properly set
    const energy_series = find_series_by_label(series, `energy`)
    const a_series = series.find((s) => s.label === `A`)
    expect(energy_series?.unit).toBe(`eV`)
    if (a_series) expect(a_series.unit).toBe(`Å`)
  })

  it(`should handle mixed visibility states in axis labeling`, () => {
    const series = [
      create_series([1, 2], true, `Visible`, `eV`, `y1`),
      create_series([3, 4], false, `Hidden`, `eV`, `y1`), // Same unit, but hidden
      create_series([5, 6], true, `Another`, `Å`, `y2`),
    ]

    const labels = generate_axis_labels(series)
    expect(labels.y1).toBe(`Visible (eV)`) // Only visible series included
    expect(labels.y2).toBe(`Another (Å)`)
  })
})
