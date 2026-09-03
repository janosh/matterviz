import type { AnyStructure, ElementSymbol, Site, Species, Vec3 } from '$lib'
import * as struct_utils from '$lib/structure'
import type { StructureFitOpts } from '$lib/structure'
import {
  camera_needs_fit,
  camera_position_for_target,
  DEFAULT_FIT_PADDING,
  DEFAULT_STRUCTURE_VIEWS,
  default_vector_configs,
  FIT_ZOOM_REF_PX,
  get_all_site_vectors,
  get_structure_vector_keys,
  is_vector_key,
  ortho_zoom_for_extent,
  perspective_distance_for_extent,
  structure_fit_frame,
  vector_display_defaults,
  VECTOR_PALETTE,
} from '$lib/structure'
import { structures } from '$site/structures'
import { describe, expect, test } from 'vitest'

const ref_data: Record<
  string,
  {
    amounts: Record<string, number>
    density: number
    center_of_mass: Vec3
  }
> = {
  'mp-1': {
    amounts: { Cs: 2 },
    density: 1.8019302505603234,
    center_of_mass: [1.564, 1.564, 1.564],
  },
  'mp-2': {
    amounts: { Pd: 4 },
    density: 11.759135742447171,
    center_of_mass: [0.979, 0.979, 0.979],
  },
  'mp-1234': {
    amounts: { Lu: 8, Al: 16 },
    density: 6.63,
    center_of_mass: [3.119, 3.119, 3.119],
  },
  'mp-30855': {
    amounts: { U: 2, Pt: 6 },
    density: 19.14,
    center_of_mass: [3.535, 3.535, 3.535],
  },
  'mp-756175': {
    amounts: { Zr: 16, Bi: 16, O: 56 },
    density: 7.457890165317997,
    center_of_mass: [5.261, 5.261, 5.261],
  },
  'mp-1229155': {
    amounts: { Ag: 4, Hg: 4, S: 4, Br: 1, Cl: 3 },
    density: 6.107930572082895,
    center_of_mass: [2.216, 3.594, 6.502],
  },
  'mp-1229168': {
    amounts: { Al: 54, Fe: 4, Ni: 8 },
    density: 3.6567149052096903,
    center_of_mass: [1.802, 2.991, 12.542],
  },
}

describe.each(structures)(`structure-utils`, (structure) => {
  const { id } = structure
  const expected = id ? ref_data[id] : undefined

  test(`element counts, density, and ref-data properties`, () => {
    const counts = struct_utils.get_element_counts(structure)

    for (const [element, count] of Object.entries(counts)) {
      expect(element, id).toMatch(/^[A-Z][a-z]{0,2}$/)
      expect(count, `${id}: ${element}`).toBeGreaterThan(0)
      expect(Number.isInteger(count), `${id}: ${element}`).toBe(true)
    }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
    expect(total, id).toBe(structure.sites.length)

    const density = struct_utils.get_density(structure)
    if (structure.lattice) {
      // Physical sanity: 0.01 g/cm³ (aerogels) to 30 g/cm³ (beyond osmium)
      expect(density, `${id}: density`).toBeGreaterThan(0.01)
      expect(density, `${id}: density`).toBeLessThan(30)
      expect(Number.isFinite(density), `${id}: density finite`).toBe(true)
    } else {
      expect(density === 0 || Number.isNaN(density), `${id}: no-lattice density`).toBe(true)
    }

    if (!expected) return

    expect(counts, id).toEqual(expected.amounts)
    expect(density, id).toBeCloseTo(expected.density, 3)

    const com = struct_utils.get_center_of_mass(structure)
    expect(
      com.map((val) => Math.round(val * 1e3) / 1e3),
      `${id} center_of_mass`,
    ).toEqual(expected.center_of_mass)
  })
})

test(`element counts exclude periodic image sites`, () => {
  const structure = structures[0]
  const image_site = {
    ...structure.sites[0],
    properties: { ...structure.sites[0].properties, orig_site_idx: 0 },
  }
  expect(
    struct_utils.get_element_counts({ ...structure, sites: [...structure.sites, image_site] }),
  ).toEqual(struct_utils.get_element_counts(structure))
})

