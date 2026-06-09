// Build arity -> chemical-system hierarchy data for the Sunburst component
// (counterpart to pymatviz's chem_sys_sunburst).

// type-only import (erased at runtime, so no import cycle with $lib/plot)
import type { SunburstNode } from '$lib/plot/core/types'
import { is_elem_symbol } from '$lib/element'
import { parse_formula } from './parse'

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
  `nonary`,
  `denary`,
] as const

// || (not ??) so the empty index-0 placeholder also falls through to "0-ary"
export const arity_name = (arity: number): string => ARITY_NAMES[arity] || `${arity}-ary`

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
      if (!elements.every(is_elem_symbol)) return null
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
  const sorted = [...counts]
    .map(([chem_sys, count]) => ({ chem_sys, count, arity: chem_sys.split(`-`).length }))
    .sort((sys_a, sys_b) => sys_a.arity - sys_b.arity || sys_b.count - sys_a.count)
  const roots: SunburstNode<ChemSysSunburstMetadata>[] = []
  let branch: SunburstNode<ChemSysSunburstMetadata> | undefined
  for (const { chem_sys, count, arity } of sorted) {
    const name = arity_name(arity)
    if (branch?.id !== name) {
      branch = { id: name, label: name, children: [] }
      roots.push(branch)
    }
    branch.children?.push({
      id: `${name}/${chem_sys}`,
      label: chem_sys,
      value: count,
      metadata: { chem_sys, arity },
    })
  }
  return roots
}
