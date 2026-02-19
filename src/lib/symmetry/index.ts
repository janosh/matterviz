import { ATOMIC_NUMBER_TO_SYMBOL, SYMBOL_TO_ATOMIC_NUMBER } from '$lib/composition/parse'
import type { Vec3 } from '$lib/math'
import { DEFAULTS } from '$lib/settings'
import type { AnyStructure, Crystal } from '$lib/structure'
import { merge_split_partial_sites } from '$lib/structure/partial-occupancy'
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
export type SymmetryDataset = MoyoDataset & {
  // Legacy one-to-one standardized-index mapping.
  orig_indices?: number[]
  // Preferred mapping for merged disordered-site inputs (one standardized index -> many originals).
  orig_site_indices_by_std_idx?: number[][]
}

let initialized = false
const OCCUPANCY_EPS = 1e-8

export async function ensure_moyo_wasm_ready(wasm_url?: string) {
  if (initialized) return

  // Use provided URL (e.g. from VSCode webview data), otherwise use Vite-bundled URL
  const url = wasm_url ?? moyo_wasm_url

  await init({ module_or_path: url })
  initialized = true
}

function get_site_atomic_number(
  site: Crystal[`sites`][number],
  site_idx: number,
): number {
  const occupancy_by_element = new Map<keyof typeof SYMBOL_TO_ATOMIC_NUMBER, number>()
  for (const { element, occu } of site.species) {
    if (occu <= OCCUPANCY_EPS) continue
    occupancy_by_element.set(element, (occupancy_by_element.get(element) ?? 0) + occu)
  }

  let selected_element: (typeof site.species)[number][`element`] | undefined = site
    .species[0]?.element
  let best_occupancy = -Infinity
  occupancy_by_element.forEach((occupancy, element) => {
    if (
      occupancy > best_occupancy ||
      (occupancy === best_occupancy && element.localeCompare(selected_element ?? ``) < 0)
    ) {
      selected_element = element
      best_occupancy = occupancy
    }
  })

  if (selected_element === undefined) {
    throw new Error(`Unknown element at site ${site_idx}: ${String(selected_element)}`)
  }
  const atomic_number = SYMBOL_TO_ATOMIC_NUMBER[selected_element]
  if (atomic_number === undefined) {
    throw new Error(`Unknown element at site ${site_idx}: ${String(selected_element)}`)
  }
  return atomic_number
}

function build_moyo_input_cell(
  structure: Crystal,
): Pick<MoyoCell, `positions` | `numbers`> & {
  orig_site_indices_by_input_idx: number[][]
} {
  const merged_render_sites = merge_split_partial_sites(structure.sites)
  return {
    positions: merged_render_sites.map(({ site }) => site.abc),
    numbers: merged_render_sites.map(({ site, site_idx }) =>
      get_site_atomic_number(site, site_idx)
    ),
    orig_site_indices_by_input_idx: merged_render_sites.map(({ source_site_indices }) =>
      source_site_indices
    ),
  }
}

function build_moyo_cell(
  structure: Crystal,
  positions: Vec3[],
  numbers: number[],
): MoyoCell {
  // nalgebra Matrix3 deserializes as a flat list in COLUMN-MAJOR of the internal basis B
  // Internal B = transpose(row-basis RB). column-major(B) == row-major(RB).
  // So supply row-major of the pymatgen lattice.matrix (RB).
  const [v_a, v_b, v_c] = structure.lattice.matrix
  return {
    lattice: { basis: [...v_a, ...v_b, ...v_c] },
    positions,
    numbers,
  }
}

export function to_cell_json(structure: Crystal): string {
  const { positions, numbers } = build_moyo_input_cell(structure)
  return JSON.stringify(build_moyo_cell(structure, positions as Vec3[], numbers))
}

const fractional_sq_dist = (pos_1: Vec3, pos_2: Vec3): number =>
  (pos_1[0] - pos_2[0] - Math.round(pos_1[0] - pos_2[0])) ** 2 +
  (pos_1[1] - pos_2[1] - Math.round(pos_1[1] - pos_2[1])) ** 2 +
  (pos_1[2] - pos_2[2] - Math.round(pos_1[2] - pos_2[2])) ** 2

