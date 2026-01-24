import {
  apply_slice,
  build_diagram,
  parse_curve_ref,
} from '$lib/phase-diagram/build-diagram'
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
    { ref: `curve[1:3]`, expected: { name: `curve`, reverse: false, start: 1, end: 3 } },
    {
      ref: `curve[-2:-1]`,
      expected: { name: `curve`, reverse: false, start: -2, end: -1 },
    },
    {
      ref: `~curve[1:]`,
      expected: { name: `curve`, reverse: true, start: 1, end: null },
    },
    {
      ref: `~curve[1:-1]`,
      expected: { name: `curve`, reverse: true, start: 1, end: -1 },
    },
    {
      ref: `liquidus_left`,
      expected: { name: `liquidus_left`, reverse: false, start: null, end: null },
    },
    {
      ref: `~solidus_alpha[1:-1]`,
      expected: { name: `solidus_alpha`, reverse: true, start: 1, end: -1 },
    },
  ])(`parses "$ref"`, ({ ref, expected }) => {
    expect(parse_curve_ref(ref)).toEqual(expected)
  })

  test(`handles curve name with underscores and numbers`, () => {
    const result = parse_curve_ref(`liquidus_right_2[2:5]`)
    expect(result).toEqual({ name: `liquidus_right_2`, reverse: false, start: 2, end: 5 })
  })
})

describe(`apply_slice`, () => {
  const arr = [0, 1, 2, 3, 4]

  test.each([
    { start: null, end: null, expected: [0, 1, 2, 3, 4], desc: `full array` },
    { start: 0, end: null, expected: [0, 1, 2, 3, 4], desc: `[0:]` },
    { start: 1, end: null, expected: [1, 2, 3, 4], desc: `[1:]` },
    { start: null, end: 3, expected: [0, 1, 2], desc: `[:3]` },
    { start: 1, end: 3, expected: [1, 2], desc: `[1:3]` },
    { start: -1, end: null, expected: [4], desc: `[-1:]` },
    { start: -2, end: null, expected: [3, 4], desc: `[-2:]` },
    { start: null, end: -1, expected: [0, 1, 2, 3], desc: `[:-1]` },
    { start: null, end: -2, expected: [0, 1, 2], desc: `[:-2]` },
    { start: 1, end: -1, expected: [1, 2, 3], desc: `[1:-1]` },
    { start: -3, end: -1, expected: [2, 3], desc: `[-3:-1]` },
  ])(`$desc → $expected`, ({ start, end, expected }) => {
    expect(apply_slice(arr, start, end)).toEqual(expected)
  })

  test(`handles empty array`, () => {
    expect(apply_slice([], 1, null)).toEqual([])
  })

  test(`handles out-of-bounds positive indices`, () => {
    expect(apply_slice([1, 2], 5, null)).toEqual([])
    expect(apply_slice([1, 2], null, 10)).toEqual([1, 2])
  })

  test(`handles large negative indices`, () => {
    expect(apply_slice([1, 2, 3], -10, null)).toEqual([1, 2, 3])
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
      liquidus: [[0, 800], [0.5, 600], [1, 700]],
      solidus: [[0, 800], [0.3, 500], [1, 700]],
    },
    regions: [
      {
        id: `liquid`,
        name: `Liquid`,
        color: `liquid`,
        bounds: [[0, 900], [1, 900], [1, 700], `~liquidus[1:]`],
      },
    ],
    special_points: [
      { id: `eutectic`, type: `eutectic`, position: [0.5, 600], label: `E` },
    ],
  }

  test(`builds diagram with correct structure`, () => {
    const result = build_diagram(minimal_input)
    expect(result.components).toEqual([`A`, `B`])
    expect(result.temperature_range).toEqual([300, 900])
    expect(result.temperature_unit).toBe(`K`)
    expect(result.composition_unit).toBe(`at%`)
    expect(result.title).toBe(`Test Diagram`)
    expect(result.regions).toHaveLength(1)
    expect(result.boundaries).toHaveLength(2)
    expect(result.special_points).toHaveLength(1)
  })

  test(`expands curve references in region bounds`, () => {
    const result = build_diagram(minimal_input)
    const liquid_region = result.regions[0]
    // bounds: [[0, 900], [1, 900], [1, 700], ~liquidus[1:]]
    // ~liquidus[1:] = reversed([0.5, 600], [1, 700]) = [[1, 700], [0.5, 600]]
    // but [1, 700] is already present, so dedupe should handle it
    expect(liquid_region.vertices.length).toBeGreaterThan(0)
    expect(liquid_region.vertices[0]).toEqual([0, 900])
  })

  test(`resolves color keys to rgba values`, () => {
    const result = build_diagram(minimal_input)
    expect(result.regions[0].color).toContain(`rgba`)
  })

  test(`infers boundary types from curve names`, () => {
    const result = build_diagram(minimal_input)
    const liquidus = result.boundaries.find((b) => b.id === `liquidus`)
    const solidus = result.boundaries.find((b) => b.id === `solidus`)
    expect(liquidus?.type).toBe(`liquidus`)
    expect(solidus?.type).toBe(`solidus`)
  })

  test(`applies default boundary styles based on type`, () => {
    const result = build_diagram(minimal_input)
    const liquidus = result.boundaries.find((b) => b.id === `liquidus`)
    expect(liquidus?.style?.color).toBe(`#1565c0`)
    expect(liquidus?.style?.width).toBe(2.5)
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
    expect(result.pseudo_binary?.parent_system).toEqual([`Fe`, `C`])
    expect(result.x_axis_label).toBe(`wt% C`)
  })

  test(`handles missing optional fields`, () => {
    const minimal: DiagramInput = {
      meta: {
        components: [`X`, `Y`],
        temp_range: [0, 100],
      },
      curves: {},
      regions: [],
    }
    const result = build_diagram(minimal)
    expect(result.special_points).toBeUndefined()
    expect(result.pseudo_binary).toBeUndefined()
    expect(result.x_axis_label).toBeUndefined()
  })

  test(`deduplicates consecutive vertices`, () => {
    const input_with_dupes: DiagramInput = {
      meta: { components: [`A`, `B`], temp_range: [0, 100] },
      curves: {
        line: [[0, 0], [1, 1]],
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
    const result = build_diagram(input_with_dupes)
    // Should not have consecutive duplicates
    const verts = result.regions[0].vertices
    for (let idx = 1; idx < verts.length; idx++) {
      const prev = verts[idx - 1]
      const curr = verts[idx]
      expect(curr[0] !== prev[0] || curr[1] !== prev[1]).toBe(true)
    }
  })
})
