// Constants and thresholds for Fermi surface computation

// Grid processing limits
// Maximum grid points before automatic downsampling kicks in
// 20^3 = 8,000 points keeps UI snappy while maintaining reasonable detail
export const MAX_GRID_POINTS = 8_000

// Maximum triangles for BZ symmetry tiling (48x for Oh symmetry)
// Above this, tiling is auto-disabled for performance
export const MAX_TRIANGLES_FOR_TILING = 50_000

// Numerical tolerances
export const CLOSED_CONTOUR_TOLERANCE = 1e-6 // Distance threshold for detecting closed contours
export const IRREDUCIBLE_BZ_TOLERANCE = 0.01 // Threshold for detecting irreducible BZ (vertices in positive octant)
export const IRREDUCIBLE_BZ_MIN_VERTICES = 10 // Minimum significant vertex count for irreducible BZ detection

export const SPANNING_THRESHOLD = 0.8 // Fraction of BZ extent a surface must cover to be considered "spanning" that direction
export const BOHR_TO_ANGSTROM = 0.529177 // 1 Bohr = 0.529177 Angstrom
export const HARTREE_TO_EV = 27.2114 // 1 Hartree = 27.2114 eV

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
