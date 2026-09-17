import { get_d3_interpolator, type D3InterpolateName } from '$lib/colors'
import type { ElementSymbol } from '$lib/element'
import * as math from '$lib/math'
import type { Vec3 } from '$lib/math'
import type { VectorColorMode, VectorLayerConfig } from '$lib/settings'
import { rgb } from 'd3-color'
import { get_majority_element } from './bonding'
import { numeric_sites } from './site'
import { element_from_atomic_number } from '$lib/element/helpers'
import {
  vector_reader,
  VECTOR_PALETTE,
  create_arrow_placements,
  write_arrow_placement,
  prepare_vector_geometry,
  same_vector_geometry,
  type VectorGeometryFilter,
  type VectorGeometrySettings,
  type ArrowPlacements,
} from './vectors'
import type { AnyStructure } from './index'

export type VectorArrow = {
  position: Vec3
  vector: Vec3
  magnitude: number
  scale: number
  color: string
}

export type ArrowColumns = { placements: ArrowPlacements; colors: string[] | string }

export function pack_arrows(
  arrows: readonly VectorArrow[],
  shaft_size: number,
  head_size: number,
  head_length: number,
): ArrowColumns {
  const placements = create_arrow_placements(arrows.length, [
    shaft_size,
    head_size,
    head_length,
  ])
  const colors: string[] = []
  for (const [idx, { position, vector, magnitude, scale, color }] of arrows.entries()) {
    write_arrow_placement(placements, idx, position, vector, magnitude, scale)
    colors.push(color)
  }
  return { placements, colors }
}

export type VectorLayer = { key: string; arrows: ArrowColumns }

export type VectorLayerOptions = VectorGeometrySettings &
  VectorGeometryFilter & {
    vector_configs: Record<string, VectorLayerConfig>
    vector_color_mode: VectorColorMode
    vector_color: string
    palette: Partial<Record<ElementSymbol, string>>
    char_atom_spacing: number
    vector_color_scale: D3InterpolateName
  }

// sRGB blend from spin-down blue to spin-up red by the original vector direction.
const [spin_down_rgb, spin_up_rgb] = [rgb(`#3498db`), rgb(`#e74c3c`)]
function spin_direction_color(vec: Vec3): string {
  const mag = Math.hypot(...vec)
  const z_frac = mag > 1e-10 ? (vec[2] / mag + 1) / 2 : 0.5
  return rgb(
    math.lerp(spin_down_rgb.r, spin_up_rgb.r, z_frac),
    math.lerp(spin_down_rgb.g, spin_up_rgb.g, z_frac),
    math.lerp(spin_down_rgb.b, spin_up_rgb.b, z_frac),
  ).formatHex()
}

// Geometry is immutable and can arrive prepared by the worker. Colors remain live viewer
// state, using original vectors even when the displayed arrows have normalized lengths.
export function build_vector_layers(
  structure: AnyStructure | null | undefined,
  options: VectorLayerOptions,
  previous_layers: readonly VectorLayer[],
): VectorLayer[] {
  if (!structure) return []
  const {
    vector_configs,
    vector_color_mode,
    vector_color,
    palette,
    vector_color_scale,
    nothing_hidden,
    vector_origin_gap,
    char_atom_spacing,
  } = options
  const columns = numeric_sites.get(structure)
  const cached = columns?.vector_geometry
  const geometry =
    cached &&
    nothing_hidden &&
    vector_origin_gap === 0 &&
    Object.is(cached.spacing, char_atom_spacing) &&
    same_vector_geometry(cached.settings, options)
      ? cached
      : prepare_vector_geometry(structure, options, options, char_atom_spacing)
  if (geometry.layers.length === 0) return []
  const is_single = geometry.layers.length === 1
  const interpolator = get_d3_interpolator(vector_color_scale)
  return geometry.layers.map(({ key, site_indices, placements }, layer_idx) => {
    const configured_color = vector_configs[key]?.color
    const layer_color = configured_color ?? VECTOR_PALETTE[layer_idx % VECTOR_PALETTE.length]
    const mode =
      vector_color_mode === `auto`
        ? key.startsWith(`magmom`) || key.startsWith(`spin`)
          ? `spin_direction`
          : `element`
        : vector_color_mode
    // Uniform layer colors need neither one string per atom nor a per-atom color pass.
    if (configured_color || !is_single || mode === `uniform`)
      return {
        key,
        arrows: {
          placements,
          colors: configured_color || !is_single ? layer_color : vector_color,
        },
      }
    const previous = previous_layers.find((layer) => layer.key === key)?.arrows.colors
    const colors = Array.isArray(previous) ? previous : []
    const magnitudes = columns?.display_metrics?.vector_magnitudes[key]?.values
    const read = vector_reader(structure, key, magnitudes)
    let vector: Vec3 = [0, 0, 0]
    for (let idx = 0; idx < site_indices.length; idx++) {
      const site_idx = site_indices[idx]
      if (mode === `element`) {
        const element = columns
          ? element_from_atomic_number(columns.numbers[site_idx])
          : get_majority_element(structure.sites[site_idx])
        // oxlint-disable-next-line typescript/prefer-nullish-coalescing -- Empty element colors use the uniform color too.
        colors[idx] = (element && palette?.[element]) || vector_color
        continue
      }
      if (mode === `spin_direction` || !magnitudes) {
        const source = read?.(site_idx)
        if (!source) throw new Error(`Prepared vector ${key} is missing at site ${site_idx}`)
        vector = source
      }
      const magnitude = magnitudes ? magnitudes[site_idx] : Math.hypot(...vector)
      colors[idx] =
        mode === `spin_direction`
          ? spin_direction_color(vector)
          : interpolator(
              geometry.max_magnitude > 1e-10 ? magnitude / geometry.max_magnitude : 0,
            )
    }
    colors.length = site_indices.length
    return { key, arrows: { placements, colors } }
  })
}
