import type { AnyStructure, BondPair } from '$lib'
import init, {
  electroneg_ratio as electroneg_ratio_wasm,
  voronoi as voronoi_wasm,
} from '../../../dist/wasm/bonding_wasm.js'
import bonding_wasm_url from '../../../dist/wasm/bonding_wasm_bg.wasm?url'

let wasm_initialized = false

async function ensure_wasm_ready(): Promise<void> {
  if (!wasm_initialized) {
    await init({ module_or_path: bonding_wasm_url })
    wasm_initialized = true
  }
}

function serialize_for_wasm(structure: AnyStructure) {
  return {
    sites: structure.sites.map((site) => ({
      xyz: site.xyz,
      element: site.species?.[0]?.element || ``,
    })),
  }
}

async function call_wasm<T>(
  wasm_fn: (structure: unknown, options: unknown) => T,
  structure: AnyStructure,
  options: Record<string, unknown>,
  fn_name: string,
): Promise<T> {
  await ensure_wasm_ready()
  try {
    return wasm_fn(serialize_for_wasm(structure), options) as T
  } catch (error) {
    throw new Error(`${fn_name} failed: ${error}`)
  }
}

export function electroneg_ratio(
  structure: AnyStructure,
  options: {
    electronegativity_threshold?: number
    max_distance_ratio?: number
    min_bond_dist?: number
    metal_metal_penalty?: number
    metal_nonmetal_bonus?: number
    similar_electronegativity_bonus?: number
    same_species_penalty?: number
    strength_threshold?: number
  } = {},
): Promise<BondPair[]> {
  return call_wasm(
    electroneg_ratio_wasm,
    structure,
    {
      electronegativity_threshold: 1.7,
      max_distance_ratio: 2.0,
      min_bond_dist: 0.4,
      metal_metal_penalty: 0.7,
      metal_nonmetal_bonus: 1.5,
      similar_electronegativity_bonus: 1.2,
      same_species_penalty: 0.5,
      strength_threshold: 0.3,
      ...options,
    },
    `electroneg_ratio`,
  )
}

export function voronoi(
  structure: AnyStructure,
  options: {
    min_solid_angle?: number
    min_face_area?: number
    max_distance?: number
    min_bond_dist?: number
  } = {},
): Promise<BondPair[]> {
  return call_wasm(
    voronoi_wasm,
    structure,
    {
      min_solid_angle: 0.01, // Very permissive - accept most neighbors
      min_face_area: 0.05, // Very low face area requirement
      max_distance: 5.0, // Generous max distance
      min_bond_dist: 0.4,
      ...options,
    },
    `voronoi`,
  )
}

export const BONDING_STRATEGIES = {
  electroneg_ratio,
  voronoi,
} as const

export type BondingStrategy = keyof typeof BONDING_STRATEGIES
export type BondingAlgo = (typeof BONDING_STRATEGIES)[BondingStrategy]
