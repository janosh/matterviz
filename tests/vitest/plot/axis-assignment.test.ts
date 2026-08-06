import {
  assign_axes,
  AxisAssignmentOverflowError,
  axis_group_key,
  axis_labels,
  axis_scale_types,
  group_axis_series,
} from '$lib/plot/core/axis-assignment'
import type {
  AxisAssignmentOptions,
  AxisValueSeries,
  OverflowAxisAssignment,
} from '$lib/plot/core/axis-assignment'
import { describe, expect, test } from 'vitest'

const create_series = (
  label: string,
  unit = ``,
  options: Partial<AxisValueSeries> = {},
): AxisValueSeries => ({
  label,
  unit,
  y: [1, 2],
  ...options,
})

const assign_overflow = (
  series: AxisValueSeries[],
  options: AxisAssignmentOptions<AxisValueSeries> = {},
): OverflowAxisAssignment<AxisValueSeries> => {
  const result = assign_axes(series, options)
  expect(result.status).toBe(`overflow`)
  if (result.status !== `overflow`) throw new Error(`Expected overflow assignment`)
  return result
}

describe(`axis_group_key`, () => {
  test.each([
    [`axis_group overrides unit`, create_series(`SCF`, `eV`, { axis_group: `scf` }), `scf`],
    [`unit groups ordinary series`, create_series(`Energy`, `eV`), `eV`],
    [`empty unit becomes dimensionless`, create_series(`Score`), `dimensionless`],
    [
      `blank axis group falls back to a trimmed unit`,
      create_series(`Energy`, ` eV `, { axis_group: `  ` }),
      `eV`,
    ],
    [
      `blank axis group and unit become dimensionless`,
      create_series(`Score`, `  `, { axis_group: ` ` }),
      `dimensionless`,
    ],
  ] as const)(`uses %s`, (_name, series, expected) => {
    expect(axis_group_key(series)).toBe(expected)
  })
})

describe(`group_axis_series`, () => {
  const input = [
    create_series(`Energy`, `eV`),
    create_series(`Hidden force`, `eV/Å`, { visible: false }),
    create_series(`Free energy`, `eV`),
    create_series(`Residual`, `eV`, { axis_group: `scf` }),
  ]

  test.each([
    {
      name: `default visibility`,
      options: {},
      expected_keys: [`eV`, `scf`],
      expected_indices: [[0, 2], [3]],
    },
    {
      name: `custom visible-series filter`,
      options: {
        is_visible: (_series: AxisValueSeries, series_idx: number) => series_idx > 0,
      },
      expected_keys: [`eV/Å`, `eV`, `scf`],
      expected_indices: [[1], [2], [3]],
    },
  ])(
    `groups by axis_group or unit with $name`,
    ({ options, expected_keys, expected_indices }) => {
      const groups = group_axis_series(input, options)
      expect(groups.map((group) => group.key)).toEqual(expected_keys)
      expect(groups.map((group) => group.series_indices)).toEqual(expected_indices)
    },
  )
})

