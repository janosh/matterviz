export { compute_msd_async } from './async-compute.svelte'
export * from './calc-msd'
export * from './collect'
export { default as MsdPlot } from './MsdPlot.svelte'
export { default as TrajectoryMsdPane } from './TrajectoryMsdPane.svelte'

export interface EinsteinFitOptions {
  // Fit window as a fraction of the largest lag. Defaults exclude the ballistic
  // short-time region and the noisy long-lag tail (few time origins).
  start_fraction?: number
  end_fraction?: number
  // Spatial dimensionality; D = slope / (2 * dimensionality)
  dimensionality?: number
}

export interface EinsteinFit {
  // D = slope / (2 * dimensionality), in Å²/<time_unit>
  diffusion_coefficient: number
  // The same D in the unit diffusion coefficients are quoted in; null when the time unit is
  // `frame` or not one of fs / ps / ns
  diffusion_coefficient_cm2_s: number | null
  slope: number
  intercept: number
  r_squared: number
  // Inclusive lag window (in frames) the fit actually used
  lag_window: [number, number]
  n_points: number
  dimensionality: number
  // e.g. `Å²/ps` or `Å²/frame` when no dt was supplied
  units: string
}

export interface MsdCurve {
  // `Total` for the all-atom curve, otherwise the element symbol
  label: string
  n_atoms: number
  // Mean squared displacement in Å², one entry per lag
  msd: number[]
  // Standard error of the mean over time origins. Time origins overlap and are
  // therefore correlated, so this is a lower bound on the true uncertainty.
  std_error: number[]
  // Number of time origins averaged at each lag (decreases with lag)
  n_origins: number[]
  // Null when the fit window contained fewer than 2 lags
  fit: EinsteinFit | null
}

export interface MsdOptions {
  // Time per collected frame. Left at 1 the x axis is labelled in frames, because
  // a run may not record a timestep and frame spacing is not guaranteed uniform.
  dt?: number
  // Only used when dt is explicitly supplied (e.g. `ps`, `fs`)
  time_unit?: string
  // Largest lag as a fraction of the trajectory length (longer lags have too few origins)
  max_lag_fraction?: number
  // Cap on the number of distinct lags evaluated; longer runs sub-sample lags evenly
  max_lags?: number
  fit?: EinsteinFitOptions
}

export interface MsdResult {
  // Lags in frames (of the collected, possibly strided, frame series)
  lags: number[]
  // lags * dt — identical to `lags` when no dt was supplied
  times: number[]
  curves: MsdCurve[]
  dt: number
  // `frame` when no dt was supplied
  time_unit: string
  x_label: string
  n_frames: number
  n_atoms: number
  // False when the input was already unwrapped or had no lattice
  unwrapped: boolean
  // Every `lag_stride`-th lag was evaluated (from `max_lags`) and every `origin_stride`-th
  // time origin averaged (auto-tuned against an internal work budget)
  lag_stride: number
  origin_stride: number
  frame_stride: number
}
