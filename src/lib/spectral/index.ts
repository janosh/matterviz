import type { ComponentProps } from 'svelte'
import type { ScatterPlotOptions } from '$lib/plot'
import type Bands from './Bands.svelte'
import type Dos from './Dos.svelte'

// Spectral visualization components (band structure, density of states, etc.)

export { default as Bands } from './Bands.svelte'
export { default as BandsAndDos } from './BandsAndDos.svelte'
export { default as BrillouinBandsDos } from './BrillouinBandsDos.svelte'
export { default as Dos } from './Dos.svelte'
export * from './frequency-units'
export * from './helpers'
export * from './ir-raman'
export { default as IrRamanSpectrum } from './IrRamanSpectrum.svelte'
export { default as PhononModeExplorer } from './PhononModeExplorer.svelte'
export { default as PhononThermalPlot } from './PhononThermalPlot.svelte'
export { default as TrajectorySpectroscopyPane } from './TrajectorySpectroscopyPane.svelte'
export { default as TrajectorySpectrumPlot } from './TrajectorySpectrumPlot.svelte'
export * from './parse-phonon-modes'
export * from './phonon-modes'
export * from './spectroscopy-collect'
export * from './thermal'
export * from './trajectory-spectroscopy'
export { compute_trajectory_spectroscopy_async } from './trajectory-spectroscopy-async.svelte'
export type * from './types'

// Paired viewers own data, hover markers and synchronized view state.
type SpectralPlotOptions = Omit<
  ScatterPlotOptions,
  'view' | 'resolved_padding' | 'tooltip' | 'controls_extra' | 'children'
>
export type BandsOptions = SpectralPlotOptions &
  Pick<
    ComponentProps<typeof Bands>,
    | 'line_kwargs'
    | 'path_mode'
    | 'ribbon_config'
    | 'band_spin_mode'
    | 'highlight_regions'
    | 'shade_imaginary_modes'
    | 'show_gap_annotation'
    | 'bz_popup_props'
  >
export type DosOptions = SpectralPlotOptions &
  Pick<
    ComponentProps<typeof Dos>,
    | 'stack'
    | 'sigma'
    | 'normalize'
    | 'spin_mode'
    | 'show_normalize_control'
    | 'show_units_control'
    | 'sigma_range'
  >