describe(`assign_axes`, () => {
  test(`assigns y1/y2 deterministically without mutating input`, () => {
    const input = [
      create_series(`Energy`, `eV`),
      create_series(`Free energy`, `eV`),
      create_series(`Force`, `eV/Å`),
      create_series(`Hidden`, `GPa`, { visible: false }),
    ]
    const original = structuredClone(input)

    expect(assign_axes(input)).toEqual({
      status: `assigned`,
      assignments: [`y1`, `y1`, `y2`, undefined],
      groups: [
        {
          key: `eV`,
          priority: 0,
          series: [input[0], input[1]],
          series_indices: [0, 1],
          axis: `y1`,
        },
        {
          key: `eV/Å`,
          priority: 0,
          series: [input[2]],
          series_indices: [2],
          axis: `y2`,
        },
      ],
      overflow_groups: [],
    })
    expect(input).toEqual(original)
  })

  test(`reserves explicit axes before assigning duplicate automatic groups`, () => {
    const input = [
      create_series(`Explicit energy`, `eV`, { y_axis: `y1` }),
      create_series(`Pressure`, `GPa`),
      create_series(`Pressure duplicate`, `GPa`),
      create_series(`Hidden explicit`, `K`, { visible: false, y_axis: `y2` }),
    ]

    const result = assign_axes(input)

    expect(result.status).toBe(`assigned`)
    expect(result.assignments).toEqual([`y1`, `y2`, `y2`, undefined])
    expect(
      result.groups.map(({ key, axis, series_indices }) => ({ key, axis, series_indices })),
    ).toEqual([
      { key: `eV`, axis: `y1`, series_indices: [0] },
      { key: `GPa`, axis: `y2`, series_indices: [1, 2] },
    ])
  })

  test(`inherits an explicit axis within the same automatic group`, () => {
    const result = assign_axes([
      create_series(`Explicit energy`, `eV`, { y_axis: `y2` }),
      create_series(`Automatic free energy`, `eV`),
    ])

    expect(result.assignments).toEqual([`y2`, `y2`])
    expect(
      result.groups.map(({ key, axis, series_indices }) => ({ key, axis, series_indices })),
    ).toEqual([{ key: `eV`, axis: `y2`, series_indices: [0, 1] }])
  })

  test(`reports an ambiguous automatic peer when its group reserves both axes`, () => {
    const result = assign_overflow([
      create_series(`Explicit secondary energy`, `eV`, { y_axis: `y2` }),
      create_series(`Automatic free energy`, `eV`),
      create_series(`Explicit primary energy`, `eV`, { y_axis: `y1` }),
    ])

    expect(result.assignments).toEqual([`y2`, undefined, `y1`])
    expect(result.overflow_groups).toHaveLength(1)
    expect(result.overflow_groups[0]).toMatchObject({
      key: `eV`,
      series_indices: [1],
      series: [expect.objectContaining({ label: `Automatic free energy` })],
    })
    expect(result.error.message).toBe(
      `Cannot assign 1 visible automatic axis group to 0 available axes (y1, y2 reserved explicitly): eV`,
    )
  })

  test(`assigns the sole automatic group to y1 when only y2 is reserved`, () => {
    const result = assign_axes([
      create_series(`Explicit pressure`, `GPa`, { y_axis: `y2` }),
      create_series(`Energy`, `eV`),
    ])

    expect(result.assignments).toEqual([`y2`, `y1`])
    expect(result.groups.map(({ key, axis }) => ({ key, axis }))).toEqual([
      { key: `GPa`, axis: `y2` },
      { key: `eV`, axis: `y1` },
    ])
  })

  test.each([
    [false, true, [undefined, `y1`]],
    [true, false, [`y1`, undefined]],
  ] as const)(
    `assigns only visible series (%s, %s)`,
    (first_visible, second_visible, expected) => {
      const input = [
        create_series(`Energy`, `eV`, { visible: first_visible }),
        create_series(`Pressure`, `GPa`, { visible: second_visible }),
      ]
      expect(assign_axes(input).assignments).toEqual(expected)
    },
  )

  test(`reports automatic overflow after explicit reservations`, () => {
    const input = [
      create_series(`Explicit energy`, `eV`, { y_axis: `y1` }),
      create_series(`Pressure`, `GPa`),
      create_series(`Temperature`, `K`),
    ]
    const result = assign_overflow(input)
    expect(result.assignments).toEqual([`y1`, `y2`, undefined])
    expect(result.groups.map(({ key, axis }) => ({ key, axis }))).toEqual([
      { key: `eV`, axis: `y1` },
      { key: `GPa`, axis: `y2` },
    ])
    expect(result.overflow_groups.map((group) => group.key)).toEqual([`K`])
    expect(result.error).toMatchObject({
      group_keys: [`GPa`, `K`],
      max_axes: 2,
      reserved_axes: [`y1`],
    })
    expect(result.error.message).toBe(
      `Cannot assign 2 visible automatic axis groups to 1 available axis (y1 reserved explicitly): GPa, K`,
    )
  })

  test(`reports overflow while assigning only the two highest-priority groups`, () => {
    const input = [
      create_series(`Low`, `low`),
      create_series(`Medium`, `medium`),
      create_series(`High`, `high`),
    ]
    const priority = (group_key: string) => [`high`, `medium`, `low`].indexOf(group_key)
    const result = assign_overflow(input, { priority })
    expect(result.assignments).toEqual([undefined, `y2`, `y1`])
    expect(result.groups.map(({ key, axis }) => ({ key, axis }))).toEqual([
      { key: `high`, axis: `y1` },
      { key: `medium`, axis: `y2` },
    ])
    expect(result.overflow_groups.map((group) => group.key)).toEqual([`low`])
    expect(result.error).toBeInstanceOf(AxisAssignmentOverflowError)
    expect(result.error).toMatchObject({
      group_keys: [`high`, `medium`, `low`],
      max_axes: 2,
    })
  })

  test.each([
    { max_axes: 1 as const, expected: [`y1`, undefined] },
    { max_axes: 2 as const, expected: [`y1`, `y2`] },
  ])(`respects the explicit $max_axes-axis limit`, ({ max_axes, expected }) => {
    const result = assign_axes([create_series(`A`, `unit_a`), create_series(`B`, `unit_b`)], {
      max_axes,
    })
    expect(result.assignments).toEqual(expected)
    expect(result.status).toBe(max_axes === 1 ? `overflow` : `assigned`)
  })

  test(`rejects an unsupported runtime max_axes value`, () => {
    expect(() => assign_axes([], { max_axes: 3 as never })).toThrow(
      `max_axes must be 1 or 2, got 3`,
    )
  })

  test(`returns a complete empty assignment for all-hidden input`, () => {
    const input = [
      create_series(`Energy`, `eV`, { visible: false }),
      create_series(`Force`, `eV/Å`, { visible: false }),
    ]
    expect(assign_axes(input, { max_axes: 1 })).toEqual({
      status: `assigned`,
      assignments: input.map(() => undefined),
      groups: [],
      overflow_groups: [],
    })
  })

  test(`rejects non-finite priorities with group context`, () => {
    expect(() =>
      assign_axes([create_series(`Energy`, `eV`)], { priority: () => Infinity }),
    ).toThrow(`Axis priority must be finite for group "eV", got Infinity`)
  })
})

