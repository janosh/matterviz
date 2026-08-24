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
