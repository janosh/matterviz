import {
  SETTINGS_CONFIG,
  type DefaultSettings,
  type SettingType,
  validate_setting_value,
} from '../settings'
import { is_plain_object } from '../utils'

export const STRUCTURE_VIEW_STATE_VERSION = 1 as const
export const STRUCTURE_VIEW_STATE_STORAGE_KEY = `matterviz:structure-view:v1`

type StructureSettings = DefaultSettings[`structure`]
type StructureSettingKey = keyof StructureSettings

export type StructurePaneSize = { width: number; height: number }

export type StructureViewState = {
  version: typeof STRUCTURE_VIEW_STATE_VERSION
  settings: {
    color_scheme: DefaultSettings[`color_scheme`]
    background_color?: DefaultSettings[`background_color`]
    background_opacity: DefaultSettings[`background_opacity`]
    structure: Partial<StructureSettings>
  }
  viewer: {
    supercell_scaling: string
    cell_type: `original` | `conventional` | `primitive`
    multi_view: boolean
    controls_pane_size?: StructurePaneSize
  }
}

type StructureViewStateSource = {
  scene_props?: object
  color_scheme?: unknown
  background_color?: unknown
  background_opacity?: unknown
  show_image_atoms?: unknown
  show_trajectory_lines?: unknown
  atom_color_config?: object
  supercell_scaling?: unknown
  cell_type?: unknown
  multi_view?: unknown
  controls_pane_size?: unknown
}

type StructureViewStateParseResult =
  | { state: StructureViewState; error?: never }
  | { state?: never; error: string }

// Absolute camera coordinates and vector property keys belong to one particular structure.
// Restoring either globally can mis-frame or suppress vector discovery on the next structure.
const is_non_portable_structure_key = (key: StructureSettingKey): boolean =>
  key === `camera_position` || key === `vector_configs`

const object_value = (source: object | undefined, key: PropertyKey): unknown =>
  source && Reflect.has(source, key) ? Reflect.get(source, key) : undefined

const in_range = (value: unknown, min: number, max: number): value is number =>
  typeof value === `number` && Number.isFinite(value) && value >= min && value <= max

const normalize_pane_size = (value: unknown): StructurePaneSize | undefined => {
  if (!is_plain_object(value)) return undefined
  const { width, height } = value
  if (!in_range(width, 200, 10000) || !in_range(height, 100, 10000)) return undefined
  return { width, height }
}

const normalize_supercell_scaling = (value: unknown): string => {
  if (typeof value !== `string` || !/^\d+(?:x\d+x\d+)?$/.test(value)) return `1x1x1`
  return value.split(`x`).every((factor) => Number(factor) > 0) ? value : `1x1x1`
}

const normalize_cell_type = (value: unknown): `original` | `conventional` | `primitive` =>
  value === `conventional` || value === `primitive` ? value : `original`

const structure_setting_source = (
  key: StructureSettingKey,
  source: StructureViewStateSource,
): unknown => {
  if (key === `show_image_atoms`) return source.show_image_atoms
  if (key === `show_trajectory_lines`) return source.show_trajectory_lines
  if (key === `atom_color_mode`) return object_value(source.atom_color_config, `mode`)
  if (key === `atom_color_scale`) return object_value(source.atom_color_config, `scale`)
  if (key === `atom_color_scale_type`)
    return object_value(source.atom_color_config, `scale_type`)
  return object_value(source.scene_props, key)
}

const normalize_structure_settings = (
  setting_value: (key: StructureSettingKey) => unknown,
): Partial<StructureSettings> => {
  const settings: Partial<StructureSettings> = {}
  for (const [raw_key, raw_setting] of Object.entries(SETTINGS_CONFIG.structure)) {
    const key = raw_key as StructureSettingKey
    const setting = raw_setting as SettingType<StructureSettings[StructureSettingKey]>
    if (is_non_portable_structure_key(key)) continue
    Reflect.set(settings, key, validate_setting_value(setting_value(key), setting))
  }
  return settings
}

