// TDB (Thermodynamic Database) file parser
// Parses CALPHAD TDB files to extract metadata about elements, phases, and parameters

import { ELEM_SYMBOLS } from '$lib/labels'
import type { Vec2 } from '$lib/math'

// Default temperature bounds for TDB parsing (in Kelvin)
const TDB_TEMP_DEFAULTS = {
  min: 298.15, // Room temperature
  max_fallback: 3000, // Fallback when no functions define ranges
  max_range: 5000, // Default max for temperature ranges in FUNCTION bodies
} as const

export interface TdbElement {
  symbol: string
  reference_phase: string
  mass: number
  enthalpy: number
  entropy: number
}

export interface TdbPhase {
  name: string
  model_hints: string
  sublattice_count: number
  sublattice_sites: number[]
  constituents?: string[][]
}

export interface TdbFunction {
  name: string
  expression: string
  temperature_ranges: { min: number; max: number; expr: string }[]
}

export interface TdbParameter {
  type: string
  phase: string
  constituents: string[]
  order: number
  expression: string
}

export interface TdbData {
  elements: TdbElement[]
  phases: TdbPhase[]
  functions: TdbFunction[]
  parameters: TdbParameter[]
  comments: string[]
}

export interface TdbParseResult {
  data: TdbData
  // Set when exactly two real (non-VA, non-electron) elements are declared
  binary_system?: [string, string]
  // [min, max] in K over all FUNCTION temperature ranges, with defaults when none are given
  temperature_range: Vec2
}

// Parse a TDB file content string. Throws when the content holds no TDB statements at all
// (ELEMENT/PHASE/FUNCTION/PARAMETER), since an "empty database" is always a wrong file.
export function parse_tdb(content: string): TdbParseResult {
  const data: TdbData = {
    elements: [],
    phases: [],
    functions: [],
    parameters: [],
    comments: [],
  }

  // Statements end with `!` and may span lines; `$` lines are comments. Blank lines are
  // dropped before joining (a blank entry would otherwise swallow the next statement into
  // `" ELEMENT ..."`, which no keyword dispatch matches).
  const statements = content.split(/\r\n|\r|\n/).reduce((acc: string[], line) => {
    const trimmed = line.trim()
    if (!trimmed) return acc
    if (trimmed.startsWith(`$`)) {
      data.comments.push(trimmed.slice(1).trim())
      return acc
    }
    if (acc.length === 0 || acc[acc.length - 1].endsWith(`!`)) acc.push(trimmed)
    else acc[acc.length - 1] += ` ${trimmed}`
    return acc
  }, [])

  for (const line of statements) parse_tdb_line(line, data)

  const { elements, phases, functions, parameters } = data
  if ([elements, phases, functions, parameters].every((items) => items.length === 0)) {
    throw new Error(
      `Not a TDB file: no ELEMENT, PHASE, FUNCTION or PARAMETER statements in ${content.length} chars`,
    )
  }

  // Derive binary system from elements (excluding VA)
  const real_elements = elements.map((el) => el.symbol).filter(is_real_element)
  const binary_system: [string, string] | undefined =
    real_elements.length === 2 ? [real_elements[0], real_elements[1]] : undefined

  // Temperature range: min and max across all FUNCTION ranges (each range has max > min,
  // so the pair can't invert); defaults when no function declares one
  const ranges = functions.flatMap((func) => func.temperature_ranges)
  const temperature_range: Vec2 =
    ranges.length > 0
      ? [Math.min(...ranges.map((rng) => rng.min)), Math.max(...ranges.map((rng) => rng.max))]
      : [TDB_TEMP_DEFAULTS.min, TDB_TEMP_DEFAULTS.max_fallback]

  return { data, binary_system, temperature_range }
}

// Parser configuration for TDB line handlers
// Each parser has a keyword prefix, regex pattern, and transform function
interface LineParser {
  prefix: string
  pattern: RegExp
  handler: (match: RegExpMatchArray, data: TdbData) => void
}