describe(`axis_labels`, () => {
  test.each([
    {
      name: `single series with unit`,
      series: [create_series(`Energy`, `eV`)],
      expected: { y1: `Energy (eV)`, y2: `Value` },
    },
    {
      name: `deduplicated sorted labels`,
      series: [create_series(`B`, `eV`), create_series(`A`, `eV`), create_series(`B`, `eV`)],
      expected: { y1: `A / B (eV)`, y2: `Value` },
    },
    {
      name: `hidden series excluded`,
      series: [
        create_series(`Visible`, `eV`),
        create_series(`Hidden`, `eV`, { visible: false }),
        create_series(`Force`, `eV/Å`, { y_axis: `y2` }),
      ],
      expected: { y1: `Visible (eV)`, y2: `Force (eV/Å)` },
    },
    {
      name: `custom visibility filter`,
      series: [
        create_series(`First`, `eV`, { visible: false }),
        create_series(`Second`, `eV`, { visible: false }),
      ],
      options: {
        is_visible: (_series: AxisValueSeries, series_idx: number) => series_idx === 1,
      },
      expected: { y1: `Second (eV)`, y2: `Value` },
    },
    {
      name: `mixed units independent of input order`,
      series: [
        create_series(`Pressure`, `GPa`),
        create_series(`Energy`, `eV`),
        create_series(`Energy`, `eV`),
      ],
      expected: { y1: `Energy (eV) / Pressure (GPa)`, y2: `Value` },
    },
  ])(`generates labels for $name`, ({ series, options, expected }) => {
    expect(axis_labels(series, options)).toEqual(expected)
  })

  test(`uses a resolved assignment instead of unresolved series axes`, () => {
    const input = [
      create_series(`Energy`, `eV`),
      create_series(`Residual`, `eV`, { axis_group: `scf` }),
    ]
    const assignment = assign_axes(input)

    expect(axis_labels(input, { axis: assignment.assignments })).toEqual({
      y1: `Energy (eV)`,
      y2: `Residual (eV)`,
    })
  })
})

