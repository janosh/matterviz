import { DEFAULTS, SETTINGS_CONFIG, type DefaultSettings, type SettingType } from '../settings'

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
  lattice_props?: object
  color_scheme?: unknown
  background_color?: unknown
  background_opacity?: unknown
  show_image_atoms?: unknown
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

const is_record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === `object` && !Array.isArray(value)

const clone_value = <Value>(value: Value): Value => {
  if (Array.isArray(value)) return value.map(clone_value) as Value
  if (!is_record(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, clone_value(nested)]),
  ) as Value
}

const object_value = (source: object | undefined, key: PropertyKey): unknown =>
  source && Reflect.has(source, key) ? Reflect.get(source, key) : undefined

const valid_number = (value: unknown, setting: SettingType<number>): value is number => {
  if (typeof value !== `number` || !Number.isFinite(value)) return false
  if (setting.minimum !== undefined && value < setting.minimum) return false
  if (setting.maximum !== undefined && value > setting.maximum) return false
  if (setting.multipleOf !== undefined) {
    const quotient = value / setting.multipleOf
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(quotient)) * 4
    if (Math.abs(quotient - Math.round(quotient)) > tolerance) return false
  }
  return true
}

const same_primitive_type = (value: unknown, reference: unknown): boolean =>
  typeof value === typeof reference && (typeof value !== `number` || Number.isFinite(value))

const valid_array = (value: unknown, setting: SettingType<readonly unknown[]>): boolean => {
  if (!Array.isArray(value)) return false
  if (setting.minItems !== undefined && value.length < setting.minItems) return false
  if (setting.maxItems !== undefined && value.length > setting.maxItems) return false
  const reference = setting.value
  // The only empty-array settings in the schema are element-symbol lists.
  if (reference.length === 0) return value.every((item) => typeof item === `string`)
  return value.every((item, item_idx) =>
    same_primitive_type(item, reference[item_idx] ?? reference[0]),
  )
}

const validate_setting_value = <Value>(value: unknown, setting: SettingType<Value>): Value => {
  const fallback = clone_value(setting.value)
  if (setting.enum) {
    return typeof value === `string` && Object.hasOwn(setting.enum, value)
      ? (value as Value)
      : fallback
  }
  if (typeof setting.value === `number`) {
    return valid_number(value, setting as SettingType<number>) ? (value as Value) : fallback
  }
  if (Array.isArray(setting.value)) {
    return valid_array(value, setting as SettingType<readonly unknown[]>)
      ? (clone_value(value) as Value)
      : fallback
  }
  if (is_record(setting.value)) {
    return is_record(value) ? (clone_value(value) as Value) : fallback
  }
  return same_primitive_type(value, setting.value) ? (value as Value) : fallback
}

const is_web_setting = (setting: SettingType): boolean =>
  setting.context === undefined || setting.context === `all` || setting.context === `web`

const in_range = (value: unknown, min: number, max: number): value is number =>
  typeof value === `number` && Number.isFinite(value) && value >= min && value <= max

const normalize_pane_size = (value: unknown): StructurePaneSize | undefined => {
  if (!is_record(value)) return undefined
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
  if (key === `atom_color_mode`) return object_value(source.atom_color_config, `mode`)
  if (key === `atom_color_scale`) return object_value(source.atom_color_config, `scale`)
  if (key === `atom_color_scale_type`)
    return object_value(source.atom_color_config, `scale_type`)
  const lattice_value = object_value(source.lattice_props, key)
  return lattice_value === undefined ? object_value(source.scene_props, key) : lattice_value
}

const normalize_structure_settings = (
  setting_value: (key: StructureSettingKey) => unknown,
): Partial<StructureSettings> => {
  const settings: Partial<StructureSettings> = {}
  for (const [raw_key, raw_setting] of Object.entries(SETTINGS_CONFIG.structure)) {
    const key = raw_key as StructureSettingKey
    const setting = raw_setting as SettingType<StructureSettings[StructureSettingKey]>
    if (!is_web_setting(setting) || is_non_portable_structure_key(key)) continue
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
  const settings = is_record(value.settings) ? value.settings : {}
  const structure = is_record(settings.structure) ? settings.structure : {}
  return build_view_state(
    settings,
    is_record(value.viewer) ? value.viewer : {},
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
  if (!is_record(parsed)) return { error: `View state must be a JSON object` }
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

// Storage is untrusted browser input; failure to remove it must not break the viewer.
const discard_stored_state = (storage: Storage): boolean => {
  try {
    storage.removeItem(STRUCTURE_VIEW_STATE_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

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
  try {
    storage.setItem(STRUCTURE_VIEW_STATE_STORAGE_KEY, serialized)
    return true
  } catch {
    return false
  }
}

export const clear_structure_view_state = (): boolean => {
  const storage = get_storage()
  return storage ? discard_stored_state(storage) : false
}

export const DEFAULT_STRUCTURE_VIEW_STATE = create_structure_view_state({
  lattice_props: DEFAULTS.structure,
  color_scheme: DEFAULTS.color_scheme,
  background_opacity: DEFAULTS.background_opacity,
  show_image_atoms: DEFAULTS.structure.show_image_atoms,
})

// every save compares against this, so serialize the defaults once rather than per keystroke
const DEFAULT_VIEW_STATE_JSON = serialize_structure_view_state(DEFAULT_STRUCTURE_VIEW_STATE)