// Line parsers for TDB format - uses a data-driven approach to reduce repetition
const LINE_PARSERS: LineParser[] = [
  {
    // ELEMENT AL FCC_A1 2.698154E-02 4.5773304E+03 2.871870E+01!
    prefix: `ELEMENT `,
    pattern:
      /ELEMENT\s+(?<symbol>\S+)\s+(?<reference_phase>\S+)\s+(?<mass>[\d.E+-]+)\s+(?<enthalpy>[\d.E+-]+)\s+(?<entropy>[\d.E+-]+)/i,
    handler: (match, data) => {
      data.elements.push({
        symbol: match[1].toUpperCase(),
        reference_phase: match[2],
        mass: Number(match[3]),
        enthalpy: Number(match[4]),
        entropy: Number(match[5]),
      })
    },
  },
  {
    // PHASE LIQUID % 1 1.0 !
    prefix: `PHASE `,
    pattern: /PHASE\s+(?<name>\S+)\s+(?<model_hints>%\S*)\s+(?<count>\d+)\s+(?<sites>.+?)!/i,
    handler: (match, data) => {
      const sublattice_sites = match[4]
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((val) => !isNaN(val))
      data.phases.push({
        name: match[1],
        model_hints: match[2],
        sublattice_count: Math.trunc(Number(match[3])),
        sublattice_sites,
      })
    },
  },
  {
    // CONSTITUENT FCC_A1 :AL,ZN : VA : !
    prefix: `CONSTITUENT `,
    pattern: /CONSTITUENT\s+(?<phase_name>\S+)\s*:\s*(?<constituents>.+?)!/i,
    handler: (match, data) => {
      const phase_name = match[1]
      // `:AL,ZN : VA : !` -> [[AL, ZN], [VA]]; the trailing `:` terminates the last
      // sublattice rather than opening an empty one
      const constituents = match[2]
        .split(`:`)
        .map((sub) =>
          sub
            .split(`,`)
            .map((name) => name.trim())
            .filter((name) => name.length > 0),
        )
        .filter((sublattice) => sublattice.length > 0)
      const matched_phase = data.phases.find(
        (candidate_phase) => candidate_phase.name.toUpperCase() === phase_name.toUpperCase(),
      )
      if (matched_phase) matched_phase.constituents = constituents
    },
  },
  {
    // FUNCTION GHSERAL 298.15 expr1; 700 Y expr2; 933.47 Y expr3; 2900 N !
    prefix: `FUNCTION `,
    pattern: /FUNCTION\s+(?<name>\S+)\s+(?<body>.+?)!/i,
    handler: (match, data) => {
      const ranges = parse_temperature_ranges(match[2])
      if (ranges.length > 0) {
        data.functions.push({
          name: match[1],
          expression: match[2],
          temperature_ranges: ranges,
        })
      }
    },
  },
  {
    // PARAMETER G(LIQUID,AL;0) 298.15 +GHSERAL+11005.029-11.841867*T; 6000 N !
    prefix: `PARAMETER `,
    pattern: /PARAMETER\s+(?<type>\w+)\((?<spec>[^)]+)\)\s+(?<expression>.+?)!/i,
    handler: (match, data) => {
      const spec_match = /(?<phase>[^,]+),(?<constituents>[^;]+);(?<order>\d+)/.exec(match[2])
      if (spec_match) {
        data.parameters.push({
          type: match[1],
          phase: spec_match[1],
          constituents: spec_match[2].split(`,`).map((name) => name.trim()),
          order: Math.trunc(Number(spec_match[3])),
          expression: match[3],
        })
      }
    },
  },
]

// Parse temperature ranges from a FUNCTION body: `T_lo expr_1; T_1 Y expr_2; ...; T_hi N`.
// Each `; T Y` closes the previous range at T and opens the next one; `; T N` closes the
// last range at T and ends the function. A body without a final `N` leaves the last range
// open to TDB_TEMP_DEFAULTS.max_range.
function parse_temperature_ranges(body: string): TdbFunction[`temperature_ranges`] {
  const ranges: TdbFunction[`temperature_ranges`] = []
  for (const segment of body.split(`;`)) {
    const temp_match = /^\s*(?<temp>[\d.E+-]+)\s*(?<flag>\b[YN]\b)?\s*(?<expr>.*)$/is.exec(
      segment,
    )
    if (!temp_match?.groups) continue
    const { temp, flag, expr } = temp_match.groups
    const breakpoint = Number(temp)
    if (!Number.isFinite(breakpoint)) continue
    if (ranges.length > 0) ranges[ranges.length - 1].max = breakpoint
    if (flag?.toUpperCase() === `N`) break
    ranges.push({ min: breakpoint, max: TDB_TEMP_DEFAULTS.max_range, expr: expr.trim() })
  }
  // Filter out invalid ranges where max <= min (malformed data)
  return ranges.filter((range) => range.max > range.min)
}