describe(`get_center_of_mass`, () => {
  const create_simple_structure = (sites: (Species & { xyz: Vec3 })[]): AnyStructure => ({
    sites: sites.map((site, idx) => ({
      species: [{ element: site.element, occu: site.occu, oxidation_state: 0 }],
      abc: site.xyz,
      xyz: site.xyz,
      label: `${site.element}${idx + 1}`,
      properties: {},
    })),
    charge: 0,
  })

  test.each([
    {
      sites: [
        { element: `H` as const, xyz: [0, 0, 0] as Vec3, occu: 1, oxidation_state: 0 },
        { element: `O` as const, xyz: [2, 2, 2] as Vec3, occu: 1, oxidation_state: 0 },
        { element: `H` as const, xyz: [4, 4, 4] as Vec3, occu: 1, oxidation_state: 0 },
      ],
      expected: [2.0, 2.0, 2.0] as Vec3,
      desc: `simple structure with equal occupancies`,
    },
    {
      sites: [
        { element: `H` as const, xyz: [0, 0, 0] as Vec3, occu: 0.5, oxidation_state: 0 },
        { element: `O` as const, xyz: [2, 2, 2] as Vec3, occu: 2.0, oxidation_state: 0 },
      ],
      expected: [1.969, 1.969, 1.969] as Vec3,
      desc: `weighted occupancies`,
    },
    {
      sites: [
        {
          element: `H` as const,
          xyz: [1, 2, 3] as Vec3,
          occu: 1,
          oxidation_state: 0,
        },
      ],
      expected: [1, 2, 3] as Vec3,
      desc: `single atom structure`,
    },
  ])(`should calculate center of mass for $desc`, ({ sites, expected }) => {
    const structure = create_simple_structure(sites)
    const result = struct_utils.get_center_of_mass(structure)
    expected.forEach((val, idx) => expect(result[idx]).toBeCloseTo(val, 3))
  })
})

