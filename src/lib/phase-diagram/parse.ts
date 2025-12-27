// TDB (Thermodynamic Database) file parser
// Parses CALPHAD TDB files to extract metadata about elements, phases, and parameters

import { ELEM_SYMBOLS } from '$lib/labels'

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
  raw_content: string
}

export interface TdbParseResult {
  success: boolean
  data: TdbData | null
  error?: string
  // Derived properties for convenience
  binary_system?: [string, string]
  available_phases?: string[]
  temperature_range?: [number, number]
}

// Parse a TDB file content string
export function parse_tdb(content: string): TdbParseResult {
  try {
    const data: TdbData = {
      elements: [],
      phases: [],
      functions: [],
      parameters: [],
      comments: [],
      raw_content: content,
    }

    // Normalize line endings and join continuation lines
    const normalized = content
      .replace(/\r\n/g, `\n`)
      .replace(/\r/g, `\n`)
      // Join lines that don't end with ! (continuation)
      .split(`\n`)
      .reduce((acc: string[], line) => {
        const trimmed = line.trim()
        if (trimmed.startsWith(`$`)) {
          data.comments.push(trimmed.substring(1).trim())
          return acc
        }
        if (acc.length === 0 || acc[acc.length - 1].endsWith(`!`)) {
          acc.push(trimmed)
        } else {
          acc[acc.length - 1] += ` ` + trimmed
        }
        return acc
      }, [])
      .filter((line) => line.length > 0)

    for (const line of normalized) {
      parse_tdb_line(line, data)
    }

    // Derive binary system from elements (excluding VA)
    const real_elements = data.elements.map((el) => el.symbol).filter(is_real_element)

    const binary_system: [string, string] | undefined = real_elements.length === 2
      ? [real_elements[0], real_elements[1]]
      : undefined

    // Extract temperature range from functions/parameters
    // Find the actual min and max temperatures across all ranges
    let min_temp = Infinity
    let max_temp = -Infinity
    for (const func of data.functions) {
      for (const range of func.temperature_ranges) {
        if (range.min < min_temp) min_temp = range.min
        if (range.max > max_temp) max_temp = range.max
      }
    }

    // Use sensible defaults if no ranges found
    if (min_temp === Infinity) min_temp = 298.15
    if (max_temp === -Infinity) max_temp = 3000

    return {
      success: true,
      data,
      binary_system,
      available_phases: data.phases.map((phase) => phase.name),
      temperature_range: [min_temp, max_temp],
    }
  } catch (exc) {
    return {
      success: false,
      data: null,
      error: exc instanceof Error ? exc.message : String(exc),
    }
  }
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
    pattern: /ELEMENT\s+(\S+)\s+(\S+)\s+([\d.E+-]+)\s+([\d.E+-]+)\s+([\d.E+-]+)/i,
    handler: (match, data) => {
      data.elements.push({
        symbol: match[1].toUpperCase(),
        reference_phase: match[2],
        mass: parseFloat(match[3]),
        enthalpy: parseFloat(match[4]),
        entropy: parseFloat(match[5]),
      })
    },
  },
  {
    // PHASE LIQUID % 1 1.0 !
    prefix: `PHASE `,
    pattern: /PHASE\s+(\S+)\s+(%\S*)\s+(\d+)\s+(.+?)!/i,
    handler: (match, data) => {
      const sublattice_sites = match[4]
        .trim()
        .split(/\s+/)
        .map((val) => parseFloat(val))
        .filter((val) => !isNaN(val))
      data.phases.push({
        name: match[1],
        model_hints: match[2],
        sublattice_count: parseInt(match[3], 10),
        sublattice_sites,
      })
    },
  },
  {
    // CONSTITUENT FCC_A1 :AL,ZN : VA : !
    prefix: `CONSTITUENT `,
    pattern: /CONSTITUENT\s+(\S+)\s*:\s*(.+?)!/i,
    handler: (match, data) => {
      const phase_name = match[1]
      const constituents = match[2].split(`:`).map((sub) =>
        sub
          .split(`,`)
          .map((name) => name.trim())
          .filter((name) => name.length > 0)
      )
      const phase = data.phases.find(
        (phase) => phase.name.toUpperCase() === phase_name.toUpperCase(),
      )
      if (phase) phase.constituents = constituents
    },
  },
  {
    // FUNCTION GHSERAL 298.15 expr1; 700 Y expr2; 933.47 Y expr3; 2900 N !
    prefix: `FUNCTION `,
    pattern: /FUNCTION\s+(\S+)\s+(.+?)!/i,
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
    pattern: /PARAMETER\s+(\w+)\(([^)]+)\)\s+(.+?)!/i,
    handler: (match, data) => {
      const spec_match = match[2].match(/([^,]+),([^;]+);(\d+)/)
      if (spec_match) {
        data.parameters.push({
          type: match[1],
          phase: spec_match[1],
          constituents: spec_match[2].split(`,`).map((name) => name.trim()),
          order: parseInt(spec_match[3], 10),
          expression: match[3],
        })
      }
    },
  },
]

