// Override state + shared <option> lists for the ChemPotDiagram2D/3D control panes
import { CHEMPOT_DEFAULTS, type ChemPotDiagramConfig } from './types'

// Per-key user overrides with `override ?? config ?? default` resolution; `reset()`
// clears all overrides (the panes' "Reset defaults" buttons). Defaults come from
// CHEMPOT_DEFAULTS unless overridden via custom_defaults; keys without either throw upfront.
export function create_chempot_overrides<Key extends keyof ChemPotDiagramConfig>(
  config: () => ChemPotDiagramConfig,
  keys: readonly Key[],
  custom_defaults: { [P in Key]?: NonNullable<ChemPotDiagramConfig[P]> } = {},
) {
  const defaults = Object.fromEntries(
    keys.map((key) => {
      const fallback =
        custom_defaults[key] ?? CHEMPOT_DEFAULTS[key as keyof typeof CHEMPOT_DEFAULTS]
      if (fallback === undefined) {
        throw new Error(
          `create_chempot_overrides: key '${key}' is missing from both custom_defaults and CHEMPOT_DEFAULTS`,
        )
      }
      return [key, fallback]
    }),
  ) as { [P in Key]: NonNullable<ChemPotDiagramConfig[P]> }
  let overrides = $state<{ [P in Key]?: NonNullable<ChemPotDiagramConfig[P]> }>({})
  return {
    resolve: <P extends Key>(key: P): NonNullable<ChemPotDiagramConfig[P]> =>
      overrides[key] ?? config()[key] ?? defaults[key],
    set: <P extends Key>(key: P, value: NonNullable<ChemPotDiagramConfig[P]>): void => {
      overrides[key] = value
    },
    reset: (): void => {
      overrides = {}
    },
  }
}

// [value, label] pairs for the color-mode and color-scale <select>s in both panes
export const CHEMPOT_COLOR_MODE_OPTIONS = [
  [`none`, `None`],
  [`energy`, `Energy/atom`],
  [`formation_energy`, `Formation energy`],
  [`arity`, `Element count`],
  [`entries`, `Entry count`],
] as const

export const CHEMPOT_COLOR_SCALE_OPTIONS = [
  [`interpolateViridis`, `Viridis`],
  [`interpolatePlasma`, `Plasma`],
  [`interpolateInferno`, `Inferno`],
  [`interpolateMagma`, `Magma`],
  [`interpolateCividis`, `Cividis`],
  [`interpolateTurbo`, `Turbo`],
  [`interpolateRdYlBu`, `RdYlBu`],
  [`interpolateSpectral`, `Spectral`],
] as const
