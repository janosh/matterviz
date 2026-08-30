import { apply_slice, build_diagram, parse_curve_ref } from '$lib/phase-diagram/build-diagram'
import type { DiagramInput } from '$lib/phase-diagram/diagram-input'
import { describe, expect, test } from 'vitest'

describe(`parse_curve_ref`, () => {
  test.each([
    { ref: `curve`, expected: { name: `curve`, reverse: false, start: null, end: null } },
    { ref: `~curve`, expected: { name: `curve`, reverse: true, start: null, end: null } },
    {
      ref: `curve[1:]`,
      expected: { name: `curve`, reverse: false, start: 1, end: null },
    },
    {
      ref: `curve[:-1]`,
      expected: { name: `curve`, reverse: false, start: null, end: -1 },
    },
    {
      ref: `~solidus_alpha[1:-1]`,
      expected: { name: `solidus_alpha`, reverse: true, start: 1, end: -1 },
    },
    {
      ref: `liquidus_right_2[2:5]`,
      expected: { name: `liquidus_right_2`, reverse: false, start: 2, end: 5 },
    },
  ])(`parses "$ref"`, ({ ref, expected }) => {
    expect(parse_curve_ref(ref)).toEqual(expected)
  })
})

describe(`apply_slice`, () => {
  // Python slice semantics on [0, 1, 2, 3, 4] unless `arr` is given
  test.each([
    { start: null, end: null, expected: [0, 1, 2, 3, 4], desc: `full array` },
    { start: 1, end: null, expected: [1, 2, 3, 4], desc: `[1:]` },
    { start: null, end: 3, expected: [0, 1, 2], desc: `[:3]` },
    { start: 1, end: 3, expected: [1, 2], desc: `[1:3]` },
    { start: -1, end: null, expected: [4], desc: `[-1:]` },
    { start: null, end: -1, expected: [0, 1, 2, 3], desc: `[:-1]` },
    { start: 1, end: -1, expected: [1, 2, 3], desc: `[1:-1]` },
    { start: 5, end: null, expected: [], desc: `start past the end` },
    { start: null, end: 10, expected: [0, 1, 2, 3, 4], desc: `end past the end` },
    { start: -10, end: null, expected: [0, 1, 2, 3, 4], desc: `start before the beginning` },
    { arr: [], start: 1, end: null, expected: [], desc: `empty array` },
  ])(`$desc → $expected`, ({ arr = [0, 1, 2, 3, 4], start, end, expected }) => {
    expect(apply_slice(arr, start, end)).toEqual(expected)
  })
})

describe(`build_diagram`, () => {
  const minimal_input: DiagramInput = {
    meta: {
      components: [`A`, `B`],
      temp_range: [300, 900],
      temp_unit: `K`,
      comp_unit: `at%`,
      title: `Test Diagram`,
    },
    curves: {
      liquidus: [
        [0, 800],
        [0.5, 600],
        [1, 700],
      ],
      solidus: [
        [0, 800],
        [0.3, 500],
        [1, 700],
      ],
    },
    regions: [
      {
        id: `liquid`,
        name: `Liquid`,
        color: `rgba(135, 206, 250, 0.6)`,
        bounds: [[0, 900], [1, 900], [1, 700], `~liquidus[1:]`],
      },
    ],
    special_points: [{ id: `eutectic`, type: `eutectic`, position: [0.5, 600], label: `E` }],
  }

  test(`copies metadata, expands curve refs into region vertices, types and styles boundaries`, () => {
    const result = build_diagram(minimal_input)
    expect(result).toMatchObject({
      components: [`A`, `B`],
      temperature_range: [300, 900],
      temperature_unit: `K`,
      composition_unit: `at%`,
      title: `Test Diagram`,
    })
    expect(result.special_points).toHaveLength(1)
    // ~liquidus[1:] reverses first, then slices: drops the [1, 700] the explicit vertex
    // already supplied (Python's reversed(curve)[1:] idiom)
    expect(result.regions.map((region) => region.vertices)).toEqual([
      [
        [0, 900],
        [1, 900],
        [1, 700],
        [0.5, 600],
        [0, 800],
      ],
    ])
    // boundary type inferred from the curve name, default style from the type
    expect(result.boundaries.map(({ id, type, style }) => [id, type, style])).toEqual([
      [`liquidus`, `liquidus`, expect.objectContaining({ color: `#1565c0`, width: 2.5 })],
      [`solidus`, `solidus`, expect.anything()],
    ])
  })

  test(`an unknown curve reference throws instead of silently dropping the bound`, () => {
    const bad_input: DiagramInput = {
      ...minimal_input,
      regions: [{ id: `solid`, name: `Solid`, bounds: [`solvus`, [1, 300]] }],
    }
    expect(() => build_diagram(bad_input)).toThrow(/Unknown curve "solvus".*liquidus, solidus/)
  })

  test(`passes raw CSS region colors through and omits color when unset`, () => {
    expect(build_diagram(minimal_input).regions[0].color).toBe(`rgba(135, 206, 250, 0.6)`)
    const uncolored = {
      ...minimal_input,
      regions: [
        {
          id: `liquid`,
          name: `Liquid`,
          bounds: [
            [0, 900],
            [1, 900],
            [1, 700],
          ],
        },
      ],
    } satisfies DiagramInput
    expect(`color` in build_diagram(uncolored).regions[0]).toBe(false)
  })

  test(`handles pseudo-binary metadata`, () => {
    const input_with_pseudo: DiagramInput = {
      ...minimal_input,
      meta: {
        ...minimal_input.meta,
        pseudo_binary: {
          parent_system: [`Fe`, `C`],
          section_description: `Fe to Fe3C`,
          use_subscripts: true,
        },
        x_axis_label: `wt% C`,
      },
    }
    const result = build_diagram(input_with_pseudo)
    expect(result.pseudo_binary).toEqual(input_with_pseudo.meta.pseudo_binary)
    expect(result.x_axis_label).toBe(`wt% C`)

    // Unset optional metadata leaves the keys absent, not undefined-valued
    const bare = build_diagram({
      meta: { components: [`X`, `Y`], temp_range: [0, 100] },
      curves: {},
      regions: [],
    })
    expect(bare.special_points).toBeUndefined()
    expect(`pseudo_binary` in bare).toBe(false)
    expect(`x_axis_label` in bare).toBe(false)
  })

  test(`deduplicates consecutive vertices`, () => {
    const input_with_dupes: DiagramInput = {
      meta: { components: [`A`, `B`], temp_range: [0, 100] },
      curves: {
        line: [
          [0, 0],
          [1, 1],
        ],
      },
      regions: [
        {
          id: `test`,
          name: `Test`,
          color: `#fff`,
          bounds: [[0, 0], `line`, [1, 1], [1, 1]], // explicit dupe
        },
      ],
    }
    expect(build_diagram(input_with_dupes).regions[0].vertices).toEqual([
      [0, 0],
      [1, 1],
    ])
  })
})
