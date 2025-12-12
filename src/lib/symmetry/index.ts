import { ATOMIC_NUMBER_TO_SYMBOL, SYMBOL_TO_ATOMIC_NUMBER } from '$lib/composition/parse'
import type { Vec3 } from '$lib/math'
import { DEFAULTS } from '$lib/settings'
import type { AnyStructure, PymatgenStructure } from '$lib/structure'
import type { MoyoCell, MoyoDataset } from '@spglib/moyo-wasm'
import init, { analyze_cell } from '@spglib/moyo-wasm'
import moyo_wasm_url from '@spglib/moyo-wasm/moyo_wasm_bg.wasm?url'

export * from './cell-transform'
export * from './spacegroups'
export { default as SymmetryStats } from './SymmetryStats.svelte'
export { default as WyckoffTable } from './WyckoffTable.svelte'

// Keys are standard crystallographic symbols (P, I, F, A, B, C, R)
export const BRAVAIS_LATTICES = {
  P: `Primitive`,
  I: `Body-centered`,
  F: `Face-centered`,
  A: `A-face centered`,
  B: `B-face centered`,
  C: `C-face centered`,
  R: `Rhombohedral`,
} as const

export type BravaisLattice = (typeof BRAVAIS_LATTICES)[keyof typeof BRAVAIS_LATTICES]

export type SymmetrySettings = {
  symprec: number
  algo: `Moyo` | `Spglib`
}
export const default_sym_settings = {
  symprec: DEFAULTS.symmetry.symprec,
  algo: DEFAULTS.symmetry.algo,
} as const satisfies SymmetrySettings

export type WyckoffPos = {
  wyckoff: string
  elem: string
  abc: Vec3
  site_indices?: number[]
}

let initialized = false

export async function ensure_moyo_wasm_ready(wasm_url?: string) {
  if (initialized) return

  // Use provided URL (e.g., from VSCode webview data), otherwise use Vite-bundled URL
  const url = wasm_url ?? moyo_wasm_url

  await init({ module_or_path: url })
  initialized = true
}

