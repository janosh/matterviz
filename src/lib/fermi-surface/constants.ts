import type { ColorProperty, SpinChannel } from './types'

// Band colors (ColorBrewer Set1 palette for categorical data)
export const BAND_COLORS = [
  `#e41a1c`, // red
  `#377eb8`, // blue
  `#4daf4a`, // green
  `#984ea3`, // purple
  `#ff7f00`, // orange
  `#ffff33`, // yellow
  `#a65628`, // brown
  `#f781bf`, // pink
  `#999999`, // gray
  `#66c2a5`, // teal
] as const

// Flat colours of the spin channels in `spin` colouring mode, also FermiSurfaceTooltip's badge
export const SPIN_COLORS = { up: BAND_COLORS[0], down: BAND_COLORS[1] } as const

// Flat colour of a band's sheet (material, tooltip background, ElectronicStructure's band lines):
// its spin channel's in `spin` colouring mode, else its band's
export const sheet_color = (
  band_index: number,
  spin: SpinChannel,
  color_property: ColorProperty,
): string =>
  color_property === `spin` && spin
    ? SPIN_COLORS[spin]
    : BAND_COLORS[band_index % BAND_COLORS.length]

// Key of a per-vertex property its source leaves unnamed (an IFermi/JSON `properties` array,
// a scalar FRMSF colour block). FermiSurface's custom_property_label relabels it for display.
export const DEFAULT_PROPERTY_NAME = `Property`

// Display label of a named property: the caller's label for the unnamed one, else its name
export const property_label = (name: string, custom_label?: string): string =>
  name === DEFAULT_PROPERTY_NAME ? (custom_label ?? name) : name
