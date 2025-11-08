import type { ElementSymbol, Site, Vec3 } from '$lib'
import type { Matrix3x3 } from '$lib/math'
import type { PymatgenStructure } from '$lib/structure'
import * as ap from '$lib/structure/atom-properties'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'

const make_site = (xyz: Vec3, element = `C`): Site => ({
  xyz,
  abc: [0, 0, 0],
  species: [{ element: element as ElementSymbol, occu: 1, oxidation_state: 0 }],
  label: element,
  properties: {},
})

const make_struct = (sites: { xyz: Vec3; element?: string }[]): PymatgenStructure => ({
  sites: sites.map(({ xyz, element = `C` }) => make_site(xyz, element)),
  charge: 0,
  lattice: {
    matrix: [[10, 0, 0], [0, 10, 0], [0, 0, 10]] satisfies Matrix3x3,
    pbc: [true, true, true],
    a: 10,
    b: 10,
    c: 10,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: 1000,
  },
})

describe(`Color Scales`, () => {
  test(`d3 scales`, () =>
    expect(ap.get_d3_color_scales()).toContain(`interpolateViridis`))

  test.each(
    [
      [[1, 2, 3, 4, 5], `continuous`, true],
      [[1, 2, 3, 1, 2], `categorical`, false],
      [[5, 5, 5], `continuous`, false],
    ] as const,
  )(`apply_color_scale %s`, (vals, scale_type, diff) => {
    const colors = ap.apply_color_scale([...vals], `interpolateViridis`, scale_type)
    expect(colors).toHaveLength(vals.length)
    expect(colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true)
    if (diff) expect(colors[0]).not.toBe(colors[colors.length - 1])
    if (scale_type === `categorical`) expect(colors[0]).toBe(colors[3])
  })

  test(`categorical strings`, () => {
    const colors = ap.apply_categorical_color_scale([`a`, `b`, `c`, `a`])
    expect([colors.length, colors[0] === colors[3]]).toEqual([4, true])
  })

  test(`invalid scale fallback`, () => {
    expect(ap.apply_color_scale([1, 2], `bad`)[0]).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe(`Coordination`, () => {
  test(`bonded atoms CN > 0`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0], element: `C` }, {
      xyz: [1.5, 0, 0],
      element: `O`,
    }])
    const vals = ap.get_coordination_colors(structure).values as number[]
    expect(vals.every((val) => val > 0)).toBe(true)
  })

  test(`isolated atoms CN = 0`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [100, 100, 100] }])
    expect(ap.get_coordination_colors(structure).values).toEqual([0, 0])
  })

  test(`linear chain middle > end`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0], element: `C` }, {
      xyz: [1.5, 0, 0],
      element: `C`,
    }, { xyz: [3, 0, 0], element: `C` }])
    const vals = ap.get_coordination_colors(structure).values as number[]
    expect(vals[1]).toBeGreaterThan(vals[0])
  })

  test.each([`electroneg_ratio`, `solid_angle`] as const)(`%s strategy`, (strategy) => {
    const structure = make_struct([{ xyz: [0, 0, 0], element: `C` }, {
      xyz: [1.5, 0, 0],
      element: `O`,
    }])
    const vals = ap.get_coordination_colors(structure, strategy).values as number[]
    expect(vals.some((val) => val > 0)).toBe(true)
  })
})

describe(`Wyckoff`, () => {
  test(`no data → gray`, () => {
    const result = ap.get_wyckoff_colors(make_struct([{ xyz: [0, 0, 0] }]), null)
    expect([result.colors[0], result.values[0]]).toEqual([`#808080`, `unknown`])
  })

  test(`with data`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }])
    const result = ap.get_wyckoff_colors(
      structure,
      { wyckoffs: [`a`, `b`] } as unknown as MoyoDataset,
    )
    expect([result.values, result.colors[0] !== result.colors[1]]).toEqual([
      [`a`, `b`],
      true,
    ])
  })

  test(`duplicates same color`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }, {
      xyz: [2, 2, 2],
    }, { xyz: [3, 3, 3] }])
    const result = ap.get_wyckoff_colors(
      structure,
      { wyckoffs: [`a`, `a`, `b`, `a`] } as unknown as MoyoDataset,
    )
    expect([result.colors[0] === result.colors[1], result.colors[0] !== result.colors[2]])
      .toEqual([true, true])
  })

  test(`null positions`, () => {
    const result = ap.get_wyckoff_colors(
      make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }]),
      { wyckoffs: [null, `b`] } as unknown as MoyoDataset,
    )
    expect(result.values).toEqual([`unknown`, `b`])
  })
})

