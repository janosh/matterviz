import { site_count } from './site'
import type { ComponentProps } from 'svelte'
import type StructureScene from './StructureScene.svelte'
import type Structure from './Structure.svelte'
import type { HTMLAttributes } from 'svelte/elements'
import type { DefaultSettings, ShowBonds } from '$lib/settings'
import type { AnyStructure } from './index'

type SceneProps = ComponentProps<typeof StructureScene>

export const applies_to_structure = (when: ShowBonds, crystal: boolean): boolean =>
  when === `always` || when === (crystal ? `crystals` : `molecules`)

// Count atoms in the input cell, excluding periodic images and display-only tiling.
export const resolve_cell_vectors = (
  visible: boolean | undefined,
  structure: AnyStructure | undefined,
): boolean => visible ?? site_count(structure) <= 100

// Persisted appearance settings plus scene-only configuration. Scene data, editing state
// and computed outputs remain owned by Structure.
export type StructureSettings = Pick<
  SceneProps,
  | Extract<keyof DefaultSettings[`structure`], keyof SceneProps>
  | `camera_position`
  | `camera_target`
  | `camera_direction`
  | `bonding_options`
  | `lattice_planes`
  | `symmetry_elements`
  | `symmetry_elements_props`
  | `symmetry_declutter`
  | `atom_label`
  | `selection_highlight_color`
  | `active_highlight_color`
  | `element_radius_overrides`
  | `site_radius_overrides`
  | `trajectory_line_elements`
>

// Appearance and local controls for a Structure embedded in a composite viewer.
export type StructureOptions = Pick<
  HTMLAttributes<HTMLDivElement>,
  'id' | 'class' | 'style' | 'role' | 'aria-label'
> &
  Pick<
    ComponentProps<typeof Structure>,
    | 'children'
    | 'atom_tooltip'
    | 'apply_supercell_scaling'
    | 'show_host_tool'
    | 'scene_props'
    | 'active_pane'
    | 'multi_view'
    | 'views'
    | 'enable_measure_mode'
    | 'measure_mode'
    | 'background_color'
    | 'background_opacity'
    | 'show_controls'
    | 'persist_settings'
    | 'fullscreen_toggle'
    | 'color_scheme'
    | 'atom_color_config'
    | 'enable_info_pane'
    | 'analyze_symmetry'
    | 'png_dpi'
    | 'performance_mode'
    | 'show_image_atoms'
    | 'supercell_scaling'
    | 'cell_type'
    | 'hidden_elements'
    | 'symmetry_settings'
    | 'isosurface_settings'
    | 'slice_settings'
    | 'display_mode'
    | 'on_camera_move'
    | 'on_camera_reset'
  >
