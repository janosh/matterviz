import type { Vec3 } from '#lib/math.js'
import type { AnyStructure, Site } from '#lib/structure/index.js'
import type { AtomColorField } from '#lib/structure/atom-color-field.js'
import {
  AtomGroupBuilder,
  type AtomGroupInput,
  type RenderAtom,
  tooltip_fill,
} from '#lib/structure/atom-groups.js'
import * as atom_instances from '#lib/structure/atom-instances.js'
import { merge_split_partial_sites } from '#lib/structure/partial-occupancy.js'
import { make_site } from '#lib/structure/site.js'
import { create_numeric_md_frame, FrameView } from '#lib/trajectory/frame.js'
import { describe, expect, onTestFinished, test, vi } from 'vitest'

const palette = { C: `#111111`, O: `#222222`, Fe: `#333333`, Ni: `#444444` }

const make_input = (
  structure: AnyStructure,
  overrides: Partial<AtomGroupInput> = {},
): AtomGroupInput => ({
  structure,
  render_sites: () => merge_split_partial_sites(structure.sites),
  palette,
  property_colors: null,
  hidden_prop_vals: new Set(),
  hidden_elements: new Set(),
  hide_completion_images: false,
  radius_scale: 1,
  radius_options: { same_size_atoms: true },
  hidden_centers: null,
  cutaway_sites: undefined,
  appearance: `default`,
  ...overrides,
})

const co_molecule = (offset = 0): AnyStructure => ({
  sites: [
    make_site(`C`, [0, 0, 0], [offset, 0, 0], `C`),
    make_site(`O`, [0, 0, 0], [offset + 1.13, 0, 0], `O`),
  ],
})

