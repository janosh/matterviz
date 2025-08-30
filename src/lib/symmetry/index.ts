import type { Vec3 } from '$lib'
import { atomic_number_to_symbol, symbol_to_atomic_number } from '$lib/composition/parse'
import type { AnyStructure, PymatgenStructure } from '$lib/structure'
import type { MoyoCell, MoyoDataset } from '@spglib/moyo-wasm'
import init, { analyze_cell } from '@spglib/moyo-wasm'
import moyo_wasm_url from '@spglib/moyo-wasm/moyo_wasm_bg.wasm?url'

export { default as WyckoffTable } from './WyckoffTable.svelte'

export type WyckoffPos = {
  wyckoff: string
  elem: string
  abc: Vec3
  site_indices?: number[]
}

let initialized = false

export async function ensure_moyo_wasm_ready() {
  if (initialized) return
  await init({ module_or_path: moyo_wasm_url })
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
  const numbers = structure.sites.map((site, idx) => {
    const sym = site.species?.[0]?.element
    const num = sym !== null ? symbol_to_atomic_number[sym] : undefined
    if (typeof num !== `number`) {
      throw new Error(`Unknown element at site ${idx}: ${String(sym)}`)
    }
    return num
  })
  const cell: MoyoCell = { lattice: { basis }, positions, numbers }
  return JSON.stringify(cell)
}

export async function analyze_structure_symmetry(
  struct_or_mol: AnyStructure,
  symprec = 1e-4,
  setting: `Standard` | `Spglib` = `Standard`,
): Promise<MoyoDataset> {
  await ensure_moyo_wasm_ready()
  if (!(`lattice` in struct_or_mol)) {
    throw new Error(`Symmetry analysis requires a periodic structure with a lattice`)
  }
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
export function wyckoff_positions_from_moyo(
  sym_data: (MoyoDataset & { original_indices?: number[] }) | null,
): WyckoffPos[] {
  if (!sym_data) return []

  const { positions, numbers } = sym_data.std_cell
  const { wyckoffs, original_indices } = sym_data

  // Group sites by letter-element combination and track all indices
  const groups = new Map<string, {
    letter: string
    elem: string
    indices: number[]
    positions: Vec3[]
  }>()

  // Process all sites, including those without Wyckoff letters
  wyckoffs.forEach((full, idx) => {
    const letter = (full?.match(/[a-z]+$/)?.[0] ?? full ?? ``).toString()
    const atomic_num = numbers[idx]
    const elem = atomic_number_to_symbol[atomic_num] ?? `?`
    const position = positions[idx]

    if (letter) {
      // Symmetric site with Wyckoff letter
      const key = `${letter}|${elem}`
      if (!groups.has(key)) {
        groups.set(key, { letter, elem, indices: [], positions: [] })
      }
      const group = groups.get(key)
      if (group) {
        group.indices.push(idx)
        group.positions.push(position)
      }
    } else {
      // Non-symmetric site (no Wyckoff letter) - each gets its own group
      const key = `nosym|${elem}|${idx}`
      groups.set(key, { letter: ``, elem, indices: [idx], positions: [position] })
    }
  })

  const rows = Array.from(groups.values()).map(({ letter, elem, indices, positions }) => {
    // Find the position with the best simplicity score to display
    let best_pos = positions[0]
    let best_score = simplicity_score(best_pos)

    for (const pos of positions) {
      const score = simplicity_score(pos)
      if (score < best_score) {
        best_score = score
        best_pos = pos
      }
    }

    // Map standardized cell indices back to original structure indices
    const orig_site_indices = original_indices
      ? indices.map((i) => original_indices[i]).filter((i) => i !== undefined)
      : indices

    if (letter) {
      // For symmetric sites, show multiplicity
      const wyckoff = `${indices.length}${letter}`
      return { wyckoff, elem, abc: best_pos, site_indices: orig_site_indices }
    } else {
      // For non-symmetric sites, show multiplicity 1
      return { wyckoff: `1`, elem, abc: best_pos, site_indices: orig_site_indices }
    }
  })

  rows.sort((w1, w2) => {
    const [w1_mult, w2_mult] = [parseInt(w1.wyckoff), parseInt(w2.wyckoff)]
    if (w1_mult !== w2_mult) return w1_mult - w2_mult
    return w1.wyckoff.localeCompare(w2.wyckoff)
  })

  return rows
}
