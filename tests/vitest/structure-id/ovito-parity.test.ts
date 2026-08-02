// Numerical parity against OVITO 3.15.5, the reference implementation of both algorithms.
// generate_ovito_reference.py builds the fixtures, runs OVITO's own CommonNeighborAnalysisModifier
// (adaptive and fixed-cutoff) and CentroSymmetryModifier over them, and writes the coordinates
// alongside OVITO's per-atom output. Both implementations therefore see byte-identical positions,
// so any disagreement is an algorithm difference rather than a fixture difference.
import type { Matrix3x3, Vec3 } from '$lib/math'
import { calc_lattice_params } from '$lib/math'
import type { Crystal } from '$lib/structure'
import { calc_structure_id } from '$lib/structure-id'
import { make_site } from '$lib/structure/site'
import { describe, expect, test } from 'vitest'
import { load_json } from '../setup'

interface OvitoCase {
  label: string
  matrix: number[][]
  positions: number[][]
  fixed_cutoff: number | null
  n_csp_neighbors: number
  cna_adaptive: number[]
  cna_fixed?: number[]
  csp: number[]
}

type OvitoFixedCase = OvitoCase & { fixed_cutoff: number; cna_fixed: number[] }

const { ovito_version, cases } = load_json<{ ovito_version: string; cases: OvitoCase[] }>(
  `${import.meta.dirname}/ovito_reference.json.gz`,
)

const labeled_cases = cases.map((ovito_case) => [ovito_case.label, ovito_case] as const)
const fixed_cases = cases
  .filter(
    (ovito_case): ovito_case is OvitoFixedCase =>
      ovito_case.fixed_cutoff !== null && ovito_case.cna_fixed !== undefined,
  )
  .map((ovito_case) => [ovito_case.label, ovito_case] as const)

const to_crystal = ({ matrix, positions }: OvitoCase): Crystal => {
  const lattice_matrix = matrix as Matrix3x3
  return {
    sites: positions.map((xyz) =>
      // abc is unused by the analysis (it re-derives fractional coords from xyz), so the
      // Cartesian position is stored in both slots rather than inverting the cell here
      make_site(`Cu`, xyz as Vec3, xyz as Vec3, `Cu`),
    ),
    lattice: {
      matrix: lattice_matrix,
      pbc: [true, true, true],
      ...calc_lattice_params(lattice_matrix),
    },
  }
}

// Fraction of atoms whose code differs, plus the confusion pairs, so a failure says what moved
const compare_codes = (ours: Int8Array | null, theirs: number[]) => {
  if (!ours) throw new Error(`CNA was not computed`)
  if (ours.length !== theirs.length) {
    return [`length: ovito ${theirs.length} vs ours ${ours.length}`]
  }
  const mismatches: string[] = []
  for (const [idx, code] of theirs.entries()) {
    if (ours[idx] !== code) mismatches.push(`${idx}: ovito ${code} vs ours ${ours[idx]}`)
  }
  return mismatches
}

describe(`parity with OVITO ${ovito_version}`, () => {
  test.each(labeled_cases)(`%s: adaptive CNA matches atom for atom`, (_label, ovito_case) => {
    const result = calc_structure_id(to_crystal(ovito_case), { skip_csp: true })
    expect(compare_codes(result.cna_types, ovito_case.cna_adaptive)).toEqual([])
  })

  test.each(fixed_cases)(
    `%s: fixed-cutoff CNA matches atom for atom`,
    (_label, ovito_case) => {
      const { fixed_cutoff, cna_fixed } = ovito_case
      const result = calc_structure_id(to_crystal(ovito_case), {
        cna_mode: `fixed`,
        cutoff: fixed_cutoff,
        skip_csp: true,
      })
      expect(compare_codes(result.cna_types, cna_fixed)).toEqual([])
    },
  )

  test.each(labeled_cases)(`%s: centrosymmetry matches within 1e-12`, (label, ovito_case) => {
    const result = calc_structure_id(to_crystal(ovito_case), {
      skip_cna: true,
      n_csp_neighbors: ovito_case.n_csp_neighbors,
    })
    if (!result.centrosymmetry) throw new Error(`CSP was not computed`)
    expect(result.centrosymmetry).toHaveLength(ovito_case.csp.length)
    let max_abs_error = 0
    let max_rel_error = 0
    for (const [idx, reference] of ovito_case.csp.entries()) {
      const abs_error = Math.abs(result.centrosymmetry[idx] - reference)
      max_abs_error = Math.max(max_abs_error, abs_error)
      if (reference > 1e-6) max_rel_error = Math.max(max_rel_error, abs_error / reference)
    }
    console.info(
      `${label} CSP vs OVITO: max |a-b| = ${max_abs_error.toExponential(3)} Å², ` +
        `max relative = ${max_rel_error.toExponential(3)}`,
    )
    // Both sides are float64 over identical coordinates, so the only difference is the order
    // the six terms are accumulated in. Measured worst case across all fixtures is
    // 3.0e-14 Å² absolute and 1.5e-14 relative (~68 x f64 eps); two fixtures agree bit for
    // bit. The bounds below sit ~30x above that, tight enough that a genuine algorithm
    // change (a different pairing, a different neighbor set) could not slip through.
    expect(max_abs_error).toBeLessThan(1e-12)
    expect(max_rel_error).toBeLessThan(1e-12)
  })
})