function parse_tdb_line(line: string, data: TdbData): void {
  const upper_line = line.toUpperCase()

  for (const parser of LINE_PARSERS) {
    if (upper_line.startsWith(parser.prefix)) {
      const match = line.match(parser.pattern)
      if (match) parser.handler(match, data)
      else if (parser.prefix === `ELEMENT `) {
        // Fallback for simpler ELEMENT format: ELEMENT AL FCC_A1!
        const simple_match = /ELEMENT\s+(?<symbol>\S+)\s+(?<reference_phase>\S+)/i.exec(line)
        if (simple_match) {
          data.elements.push({
            symbol: simple_match[1].toUpperCase(),
            reference_phase: simple_match[2].replace(/!$/, ``),
            mass: 0,
            enthalpy: 0,
            entropy: 0,
          })
        }
      }
      return
    }
  }
  // TYPE_DEFINITION, DEFINE_SYSTEM_DEFAULT, etc. are ignored
}

// Get a normalized system name from elements (e.g., "AL-ZN" always alphabetically sorted)
export const get_system_name = (elements: string[]): string =>
  elements
    .filter(is_real_element)
    .map((el) => el.toUpperCase())
    .toSorted()
    .join(`-`)

// Check if a TDB file represents a binary system
export const is_binary_system = (tdb_data: TdbData): boolean =>
  tdb_data.elements.map((el) => el.symbol).filter(is_real_element).length === 2

// Predicate to filter out non-real elements (VA = vacancy, /- = electron)
const is_real_element = (sym: string) => sym !== `VA` && sym !== `/-`

// Known element symbols for parsing concatenated system names (e.g., "CuMg" -> ["CU", "MG"])
const KNOWN_ELEMENTS = new Set(ELEM_SYMBOLS.map((sym) => sym.toUpperCase()))

// Extract element symbols from a concatenated string (e.g., "CuMg" -> ["CU", "MG"])
// Returns null if the string doesn't fully match as element symbols
// Uses backtracking to handle ambiguous cases (e.g., "NBR" -> ["N", "BR"] not ["NB", ?])
function extract_elements_from_string(input: string): string[] | null {
  const upper = input.toUpperCase()

  function parse(idx: number): string[] | null {
    if (idx >= upper.length) return []

    // Try two-letter symbol first (prefer longer match)
    if (idx + 1 < upper.length) {
      const two_letter = upper.slice(idx, idx + 2)
      if (KNOWN_ELEMENTS.has(two_letter)) {
        const rest = parse(idx + 2)
        if (rest !== null) return [two_letter, ...rest]
      }
    }

    // Try single-letter symbol (backtrack if two-letter path failed)
    const one_letter = upper[idx]
    if (KNOWN_ELEMENTS.has(one_letter)) {
      const rest = parse(idx + 1)
      if (rest !== null) return [one_letter, ...rest]
    }

    return null
  }

  const elements = parse(0)
  return elements && elements.length >= 2 ? elements : null
}

// Normalize a system name string to canonical form (e.g., "cumg", "Cu-Mg", "CU_MG" -> "CU-MG")
export function normalize_system_name(input: string): string {
  if (!input) return ``

  // First try splitting on common delimiters
  const delimiter_parts = input.split(/[-_]/).filter(Boolean)

  let elements: string[]
  if (delimiter_parts.length >= 2) {
    // Has delimiter, normalize each part
    elements = delimiter_parts.map((part) => part.toUpperCase())
  } else {
    // No delimiter, try to parse concatenated symbols
    const parsed = extract_elements_from_string(input)
    if (!parsed) {
      // Couldn't parse as elements, return uppercased input as-is
      return input.toUpperCase()
    }
    elements = parsed
  }

  // Sort alphabetically and join with hyphen
  return elements.toSorted().join(`-`)
}
