import { atomic_number_to_symbol, symbol_to_atomic_number } from '$lib/composition/parse'
import type { AnyStructure, PymatgenStructure } from '$lib/structure'
import type { MoyoCell, MoyoDataset } from 'moyo-wasm'
import init, { analyze_cell } from 'moyo-wasm'
import wasm_url from 'moyo-wasm/moyo_wasm_bg.wasm?url'

let initialized = false

export async function ensure_moyo_wasm_ready() {
  if (initialized) return
  await init(wasm_url)
  initialized = true
}

export function to_cell_json(structure: PymatgenStructure): string {
  // nalgebra Matrix3 deserializes as a flat list in COLUMN-MAJOR of the internal basis B
  // Internal B = transpose(row-basis RB). column-major(B) == row-major(RB).
  // So supply row-major of the pymatgen lattice.matrix (RB).
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = structure.lattice.matrix
  const basis: MoyoCell[`lattice`][`basis`] = [
    m00,
    m01,
    m02,
    m10,
    m11,
    m12,
    m20,
    m21,
    m22,
  ]
  const positions = structure.sites.map((s) => s.abc)
  const numbers = structure.sites.map(
    (s) => symbol_to_atomic_number[s.species[0]?.element] ?? 0,
  )
  const cell: MoyoCell = { lattice: { basis }, positions, numbers }
  return JSON.stringify(cell)
}

export async function analyze_structure_symmetry(
  struct_or_mol: AnyStructure,
  symprec = 1e-4,
  setting: `Standard` | `Spglib` = `Standard`,
): Promise<MoyoDataset> {
  await ensure_moyo_wasm_ready()
  if (!(`lattice` in struct_or_mol)) throw new Error(`No lattice on structure`)
  const cell_json = to_cell_json(struct_or_mol)
  return analyze_cell(cell_json, symprec, setting)
}

// Helper function to score coordinate simplicity for Wyckoff table
export function simplicity_score(vec: number[]): number {
  const to_unit = (v: number) => v - Math.floor(v)
  const near_zero = (v: number) => Math.min(v, 1 - v)
  const near_half = (v: number) => Math.abs(v - 0.5)
  const [ax, ay, az] = vec?.map(to_unit) ?? []
  return (
    near_zero(ax) + near_zero(ay) + near_zero(az) +
    0.5 * (near_half(ax) + near_half(ay) + near_half(az))
  )
}

// Generate Wyckoff table rows from symmetry data
export function generate_wyckoff_rows(
  sym_data: MoyoDataset | null,
): { wyckoff: string; elem: string; abc: number[] }[] {
  if (!sym_data) return []

  const { positions, numbers } = sym_data.std_cell
  const { wyckoffs } = sym_data

  // Count multiplicity per letter-element combination
  const letter_elem_counts: Record<string, number> = {}
  const best_by_key = new Map<
    string,
    { letter: string; elem: string; idx: number }
  >()

  // Process all sites, including those without Wyckoff letters
  wyckoffs.forEach((full, idx) => {
    const letter = (full?.match(/[a-z]+$/)?.[0] ?? full ?? ``).toString()
    const atomic_num = numbers[idx]
    const elem = atomic_number_to_symbol[atomic_num] ?? `?`

    if (letter) {
      // Symmetric site with Wyckoff letter
      const key = `${letter}|${elem}`
      letter_elem_counts[key] = (letter_elem_counts[key] ?? 0) + 1

      const prev = best_by_key.get(key)
      const better = !prev ||
        simplicity_score(positions[idx]) <
          simplicity_score(positions[prev.idx])
      if (better) best_by_key.set(key, { letter, elem, idx })
    } else {
      // Non-symmetric site (no Wyckoff letter) - add directly
      best_by_key.set(`nosym|${elem}|${idx}`, { letter: ``, elem, idx })
    }
  })

  const rows = Array.from(best_by_key.values()).map(({ letter, elem, idx }) => {
    if (letter) {
      // For symmetric sites, show multiplicity for this specific letter-element combination
      const key = `${letter}|${elem}`
      const wyckoff = `${letter_elem_counts[key]}${letter}`
      return { wyckoff, elem, abc: positions[idx] }
      // For non-symmetric sites, show multiplicity 1
    } else return { wyckoff: `1`, elem, abc: positions[idx] }
  })

  rows.sort((w1, w2) => {
    const [w1_mult, w2_mult] = [parseInt(w1.wyckoff), parseInt(w2.wyckoff)]
    if (w1_mult !== w2_mult) return w1_mult - w2_mult
    return w1.wyckoff.localeCompare(w2.wyckoff)
  })

  return rows
}
