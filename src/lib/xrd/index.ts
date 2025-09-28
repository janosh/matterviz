import type { ElementSymbol } from '$lib'
import type { RadiationKey } from './calc-xrd'
export * from './calc-xrd'
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
  debye_waller_factors?: Partial<Record<ElementSymbol, number>>
  scaled?: boolean
  two_theta_range?: [number, number] | null
}

export interface PatternEntry {
  label: string
  pattern: XrdPattern
  color?: string
}