describe(`AtomGroupBuilder`, () => {
  test(`splits full, image and partial atoms and anchors each site on its first wedge`, () => {
    const image: Site = {
      ...make_site(`C`, [1, 0, 0], [3, 0, 0], `C`),
      provenance: { image_of: 0 },
    }
    const disordered: Site = {
      ...make_site(`Fe`, [0, 0, 0], [0, 2, 0], `FeNi`),
      species: [
        { element: `Fe`, occu: 0.5, oxidation_state: 0 },
        { element: `Ni`, occu: 0.5, oxidation_state: 0 },
      ],
    }
    const structure = { sites: [...co_molecule().sites, image, disordered] }
    const groups = new AtomGroupBuilder().build(make_input(structure))
    expect(groups.base.map(({ site_idx, color }) => [site_idx, color])).toEqual([
      [0, palette.C],
      [1, palette.O],
    ])
    expect(groups.image.map(({ site_idx }) => site_idx)).toEqual([2])
    expect(groups.partial.map(({ element }) => element)).toEqual([`Fe`, `Ni`])
    expect(groups.first_by_site.get(3)).toBe(groups.partial[0])
    expect([...groups.first_by_site.keys()]).toEqual([0, 1, 2, 3])
  })

  test(`coordinate-only frames reuse the atom records in a fresh base array`, () => {
    const builder = new AtomGroupBuilder()
    const first = builder.build(make_input(co_molecule()))
    let render_site_reads = 0
    const moved = co_molecule(5)
    const next = builder.build(
      make_input(moved, {
        render_sites: () => {
          render_site_reads += 1
          return merge_split_partial_sites(moved.sites)
        },
      }),
    )
    // the reuse path never merges partial sites again
    expect(render_site_reads).toBe(0)
    expect(next.base).not.toBe(first.base)
    expect(next.base[0]).toBe(first.base[0])
    expect(next.base.map(({ position }) => position[0])).toEqual([5, 6.13])
    // an appearance change rebuilds the records
    const rebuilt = builder.build(make_input(moved, { appearance: `other` }))
    expect(rebuilt.base[0]).not.toBe(first.base[0])
  })

  test(`a warm cache is bypassed when a filter turns on or the site count changes`, () => {
    const builder = new AtomGroupBuilder()
    const first = builder.build(make_input(co_molecule()))
    const hidden_elements = new Set([`O`])
    const filtered = builder.build(make_input(co_molecule(1), { hidden_elements }))
    expect(filtered.base.map(({ site_idx }) => site_idx)).toEqual([0])
    expect(filtered.base[0]).not.toBe(first.base[0])
    builder.build(make_input(co_molecule()))
    const grown = {
      sites: [...co_molecule(2).sites, make_site(`C`, [0, 0, 0], [9, 0, 0], `C`)],
    }
    const regrown = builder.build(make_input(grown))
    expect(regrown.base.map(({ position }) => position[0])).toEqual([2, 3.13, 9])
  })

  test(`builds with image atoms are never reused, so images follow every frame`, () => {
    const with_image = (offset: number): AnyStructure => ({
      sites: [
        ...co_molecule(offset).sites,
        { ...make_site(`C`, [1, 0, 0], [offset + 3, 0, 0], `C`), provenance: { image_of: 0 } },
      ],
    })
    const builder = new AtomGroupBuilder()
    const first = builder.build(make_input(with_image(0)))
    const moved = builder.build(make_input(with_image(5)))
    expect(moved.image[0].position).toEqual([8, 0, 0])
    expect(moved.base[0]).not.toBe(first.base[0])
  })

  test(`numeric frames of one topology read coordinates straight from the columns`, () => {
    const view = new FrameView()
    const numeric_frame = (offset: number): AnyStructure => {
      const coords = new Float64Array([offset, 0, 0, offset + 1.13, 0, 0])
      const frame = create_numeric_md_frame(
        coords,
        new Uint8Array([6, 8]),
        undefined,
        undefined,
        0,
        {},
        [],
      )
      frame.topology = { kind: `fixed-order`, revision: 0 }
      return view.update(frame).structure
    }
    const builder = new AtomGroupBuilder()
    const first = builder.build(make_input(numeric_frame(0)))
    const from_columns = vi.spyOn(atom_instances, `update_atom_coordinates`)
    const from_sites = vi.spyOn(atom_instances, `update_ordered_atom_positions`)
    onTestFinished(() => {
      from_columns.mockRestore()
      from_sites.mockRestore()
    })
    const next = builder.build(make_input(numeric_frame(4)))
    expect([from_columns.mock.calls.length, from_sites.mock.calls.length]).toEqual([1, 0])
    expect(next.base[1]).toBe(first.base[1])
    expect(next.base.map(({ position }) => position[0])).toEqual([4, 5.13])
  })

  test(`reset drops the reuse cache`, () => {
    const builder = new AtomGroupBuilder()
    const first = builder.build(make_input(co_molecule()))
    expect(builder.reset().base).toEqual([])
    const rebuilt = builder.build(make_input(co_molecule(1)))
    expect(rebuilt.base[0]).not.toBe(first.base[0])
  })

  test(`the reuse path recolors kept records as property colors toggle`, () => {
    const builder = new AtomGroupBuilder()
    const property_colors = { values: [1, 2], colors: [`#aaaaaa`, `#bbbbbb`] }
    const colors = (offset: number, overrides: Partial<AtomGroupInput> = {}) => {
      const { base } = builder.build(make_input(co_molecule(offset), overrides))
      return { first: base[0], colors: base.map(({ color }) => color) }
    }
    const colored = colors(0, { property_colors })
    expect(colored.colors).toEqual([`#aaaaaa`, `#bbbbbb`])
    // same appearance and order: each frame reuses the records and recolors them
    const plain = colors(1)
    expect(plain.first).toBe(colored.first)
    expect(plain.colors).toEqual([palette.C, palette.O])
    const recolored = colors(2, { property_colors })
    expect(recolored.first).toBe(colored.first)
    expect(recolored.colors).toEqual([`#aaaaaa`, `#bbbbbb`])
  })

  test.each([
    [`hidden element`, { hidden_elements: new Set([`O`]) }, [0]],
    [`hidden property value`, { hidden_prop_vals: new Set([2]) }, [0]],
    [`hidden polyhedron center`, { hidden_centers: new Set([0]) }, [1]],
  ] as const)(`filters a %s`, (_label, overrides, expected) => {
    const property_colors = { values: [1, 2], colors: [`#aaaaaa`, `#bbbbbb`] }
    const input = make_input(co_molecule(), { property_colors, ...overrides })
    const groups = new AtomGroupBuilder().build(input)
    expect(groups.base.map(({ site_idx }) => site_idx)).toEqual(expected)
  })

  test(`hides completion images only when asked`, () => {
    const completion: Site = {
      ...make_site(`O`, [1, 0, 0], [4, 0, 0], `O`),
      provenance: { image_of: 1, completion: true },
    }
    const structure = { sites: [...co_molecule().sites, completion] }
    const count = (hide_completion_images: boolean) =>
      new AtomGroupBuilder().build(make_input(structure, { hide_completion_images })).image
        .length
    expect([count(false), count(true)]).toEqual([1, 0])
  })

  test(`whole-atom cutaways keep listed sites at every listed position`, () => {
    const shifted: Vec3 = [1.13, 3, 0]
    const cutaway_sites = new Map<number, Vec3[]>([[1, [[1.13, 0, 0], shifted]]])
    const groups = new AtomGroupBuilder().build(make_input(co_molecule(), { cutaway_sites }))
    // the copy away from the site's own position draws as an image atom
    expect(groups.base.map(({ site_idx }) => site_idx)).toEqual([1])
    expect(groups.image.map(({ position }) => position)).toEqual([shifted])
  })
})

describe(`tooltip_fill`, () => {
  const atom = (species: Site[`species`]): RenderAtom =>
    ({ site_idx: 0, color: `#123456`, species }) as RenderAtom
  const fe = { element: `Fe`, occu: 0.5, oxidation_state: 2 } as const
  const fe3 = { ...fe, oxidation_state: 3 }
  const ni = { element: `Ni`, occu: 0.5, oxidation_state: 0 } as const
  const none = new Set<string>()

  const color_field = {} as AtomColorField
  const property_colors = { colors: [`#abcdef`], values: [1] }

  test.each([
    [`no hovered atom`, undefined, undefined, null, none, null],
    [`mixed-valence single element`, atom([fe, fe3]), undefined, null, none, `#123456`],
    [`two elements`, atom([fe, ni]), undefined, null, none, null],
    [`two elements, one hidden`, atom([fe, ni]), undefined, null, new Set([`Ni`]), `#123456`],
    [`property color`, atom([fe, ni]), undefined, property_colors, none, `#123456`],
    [`color field keeps the neutral chip`, atom([fe]), color_field, null, none, null],
    [
      `color field outranks property colors`,
      atom([fe]),
      color_field,
      property_colors,
      none,
      null,
    ],
  ])(`%s`, (_label, hovered, field, prop_colors, hidden, expected) => {
    expect(tooltip_fill(hovered, field, prop_colors, hidden)).toBe(expected)
  })
})
