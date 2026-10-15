// Structure I/O round-trip contract: every structure fixture, exported to each text format and
// parsed back, keeps what that format represents (to the precision it prints) and the exporter
// refuses what the format cannot represent instead of writing a lossy file
import { readdirSync, statSync } from 'node:fs'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import type { AnyStructure, Site } from '#lib/structure/index.js'
import type { StructTextFormat } from '#lib/structure/export.js'
import {
  fractional_export_unavailable_reason,
  poscar_export_unavailable_reason,
  STRUCT_TEXT_FORMATS,
  xyz_export_unavailable_reason,
} from '#lib/structure/export.js'
import { parse_structure_file } from '#lib/structure/parse.js'
import { describe, expect, test } from 'vitest'
import {
  complex_structure,
  make_crystal,
  read_maybe_gz,
  simple_structure,
} from '../test-fixtures'

// Largest error a correctly rounded `toFixed(decimals)` adds (half a unit in the last printed
// place) plus 1e-12 for the float arithmetic around it: ~1e3 x f64 eps at the |values| < 100
// (Å, degrees) of these fixtures, and still 500x below the coarsest printed precision
const printed = (decimals: number): number => 0.5 * 10 ** -decimals + 1e-12
// Text numbers have no -0 (`JSON.stringify(-0)` and `String(-0)` are `0`), which a text
// round trip, unlike structuredClone, reproduces
// oxlint-disable-next-line unicorn/prefer-structured-clone
const as_text = <T>(value: T): T => JSON.parse(JSON.stringify(value))

type Capability = {
  ordered_only: boolean // one fully occupied element per site (refuses partial/mixed sites)
  lattice: `matrix` | `params` // CIF stores cell parameters, rebuilt in standard orientation
  lattice_tol: number // Å for lengths, degrees for angles
  coords: `abc` | `xyz` // the coordinate kind the file stores, compared to coords_tol
  coords_tol: number
  occu_tol: number
  oxidation_states: boolean
  labels: boolean
  charge_and_pbc: boolean // CIF and POSCAR cells are always fully periodic, with no charge
  regroups_by_element: boolean // POSCAR writes one block per element
  // The site properties a re-read is expected to return, exactly
  site_properties: (site: Site, structure: AnyStructure) => Record<string, unknown>
  unavailable_reason: (structure: AnyStructure) => string | undefined
}

// extXYZ writes a column for every property that is a finite number or a finite 3-vector on
// every site (full precision), plus per-axis motion flags. Forces would be printed to 6
// decimals, but no fixture carries any (asserted below).
const is_column_value = (value: unknown): boolean =>
  (typeof value === `number` && Number.isFinite(value)) ||
  (Array.isArray(value) && value.length === 3 && value.every(Number.isFinite))
const xyz_site_properties = (site: Site, { sites }: AnyStructure): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(as_text(site.properties)).filter(
      ([key]) =>
        key === `selective_dynamics` ||
        sites.every(({ properties }) => is_column_value(properties[key])),
    ),
  )

const CAPABILITIES: Record<StructTextFormat, Capability> = {
  json: {
    ordered_only: false,
    lattice: `matrix`,
    lattice_tol: 0,
    coords: `abc`,
    // the reader wraps abc into [0, 1) (-6e-17 -> 0) and re-derives it where only xyz is
    // trusted (OPTIMADE): a few f64 eps on values < 1 (measured max 3.9e-16, 1.75 eps)
    coords_tol: 2e-15,
    occu_tol: 0,
    oxidation_states: true,
    labels: true,
    charge_and_pbc: true,
    regroups_by_element: false,
    site_properties: (site) => as_text(site.properties),
    unavailable_reason: () => undefined,
  },
  xyz: {
    ordered_only: true,
    lattice: `matrix`,
    lattice_tol: printed(8),
    coords: `xyz`,
    coords_tol: printed(6),
    occu_tol: 0,
    oxidation_states: false,
    labels: false,
    charge_and_pbc: false,
    regroups_by_element: false,
    site_properties: xyz_site_properties,
    unavailable_reason: xyz_export_unavailable_reason,
  },
  cif: {
    ordered_only: false,
    lattice: `params`,
    lattice_tol: printed(6),
    coords: `abc`,
    coords_tol: printed(8),
    occu_tol: printed(8),
    oxidation_states: true,
    labels: true,
    charge_and_pbc: false,
    regroups_by_element: false,
    site_properties: () => ({}),
    unavailable_reason: fractional_export_unavailable_reason,
  },
  poscar: {
    ordered_only: true,
    lattice: `matrix`,
    lattice_tol: printed(8),
    coords: `abc`,
    coords_tol: printed(8),
    occu_tol: 0,
    oxidation_states: false,
    labels: false,
    charge_and_pbc: false,
    regroups_by_element: true,
    site_properties: (site) =>
      `selective_dynamics` in site.properties
        ? { selective_dynamics: site.properties.selective_dynamics }
        : {},
    unavailable_reason: poscar_export_unavailable_reason,
  },
}