// Normalize flat live props and nested stored records into the same persisted shape.
const build_view_state = (
  settings: Record<string, unknown>,
  viewer: Record<string, unknown>,
  structure_setting: (key: StructureSettingKey) => unknown,
): StructureViewState => {
  const controls_pane_size = normalize_pane_size(viewer.controls_pane_size)
  const background_color =
    settings.background_color === undefined
      ? undefined
      : validate_setting_value(settings.background_color, SETTINGS_CONFIG.background_color)
  return {
    version: STRUCTURE_VIEW_STATE_VERSION,
    settings: {
      color_scheme: validate_setting_value(
        settings.color_scheme,
        SETTINGS_CONFIG.color_scheme,
      ),
      background_color,
      background_opacity: validate_setting_value(
        settings.background_opacity,
        SETTINGS_CONFIG.background_opacity,
      ),
      structure: normalize_structure_settings(structure_setting),
    },
    viewer: {
      supercell_scaling: normalize_supercell_scaling(viewer.supercell_scaling),
      cell_type: normalize_cell_type(viewer.cell_type),
      multi_view: viewer.multi_view === true,
      ...(controls_pane_size && { controls_pane_size }),
    },
  }
}

export const create_structure_view_state = (
  source: StructureViewStateSource = {},
): StructureViewState =>
  build_view_state(source, source, (key) => structure_setting_source(key, source))

const normalize_structure_view_state = (
  value: StructureViewState | Record<string, unknown>,
): StructureViewState => {
  const settings = is_plain_object(value.settings) ? value.settings : {}
  const structure = is_plain_object(settings.structure) ? settings.structure : {}
  return build_view_state(
    settings,
    is_plain_object(value.viewer) ? value.viewer : {},
    (key) => structure[key],
  )
}

export const deserialize_structure_view_state = (
  json: string,
): StructureViewStateParseResult => {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { error: `Invalid JSON` }
  }
  if (!is_plain_object(parsed)) return { error: `View state must be a JSON object` }
  if (parsed.version !== STRUCTURE_VIEW_STATE_VERSION) {
    return {
      error: `Unsupported view-state version ${String(parsed.version)}; expected ${STRUCTURE_VIEW_STATE_VERSION}`,
    }
  }
  return { state: normalize_structure_view_state(parsed) }
}

export const serialize_structure_view_state = (state: StructureViewState): string => {
  if (state.version !== STRUCTURE_VIEW_STATE_VERSION) {
    throw new Error(`Cannot serialize structure view state version ${String(state.version)}`)
  }
  return JSON.stringify(normalize_structure_view_state(state), null, 2)
}

const get_storage = (): Storage | null => {
  try {
    const storage = globalThis.localStorage
    return storage && typeof storage.getItem === `function` ? storage : null
  } catch {
    return null
  }
}

// Storage is untrusted browser input; failures must not break the viewer.
const try_storage_action = (action: () => void): boolean => {
  try {
    action()
    return true
  } catch {
    return false
  }
}
const discard_stored_state = (storage: Storage): boolean =>
  try_storage_action(() => storage.removeItem(STRUCTURE_VIEW_STATE_STORAGE_KEY))

export const load_structure_view_state = (): StructureViewState | null => {
  const storage = get_storage()
  if (!storage) return null
  try {
    const stored = storage.getItem(STRUCTURE_VIEW_STATE_STORAGE_KEY)
    if (stored === null) return null
    const { state } = deserialize_structure_view_state(stored)
    if (state) return state
  } catch {
    // fall through and purge whatever we could not read back
  }
  discard_stored_state(storage)
  return null
}

export const save_structure_view_state = (state: StructureViewState): boolean => {
  const storage = get_storage()
  if (!storage) return false
  const serialized = serialize_structure_view_state(state)
  // Storing a state identical to the defaults would pin today's defaults for good, so drop it.
  if (serialized === DEFAULT_VIEW_STATE_JSON) return discard_stored_state(storage)
  return try_storage_action(() =>
    storage.setItem(STRUCTURE_VIEW_STATE_STORAGE_KEY, serialized),
  )
}

export const clear_structure_view_state = (): boolean => {
  const storage = get_storage()
  return storage ? discard_stored_state(storage) : false
}

export const DEFAULT_STRUCTURE_VIEW_STATE = create_structure_view_state()

// every save compares against this, so serialize the defaults once rather than per keystroke
const DEFAULT_VIEW_STATE_JSON = serialize_structure_view_state(DEFAULT_STRUCTURE_VIEW_STATE)
