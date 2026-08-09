import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import {
  BINARY_VIEWER_EXTENSIONS,
  TEXT_VIEWER_EXTENSIONS,
  VASP_VIEWER_STEMS,
  VASP_VOLUMETRIC_FILES,
} from '$lib/constants'
import { SETTINGS_CONFIG, type SettingType } from '$lib/settings'

// Formats with no decoder. Kept because a custom editor at priority `option` only adds a
// "Reopen Editor With…" entry, and MatterViz answers .dcd with "convert with MDAnalysis
// first" — more use than the byte soup the default editor shows. JupyterLab deliberately
// does NOT claim these: there its file types are `defaultFor`, so a claim displaces a
// working handler rather than sitting beside it.
const HINT_ONLY_EXTENSIONS = [`dcd`, `xtc`, `trr`]

// Heuristic selectors stay literal. They are narrower than the keyword lists in
// $lib/constants on purpose: generating from all of STRUCT_KEYWORDS would put a MatterViz
// entry on every *data*.json in the workspace.
// oxfmt-ignore
const KEYWORD_SELECTORS = [
  `*{structure,material,crystal,lattice,geometry}.{json,yaml,yml}.gz`,
  `*{trajectory,traj,relax,npt,nvt,nve,qha,md_,_md,-md,md-,md.,dynamics,simulation}*`,
]

const brace = (stems: string[]) => `{${[...new Set(stems)].sort().join(`,`)}}`
const both_cases = (stems: readonly string[]) => [
  ...stems.map((stem) => stem.toUpperCase()),
  ...stems,
]

// VASP's canonical filenames carry no extension, so they are matched as name stems.
const stem_glob = brace(both_cases(VASP_VIEWER_STEMS))

// A trailing `[._-]*` also swallows a file extension, so these forms would claim
// write_poscar.py and contcar_reader.rs. Restricted to upper-case volumetric stems, which
// is what the hand-written list did and the only combination where decorated names
// (PARCHG.BAND_1, run_PARCHG_001) are real. Whether VS Code compares these case-sensitively
// is not worth depending on, hence a narrower stem set rather than a lower-case exclusion.
const decorated_stem_glob = brace(VASP_VOLUMETRIC_FILES.map((stem) => stem.toUpperCase()))

// Every extension MatterViz offers to open, plus the same set compressed. Both are derived
// so adding a format to $lib/constants reaches the editor registration automatically.
const build_custom_editor_selectors = (): { filenamePattern: string }[] => {
  const extensions = [
    ...new Set([
      ...TEXT_VIEWER_EXTENSIONS,
      ...BINARY_VIEWER_EXTENSIONS,
      ...HINT_ONLY_EXTENSIONS,
    ]),
  ].sort()
  const ext_glob = `*.{${extensions.join(`,`)}}`
  return [
    ext_glob,
    `${ext_glob}.gz`,
    ...KEYWORD_SELECTORS,
    stem_glob,
    `${stem_glob}.gz`,
    `*[._-]${stem_glob}`,
    `*[._-]${stem_glob}.gz`,
    `${decorated_stem_glob}[._-]*`,
    `${decorated_stem_glob}[._-]*.gz`,
    `*[._-]${decorated_stem_glob}[._-]*`,
    `*[._-]${decorated_stem_glob}[._-]*.gz`,
  ].map((filenamePattern) => ({ filenamePattern }))
}

