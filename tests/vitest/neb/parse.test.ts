import {
  parse_dropped_paths,
  parse_reaction_path_json,
  parse_xyz_reaction_path,
  REACTION_PATH_FORMAT,
} from '$lib/neb/parse'
import { analyze_barrier, path_spline, reaction_coordinate } from '$lib/neb/reaction-path'
import { reaction_paths } from '$site/neb'
import { describe, expect, test } from 'vitest'
import { make_crystal } from '../setup'

const CELL = 4
const cubic_structure = (x_frac: number) =>
  make_crystal(CELL, [{ element: `Li`, abc: [x_frac, 0, 0] }])
const direct_path = reaction_paths[`direct hop`]
const curved_path = reaction_paths[`curved hop`]

const minimal_doc = (extra: Record<string, unknown> = {}) => ({
  format: REACTION_PATH_FORMAT,
  version: 1,
  energy_unit: `eV`,
  images: [
    { energy: -10, label: `IS`, structure: cubic_structure(0.1) },
    { energy: -9.2, label: `TS`, structure: cubic_structure(0.3) },
    { energy: -9.7, label: `FS`, structure: cubic_structure(0.5) },
  ] as Record<string, unknown>[],
  ...extra,
})

describe(`reaction-path JSON`, () => {
  test(`single-path document parses into one path keyed by its label, else the filename`, () => {
    const paths = parse_reaction_path_json(JSON.stringify(minimal_doc()), `hop.json`)
    expect(Object.keys(paths)).toEqual([`hop.json`])
    const path = paths[`hop.json`]
    expect(path.images).toHaveLength(3)
    expect(path.energy_unit).toBe(`eV`)
    expect(path.images.map((image) => image.label)).toEqual([`IS`, `TS`, `FS`])
    expect(analyze_barrier(path).forward_barrier).toBeCloseTo(0.8, 12)

    // a document label takes over as the key, and stands in for a missing filename
    const labelled = parse_reaction_path_json(
      JSON.stringify(minimal_doc({ label: `vacancy` })),
    )
    expect(Object.keys(labelled)).toEqual([`vacancy`])
  })

  test.each([
    [`full path objects`, (images: unknown) => ({ label: `a`, images })],
    [`bare image arrays`, (images: unknown) => images],
  ])(`multi-path documents accept %s`, (_name, wrap) => {
    const { images } = minimal_doc()
    const doc = {
      format: REACTION_PATH_FORMAT,
      energy_unit: `meV`,
      paths: { vacancy: wrap(images), interstitial: wrap(images) },
    }
    const paths = parse_reaction_path_json(JSON.stringify(doc), `multi.json`)
    expect(Object.keys(paths)).toEqual([`vacancy`, `interstitial`])
    expect(paths.vacancy.energy_unit).toBe(`meV`)
  })

  test(`per-image forces and labels survive the parse`, () => {
    const doc = minimal_doc()
    doc.images[0].forces = [[0.1, -0.2, 0.3]]
    const path = parse_reaction_path_json(JSON.stringify(doc), `f.json`)[`f.json`]
    expect(path.images[0].forces).toEqual([[0.1, -0.2, 0.3]])
    expect(path.images[1].forces).toBeUndefined()
  })

  test(`an unrecognised top-level key such as _comment provenance is tolerated`, () => {
    const doc = minimal_doc({ _comment: `synthetic fixture, not a real calculation` })
    const path = parse_reaction_path_json(JSON.stringify(doc), `hop.json`)[`hop.json`]
    expect(path.images).toHaveLength(3)
  })

  // Every image after the first is well-formed, so each row isolates one defect
  const structure = cubic_structure(0)
  const good = { energy: 1, structure: cubic_structure(0.5) }
  const two_forces = [1, 4].map((val) => [val, val + 1, val + 2])
  const doc_with = (...images: unknown[]) => JSON.stringify({ images })

  // oxfmt-ignore
  test.each([
    [`malformed JSON`, `{ not json`, /not valid JSON/],
    [`a non-object document`, `[1, 2, 3]`, /must contain a JSON object/],
    [`a foreign format tag`, JSON.stringify({ format: `ase-neb`, images: [] }), /expected "matterviz-reaction-path"/],
    [`no images and no paths`, JSON.stringify({ format: REACTION_PATH_FORMAT }), /neither an "images" array nor a "paths" record/],
    [`an empty paths record`, JSON.stringify({ format: REACTION_PATH_FORMAT, paths: {} }), /empty "paths" record/],
    [`a single-image path`, doc_with({ energy: 0, structure }), /at least 2 images/],
    [`a missing structure`, doc_with({ energy: 0 }, good), /missing a "structure" object/],
    [`a non-numeric energy`, doc_with({ energy: `low`, structure }, good), /energy must be a finite number/],
    [`a malformed force vector`, doc_with({ energy: 0, forces: [[1, 2]], structure }, good), /must be 3 finite numbers/],
    [`a force count mismatch`, doc_with({ energy: 0, forces: two_forces, structure }, good), /2 force vectors for 1 sites/],
  ])(`throws with context for %s`, (_name, content, pattern) => {
    expect(() => parse_reaction_path_json(content, `bad.json`)).toThrow(pattern)
  })
})