// (fixture, format) pairs that lose information by design, with the reason
const KNOWN_LOSSES: Record<string, Partial<Record<StructTextFormat, string>>> = {
  // its H and O sit 0.007 Å apart, closer than the 0.05 Å within which parse_cif merges
  // rows into one (disordered) site, as no two real atoms are that close
  'scientific-notation.poscar': { cif: `merges two atoms 0.007 Å apart` },
}

// Fe2+ 0.5 / Fe3+ 0.5 share one site (one Fe to POSCAR/XYZ), Mn2.5+ prints a fractional charge
const mixed_valence = make_crystal(4, [
  { element: `Fe`, abc: [0, 0, 0], label: `Fe1` },
  { element: `Mn`, abc: [0.5, 0.5, 0.5], label: `Mn1`, oxidation_state: 2.5 },
])
mixed_valence.sites[0].species = [2, 3].map((oxidation_state) => ({
  element: `Fe`,
  occu: 0.5,
  oxidation_state,
}))

const FIXTURE_DIR = `src/site/structures`
const fixtures: { name: string; structure: AnyStructure }[] = [
  ...readdirSync(FIXTURE_DIR, { recursive: true, encoding: `utf8` })
    .filter((name) => statSync(`${FIXTURE_DIR}/${name}`).isFile())
    .toSorted()
    .map((name) => ({
      name,
      structure: parse_structure_file(
        read_maybe_gz(`${FIXTURE_DIR}/${name}`),
        name.replace(/\.gz$/, ``),
      ),
    })),
  { name: `simple_structure`, structure: simple_structure },
  { name: `complex_structure`, structure: complex_structure },
  { name: `molecule`, structure: { sites: simple_structure.sites } },
  { name: `mixed_valence`, structure: mixed_valence },
]
const formats = Object.keys(STRUCT_TEXT_FORMATS) as StructTextFormat[]
const cases = fixtures.flatMap((fixture) =>
  formats
    .filter((fmt) => !KNOWN_LOSSES[fixture.name]?.[fmt])
    .map((fmt) => ({ ...fixture, fmt })),
)

const has_lattice = (structure: AnyStructure) =>
  `lattice` in structure && structure.lattice ? structure.lattice : undefined
const is_disordered = ({ species }: Site): boolean =>
  new Set(species.map(({ element }) => element)).size > 1 ||
  species.reduce((sum, { occu }) => sum + occu, 0) < 1 - 1e-3
// Coordinate differences to the nearest periodic image, since readers wrap atoms into the
// cell (a molecule has none). xyz images shift by the original lattice, which the extXYZ
// cell may differ from by its print precision: 3 x 5e-9 Å per lattice vector, inside slack.
const coord_diffs = (site_a: Site, site_b: Site, cap: Capability, matrix?: Matrix3x3) => {
  if (cap.coords === `abc`)
    return site_a.abc.map((val, axis) => {
      const delta = site_b.abc[axis] - val
      return Math.abs(delta - Math.round(delta))
    })
  const delta = math.subtract(site_b.xyz, site_a.xyz)
  if (!matrix) return delta.map(Math.abs)
  const n_cells = math.create_cart_to_frac(matrix)(delta).map(Math.round) as Vec3
  const shift = math.create_frac_to_cart(matrix)(n_cells)
  return delta.map((val, axis) => Math.abs(val - shift[axis]))
}

// Site indices in the order the format writes them: POSCAR groups by element in
// first-appearance order (stable within a group)
const export_order = (sites: Site[], { regroups_by_element }: Capability): number[] => {
  const indices = sites.map((_site, idx) => idx)
  if (!regroups_by_element) return indices
  const elements = [...new Set(sites.map((site) => site.species[0]?.element))]
  const group = (idx: number) => elements.indexOf(sites[idx].species[0]?.element)
  return indices.toSorted((idx_a, idx_b) => group(idx_a) - group(idx_b))
}