export function to_cell_json(structure: PymatgenStructure): string {
  // nalgebra Matrix3 deserializes as a flat list in COLUMN-MAJOR of the internal basis B
  // Internal B = transpose(row-basis RB). column-major(B) == row-major(RB).
  // So supply row-major of the pymatgen lattice.matrix (RB).
  const [v_a, v_b, v_c] = structure.lattice.matrix
  const basis: MoyoCell[`lattice`][`basis`] = [...v_a, ...v_b, ...v_c]
  const positions = structure.sites.map((site) => site.abc)
  const numbers = structure.sites.map((site, idx) => {
    const sym = site.species?.[0]?.element
    const num = sym !== null ? SYMBOL_TO_ATOMIC_NUMBER[sym] : undefined
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
  settings: Partial<SymmetrySettings>,
): Promise<MoyoDataset> {
  await ensure_moyo_wasm_ready()
  if (!(`lattice` in struct_or_mol)) {
    throw new Error(`Symmetry analysis requires a periodic structure with a lattice`)
  }
  const cell_json = to_cell_json(struct_or_mol)
  const { symprec, algo } = { ...default_sym_settings, ...settings }
  // Map "Moyo" to "Standard" for moyo-wasm
  const moyo_algo = algo === `Moyo` ? `Standard` : algo
  return analyze_cell(cell_json, symprec, moyo_algo)
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
  sym_data: (MoyoDataset & { orig_indices?: number[] }) | null,
): WyckoffPos[] {
  if (!sym_data) return []

  const { positions, numbers } = sym_data.std_cell
  const { wyckoffs, orig_indices } = sym_data

  // Group sites by letter-element combination and track all indices
  const groups = new Map<string, {
    letter: string
    elem: string
    indices: number[]
    positions: Vec3[]
  }>()

  // Process all sites, including those without Wyckoff letters
  for (const [idx, full] of wyckoffs.entries()) {
    const letter = (full?.match(/[a-z]+$/)?.[0] ?? full ?? ``).toString()
    const atomic_num = numbers[idx]
    const elem = ATOMIC_NUMBER_TO_SYMBOL[atomic_num] ?? `?`
    const position = positions[idx]

    const key = letter ? `${letter}|${elem}` : `nosym|${elem}|${idx}`
    const group = groups.get(key) ?? { letter, elem, indices: [], positions: [] }
    group.indices.push(idx)
    group.positions.push(position)
    groups.set(key, group)
  }

  const rows = Array.from(groups.values()).map(({ letter, elem, indices, positions }) => {
    // Find the position with the best simplicity score to display
    const best_pos = positions.reduce((best, pos) => {
      const score = simplicity_score(pos)
      return score < best.score ? { pos, score } : best
    }, { pos: positions[0], score: simplicity_score(positions[0]) }).pos

    // Map standardized cell indices back to original structure indices
    const orig_site_indices = orig_indices
      ? indices.map((i) => orig_indices[i]).filter((idx) => idx !== undefined)
      : indices

    const wyckoff = letter ? `${indices.length}${letter}` : `1`
    return { wyckoff, elem, abc: best_pos, site_indices: orig_site_indices }
  })

  rows.sort((w1, w2) => {
    const [w1_mult, w2_mult] = [parseInt(w1.wyckoff), parseInt(w2.wyckoff)]
    if (w1_mult !== w2_mult) return w1_mult - w2_mult
    return w1.wyckoff.localeCompare(w2.wyckoff)
  })

  return rows
}

// Apply symmetry operations to find all equivalent positions for a given fractional coordinate
export function apply_symmetry_operations(
  position: Vec3,
  operations: MoyoDataset[`operations`],
  _tolerance = 1e-6,
): Vec3[] {
  const seen = new Set<string>()
  const wrap = (coord: number) => coord - Math.floor(coord)
  const key = (pos: Vec3) => pos.map((c) => wrap(c).toFixed(8)).join(`,`)

  return operations
    .map(({ rotation, translation }) => {
      // Apply 3x3 rotation matrix and translation: new_pos = R * position + t
      const new_pos: Vec3 = [0, 1, 2].map((i) =>
        rotation[i * 3] * position[0] +
        rotation[i * 3 + 1] * position[1] +
        rotation[i * 3 + 2] * position[2] +
        translation[i]
      ) as Vec3
      return new_pos.map(wrap) as Vec3
    })
    .filter((pos) => {
      const pos_key = key(pos)
      if (seen.has(pos_key)) return false
      seen.add(pos_key)
      return true
    })
}

// Map Wyckoff positions to all equivalent atoms in the displayed structure (including image atoms)
export function map_wyckoff_to_all_atoms(
  wyckoff_positions: WyckoffPos[],
  displayed_structure: PymatgenStructure,
  orig_structure: PymatgenStructure,
  sym_data: MoyoDataset | null,
  tolerance = 1e-5,
): WyckoffPos[] {
  if (!sym_data?.operations || !displayed_structure.sites || !orig_structure.sites) {
    return wyckoff_positions
  }

  const periodic_distance = (pos1: Vec3, pos2: Vec3) =>
    Math.sqrt(
      pos1.reduce((sum, coord, idx) => {
        // Wrap delta into [-0.5, 0.5) using safe modulo
        const delta = coord - pos2[idx]
        const wrapped = (((delta + 0.5) % 1) + 1) % 1 - 0.5
        const d = Math.abs(wrapped)
        return sum + d * d
      }, 0),
    )

  return wyckoff_positions.map((wyckoff_pos) => {
    const indices = (wyckoff_pos.site_indices || [])
      .filter((idx) => idx < orig_structure.sites.length)
      .flatMap((orig_idx) => {
        const { abc: orig_abc, species } = orig_structure.sites[orig_idx]
        const element = species[0]?.element
        const equivalent_positions = apply_symmetry_operations(
          orig_abc,
          sym_data.operations,
          tolerance,
        )

        return displayed_structure.sites
          .map((site, display_idx) => ({ site, display_idx }))
          .filter(({ site }) => site.species[0]?.element === element)
          .filter(({ site }) =>
            equivalent_positions.some((equiv_pos) =>
              periodic_distance(equiv_pos, site.abc) < tolerance
            )
          )
          .map(({ display_idx }) => display_idx)
      })

    return { ...wyckoff_pos, site_indices: [...new Set(indices)].sort((a, b) => a - b) }
  })
}