describe(`extended XYZ reaction paths`, () => {
  const LATTICE = `Lattice="4.0 0.0 0.0 0.0 4.0 0.0 0.0 0.0 4.0"`
  const frame = (x_val: number, energy: number, with_forces = false, key = `energy`) => {
    const props = `Properties=species:S:1:pos:R:3${with_forces ? `:forces:R:3` : ``}`
    const tail = with_forces ? ` 0.0 0.0 ${-energy}` : ``
    return `1\n${LATTICE} ${props} ${key}=${energy}\nLi ${x_val} 0.0 0.0${tail}`
  }

  test(`splits a multi-frame file into one image per frame`, () => {
    const content = [frame(0, -10), frame(1, -9.2), frame(2, -9.7)].join(`\n`)
    const path = parse_xyz_reaction_path(content, `neb.xyz`)
    expect(path.images.map((image) => image.energy)).toEqual([-10, -9.2, -9.7])
    expect(path.images.map((image) => image.label)).toEqual([`image 0`, `image 1`, `image 2`])
    expect(analyze_barrier(path).forward_barrier).toBeCloseTo(0.8, 12)
  })

  // Routing through the trajectory XYZ reader buys the wider key set for free; the old
  // hand-rolled regex only knew `energy=`.
  test.each([`E`, `etot`, `total_energy`, `energy`])(`reads a %s= energy key`, (key) => {
    const content = [frame(0, -10, false, key), frame(1, -9.2, false, key)].join(`\n`)
    const path = parse_xyz_reaction_path(content, `neb.xyz`)
    expect(path.images.map((image) => image.energy)).toEqual([-10, -9.2])
  })

  test(`reads forces only when the Properties spec declares them`, () => {
    const with_forces = [frame(0, -10, true), frame(1, -9.2, true), frame(2, -9.7, true)]
    const path = parse_xyz_reaction_path(with_forces.join(`\n`), `neb.xyz`)
    expect(path.images.map((image) => image.forces?.[0])).toEqual([
      [0, 0, 10],
      [0, 0, 9.2],
      [0, 0, 9.7],
    ])

    const no_forces = [frame(0, -10), frame(1, -9.2)].join(`\n`)
    expect(parse_xyz_reaction_path(no_forces).images[0].forces).toBeUndefined()
  })

  // oxfmt-ignore
  test.each([
    [`a single frame`, frame(0, -10), /1 XYZ frame\(s\).*at least 2/],
    [`a frame with no energy in its comment`, `1\njust a comment\nLi 0.0 0.0 0.0\n1\njust a comment\nLi 1.0 0.0 0.0`, /no parsable energy/],
    [`a non-numeric atom count`, `abc\ncomment\nLi 0 0 0`, /0 XYZ frame\(s\).*at least 2/],
    [`a truncated frame`, `3\ncomment energy=-1\nLi 0 0 0`, /0 XYZ frame\(s\).*at least 2/],
  ])(`throws for %s`, (_name, content, pattern) => {
    expect(() => parse_xyz_reaction_path(content, `neb.xyz`)).toThrow(pattern)
  })

  test(`a malformed count line does not discard the frames around it`, () => {
    // The old hand-rolled splitter bailed on the first bad count field; the trajectory
    // walker resynchronises on the next plausible frame header instead.
    const content = [frame(0, -10), `oops`, frame(1, -9.2), frame(2, -9.7)].join(`\n`)
    const path = parse_xyz_reaction_path(content, `neb.xyz`)
    expect(path.images.map((image) => image.energy)).toEqual([-10, -9.2, -9.7])
  })
})