// Content AABB framing (camera-fit.ts) — look-at center + padded sphere extent for zoom.
describe(`structure_fit_frame`, () => {
  const site = (element: ElementSymbol, xyz: Vec3): Site => ({
    species: [{ element, occu: 1, oxidation_state: 0 }],
    abc: [0, 0, 0],
    xyz,
    label: element,
    properties: {},
  })
  const cubic = (a: number, sites: Site[]): AnyStructure => ({
    sites,
    lattice: {
      matrix: [
        [a, 0, 0],
        [0, a, 0],
        [0, 0, a],
      ],
      a,
      b: a,
      c: a,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: a ** 3,
      pbc: [true, true, true],
    },
  })
  const extent = (...args: Parameters<typeof structure_fit_frame>) =>
    structure_fit_frame(...args).extent

  test.each([undefined, null, { sites: [] }])(`empty → extent 10 for %j`, (input) => {
    expect(extent(input)).toBe(10)
    structure_fit_frame(input).center[0] = 5
    expect(structure_fit_frame(input).center).toEqual([0, 0, 0])
  })

  test(`molecule / cell framing`, () => {
    expect(DEFAULT_FIT_PADDING).toBeCloseTo(1 / 0.92, 10)
    const diatomic = { sites: [site(`H`, [-1, 0, 0]), site(`H`, [1, 0, 0])] }
    const { center, extent: fit } = structure_fit_frame(diatomic)
    center.forEach((coord) => expect(coord).toBeCloseTo(0, 10))
    expect(extent(diatomic, { atom_radius_scale: 0 })).toBeCloseTo(2 * DEFAULT_FIT_PADDING, 10)
    expect(fit).toBeCloseTo(2 * (1 + 0.25 * 0.7) * DEFAULT_FIT_PADDING, 10)
    expect(
      structure_fit_frame(
        { sites: [site(`H`, [0, 0, 0]), site(`H`, [4, 0, 0])] },
        { atom_radius_scale: 0 },
      ).center,
    ).toEqual([2, 0, 0])

    const a = 4.21
    const empty = structure_fit_frame(cubic(a, []), { atom_radius_scale: 0 })
    empty.center.forEach((coord) => expect(coord).toBeCloseTo(a / 2, 10))
    expect(empty.extent).toBeCloseTo(a * Math.sqrt(3) * DEFAULT_FIT_PADDING, 10)
    const with_atom = extent(cubic(a, [site(`Mg`, [0, 0, 0])]), { atom_radius_scale: 0.7 })
    expect(with_atom).toBeGreaterThan(empty.extent)
    expect(with_atom).toBeLessThan((a * Math.sqrt(3) + 2.1) * DEFAULT_FIT_PADDING * 1.2)

    const { sites: _dropped, ...no_sites } = cubic(2, [])
    expect(extent(no_sites as AnyStructure, { atom_radius_scale: 0 })).toBeCloseTo(
      2 * Math.sqrt(3) * DEFAULT_FIT_PADDING,
      10,
    )
  })

  test.each([
    [
      `atom centers only`,
      { sites: [site(`Mg`, [-2, 0, 0]), site(`Mg`, [2, 0, 0])] },
      { atom_radius_scale: 0 },
      4 * DEFAULT_FIT_PADDING,
    ],
    [
      `same_size unit radius`,
      { sites: [site(`H`, [0, 0, 0])] },
      { same_size_atoms: true, atom_radius_scale: 2 },
      4 * DEFAULT_FIT_PADDING,
    ],
    [
      `site override`,
      { sites: [site(`H`, [0, 0, 0])] },
      { site_radius_overrides: new Map([[0, 5]]), atom_radius_scale: 1 },
      10 * DEFAULT_FIT_PADDING,
    ],
    [
      `same_size ignores site override`,
      { sites: [site(`H`, [0, 0, 0])] },
      {
        same_size_atoms: true,
        site_radius_overrides: new Map([[0, 5]]),
        atom_radius_scale: 1,
      },
      2 * DEFAULT_FIT_PADDING,
    ],
    [
      `occupancy-weighted disordered site`,
      {
        sites: [
          {
            ...site(`H`, [0, 0, 0]),
            species: [
              { element: `H`, occu: 0.5, oxidation_state: 0 },
              { element: `Mg`, occu: 0.5, oxidation_state: 0 },
            ],
          },
        ],
      },
      { atom_radius_scale: 1, element_radius_overrides: { H: 1, Mg: 3 } },
      4 * DEFAULT_FIT_PADDING,
    ],
  ] satisfies [string, AnyStructure, StructureFitOpts, number][])(
    `%s`,
    (_label, structure, opts, expected) => {
      expect(extent(structure, opts)).toBeCloseTo(expected, 10)
    },
  )
})