export function map_std_to_orig_site_indices(
  std_positions: Vec3[],
  std_numbers: number[],
  input_positions: Vec3[],
  input_numbers: number[],
  orig_site_indices_by_input_idx: number[][],
): number[][] {
  return std_positions.map((std_pos, std_idx) => {
    const std_number = std_numbers[std_idx]
    let nearest_input_idx = -1
    let nearest_sq_dist = Infinity
    for (let input_idx = 0; input_idx < input_positions.length; input_idx += 1) {
      if (input_numbers[input_idx] !== std_number) continue
      const sq_dist = fractional_sq_dist(std_pos, input_positions[input_idx])
      if (sq_dist < nearest_sq_dist) {
        nearest_sq_dist = sq_dist
        nearest_input_idx = input_idx
      }
    }

    if (nearest_input_idx === -1) return []
    return orig_site_indices_by_input_idx[nearest_input_idx] ?? []
  })
}

export async function analyze_structure_symmetry(
  struct_or_mol: AnyStructure,
  settings: Partial<SymmetrySettings>,
): Promise<SymmetryDataset> {
  await ensure_moyo_wasm_ready()
  if (!(`lattice` in struct_or_mol)) {
    throw new Error(`Symmetry analysis requires a periodic structure with a lattice`)
  }
  const moyo_input_cell = build_moyo_input_cell(struct_or_mol)
  const cell_json = JSON.stringify(
    build_moyo_cell(
      struct_or_mol,
      moyo_input_cell.positions as Vec3[],
      moyo_input_cell.numbers,
    ) satisfies MoyoCell,
  )
  const { symprec, algo } = { ...default_sym_settings, ...settings }
  // Map "Moyo" to "Standard" for moyo-wasm
  const moyo_algo = algo === `Moyo` ? `Standard` : algo
  const sym_data = analyze_cell(cell_json, symprec, moyo_algo)
  const orig_site_indices_by_std_idx = map_std_to_orig_site_indices(
    sym_data.std_cell.positions as Vec3[],
    sym_data.std_cell.numbers,
    moyo_input_cell.positions as Vec3[],
    moyo_input_cell.numbers,
    moyo_input_cell.orig_site_indices_by_input_idx,
  )
  return { ...sym_data, orig_site_indices_by_std_idx }
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
  sym_data: SymmetryDataset | null,
): WyckoffPos[] {
  if (!sym_data) return []

  const { positions, numbers } = sym_data.std_cell
  const { wyckoffs, orig_indices, orig_site_indices_by_std_idx } = sym_data

  // Group sites by letter-element combination and track all indices
  const groups = new Map<string, {
    letter: string
    elem: string
    indices: number[]
    positions: Vec3[]
  }>()

  // Process all atoms in the standardized cell
  // Note: wyckoffs array may be shorter than std_cell when moyo combines symmetry-equivalent sites
  for (let idx = 0; idx < numbers.length; idx++) {
    // Use wyckoff letter if available, otherwise mark as non-symmetric
    const full = idx < wyckoffs.length ? wyckoffs[idx] : null
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
    const orig_site_indices = orig_site_indices_by_std_idx
      ? indices.flatMap((std_idx) => orig_site_indices_by_std_idx[std_idx] ?? [])
      : orig_indices
      ? indices.map((std_idx) => orig_indices[std_idx]).filter((idx) => idx !== undefined)
      : indices

    const wyckoff = letter ? `${indices.length}${letter}` : `1`
    return {
      wyckoff,
      elem,
      abc: best_pos,
      site_indices: [...new Set(orig_site_indices)].sort((idx_a, idx_b) => idx_a - idx_b),
    }
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
  const key = (pos: Vec3) => pos.map((coord) => wrap(coord).toFixed(8)).join(`,`)

  return operations
    .map(({ rotation, translation }) => {
      // Apply 3x3 rotation matrix and translation: new_pos = R * position + t
      const new_pos: Vec3 = [0, 1, 2].map((dim) =>
        rotation[dim * 3] * position[0] +
        rotation[dim * 3 + 1] * position[1] +
        rotation[dim * 3 + 2] * position[2] +
        translation[dim]
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
  displayed_structure: Crystal,
  orig_structure: Crystal,
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
