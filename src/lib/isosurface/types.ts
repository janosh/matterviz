// Type definitions for isosurface visualization (charge density, molecular orbitals, etc.)
import type { Matrix3x3, Vec3 } from '$lib/math'
import type { ParsedStructure } from '$lib/structure/parse'

// Precomputed statistics for a volumetric grid (min, max, abs_max, mean)
export interface DataRange {
  min: number
  max: number
  abs_max: number
  mean: number
}

// Volumetric scalar data on a 3D grid (e.g. charge density, electrostatic potential)
export interface VolumetricData {
  grid: number[][][] // scalar values [nx][ny][nz]
  grid_dims: [number, number, number] // [nx, ny, nz]
  lattice: Matrix3x3 // real-space lattice vectors (rows are a, b, c)
  origin: Vec3 // grid origin in Cartesian coordinates
  data_range: DataRange // precomputed min/max/mean statistics
  label?: string // e.g. "charge density", "spin density", "orbital"
}

// Result of parsing a volumetric file (contains both structure and volumetric data)
export interface VolumetricFileData {
  structure: ParsedStructure
  volumes: VolumetricData[] // one or more volumes (e.g. total + magnetization for spin-polarized)
}

// Isosurface rendering settings
export interface IsosurfaceSettings {
  isovalue: number
  opacity: number
  positive_color: string // color for positive isovalue lobe
  negative_color: string // color for negative isovalue lobe
  show_negative: boolean // whether to render the negative lobe (-isovalue)
  wireframe: boolean
}

// Compute min/max/abs_max/mean of a 3D grid.
// Prefer using the precomputed `data_range` field on VolumetricData when available.
export function grid_data_range(grid: number[][][]): DataRange {
  if (!grid.length || !grid[0]?.length || !grid[0][0]?.length) {
    return { min: 0, max: 0, abs_max: 0, mean: 0 }
  }
  let min_val = Infinity
  let max_val = -Infinity
  let sum = 0
  let count = 0
  for (const plane of grid) {
    for (const row of plane) {
      for (const val of row) {
        if (val < min_val) min_val = val
        if (val > max_val) max_val = val
        sum += val
        count++
      }
    }
  }
  const abs_max = Math.max(Math.abs(min_val), Math.abs(max_val))
  return { min: min_val, max: max_val, abs_max, mean: count > 0 ? sum / count : 0 }
}

// Default isosurface rendering settings
export const DEFAULT_ISOSURFACE_SETTINGS: IsosurfaceSettings = {
  isovalue: 0.05,
  opacity: 0.6,
  positive_color: `#3b82f6`, // blue
  negative_color: `#ef4444`, // red
  show_negative: false,
  wireframe: false,
}

// Compute reasonable isosurface settings from a volume's data range.
// Sets isovalue to 20% of abs_max and enables negative lobe when data has
// significant negative values (>1% of max).
export function auto_isosurface_settings(
  data_range: DataRange,
): IsosurfaceSettings {
  return {
    ...DEFAULT_ISOSURFACE_SETTINGS,
    // Fall back to default isovalue for all-zero grids to keep controls usable
    isovalue: data_range.abs_max > 0
      ? data_range.abs_max * 0.2
      : DEFAULT_ISOSURFACE_SETTINGS.isovalue,
    // Show negative lobe only when data has significant negative values (>1% of max)
    show_negative: data_range.min < -data_range.abs_max * 0.01,
  }
}
