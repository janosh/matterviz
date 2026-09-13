import { get_d3_interpolator, type D3InterpolateName } from '$lib/colors'
import type { ElementSymbol } from '$lib/element'
import * as math from '$lib/math'
import type { Vec3 } from '$lib/math'
import type { VectorColorMode, VectorLayerConfig } from '$lib/settings'
import { rgb } from 'd3-color'
import { get_majority_element } from './bonding'
import {
  get_structure_vector_keys,
  try_parse_vec3,
  vector_display_defaults,
  VECTOR_PALETTE,
  type AnyStructure,
  type Site,
} from './index'

type VectorArrow = {
  site_idx: number
  position: Vec3
  vector: Vec3
  scale: number
  color: string
}

export type VectorLayer = {
  key: string
  arrows: VectorArrow[]
  shaft_radius: number
  arrow_head_radius: number
  arrow_head_length: number
}

export type VectorLayerOptions = {
  vector_configs: Record<string, VectorLayerConfig>
  nothing_hidden: boolean
  is_site_visible: (site_idx: number) => boolean
  vector_color_mode: VectorColorMode
  vector_color: string
  vector_normalize: boolean
  palette: Partial<Record<ElementSymbol, string>>
  char_atom_spacing: number
  vector_scale: number
  vector_origin_gap: number
  get_site_radius: (site: Site, site_idx: number) => number
  vector_color_scale: D3InterpolateName
  eff_shaft_radius: number
  eff_head_radius: number
  eff_head_length: number
}

// sRGB blend from spin-down blue to spin-up red by the z-component direction of a magnetic
// vector (0 = down, 1 = up; a zero vector sits in the middle)
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