describe(`dropped files`, () => {
  test(`reaction-path JSON contributes its own named paths`, () => {
    const paths = parse_dropped_paths([
      { content: JSON.stringify(minimal_doc({ label: `vacancy` })), filename: `a.json` },
    ])
    expect(Object.keys(paths)).toEqual([`vacancy`])
  })

  test(`loose structure files are assembled into one path in drop order`, () => {
    const paths = parse_dropped_paths(
      [
        [0.1, -10],
        [0.3, -9.2],
        [0.5, -9.7],
      ].map(([x_frac, energy], idx) => ({
        content: JSON.stringify({ ...cubic_structure(x_frac), properties: { energy } }),
        filename: `0${idx}.json`,
      })),
    )
    expect(Object.keys(paths)).toEqual([`dropped images`])
    expect(analyze_barrier(paths[`dropped images`]).reaction_energy).toBeCloseTo(0.3, 12)
  })

  // The single-frame XYZ branch reads the comment at line index 1, so it has to trim the
  // content first like parse_xyz_reaction_path does — otherwise a leading blank line
  // shifts the comment out from under it and the energy reads as missing
  test.each([``, `  \n\n`])(
    `a loose single-frame XYZ keeps its comment energy after %j of leading whitespace`,
    (lead) => {
      const xyz = (x_val: number, energy: number) =>
        `${lead}1\nenergy=${energy}\nLi ${x_val} 0.0 0.0`
      const paths = parse_dropped_paths([
        { content: xyz(0, -10), filename: `a.xyz` },
        { content: xyz(1, -9.2), filename: `b.xyz` },
      ])
      expect(paths[`dropped images`].images.map((image) => image.energy)).toEqual([-10, -9.2])
    },
  )

  // oxfmt-ignore
  test.each([
    [`no files at all`, [], /got no files/],
    [`a structure file carrying no energy`, [{ content: JSON.stringify(cubic_structure(0.1)), filename: `POSCAR.json` }], /carries no energy/],
  ])(`throws for %s`, (_name, files, pattern) => {
    expect(() => parse_dropped_paths(files)).toThrow(pattern)
  })
})

describe(`Li/MgO demo fixture`, () => {
  test(`ships two mechanisms whose images all hold the same 9 atoms, migrating Li last`, () => {
    expect(Object.keys(reaction_paths)).toEqual([`direct hop`, `curved hop`])
    expect(direct_path.images).toHaveLength(7)
    expect(curved_path.images).toHaveLength(9)

    for (const path of Object.values(reaction_paths)) {
      for (const image of path.images) {
        expect(image.structure.sites).toHaveLength(9)
        expect(image.structure.sites[8].species[0].element).toBe(`Li`)
      }
    }
  })

  test.each([
    // Barriers generated from E(u) = 0.75·sin²(πu) + 0.18·u (direct) and
    // 1.05·sin²(πu) + 0.18·u (curved), sampled at the image arc lengths
    [`direct hop`, 3, 0.8339, 0.6539],
    [`curved hop`, 4, 1.14, 0.96],
  ])(`%s barrier arithmetic`, (key, ts_idx, forward, reverse) => {
    const { ts_image_idx, forward_barrier, reverse_barrier, reaction_energy } =
      analyze_barrier(reaction_paths[key])
    expect(ts_image_idx).toBe(ts_idx)
    // Fixture energies are rounded to 6 decimals, so 1e-4 covers the stored precision
    expect(forward_barrier).toBeCloseTo(forward, 4)
    expect(reverse_barrier).toBeCloseTo(reverse, 4)
    expect(reaction_energy).toBeCloseTo(0.18, 4)
  })

  test(`both mechanisms share endpoints, so only the barrier differs`, () => {
    const direct = analyze_barrier(direct_path)
    const curved = analyze_barrier(curved_path)
    expect(direct.initial_energy).toBeCloseTo(curved.initial_energy, 6)
    expect(direct.final_energy).toBeCloseTo(curved.final_energy, 6)
    expect(curved.forward_barrier).toBeGreaterThan(direct.forward_barrier)
  })

  test(`the migrating Li crosses the z cell face, so the metric choice matters`, () => {
    const images = direct_path.images
    const min_image = reaction_coordinate(images).at(-1) as number
    const raw = reaction_coordinate(images, { metric: `cartesian` }).at(-1) as number
    // Li moves 0.45 fractional units through the face in a 4.21 Å cell => 1.89 Å
    expect(min_image).toBeCloseTo(1.9882, 3)
    // Raw subtraction sends it the long way for the one boundary-crossing step
    expect(raw).toBeGreaterThan(min_image + 3)
  })

  // `rel` is the analytic saddle of the generating profile, relative to the initial state
  // oxfmt-ignore
  test.each(
    [[`direct hop`, `force-hermite`, 0.8411], [`curved hop`, `natural-cubic`, 1.1408]] as const,
  )(`%s is fitted with the %s spline, whose saddle recovers the analytic barrier and outranks every image`, (key, method, rel) => {
    const path = reaction_paths[key]
    const spline = path_spline(path)
    expect(spline.method).toBe(method)
    // The fit interpolates a smooth profile from 7-9 samples, so agreement to 5 meV
    // is the accuracy claim, not machine precision
    expect(spline.fitted_max.energy - path.images[0].energy).toBeCloseTo(rel, 2)
    expect(spline.fitted_max.energy).toBeGreaterThan(spline.highest_image.energy)
    expect(spline.saddle_at_image).toBe(false)
  })
})