// Parse temperature ranges from FUNCTION body string
function parse_temperature_ranges(
  body: string,
): { min: number; max: number; expr: string }[] {
  const ranges: { min: number; max: number; expr: string }[] = []
  for (const segment of body.split(/;\s*/)) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    const temp_match = trimmed.match(/^([\d.E+-]+)\s+(.+)/i)
    if (temp_match) {
      const next_temp = parseFloat(temp_match[1])
      const expr = temp_match[2].replace(/\s+[YN]\s*$/, ``).trim()
      if (ranges.length > 0) ranges[ranges.length - 1].max = next_temp
      ranges.push({ min: next_temp, max: 6000, expr })
    }
  }
  return ranges
}

function parse_tdb_line(line: string, data: TdbData): void {
  const upper_line = line.toUpperCase()

  for (const parser of LINE_PARSERS) {
    if (upper_line.startsWith(parser.prefix)) {
      const match = line.match(parser.pattern)
      if (match) parser.handler(match, data)
      else if (parser.prefix === `ELEMENT `) {
        // Fallback for simpler ELEMENT format: ELEMENT AL FCC_A1!
        const simple_match = line.match(/ELEMENT\s+(\S+)\s+(\S+)/i)
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
export function get_system_name(elements: string[]): string {
  return elements.filter(is_real_element).map((el) => el.toUpperCase()).sort().join(`-`)
}

// Check if a TDB file represents a binary system
export function is_binary_system(tdb_data: TdbData): boolean {
  return tdb_data.elements.map((el) => el.symbol).filter(is_real_element).length === 2
}

// Predicate to filter out non-real elements (VA = vacancy, /- = electron)
const is_real_element = (sym: string) => sym !== `VA` && sym !== `/-`

// Known element symbols for parsing concatenated system names (e.g., "CuMg" -> ["CU", "MG"])
const KNOWN_ELEMENTS = new Set(ELEM_SYMBOLS.map((sym) => sym.toUpperCase()))

// Extract element symbols from a concatenated string (e.g., "CuMg" -> ["CU", "MG"])
// Returns null if the string doesn't fully match as element symbols
function extract_elements_from_string(input: string): string[] | null {
  const upper = input.toUpperCase()
  const elements: string[] = []
  let idx = 0

  while (idx < upper.length) {
    // Try two-letter symbol first (prefer longer match)
    if (idx + 1 < upper.length) {
      const two_letter = upper.slice(idx, idx + 2)
      if (KNOWN_ELEMENTS.has(two_letter)) {
        elements.push(two_letter)
        idx += 2
        continue
      }
    }
    // Try single-letter symbol
    const one_letter = upper[idx]
    if (KNOWN_ELEMENTS.has(one_letter)) {
      elements.push(one_letter)
      idx += 1
      continue
    }
    // Unknown character - string is not a valid element concatenation
    return null
  }

  // Only return elements if we parsed at least 2 (for a binary+ system)
  return elements.length >= 2 ? elements : null
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
  return elements.sort().join(`-`)
}