describe(`camera helpers`, () => {
  test(`fits zero poses and re-fits changed camera views`, () => {
    expect(camera_needs_fit([0, 0, 0], undefined, `orthographic:`)).toBe(true)
    expect(camera_needs_fit([10, 3, 8], undefined, `orthographic:`)).toBe(false)
    expect(camera_needs_fit([10, 3, 8], `orthographic:`, `perspective:1,0.3,0.8`)).toBe(true)
    expect(
      camera_needs_fit([10, 3, 8], `perspective:1,0.3,0.8`, `perspective:1,0.3,0.8`),
    ).toBe(false)
    expect(camera_needs_fit([10, 3, 8], `perspective:1,0.3,0.8`, `perspective:0,0,1`)).toBe(
      true,
    )
  })

  test.each([
    [`default`, undefined, [10, 3, 8]],
    [`zero → default`, [0, 0, 0] as Vec3, [10, 3, 8]],
    [`+X normalized`, [3, 0, 0] as Vec3, [10, 0, 0]],
  ])(`camera_position %s`, (_name, view_dir, expected) => {
    expect(camera_position_for_target([0, 0, 0], 10, view_dir)).toEqual(expected)
  })

  // The last two rows are reciprocal-space extents, which any cell wider than ~12 A produces.
  // Clamping the divisor at 1 froze the zoom below extent 1 instead of letting it keep rising.
  test.each([
    [10, 800, 400, FIT_ZOOM_REF_PX, 40],
    [8, 500, 500, FIT_ZOOM_REF_PX * 2, 125],
    [10, 460, 460, FIT_ZOOM_REF_PX, 46],
    [100, 200, 200, FIT_ZOOM_REF_PX, 2],
    [0.5, 800, 400, FIT_ZOOM_REF_PX, 800],
    [0.001, 800, 400, FIT_ZOOM_REF_PX, 400_000],
  ] as const)(`ortho_zoom extent=%s %ix%i in=%i → %i`, (ext, w, h, zoom_in, expected) => {
    expect(ortho_zoom_for_extent(ext, w, h, zoom_in)).toBeCloseTo(expected, 10)
  })

  // Both fits share one extent/viewport check: a scene diameter has no lower bound of its own,
  // so a bad one is rejected rather than clamped into framing the scene against a constant.
  // oxfmt-ignore
  test.each([
    [0, 400, 400], [-1, 400, 400], [Number.NaN, 400, 400], [Infinity, 400, 400],
    [10, 0, 400], [10, 400, 0], [10, -1, 400],
  ])(`both fits reject extent=%s viewport %sx%s`, (ext, wid, hgt) => {
    expect(() => ortho_zoom_for_extent(ext, wid, hgt, 10)).toThrow(/Invalid ortho fit/)
    expect(() => perspective_distance_for_extent(ext, wid, hgt, 10)).toThrow(/perspective/)
  })

  test.each([0, -1, 180, 200])(`perspective rejects fov %s`, (fov) =>
    expect(() => perspective_distance_for_extent(10, 400, 400, fov)).toThrow(/perspective/),
  )

  const vertical_half_fov = Math.PI / 36
  const tall_horizontal_half_fov = Math.atan(Math.tan(vertical_half_fov) / 2)
  test.each([
    [`square`, 400, 400, 10, 5 / Math.sin(vertical_half_fov)],
    [`wide`, 800, 400, 10, 5 / Math.sin(vertical_half_fov)],
    [`tall`, 400, 800, 10, 5 / Math.sin(tall_horizontal_half_fov)],
  ] as const)(
    `perspective distance uses limiting FOV for a %s viewport`,
    (_name, width, height, fov, expected) => {
      expect(perspective_distance_for_extent(10, width, height, fov)).toBeCloseTo(expected, 10)
    },
  )
})

const make_site = (properties?: Record<string, unknown>): Site =>
  ({ species: [], abc: [0, 0, 0], xyz: [0, 0, 0], label: `X`, properties }) as Site

describe(`is_vector_key`, () => {
  // a key is a vector key when it IS a known prefix or starts with `<prefix>_`
  test.each([
    [`force`, true],
    [`magmoms`, true],
    [`velocity`, true],
    [`force_DFT`, true],
    [`spins_down`, true],
    [`force_`, true],
    [`charge`, false],
    [`forceful`, false], // prefix without the underscore separator
    [`my_force`, false],
    [``, false],
  ])(`is_vector_key(%s) = %s`, (key, expected) => {
    expect(is_vector_key(key)).toBe(expected)
  })
})

