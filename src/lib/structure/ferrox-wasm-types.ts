import type { Vec3 } from '$lib/math'

// Pure type definitions and utility functions for ferrox-wasm results.
// This module has no WASM side effects, making it safe to import in tests
// without triggering WASM resolution.

// Result Type Utilities
// The WASM module returns discriminated unions: { ok: T } | { error: string }
export type WasmResult<T> = { ok: T } | { error: string }

// Type guard to check if result is successful
export function is_ok<T>(result: WasmResult<T>): result is { ok: T } {
  return `ok` in result
}

// Type guard to check if result is an error
export function is_error<T>(result: WasmResult<T>): result is { error: string } {
  return `error` in result
}

// Unwrap a successful result or throw an error
export function unwrap<T>(result: WasmResult<T>): T {
  if (is_ok(result)) return result.ok
  throw new Error(result.error)
}

// Unwrap with a default value on error
export function unwrap_or<T>(result: WasmResult<T>, default_value: T): T {
  return is_ok(result) ? result.ok : default_value
}

// Neighbor list result from WASM
export interface NeighborListResult {
  center_indices: number[]
  neighbor_indices: number[]
  image_offsets: Vec3[]
  distances: number[]
}

// Matcher configuration options
export interface MatcherOptions {
  latt_len_tol?: number
  site_pos_tol?: number
  angle_tol?: number
  primitive_cell?: boolean
  scale?: boolean
  element_only?: boolean
}

// Structure file format types
export type StructureFormat = `cif` | `poscar` | `json`

// Lattice reduction algorithm types
export type ReductionAlgorithm = `niggli` | `lll`

// XRD Types
export interface HklInfo {
  hkl: Vec3
  multiplicity: number
}

export interface XrdPattern {
  two_theta: number[]
  intensities: number[]
  hkls: HklInfo[][]
  d_spacings: number[]
}

export interface XrdOptions {
  wavelength?: number
  two_theta_range?: [number, number] | null
  debye_waller_factors?: Record<string, number>
  scaled?: boolean
}
