import type { IsosurfaceSettings, SurfaceAppearance } from './types'

export interface FigureLighting {
  ambient: number
  key: number
  fill: number
  rim: number
  azimuth: number
  elevation: number
  warm?: boolean
  camera_relative?: boolean
  tone_mapping?: 'none' | 'agx'
  atom_roughness?: number
  atom_metalness?: number
  atom_specular?: number
  atom_glossy?: boolean
  structure_fade?: number
}

interface FigurePreset {
  name: string
  lighting: FigureLighting
  appearance: SurfaceAppearance
  opacity: number
}

const lighting: FigureLighting = {
  ambient: 0.9,
  key: 2.1,
  fill: 1.2,
  rim: 0.9,
  azimuth: 32,
  elevation: 30,
  tone_mapping: `none`,
  atom_roughness: 0.3,
  atom_metalness: 0,
  atom_specular: 0.025,
  atom_glossy: true,
}

export const FIGURE_PRESETS = {
  'translucent-shell': {
    name: `Translucent Shell`,
    lighting,
    opacity: 0.78,
    appearance: {
      material: `pbr`,
      roughness: 0.38,
      specular: 0.5,
      outline: 0.22,
      outline_width: 0.83,
      angle_opacity: true,
      depth_fade: 0.08,
    },
  },
  chalk: {
    name: `Chalk`,
    opacity: 1,
    lighting: {
      ...lighting,
      ambient: 0.8,
      key: 2.8,
      fill: 1.3,
      rim: 1.15,
      azimuth: 30,
      atom_roughness: 0.95,
      atom_specular: 0,
    },
    appearance: { material: `glossy`, specular: 0 },
  },
  'edge-contrast': {
    name: `Edge Contrast`,
    opacity: 0.56,
    lighting: {
      ...lighting,
      ambient: 0.86,
      key: 0.92,
      fill: 1.3,
      rim: 0.36,
      azimuth: 40,
      elevation: 22,
      structure_fade: 0.18,
    },
    appearance: {
      material: `pbr`,
      roughness: 0.23,
      specular: 0.51,
      saturation: 0.68,
      outline: 0.59,
      outline_width: 0.76,
      angle_opacity: true,
      inner_share: 0.015,
      depth_fade: 0.18,
    },
  },
  'high-key': {
    name: `High Key`,
    opacity: 0.88,
    lighting: {
      ...lighting,
      key: 2.65,
      fill: 1.55,
      rim: 1.2,
      azimuth: 25,
      elevation: 28,
      atom_roughness: 0.8,
      atom_specular: 0.012,
      structure_fade: 0.46,
    },
    appearance: {
      material: `pbr`,
      roughness: 0.6,
      specular: 0.23,
      outline: 0.13,
      outline_width: 0.8,
      angle_opacity: true,
      depth_fade: 0.46,
    },
  },
  'satin-metal': {
    name: `Satin Metal`,
    opacity: 1,
    lighting: {
      ...lighting,
      ambient: 2.42,
      key: 1.58,
      fill: 0.34,
      rim: 0.24,
      azimuth: -8,
      elevation: 72,
      atom_roughness: 0.58,
      atom_metalness: 0.16,
      atom_specular: 0.1,
      atom_glossy: false,
    },
    appearance: { material: `pbr`, roughness: 0.67, metalness: 0.36, specular: 0.1 },
  },
  'warm-key': {
    name: `Warm Key`,
    opacity: 0.84,
    lighting: {
      ...lighting,
      ambient: 0.75,
      key: 2.5,
      fill: 1.45,
      rim: 1.55,
      azimuth: 35,
      elevation: 25,
      warm: true,
      structure_fade: 0.32,
    },
    appearance: {
      material: `pbr`,
      roughness: 0.28,
      specular: 0.52,
      saturation: 0.72,
      outline: 0.23,
      outline_width: 0.88,
      angle_opacity: true,
      inner_share: 0.015,
      depth_fade: 0.32,
    },
  },
} satisfies Record<string, FigurePreset>

export type FigurePresetId = keyof typeof FIGURE_PRESETS

/** Apply the preset's starting opacity once so each layer remains editable. */
export function apply_figure_preset(
  settings: IsosurfaceSettings,
  figure_preset: FigurePresetId | undefined,
): IsosurfaceSettings {
  const preset = figure_preset && FIGURE_PRESETS[figure_preset]
  return {
    ...settings,
    figure_preset,
    layers: preset
      ? settings.layers.map((layer) =>
          layer.visible && layer.opacity > 0 ? { ...layer, opacity: preset.opacity } : layer,
        )
      : settings.layers,
  }
}