describe(`Custom`, () => {
  test(`numeric`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }, {
      xyz: [2, 2, 2],
    }])
    expect(ap.get_custom_colors(structure, (site) => site.xyz[2]).values).toEqual([
      0,
      1,
      2,
    ])
  })

  test(`string`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0], element: `C` }, {
      xyz: [1, 1, 1],
      element: `O`,
    }, { xyz: [2, 2, 2], element: `C` }])
    const result = ap.get_custom_colors(structure, (site) => site.species[0].element)
    expect([result.values, result.colors[0] === result.colors[2]]).toEqual([[
      `C`,
      `O`,
      `C`,
    ], true])
  })

  test(`site index`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }, {
      xyz: [2, 2, 2],
    }])
    expect(
      new Set(
        ap.get_custom_colors(
          structure,
          (_, idx) => idx,
          `interpolateViridis`,
          `categorical`,
        ).colors,
      ).size,
    ).toBe(3)
  })

  test(`properties`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 0, 0] }, {
      xyz: [0, 1, 0],
    }])
    structure.sites[0].properties = { magmom: 2.5 }
    structure.sites[1].properties = { magmom: -1.0 }
    structure.sites[2].properties = { magmom: 0.5 }
    expect(
      ap.get_custom_colors(structure, (site) => Number(site.properties?.magmom ?? 0))
        .values,
    ).toEqual([2.5, -1.0, 0.5])
  })

  test(`distance`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [3, 4, 0] }, {
      xyz: [6, 8, 0],
    }])
    expect(
      ap.get_custom_colors(structure, (site) => Math.hypot(site.xyz[0], site.xyz[1]))
        .values,
    ).toEqual([0, 5, 10])
  })
})

describe(`get_atom_colors`, () => {
  const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }])

  test.each(
    [
      [`element`, 0],
      [`coordination`, 2],
      [`wyckoff`, 2],
    ] as const,
  )(`%s mode`, (mode, len) => {
    expect(
      ap.get_atom_colors(
        structure,
        { mode },
        `electroneg_ratio`,
        mode === `wyckoff` ? null : undefined,
      ).colors.length,
    ).toBe(len)
  })

  test(`custom with fn`, () => {
    expect(
      ap.get_atom_colors(structure, { mode: `custom`, color_fn: (_, idx) => idx * 10 })
        .values,
    ).toEqual([0, 10])
  })

  test(`custom without fn`, () => {
    // When color_fn is missing, returns empty arrays (no property coloring)
    const result = ap.get_atom_colors(structure, { mode: `custom` })
    expect(result.colors).toEqual([])
    expect(result.values).toEqual([])
  })
})

describe(`Config`, () => {
  const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }])

  test(`partial uses defaults`, () => {
    expect(ap.get_atom_colors(structure, { mode: `coordination` }).colors.length).toBe(2)
  })

  test(`empty defaults to element`, () => {
    expect(ap.get_atom_colors(structure, {}).colors).toHaveLength(0)
  })

  test(`scales differ`, () => {
    const result_plasma = ap.get_atom_colors(structure, {
      mode: `coordination`,
      scale: `interpolatePlasma`,
    })
    const result_viridis = ap.get_atom_colors(structure, {
      mode: `coordination`,
      scale: `interpolateViridis`,
    })
    if (result_plasma.values[0] !== result_plasma.values[1]) {
      expect(result_plasma.colors[0]).not.toBe(result_viridis.colors[0])
    }
  })

  test(`color_fn works`, () => {
    const struct_3 = make_struct([{ xyz: [0, 0, 0] }, { xyz: [5, 5, 5] }, {
      xyz: [10, 10, 10],
    }])
    const result = ap.get_atom_colors(struct_3, {
      mode: `custom`,
      color_fn: (site) => Math.hypot(...site.xyz),
    })
    expect(result.values[1]).toBeCloseTo(Math.hypot(5, 5, 5), 1)
  })
})

describe(`Edge Cases`, () => {
  test(`single atom`, () => {
    expect(ap.get_coordination_colors(make_struct([{ xyz: [0, 0, 0] }])).values).toEqual([
      0,
    ])
  })

  test(`uniform same color`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0], element: `C` }, {
      xyz: [1.5, 0, 0],
      element: `C`,
    }])
    const result = ap.get_coordination_colors(structure)
    if (result.values[0] === result.values[1]) {
      expect(result.colors[0]).toBe(result.colors[1])
    }
  })
})

describe(`Performance`, () => {
  test(`1000 atoms < 1s`, () => {
    const structure = make_struct(Array.from({ length: 1000 }, (_, idx) => ({
      xyz: [idx % 10, Math.floor(idx / 10) % 10, Math.floor(idx / 100)] as Vec3,
      element: [`C`, `O`, `N`, `H`][idx % 4],
    })))
    const start = performance.now()
    expect(ap.get_coordination_colors(structure).colors).toHaveLength(1000)
    expect(performance.now() - start).toBeLessThan(1000)
  })

  test(`50 categorical values`, () => {
    const structure = make_struct(
      Array.from({ length: 50 }, (_, idx) => ({ xyz: [idx, 0, 0] as Vec3 })),
    )
    expect(
      new Set(
        ap.get_custom_colors(
          structure,
          (_, idx) => idx,
          `interpolateViridis`,
          `categorical`,
        ).colors,
      ).size,
    ).toBe(50)
  })

  test(`large ranges variety`, () => {
    expect(
      new Set(ap.apply_color_scale(Array.from({ length: 100 }, (_, idx) => idx * 1000)))
        .size,
    ).toBeGreaterThan(50)
  })
})
