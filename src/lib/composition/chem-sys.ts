// Build arity -> chemical-system hierarchy data for the Sunburst component
// (counterpart to pymatviz's chem_sys_sunburst).

// type-only import (erased at runtime, so no import cycle with $lib/plot)
import type { SunburstNode } from '$lib/plot/core/types'
import { is_valid_element, parse_formula } from './parse'

export interface ChemSysSunburstMetadata {
  chem_sys: string // alphabetically sorted element string, e.g. "Fe-Li-O"
  arity: number // number of distinct elements
  [key: string]: unknown // assignable to SunburstNode's default Record<string, unknown>
}

const ARITY_NAMES = [
  ``,
  `unary`,
  `binary`,
  `ternary`,
  `quaternary`,
  `quinary`,
  `senary`,
  `septenary`,
  `octonary`,
] as const

export const arity_name = (arity: number): string => ARITY_NAMES[arity] ?? `${arity}-ary`

// Build arity -> chemical-system sunburst data from a list of chemical systems
// ("Li-Fe-O") and/or formulas ("LiFePO4"), one entry per occurrence (counts become
// leaf values). Systems are normalized to alphabetical element order, so "O-Li" and
// "Li2O" both count toward "Li-O". Ids follow the "<arity>/<system>" scheme.
export function chem_sys_sunburst_data(
  entries: readonly string[],
): SunburstNode<ChemSysSunburstMetadata>[] {
  // Inputs are one entry per occurrence, so the same formula typically repeats many
  // times - memoize raw entry -> normalized system (null = invalid) to parse each
  // distinct string only once
  const normalized = new Map<string, string | null>()
  const normalize = (entry: string): string | null => {
    let elements: string[]
    if (entry.includes(`-`)) {
      elements = entry.split(`-`).map((el) => el.trim())
      if (!elements.every(is_valid_element)) return null
    } else {
      try {
        elements = Object.keys(parse_formula(entry))
      } catch {
        return null
      }
    }
    if (elements.length === 0) return null
    return [...new Set(elements)].sort().join(`-`)
  }

  const counts = new Map<string, number>()
  let n_invalid = 0
  for (const entry of entries) {
    let chem_sys = normalized.get(entry)
    if (chem_sys === undefined) {
      chem_sys = normalize(entry)
      normalized.set(entry, chem_sys)
    }
    if (chem_sys === null) {
      n_invalid += 1
      continue
    }
    counts.set(chem_sys, (counts.get(chem_sys) ?? 0) + 1)
  }
  if (n_invalid > 0) {
    console.warn(
      `chem_sys_sunburst_data: skipped ${n_invalid} invalid entr${
        n_invalid === 1 ? `y` : `ies`
      } (expected chemical systems like "Li-Fe-O" or formulas like "LiFePO4")`,
    )
  }

  // One composite sort (arity ascending, then count descending) puts systems in
  // final order; consecutive same-arity runs then collapse into one branch each
  const sorted = [...counts].sort(
    ([sys_a, count_a], [sys_b, count_b]) =>
      sys_a.split(`-`).length - sys_b.split(`-`).length || count_b - count_a,
  )
  const roots: SunburstNode<ChemSysSunburstMetadata>[] = []
  for (const [chem_sys, count] of sorted) {
    const arity = chem_sys.split(`-`).length
    const name = arity_name(arity)
    if (roots.at(-1)?.id !== name) roots.push({ id: name, label: name, children: [] })
    roots.at(-1)?.children?.push({
      id: `${name}/${chem_sys}`,
      label: chem_sys,
      value: count,
      metadata: { chem_sys, arity },
    })
  }
  return roots
}
