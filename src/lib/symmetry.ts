import { symbol_to_atomic_number } from '$lib/composition/parse'
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