describe(`get_all_site_vectors`, () => {
  test.each([
    [`force`, [1, 2, 3]],
    [`spins`, [0, 0, -1]],
    [`force_DFT`, [1, 0, 0]],
    // LAMMPS vx/vy/vz and extXYZ velocities land here with no further wiring
    [`velocity`, [1.5, -2, 0]],
    [`phonon_displacement`, [-1, 2, 0]],
  ] as const)(`accepts 3D vector in %s`, (key, vec) => {
    const result = get_all_site_vectors(make_site({ [key]: [...vec] }))
    expect(result[0]).toEqual({ key, vec: [...vec] })
  })

  test.each([
    [`force`, 2.5, [0, 0, 2.5]],
    [`spin`, -3.5, [0, 0, -3.5]],
    [`magmom`, 0, [0, 0, 0]],
  ] as const)(`converts scalar %s=%s to z-vector`, (key, scalar, expected) => {
    expect(get_all_site_vectors(make_site({ [key]: scalar }))[0].vec).toEqual(expected)
  })

  test.each([
    [`empty props`, make_site({})],
    [`non-vector keys only`, make_site({ charge: 1 })],
    [`undefined properties`, make_site()],
  ])(`returns [] for %s`, (_desc, site) => {
    expect(get_all_site_vectors(site)).toEqual([])
  })

  test.each([
    [`non-finite component`, { force: [Infinity, 0, 0] }],
    [`wrong-length array`, { force: [1, 2] }],
    [`non-numeric value`, { force: `high` }],
    [`null value`, { force: null }],
    [`nested array`, { force: [[1, 0, 0]] }],
    [`non-finite scalar`, { spin: NaN }],
  ])(`rejects invalid vector: %s`, (_label, properties) => {
    expect(get_all_site_vectors(make_site(properties))).toHaveLength(0)
  })

  test.each([
    {
      desc: `bare keys by prefix priority`,
      props: { force: [1, 0, 0], magmom: [0, 0, 1] },
      expected_keys: [`force`, `magmom`],
    },
    {
      desc: `prefixed keys alphabetically within prefix group`,
      props: { force_MLFF: [0.9, 0, 0], force_DFT: [1, 0, 0], magmom: [0, 0, 1] },
      expected_keys: [`force_DFT`, `force_MLFF`, `magmom`],
    },
    {
      desc: `bare before prefixed of same type`,
      props: { force_DFT: [1, 0, 0], force: [0, 1, 0] },
      expected_keys: [`force`, `force_DFT`],
    },
    {
      desc: `singular < prefixed < plural`,
      props: { force: [1, 0, 0], forces: [0, 1, 0], force_DFT: [0, 0, 1] },
      expected_keys: [`force`, `force_DFT`, `forces`],
    },
  ])(`ordering: $desc`, ({ props, expected_keys }) => {
    expect(get_all_site_vectors(make_site(props)).map((vec) => vec.key)).toEqual(expected_keys)
  })

  test(`can skip ordering when callers only need vector lookup`, () => {
    const site = make_site({ magmom: [0, 0, 1], force: [1, 0, 0] })
    const keys = get_all_site_vectors(site, false).map(({ key }) => key)
    expect(keys).toEqual([`magmom`, `force`])
  })

  test.each([
    {
      desc: `non-vector property keys ignored`,
      props: { charge: 1, tag: `core`, velocity: [1, 2, 3], force: [1, 0, 0] },
      expected: [
        { key: `force`, vec: [1, 0, 0] },
        { key: `velocity`, vec: [1, 2, 3] },
      ],
    },
    {
      desc: `invalid values skipped, valid ones kept`,
      props: {
        force: [NaN, 0, 0],
        magmom: [0, 0, 1],
        spin: `bad`,
        force_DFT: [1, 2],
        force_MLFF: [Infinity, 0, 0],
        magmoms: null,
        spins: true,
        velocity: { nested: [1, 2, 3] },
      },
      expected: [{ key: `magmom`, vec: [0, 0, 1] }],
    },
    {
      desc: `zero vector [0,0,0] is valid`,
      props: { force: [0, 0, 0] },
      expected: [{ key: `force`, vec: [0, 0, 0] }],
    },
  ])(`filtering: $desc`, ({ props, expected }) => {
    expect(get_all_site_vectors(make_site(props))).toEqual(expected)
  })
})

describe(`get_structure_vector_keys`, () => {
  const make_structure = (sites_props: Record<string, unknown>[]): AnyStructure => ({
    sites: sites_props.map((properties, idx) => ({
      species: [{ element: `Fe` as const, occu: 1, oxidation_state: 0 }],
      abc: [0, 0, 0] as Vec3,
      xyz: [idx, 0, 0] as Vec3,
      label: `Fe${idx + 1}`,
      properties,
    })),
    charge: 0,
  })

  test.each([
    {
      desc: `unique keys across sites in priority order`,
      sites: [{ force: [1, 0, 0], magmom: [0, 0, 1] }, { force: [0, 1, 0] }],
      expected: [`force`, `magmom`],
    },
    {
      desc: `empty for structure without vectors`,
      sites: [{ charge: 1 }, {}],
      expected: [],
    },
    {
      desc: `deduplicates across sites`,
      sites: [
        { force_DFT: [1, 0, 0], force_MLFF: [0.9, 0, 0] },
        { force_DFT: [0, 1, 0], force_MLFF: [0, 0.9, 0] },
        { force_DFT: [0, 0, 1] },
      ],
      expected: [`force_DFT`, `force_MLFF`],
    },
    {
      desc: `union across heterogeneous sites`,
      sites: [
        { force: [1, 0, 0] },
        { magmom: [0, 0, 1] },
        { spin_DFT: 0.5, force_MLFF: [0, 1, 0] },
      ],
      expected: [`force`, `force_MLFF`, `magmom`, `spin_DFT`],
    },
    {
      desc: `skips sites with all-invalid vector values`,
      sites: [{ force: [NaN, 0, 0], magmom: `bad` }, { force: [1, 0, 0] }],
      expected: [`force`],
    },
    {
      // A LAMMPS dump with vx/vy/vz + fx/fy/fz + q gets two arrow layers; charge is not one
      desc: `velocity is a layer, ranked after force/magmom/spin`,
      sites: [{ velocity: [1, 0, 0], force: [0, 1, 0], charge: -0.5, spin: [0, 0, 1] }],
      expected: [`force`, `spin`, `velocity`],
    },
  ])(`$desc`, ({ sites, expected }) => {
    expect(get_structure_vector_keys(make_structure(sites))).toEqual(expected)
  })
})

