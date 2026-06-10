import type { WyckoffPos } from '$lib/symmetry'
import {
  count_free_params,
  count_structure_free_params,
  enrich_wyckoff_rows,
  spacegroup_settings,
  spacegroup_wyckoff_positions,
  wyckoff_letter,
  wyckoff_sequence,
} from '$lib/symmetry'
import type { MoyoWyckoffPosition } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'

const make_row = (wyckoff: string, overrides: Partial<WyckoffPos> = {}): WyckoffPos => ({
  wyckoff,
  elem: `Na`,
  abc: [0, 0, 0],
  ...overrides,
})

const make_db_entry = (
  letter: string,
  coordinates: string,
  site_symmetry = `m-3m`,
  multiplicity = 1,
): MoyoWyckoffPosition => ({ multiplicity, letter, site_symmetry, coordinates })

describe(`wyckoff_letter`, () => {
  test.each([
    [`4a`, `a`],
    [`192h`, `h`],
    [`8A`, `A`], // moyo encodes ITA's 27th letter alpha as uppercase A (e.g. Pmmm)
    [`1`, ``],
    [``, ``],
  ])(`extracts letter from %j as %j`, (label, expected) => {
    expect(wyckoff_letter(label)).toBe(expected)
  })
})

describe(`count_free_params`, () => {
  test.each([
    [`x,y,z`, 3],
    [`0,0,0`, 0],
    [`1/4,1/4,1/2`, 0],
    [`1/4,1/4,z`, 1],
    [`x,2x,1/2`, 1], // repeated variable counts once
    [`x,-x,z`, 2],
    [`x,x,x`, 1],
    [`-y,x-y,2/3`, 2], // hexagonal-style triplet
  ])(`%j has %i free parameters`, (coordinates, expected) => {
    expect(count_free_params(coordinates)).toBe(expected)
  })
})

describe(`wyckoff_sequence`, () => {
  test.each<[string, string[], string]>([
    [`perovskite Pm-3m`, [`1a`, `1b`, `3c`], `c b a`],
    [`repeated letters get superscript counts`, [`8c`, `8c`, `4a`], `c² a`],
    [`descending letter order regardless of input order`, [`4e`, `2a`, `4e`, `8j`], `j e² a`],
    [`single orbit`, [`4a`], `a`],
    [`empty`, [], ``],
    [`double-digit counts`, Array.from({ length: 12 }, () => `2e`), `e¹²`],
    // alpha (A) is the letter AFTER z, so the general position still comes first
    [`Pmmm-style alpha general position`, [`1a`, `8A`, `2z`], `A z a`],
  ])(`%s`, (_desc, labels, expected) => {
    expect(wyckoff_sequence(labels.map((label) => make_row(label)))).toBe(expected)
  })

  test(`ignores rows without a letter`, () => {
    expect(wyckoff_sequence([make_row(`4`), make_row(`1a`)])).toBe(`a`)
  })
})

describe(`enrich_wyckoff_rows`, () => {
  const db = [make_db_entry(`a`, `0,0,0`, `m-3m`, 1), make_db_entry(`c`, `x,1/4,0`, `mm2`, 4)]

  test(`attaches ITA coordinates and site symmetry by letter`, () => {
    const rows = enrich_wyckoff_rows([make_row(`1a`), make_row(`4c`)], db)
    expect(rows[0].coordinates).toBe(`0,0,0`)
    expect(rows[0].site_symmetry).toBe(`m-3m`)
    expect(rows[1].coordinates).toBe(`x,1/4,0`)
    expect(rows[1].site_symmetry).toBe(`mm2`)
  })

  test(`keeps moyo-provided site symmetry over database fallback`, () => {
    const rows = enrich_wyckoff_rows([make_row(`1a`, { site_symmetry: `-43m` })], db)
    expect(rows[0].site_symmetry).toBe(`-43m`)
    expect(rows[0].coordinates).toBe(`0,0,0`)
  })

  test(`matches alpha (uppercase A) general positions`, () => {
    const alpha_db = [make_db_entry(`A`, `x,y,z`, `1`, 8)]
    const rows = enrich_wyckoff_rows([make_row(`8A`)], alpha_db)
    expect(rows[0].coordinates).toBe(`x,y,z`)
  })

  test.each<[string, WyckoffPos[], MoyoWyckoffPosition[]]>([
    [`empty database`, [make_row(`1a`)], []],
    [`letter missing from database`, [make_row(`2d`)], db],
  ])(`passes rows through unchanged with %s`, (_desc, rows, db_positions) => {
    const enriched = enrich_wyckoff_rows(rows, db_positions)
    expect(enriched).toEqual(rows)
    expect(enriched.every((row) => row.coordinates === undefined)).toBe(true)
  })
})

describe(`count_structure_free_params`, () => {
  test.each<[string, (string | undefined)[], number | null]>([
    [`all fixed`, [`0,0,0`, `1/2,1/2,1/2`], 0],
    [`mixed orbits sum per-orbit free params`, [`x,y,z`, `1/4,1/4,z`, `0,0,0`], 4],
    [`any row missing coordinates yields null`, [`x,y,z`, undefined], null],
    [`empty rows yield null (no orbit info, not 0 DOF)`, [], null],
  ])(`%s`, (_desc, coords, expected) => {
    const rows = coords.map((coordinates, idx) =>
      make_row(`${idx + 1}a`, coordinates !== undefined ? { coordinates } : {}),
    )
    expect(count_structure_free_params(rows)).toBe(expected)
  })
})

describe(`wasm database wrappers without initialized module`, () => {
  // In happy-dom unit tests the moyo WASM module is never initialized, so the
  // wrappers must degrade to empty results instead of throwing
  test.each([
    [`spacegroup_wyckoff_positions`, () => spacegroup_wyckoff_positions(523)],
    [`spacegroup_settings`, () => spacegroup_settings(225)],
  ])(`%s returns [] when WASM is not ready`, (_name, getter) => {
    expect(getter()).toEqual([])
  })
})
