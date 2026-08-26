// Worker-safe energy formatting kept separate from HTML formula sanitization.
export const format_mev = (energy_ev: number): string =>
  `${Math.round(energy_ev * 1000)} meV/atom`