describe(`default_vector_configs`, () => {
  test.each([
    {
      desc: `single key gets null color (semantic coloring)`,
      keys: [`force`],
      expected: { force: { visible: true, color: null, scale: null } },
    },
    {
      desc: `velocities use a smaller display scale`,
      keys: [`velocity`],
      expected: { velocity: { visible: true, color: null, scale: 0.05 } },
    },
    {
      desc: `multiple keys get distinct palette colors`,
      keys: [`force_DFT`, `force_MLFF`, `magmom`],
      expected: {
        force_DFT: { visible: true, color: VECTOR_PALETTE[0], scale: null },
        force_MLFF: { visible: true, color: VECTOR_PALETTE[1], scale: null },
        magmom: { visible: true, color: VECTOR_PALETTE[2], scale: null },
      },
    },
    {
      desc: `empty keys array returns empty object`,
      keys: [] as string[],
      expected: {},
    },
  ])(`$desc`, ({ keys, expected }) => {
    expect(default_vector_configs(keys)).toEqual(expected)
  })

  test(`palette wraps around for more keys than palette entries`, () => {
    const keys = Array.from({ length: 8 }, (_, idx) => `force_${idx}`)
    const configs = default_vector_configs(keys)
    expect(configs.force_6.color).toBe(VECTOR_PALETTE[6 % VECTOR_PALETTE.length])
    expect(configs.force_7.color).toBe(VECTOR_PALETTE[7 % VECTOR_PALETTE.length])
  })
})

test.each([
  [`force`, { scale: null, shaft_radius: 1, arrow_head_radius: 1, arrow_head_length: 1 }],
  [
    `velocity`,
    { scale: 0.05, shaft_radius: 0.2, arrow_head_radius: 0.1, arrow_head_length: 0.1 },
  ],
  [
    `velocities_mace`,
    { scale: 0.05, shaft_radius: 0.2, arrow_head_radius: 0.1, arrow_head_length: 0.1 },
  ],
  // case-sensitive like is_vector_key, which gates every key that reaches this
  [`VELOCITY`, { scale: null, shaft_radius: 1, arrow_head_radius: 1, arrow_head_length: 1 }],
])(`vector display defaults for %s`, (key, expected) => {
  expect(vector_display_defaults(key)).toEqual(expected)
})

test(`DEFAULT_STRUCTURE_VIEWS is a 2x2 grid: 1 perspective + 3 orthographic views with unique labels and non-zero directions`, () => {
  expect(DEFAULT_STRUCTURE_VIEWS).toHaveLength(4)
  const projections = DEFAULT_STRUCTURE_VIEWS.map((view) => view.projection)
  expect(projections.filter((proj) => proj === `perspective`)).toHaveLength(1)
  expect(projections.filter((proj) => proj === `orthographic`)).toHaveLength(3)
  const labels = DEFAULT_STRUCTURE_VIEWS.map((view) => view.label)
  expect(new Set(labels).size).toBe(labels.length)
  for (const view of DEFAULT_STRUCTURE_VIEWS) {
    expect(Math.hypot(...(view.direction ?? [0, 0, 0]))).toBeGreaterThan(0)
  }
})
