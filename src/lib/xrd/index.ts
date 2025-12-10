import type { CompositionType } from '$lib'
import type { RadiationKey } from './calc-xrd'
export * from './broadening'
export * from './calc-xrd'
export * from './parse'
export { default as XrdPlot } from './XrdPlot.svelte'

export type Hkl = [number, number, number]
export type HklObj = { hkl: Hkl; multiplicity?: number }
export type RecipPoint = { hkl: Hkl; g_norm: number }
export type HklFormat = `compact` | `full` | null

export type XrdPattern = {
  x: number[]
  y: number[]
  hkls?: HklObj[][]
  d_hkls?: number[]
}

export type XrdOptions = {
  wavelength?: number | RadiationKey
  symprec?: number
  debye_waller_factors?: CompositionType
  scaled?: boolean
  // When null, treat as unbounded up to 2/λ (Bragg maximum); when omitted, default [0, 180]
  two_theta_range?: [number, number] | null
  // Merge tolerance for peaks in degrees (default = TWO_THETA_TOL)
  peak_merge_tol?: number
  // Scaled intensity threshold (% of max) to include a peak (default = SCALED_INTENSITY_TOL)
  scaled_intensity_tol?: number
}

export interface PatternEntry {
  label: string
  pattern: XrdPattern
  color?: string
}