// Build one arrow layer per visible vector key. Auto-scales the longest
// vector to 1.8× char_atom_spacing (cube root of volume per atom).
// When vector_normalize is on, effective_max is 1 so all arrows get equal length.
// Single active key preserves legacy coloring (element for force,
// spin-direction for magmom/spin). Multiple keys use flat palette colors.
export function build_vector_layers(
  structure: AnyStructure | null | undefined,
  {
    vector_configs,
    nothing_hidden,
    is_site_visible,
    vector_color_mode,
    vector_color,
    vector_normalize,
    palette,
    char_atom_spacing,
    vector_scale,
    vector_origin_gap,
    get_site_radius,
    vector_color_scale,
    eff_shaft_radius,
    eff_head_radius,
    eff_head_length,
  }: VectorLayerOptions,
  previous_layers: readonly VectorLayer[],
): VectorLayer[] {
  if (!structure?.sites) return []
  const keys = get_structure_vector_keys(structure)
  const active_keys = keys.filter((key) => vector_configs[key]?.visible !== false)
  if (active_keys.length === 0) return []

  // Build render records directly; empty slots keep site indices aligned until compaction.
  // Hidden sites contribute neither arrows nor the maximum used for autoscaling.
  let max_mag = 0
  const sites = structure.sites
  const layers = active_keys.map((key) => {
    const previous_arrows = previous_layers.find((layer) => layer.key === key)?.arrows ?? []
    // oxlint-disable-next-line unicorn/no-new-array -- Site slots are compacted before returning.
    const arrows = new Array<VectorArrow>(sites.length)
    let arrow_count = 0
    for (let site_idx = 0; site_idx < sites.length; site_idx++) {
      const site = sites[site_idx]
      if (nothing_hidden ? site.species.length === 0 : !is_site_visible(site_idx)) continue
      const vec = try_parse_vec3(site.properties?.[key])
      if (!vec) continue
      max_mag = Math.max(max_mag, Math.hypot(...vec))
      const arrow = previous_arrows[arrow_count++] ?? {
        site_idx,
        position: site.xyz,
        vector: vec,
        scale: 0,
        color: ``,
      }
      arrow.site_idx = site_idx
      arrow.position = site.xyz
      arrow.vector = vec
      arrows[site_idx] = arrow
    }
    const display_defaults = vector_display_defaults(key)
    return {
      key,
      arrows,
      shaft_radius: eff_shaft_radius * display_defaults.shaft_radius,
      arrow_head_radius: eff_head_radius * display_defaults.arrow_head_radius,
      arrow_head_length: eff_head_length * display_defaults.arrow_head_length,
    }
  })

  // When normalize is on, treat all magnitudes as 1 so arrows have equal length
  const effective_max = vector_normalize ? 1 : max_mag
  const auto_scale = effective_max > 1e-10 ? (char_atom_spacing * 1.8) / effective_max : 1
  const is_single = active_keys.length === 1
  const effective_global_scale = auto_scale * vector_scale

  // When vector_origin_gap > 0 and multiple vectors exist at a site,
  // arrange arrow origins on a regular polygon centered on the atom, in a
  // plane perpendicular to the mean vector direction. The gap is a fraction
  // of the visual atom radius (0 = center, 0.5 = halfway to surface).
  // get_site_radius() returns the uniform scale applied to SphereGeometry(0.5),
  // so visual_radius = get_site_radius() * 0.5.
  if (vector_origin_gap > 0 && !is_single) {
    const site_arrows: VectorArrow[] = []
    for (let site_idx = 0; site_idx < sites.length; site_idx++) {
      site_arrows.length = 0
      for (const { arrows } of layers) {
        const arrow = arrows[site_idx]
        if (arrow) site_arrows.push(arrow)
      }
      if (site_arrows.length <= 1) continue
      const visual_radius = get_site_radius(sites[site_idx], site_idx) * 0.5
      const gap_abs = vector_origin_gap * visual_radius
      let mean: Vec3 = [0, 0, 0]
      for (const { vector } of site_arrows) {
        mean = math.add(mean, math.normalize_vec(vector))
      }
      const mean_dir = math.normalize_vec(mean, [0, 1, 0] as Vec3)
      const [u_vec, v_vec] = math.compute_in_plane_basis(mean_dir)
      for (const [idx, arrow] of site_arrows.entries()) {
        const angle = (2 * Math.PI * idx) / site_arrows.length
        const delta_x = math.scale(u_vec, gap_abs * Math.cos(angle))
        const delta_y = math.scale(v_vec, gap_abs * Math.sin(angle))
        arrow.position = math.add(sites[site_idx].xyz, math.add(delta_x, delta_y))
      }
    }
  }

  const mag_interpolator = get_d3_interpolator(vector_color_scale)

  for (const [layer_idx, { key, arrows }] of layers.entries()) {
    const layer_cfg = vector_configs[key]
    const configured_color = layer_cfg?.color
    const layer_scale = effective_global_scale * (layer_cfg?.scale ?? 1.0)
    const layer_color = configured_color ?? VECTOR_PALETTE[layer_idx % VECTOR_PALETTE.length]
    const effective_mode =
      vector_color_mode === `auto`
        ? key.startsWith(`magmom`) || key.startsWith(`spin`)
          ? `spin_direction`
          : `element`
        : vector_color_mode

    let arrow_count = 0
    for (let site_idx = 0; site_idx < sites.length; site_idx++) {
      const arrow = arrows[site_idx]
      if (!arrow) continue
      const site = sites[site_idx]
      const vec = arrow.vector

      // Resolve color mode: explicit per-key color always wins,
      // then multi-key uses palette, then mode-based coloring
      let arrow_color = layer_color
      if (!configured_color && is_single) {
        if (effective_mode === `magnitude`) {
          const mag = Math.hypot(...vec)
          const norm = max_mag > 1e-10 ? mag / max_mag : 0
          arrow_color = mag_interpolator(norm)
        } else if (effective_mode === `spin_direction`) {
          arrow_color = spin_direction_color(vec)
        } else if (effective_mode === `uniform`) {
          arrow_color = vector_color
        } else {
          const majority_element = get_majority_element(site)
          // oxlint-disable-next-line typescript/prefer-nullish-coalescing -- Empty element colors use the uniform color too.
          arrow_color = (majority_element && palette?.[majority_element]) || vector_color
        }
      }

      if (vector_normalize) arrow.vector = math.normalize_vec(vec)
      arrow.scale = layer_scale
      arrow.color = arrow_color
      arrows[arrow_count++] = arrow
    }
    // Fresh arrays invalidate child instance buffers; inactive keys/slots aren't retained.
    arrows.length = arrow_count
  }
  return layers
}