describe(`structure I/O round-trip contract`, () => {
  test(`covers every fixture and format`, () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(45)
    expect(cases).toHaveLength(fixtures.length * formats.length - 1)
    // the extXYZ force column prints 6 decimals; no fixture exercises it (see export.test.ts)
    const has_force = ({ structure }: (typeof fixtures)[number]) =>
      structure.sites.some((site) => `force` in site.properties)
    expect(fixtures.filter(has_force)).toEqual([])
  })

  test.each(cases)(`$name -> $fmt`, ({ structure, fmt }) => {
    const cap = CAPABILITIES[fmt]
    const { to_str, ext } = STRUCT_TEXT_FORMATS[fmt]
    const lattice = has_lattice(structure)
    const disordered = structure.sites.some(is_disordered)

    // The eligibility reason the export pane shows predicts exactly what the exporter does
    const reason = cap.unavailable_reason(structure)
    const must_refuse =
      (cap.ordered_only && disordered) || (!lattice && fmt !== `json` && fmt !== `xyz`)
    expect(Boolean(reason), String(reason)).toBe(must_refuse)
    if (must_refuse) {
      expect(() => to_str(structure)).toThrow(reason)
      return
    }

    const reparsed = parse_structure_file(to_str(structure), `exported.${ext}`)
    // JSON keeps everything else verbatim (coordinates are compared below)
    const without_coords = ({ sites, ...rest }: AnyStructure) => ({
      ...rest,
      sites: sites.map(({ abc: _abc, xyz: _xyz, ...site }) => site),
    })
    if (fmt === `json`)
      expect(without_coords(reparsed)).toEqual(as_text(without_coords(structure)))

    // Lattice
    const new_lattice = has_lattice(reparsed)
    expect(Boolean(new_lattice)).toBe(Boolean(lattice))
    if (lattice && new_lattice) {
      if (cap.lattice === `matrix`) {
        const diffs = lattice.matrix
          .flat()
          .map((val, idx) => val - new_lattice.matrix.flat()[idx])
        expect(Math.max(...diffs.map(Math.abs))).toBeLessThanOrEqual(cap.lattice_tol)
      } else {
        for (const key of [`a`, `b`, `c`, `alpha`, `beta`, `gamma`] as const) {
          expect(Math.abs(new_lattice[key] - lattice[key]), key).toBeLessThanOrEqual(
            cap.lattice_tol,
          )
        }
      }
      expect(new_lattice.pbc).toEqual(cap.charge_and_pbc ? lattice.pbc : [true, true, true])
    }
    if (cap.charge_and_pbc) expect(reparsed.charge).toBe(structure.charge)

    // Sites, in the order the format writes them
    const order = export_order(structure.sites, cap)
    expect(reparsed.sites).toHaveLength(order.length)
    for (const [new_idx, orig_idx] of order.entries()) {
      const site = structure.sites[orig_idx]
      const new_site = reparsed.sites[new_idx]
      const where = `site ${orig_idx}`

      const diffs = coord_diffs(site, new_site, cap, lattice?.matrix)
      expect(Math.max(...diffs), where).toBeLessThanOrEqual(cap.coords_tol)

      // ordered-only formats write the element of a fully occupied site
      const species = cap.ordered_only
        ? [{ element: site.species[0].element, occu: 1, oxidation_state: 0 }]
        : site.species
      expect(
        new_site.species.map(({ element }) => element),
        where,
      ).toEqual(species.map(({ element }) => element))
      const occu_diffs = species.map(({ occu }, idx) =>
        Math.abs(occu - new_site.species[idx].occu),
      )
      expect(Math.max(...occu_diffs), where).toBeLessThanOrEqual(cap.occu_tol)
      expect(
        new_site.species.map(({ oxidation_state }) => oxidation_state),
        where,
      ).toEqual(
        species.map(({ oxidation_state }) => (cap.oxidation_states ? oxidation_state : 0)),
      )

      if (cap.labels) expect(new_site.label, where).toBe(site.label)
      expect(new_site.properties, where).toEqual(cap.site_properties(site, structure))
    }
  })
})
