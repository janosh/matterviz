import { NebPlot, NebViewer } from '$lib/neb'
import {
  parse_dropped_paths,
  parse_reaction_path_json,
  parse_xyz_reaction_path,
  REACTION_PATH_FORMAT,
} from '$lib/neb/parse'
import { analyze_barrier, path_spline, reaction_coordinate } from '$lib/neb/reaction-path'
import { count_xyz_frames } from '$lib/trajectory/helpers'
import { li_mgo_hop_json, LI_MGO_HOP_FILENAME, reaction_paths } from '$site/neb'
import { type ComponentProps, mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { make_crystal, resize_element } from '../setup'

const CELL = 4
const cubic_structure = (x_frac: number) =>
  make_crystal(CELL, [{ element: `Li`, abc: [x_frac, 0, 0] }])

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
  test(`single-path document parses into one keyed path`, () => {
    const paths = parse_reaction_path_json(JSON.stringify(minimal_doc()), `hop.json`)
    expect(Object.keys(paths)).toEqual([`hop.json`])
    const path = paths[`hop.json`]
    expect(path.images).toHaveLength(3)
    expect(path.energy_unit).toBe(`eV`)
    expect(path.images.map((image) => image.label)).toEqual([`IS`, `TS`, `FS`])
    expect(analyze_barrier(path).forward_barrier).toBeCloseTo(0.8, 12)
  })

  test(`a document label becomes the path key`, () => {
    const paths = parse_reaction_path_json(JSON.stringify(minimal_doc({ label: `vacancy` })))
    expect(Object.keys(paths)).toEqual([`vacancy`])
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
    expect(path.images.map((image) => image.label)).toEqual([`IS`, `TS`, `FS`])
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
    expect(count_xyz_frames(content)).toBe(3)
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

  test(`reads a forces block declared in the Properties spec`, () => {
    const content = [frame(0, -10, true), frame(1, -9.2, true), frame(2, -9.7, true)]
    const path = parse_xyz_reaction_path(content.join(`\n`), `neb.xyz`)
    expect(path.images.map((image) => image.forces?.[0])).toEqual([
      [0, 0, 10],
      [0, 0, 9.2],
      [0, 0, 9.7],
    ])
  })

  test(`omits forces when the Properties spec has no forces block`, () => {
    const content = [frame(0, -10), frame(1, -9.2)].join(`\n`)
    expect(parse_xyz_reaction_path(content).images[0].forces).toBeUndefined()
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
      (
        [
          [0.1, -10],
          [0.3, -9.2],
          [0.5, -9.7],
        ] as const
      ).map(([x_frac, energy], idx) => ({
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
  test.each([``, `\n`, `  \n\n`])(
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
  test(`ships two mechanisms for the same hop`, () => {
    expect(Object.keys(reaction_paths)).toEqual([`direct hop`, `curved hop`])
    expect(reaction_paths[`direct hop`].images).toHaveLength(7)
    expect(reaction_paths[`curved hop`].images).toHaveLength(9)
    expect(li_mgo_hop_json).toContain(REACTION_PATH_FORMAT)
    expect(LI_MGO_HOP_FILENAME).toBe(`li-mgo-interstitial-hop.json`)
  })

  test(`every image holds the same 9 atoms with the migrating Li last`, () => {
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
    expect(forward_barrier - reverse_barrier).toBeCloseTo(reaction_energy, 12)
  })

  test(`both mechanisms share endpoints, so only the barrier differs`, () => {
    const direct = analyze_barrier(reaction_paths[`direct hop`])
    const curved = analyze_barrier(reaction_paths[`curved hop`])
    expect(direct.initial_energy).toBeCloseTo(curved.initial_energy, 6)
    expect(direct.final_energy).toBeCloseTo(curved.final_energy, 6)
    expect(curved.forward_barrier).toBeGreaterThan(direct.forward_barrier)
  })

  test(`the migrating Li crosses the z cell face, so the metric choice matters`, () => {
    const images = reaction_paths[`direct hop`].images
    const min_image = reaction_coordinate(images).at(-1) as number
    const raw = reaction_coordinate(images, { metric: `cartesian` }).at(-1) as number
    // Li moves 0.45 fractional units through the face in a 4.21 Å cell => 1.89 Å
    expect(min_image).toBeCloseTo(1.9882, 3)
    // Raw subtraction sends it the long way for the one boundary-crossing step
    expect(raw).toBeGreaterThan(min_image + 3)
  })

  // oxfmt-ignore
  test.each(
    [[`direct hop`, `force-hermite`], [`curved hop`, `natural-cubic`]] as const,
  )(`%s is fitted with the %s spline`, (key, method) => {
    const spline = path_spline(reaction_paths[key])
    expect(spline.method).toBe(method)
    expect(spline.fitted_max.energy).toBeGreaterThanOrEqual(spline.highest_image.energy)
  })

  // Analytic saddle of the generating profile, relative to the initial state
  // oxfmt-ignore
  test.each(
    [[`direct hop`, 0.8411], [`curved hop`, 1.1408]],
  )(`%s fitted saddle recovers the analytic barrier and outranks every image`, (key, rel) => {
    const path = reaction_paths[key]
    const spline = path_spline(path)
    // The fit interpolates a smooth profile from 7-9 samples, so agreement to 5 meV
    // is the accuracy claim, not machine precision
    expect(spline.fitted_max.energy - path.images[0].energy).toBeCloseTo(rel, 2)
    expect(spline.fitted_max.energy).toBeGreaterThan(spline.highest_image.energy)
    expect(spline.saddle_at_image).toBe(false)
    expect(spline.fitted_max.between_images[0]).not.toBe(spline.fitted_max.between_images[1])
  })
})

// SVG annotations are split across text nodes and indented, so compare on squashed text
const squash = (text: string | null): string => (text ?? ``).replaceAll(/\s+/g, ` `)

// jsdom lays everything out at 0x0, so the scatter plot needs an explicit size before
// any annotation it positions from the scales can be asserted on.
const sized = async (root: HTMLElement | null, label: string): Promise<HTMLElement> => {
  if (!root) throw new Error(`${label} root element not found`)
  const plot = root.matches(`.scatter`) ? root : root.querySelector<HTMLElement>(`.scatter`)
  if (plot) await resize_element(plot, 500, 340)
  return root
}

const mount_plot = (props: ComponentProps<typeof NebPlot>): Promise<HTMLElement> => {
  const style = `width: 500px; height: 340px`
  mount(NebPlot, { target: document.body, props: { ...props, style } })
  return sized(document.querySelector<HTMLElement>(`.scatter`), `NebPlot`)
}

const mount_viewer = async (
  props: ComponentProps<typeof NebViewer> = {},
): Promise<HTMLElement> => {
  mount(NebViewer, { target: document.body, props })
  await tick()
  return sized(document.querySelector<HTMLElement>(`.neb-viewer`), `NebViewer`)
}

describe(`NebPlot`, () => {
  test.each([
    [`a keyed record of paths`, () => reaction_paths],
    [`a single path object`, () => reaction_paths[`direct hop`]],
    [`a bare image array`, () => reaction_paths[`direct hop`].images],
  ])(`renders %s`, async (_name, make_paths) => {
    const plot = await mount_plot({ paths: make_paths() })
    expect(plot.querySelector(`svg[role="application"]`)).toBeInstanceOf(SVGSVGElement)
    expect(plot.querySelector(`.y-axis .axis-label`)?.textContent).toContain(`eV`)
  })

  // oxfmt-ignore
  test.each(
    [[`arc_length`, `Reaction coordinate (Å)`], [`image_index`, `Image index`]] as const,
  )(`labels the x-axis for %s mode`, async (mode, expected) => {
    const plot = await mount_plot({ paths: reaction_paths, coord_options: { mode } })
    expect(plot.querySelector(`.x-axis .axis-label`)?.textContent).toContain(expected)
  })

  // oxfmt-ignore
  test.each(
    [[`initial`, `Energy relative to initial state (eV)`], [`absolute`, `Energy (eV)`]] as const,
  )(`labels the y-axis for the %s energy reference`, async (reference, expected) => {
    const plot = await mount_plot({ paths: reaction_paths, energy_reference: reference })
    expect(plot.querySelector(`.y-axis .axis-label`)?.textContent).toContain(expected)
  })

  test(`annotates the forward barrier of the active path`, async () => {
    const plot = await mount_plot({ paths: reaction_paths, active_path_key: `direct hop` })
    // Forward barrier of the direct hop is 0.8339 eV, formatted with 3 significant digits
    expect(squash(plot.textContent)).toContain(`Ea = 0.834 eV`)
    // One dashed rule per IS/TS/FS energy, plus the active-image marker
    expect(plot.querySelectorAll(`line[stroke-dasharray="4 4"]`)).toHaveLength(3)
    expect(plot.querySelectorAll(`line[stroke-dasharray="2 3"]`)).toHaveLength(1)
  })

  test(`marks the fitted saddle separately from the highest image`, async () => {
    const plot = await mount_plot({ paths: reaction_paths, active_path_key: `direct hop` })
    // The fit sits ~7 meV above image #3; the label states the excess, not a total
    expect(plot.textContent).toMatch(/fit \+0\.00\d+/)
  })

  test(`hides the barrier annotation when asked`, async () => {
    const plot = await mount_plot({ paths: reaction_paths, annotate_barrier: false })
    expect(plot.textContent).not.toContain(`Ea = `)
  })

  // oxfmt-ignore
  test.each(
    [[`with a spline`, true, 4], [`without a spline`, false, 2]],
  )(`draws one series per path %s`, async (_name, show_spline, expected_series) => {
    await mount_plot({ paths: reaction_paths, show_spline })
    expect(document.querySelectorAll(`.legend-item`)).toHaveLength(expected_series)
  })
})

describe(`NebViewer`, () => {
  test(`shows a drop prompt when no path is supplied`, async () => {
    const viewer = await mount_viewer({})
    expect(viewer.textContent).toContain(`Drop a matterviz-reaction-path JSON`)
    expect(viewer.querySelector(`.scatter`)).toBeNull()
  })

  test(`renders the plot, the structure and the barrier summary together`, async () => {
    const viewer = await mount_viewer({ paths: reaction_paths })
    expect(viewer.querySelector(`.scatter`)).toBeInstanceOf(HTMLElement)
    expect(viewer.querySelector(`.structure-pane`)).toBeInstanceOf(HTMLElement)
    const summary = viewer.querySelector(`.barrier-summary`)?.textContent ?? ``
    expect(summary).toContain(`Forward barrier`)
    expect(summary).toContain(`0.8339 eV`)
    expect(summary).toContain(`0.6539 eV`)
    expect(summary).toContain(`Fitted saddle (force-hermite)`)
  })

  test(`offers a path selector only when several paths are present`, async () => {
    const multi = await mount_viewer({ paths: reaction_paths })
    // path picker + x-axis mode + energy reference
    expect(multi.querySelectorAll(`.controls select`)).toHaveLength(3)
    document.body.innerHTML = ``
    const single = await mount_viewer({ paths: reaction_paths[`direct hop`] })
    expect(single.querySelectorAll(`.controls select`)).toHaveLength(2)
  })

  test.each([
    [`the next button`, `[title="Next image"]`, 0, 2],
    [`the previous button`, `[title="Previous image"]`, 2, 2],
    [`the previous button at the first image`, `[title="Previous image"]`, 0, 1],
  ])(`stepping with %s moves to image %i -> %i`, async (_name, sel, start_idx, label) => {
    const viewer = await mount_viewer({ paths: reaction_paths, active_image_idx: start_idx })
    viewer.querySelector<HTMLButtonElement>(sel)?.click()
    await tick()
    expect(viewer.querySelector(`.stepper`)?.textContent).toContain(`(${label}/7)`)
  })

  test(`the previous button is disabled at the first image`, async () => {
    const viewer = await mount_viewer({ paths: reaction_paths, active_image_idx: 0 })
    expect(viewer.querySelector<HTMLButtonElement>(`[title="Previous image"]`)?.disabled).toBe(
      true,
    )
  })

  // the stepper's range input has no visible <label>, so it needs an accessible name
  test(`the image slider is reachable by its accessible name`, async () => {
    const viewer = await mount_viewer({ paths: reaction_paths })
    const slider = viewer.querySelector<HTMLInputElement>(
      `.stepper input[aria-label="Image slider"]`,
    )
    expect(slider?.type).toBe(`range`)
    expect(slider?.max).toBe(`6`)
  })

  test(`the fitted saddle is a physical energy, not an artefact of the x-axis`, async () => {
    const fitted_excess = async (coord_mode: `arc_length` | `image_index`) => {
      document.body.innerHTML = ``
      const viewer = await mount_viewer({
        paths: reaction_paths,
        active_path_key: `direct hop`,
        coord_mode,
      })
      const summary = squash(viewer.querySelector(`.barrier-summary`)?.textContent ?? ``)
      const excess = /\+(?<excess>[\d.]+) eV above image/.exec(summary)?.groups?.excess
      if (!excess) throw new Error(`no fitted saddle row in "${summary}"`)
      return Number(excess)
    }
    const [arc, index] = [
      await fitted_excess(`arc_length`),
      await fitted_excess(`image_index`),
    ]
    // dE/ds comes out of the forces in eV/Å. Grafting it unchanged onto the unitless bead
    // number reported 0.0818 eV here — 12x the truth. Reparametrising 7 knots does move
    // the interpolant a little, so allow 2 meV rather than demanding f64 agreement.
    expect(arc).toBeCloseTo(0.0069, 4)
    expect(Math.abs(index - arc)).toBeLessThan(2e-3)
  })

  test(`the summary follows the selected path`, async () => {
    const viewer = await mount_viewer({ paths: reaction_paths, active_path_key: `curved hop` })
    const summary = viewer.querySelector(`.barrier-summary`)?.textContent ?? ``
    expect(summary).toContain(`1.14 eV`)
    expect(summary).toContain(`Fitted saddle (natural-cubic)`)
  })
})
