// Helpers around moyo's space-group database functions (new in moyo-wasm 0.11):
// - wyckoff_positions(hall_number): ALL Wyckoff positions of a space-group setting
//   (multiplicity, letter, site symmetry, representative coordinate triplet)
// - hall_symbol_entries_from_number(number): all settings (origin choices, unique
//   axes, cell choices) of an ITA space group
// Plus pure helpers to join that database against the occupied Wyckoff orbits of an
// analyzed structure (Wyckoff sequence, internal degrees of freedom, ITA coords).

import { superscript_digits } from '$lib/labels'
import type { MoyoHallSymbolEntry, MoyoWyckoffPosition } from '@spglib/moyo-wasm'
import { hall_symbol_entries_from_number, wyckoff_positions } from '@spglib/moyo-wasm'
// type-only import (erased at runtime, so no import cycle with ./index)
import type { WyckoffPos } from './index'

// All Wyckoff positions of the space-group setting given by hall_number (1-530),
// ordered general-position-first. moyo returns [] for out-of-range hall numbers.
// Returns [] when the moyo WASM module is not initialized (SSR, unit tests) — callers
// treat the database as an optional enrichment, never a hard requirement.
export function spacegroup_wyckoff_positions(hall_number: number): MoyoWyckoffPosition[] {
  try {
    return wyckoff_positions(hall_number)
  } catch {
    return []
  }
}

// All Hall-symbol entries (settings) of the ITA space group `spacegroup_number`
// (1-230), ordered by Hall number. Returns [] when the WASM module is not initialized.
export function spacegroup_settings(spacegroup_number: number): MoyoHallSymbolEntry[] {
  try {
    return hall_symbol_entries_from_number(spacegroup_number)
  } catch {
    return []
  }
}

// Wyckoff letter from a `4a`-style multiplicity+letter label. Uppercase `A` is moyo's
// encoding of ITA's 27th letter alpha (general position of Pmmm-like groups).
export const wyckoff_letter = (wyckoff: string): string =>
  /[a-zA-Z]+$/.exec(wyckoff)?.[0] ?? ``

// Number of free coordinate parameters in an ITA representative triplet: distinct
// x/y/z variables, e.g. `x,y,z` → 3, `1/4,1/4,z` → 1, `x,2x,1/2` → 1, `x,-x,z` → 2
export const count_free_params = (coordinates: string): number =>
  new Set(coordinates.match(/[xyz]/g)).size

// Attach the space-group database entry (ITA representative coordinates, site-symmetry
// fallback) to each occupied Wyckoff row, matched by letter. Rows whose letter has no
// database entry (or an empty database) pass through unchanged.
export function enrich_wyckoff_rows(
  rows: WyckoffPos[],
  db_positions: MoyoWyckoffPosition[],
): WyckoffPos[] {
  if (db_positions.length === 0) return rows
  const db_by_letter = new Map(db_positions.map((pos) => [pos.letter, pos]))
  return rows.map((row) => {
    const entry = db_by_letter.get(wyckoff_letter(row.wyckoff))
    if (!entry) return row
    return {
      ...row,
      coordinates: entry.coordinates,
      site_symmetry: row.site_symmetry ?? entry.site_symmetry,
    }
  })
}

// Rank `A` (ITA's alpha, the letter AFTER z) above all lowercase letters
const letter_rank = (letter: string): number => letter.charCodeAt(0) + (letter < `a` ? 64 : 0)

// Wyckoff sequence of the occupied orbits: letters in descending alphabetical order
// (general position first, ICSD convention), each with a superscript count when more
// than one orbit occupies that letter — e.g. cubic perovskite (Pm-3m): `c b a`.
export function wyckoff_sequence(rows: WyckoffPos[]): string {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const letter = wyckoff_letter(row.wyckoff)
    if (letter) counts.set(letter, (counts.get(letter) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([letter_1], [letter_2]) => letter_rank(letter_2) - letter_rank(letter_1))
    .map(([letter, count]) =>
      count > 1 ? `${letter}${superscript_digits(String(count))}` : letter,
    )
    .join(` `)
}

// Internal degrees of freedom of the structure: free fractional coordinates summed
// over occupied Wyckoff orbits. Requires every row to carry ITA coordinates (see
// enrich_wyckoff_rows); returns null for empty rows or when any row lacks coordinates
// so callers can hide the stat instead of showing a wrong number.
export function count_structure_free_params(rows: WyckoffPos[]): number | null {
  if (rows.length === 0) return null
  let total = 0
  for (const row of rows) {
    if (row.coordinates === undefined) return null
    total += count_free_params(row.coordinates)
  }
  return total
}