describe(`axis_scale_types`, () => {
  const log_options = {
    can_use_log_scale: (series: AxisValueSeries) => series.axis_group === `scf`,
    min_log_decades: 3,
  }
  const all_linear = { y1: `linear`, y2: `linear` }
  const residual = (y: number[], options: Partial<AxisValueSeries> = {}) =>
    create_series(`Residual`, `eV`, { axis_group: `scf`, y, ...options })

  test.each([
    {
      name: `eligible positive series spanning three decades`,
      series: [residual([1e-6, 1e-3])],
      expected: { y1: `log`, y2: `linear` },
    },
    {
      name: `ineligible series`,
      series: [create_series(`Energy`, `eV`, { y: [1e-6, 1] })],
      expected: all_linear,
    },
    {
      name: `zero or negative values`,
      series: [residual([-1, 0, 1e-6, 1])],
      expected: all_linear,
    },
    {
      name: `narrow value span`,
      series: [residual([1, 100])],
      expected: all_linear,
    },
    {
      name: `hidden ineligible series`,
      series: [
        residual([1e-6, 1]),
        create_series(`Hidden energy`, `eV`, { visible: false, y: [-10, -9] }),
      ],
      expected: { y1: `log`, y2: `linear` },
    },
    {
      name: `independent y axes`,
      series: [
        create_series(`Energy`, `eV`, { y: [-10, -9] }),
        residual([1e-7, 1], { y_axis: `y2` }),
      ],
      expected: { y1: `linear`, y2: `log` },
    },
    {
      name: `non-finite values ignored`,
      series: [residual([NaN, -Infinity, 1e-6, Infinity, 1])],
      expected: { y1: `log`, y2: `linear` },
    },
    {
      name: `non-finite values cannot conceal a finite zero`,
      series: [residual([NaN, 0, 1e-6, Infinity, 1])],
      expected: all_linear,
    },
    {
      name: `entirely non-finite data`,
      series: [residual([NaN, -Infinity, Infinity])],
      expected: all_linear,
    },
  ])(`selects scale types for $name`, ({ series, expected }) => {
    expect(axis_scale_types(series, log_options)).toEqual(expected)
  })

  test(`compares decade spans without ratio overflow`, () => {
    expect(
      axis_scale_types([residual([Number.MIN_VALUE, Number.MAX_VALUE])], {
        ...log_options,
        min_log_decades: 1000,
      }),
    ).toEqual(all_linear)
  })

  test(`validates the decade threshold`, () => {
    expect(() =>
      axis_scale_types([create_series(`Residual`)], {
        can_use_log_scale: () => true,
        min_log_decades: NaN,
      }),
    ).toThrow(`min_log_decades must be a non-negative finite number, got NaN`)
  })

  test(`uses an axis accessor for unresolved series`, () => {
    const input = [
      create_series(`Energy`, `eV`, { y: [-10, -9] }),
      create_series(`Residual`, `eV`, { axis_group: `scf`, y: [1e-6, 1] }),
    ]
    expect(
      axis_scale_types(input, {
        ...log_options,
        axis: (_series, series_idx) => (series_idx === 0 ? `y1` : `y2`),
      }),
    ).toEqual({ y1: `linear`, y2: `log` })
  })
})
