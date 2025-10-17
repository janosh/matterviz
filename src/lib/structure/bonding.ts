import type { AnyStructure, BondPair, Matrix3x3, Pbc, Vec3 } from '$lib'
import * as wasm_bonding from '$wasm/bonding_wasm.js'
import bonding_wasm_url from '$wasm/bonding_wasm_bg.wasm?url'
import process from 'node:process'

let wasm_initialized = false

async function ensure_wasm_ready(): Promise<void> {
  if (!wasm_initialized) {
    // In Node.js/vitest envs, fetch returns a Response but the WASM loader
    // expects the bytes directly, so we need to manually convert
    if (typeof process !== `undefined` && process.versions?.node) {
      try {
        const response = await fetch(bonding_wasm_url as unknown as string)
        await wasm_bonding.default({ module_or_path: await response.arrayBuffer() })
      } catch { // Fallback to URL-based loading
        await wasm_bonding.default({ module_or_path: bonding_wasm_url })
      }
    } else { // Browser environment - use URL directly (fetch will be called internally)
      await wasm_bonding.default({ module_or_path: bonding_wasm_url })
    }
    wasm_initialized = true
  }
}

function serialize_for_wasm(structure: AnyStructure) {
  const serialized: {
    sites: { xyz: Vec3; element: string }[]
    lattice?: { matrix: Matrix3x3; pbc: Pbc }
  } = {
    sites: structure.sites.map((site) => {
      // Select the species with the largest occupancy (majority species)
      let majority_species = site.species?.[0]
      if (site.species && site.species.length > 1) {
        for (const species of site.species) {
          if (species.occu > (majority_species?.occu ?? 0)) {
            majority_species = species
          }
        }
      }
      const element = majority_species?.element || ``
      return { xyz: site.xyz, element }
    }),
  }

  // Include lattice and PBC information if present on the structure
  if (`lattice` in structure && structure.lattice) {
    serialized.lattice = {
      matrix: structure.lattice.matrix,
      pbc: structure.lattice.pbc,
    }
  }

  return serialized
}

async function call_wasm<T>(
  wasm_fn_name: `electroneg_ratio` | `voronoi`,
  structure: AnyStructure,
  options: Record<string, unknown>,
  fn_name: string,
): Promise<T> {
  await ensure_wasm_ready()
  try {
    const fn = wasm_bonding?.[wasm_fn_name]
    if (typeof fn !== `function`) {
      throw new Error(`Function ${wasm_fn_name} not in WASM module`)
    }
    return fn(serialize_for_wasm(structure), options) as T
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
    `electroneg_ratio`,
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
    `voronoi`,
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