// VSCode configuration generator that derives from your central settings schema
function sync_package_config() {
  const script_dir = import.meta.dirname
  const package_path = resolve(script_dir, `..`, `package.json`)
  const package_content = JSON.parse(readFileSync(package_path, `utf-8`))

  // Auto-generate VSCode settings from SETTINGS_CONFIG
  const vscode_config: Record<string, unknown> = {}

  // Helper to process settings schema
  function process_setting_schema(schema: SettingType, key_path: string) {
    if (schema && typeof schema === `object` && `value` in schema) {
      // Skip settings that don't apply to editor context
      if (schema.context && ![`editor`, `all`].includes(schema.context)) return

      const config: Record<string, unknown> = {
        type:
          typeof schema.value === `boolean`
            ? `boolean`
            : typeof schema.value === `number`
              ? `number`
              : Array.isArray(schema.value)
                ? `array`
                : `string`,
        default: schema.value,
        description: schema.description,
      }

      // Add constraints from schema
      if (schema.minimum !== undefined) config.minimum = schema.minimum
      if (schema.maximum !== undefined) config.maximum = schema.maximum
      if (schema.multipleOf !== undefined) config.multipleOf = schema.multipleOf
      if (schema.minItems !== undefined) config.minItems = schema.minItems
      if (schema.maxItems !== undefined) config.maxItems = schema.maxItems
      if (schema.enum) config.enum = Object.keys(schema.enum)

      // Add array item type for arrays. Empty-array defaults (e.g. the polyhedra
      // element lists) can't be introspected, so default those to string.
      if (Array.isArray(schema.value)) {
        const first_item = schema.value[0]
        config.items = {
          type:
            typeof first_item === `boolean`
              ? `boolean`
              : typeof first_item === `number`
                ? `number`
                : `string`,
        }
      }

      vscode_config[key_path] = config
    } else if (schema && typeof schema === `object`) {
      // This is a nested object, recurse
      Object.entries(schema).forEach(([key, value]) => {
        const nested_key = key_path ? `${key_path}.${key}` : key
        process_setting_schema(value as SettingType, nested_key)
      })
    }
  }

  // Process all settings from SETTINGS_CONFIG
  Object.entries(SETTINGS_CONFIG).forEach(([key, value]) => {
    const base_key = `matterviz.${key}`
    process_setting_schema(value, base_key)
  })

  // Preserve existing non-schema settings (like auto_render, theme, etc.)
  const existing_props = package_content.contributes?.configuration?.properties ?? {}
  const preserved_props: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(existing_props)) {
    // Preserve settings that aren't auto-generated from SETTINGS_CONFIG
    // Exclude both old .defaults.* settings and new schema-generated settings
    const is_schema_setting = Object.keys(SETTINGS_CONFIG).some(
      (config_key) =>
        key.startsWith(`matterviz.${config_key}`) ||
        key.startsWith(`matterviz.defaults.${config_key}`),
    )
    if (!is_schema_setting) preserved_props[key] = value
  }

  // Update package.json with generated + preserved settings
  package_content.contributes ??= {}
  package_content.contributes.configuration ??= { title: `MatterViz`, properties: {} }
  package_content.contributes.configuration.properties = {
    ...preserved_props,
    ...vscode_config,
  }

  const selectors = build_custom_editor_selectors()
  const editors = package_content.contributes.customEditors
  if (!Array.isArray(editors) || editors.length !== 1) {
    throw new Error(
      `expected exactly 1 customEditor to sync selectors into, got ${editors?.length}`,
    )
  }
  editors[0].selector = selectors

  const updated = `${JSON.stringify(package_content, null, 2)}\n`
  // --check: fail instead of writing, so CI catches a package.json that no longer matches
  // the shared lists (the settings half was only ever regenerated by a local prebuild).
  if (process.argv.includes(`--check`)) {
    if (updated === readFileSync(package_path, `utf-8`)) {
      console.info(`✅ package.json is in sync with SETTINGS_CONFIG and $lib file types`)
      return
    }
    console.error(`❌ package.json is stale — run \`pnpm -C extensions/vscode sync-config\``)
    process.exit(1)
  }

  writeFileSync(package_path, updated, `utf-8`)
  console.info(
    `✅ Synced ${Object.keys(vscode_config).length} settings and ${selectors.length} custom-editor selectors to package.json`,
  )
}

// Run the sync
sync_package_config()
