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
import { is_plain_object } from '$lib/utils'

// VS Code settings read by extension.ts directly rather than forwarded to the webview
const HOST_SETTING_KEYS = [`matterviz.theme`, `matterviz.auto_render`, `matterviz.open_beside`]

// Settings removed from SETTINGS_CONFIG that users may still have in their settings.json. They
// stay in the contributed configuration as deprecated entries (type plus `deprecationMessage`,
// no default) so the editor flags them instead of silently ignoring them.
const tick_format_removed = {
  type: `string`,
  deprecated: `Removed; tick formats are set per plot in its controls pane (Tick format)`,
} as const
const tick_count_removed = {
  type: `number`,
  deprecated: `Removed; tick counts follow the plot size automatically`,
} as const
export const DEPRECATED_SETTINGS: Readonly<
  Record<string, { type: `boolean` | `number` | `string`; deprecated: string }>
> = {
  'plot.grid_lines': {
    type: `boolean`,
    deprecated: `Removed; use matterviz.plot.display.x_grid / matterviz.plot.display.y_grid`,
  },
  'plot.axis_labels': { type: `boolean`, deprecated: `Removed; had no effect` },
  'plot.x_format': tick_format_removed,
  'plot.x2_format': tick_format_removed,
  'plot.y_format': tick_format_removed,
  'plot.y2_format': tick_format_removed,
  'plot.x_ticks': tick_count_removed,
  'plot.y_ticks': tick_count_removed,
}

// Formats with no decoder still get a useful "Reopen Editor With…" conversion hint.
// JupyterLab does not claim these because its file types displace the default handler.
const HINT_ONLY_EXTENSIONS = [`dcd`, `xtc`, `trr`]

// Heuristic selectors stay literal. They are narrower than the keyword lists in
// $lib/constants on purpose: generating from all of STRUCT_KEYWORDS would put a MatterViz
// entry on every *data*.json in the workspace.
// oxfmt-ignore
const KEYWORD_SELECTORS = [
  `*{structure,material,crystal,lattice,geometry}.{json,yaml,yml}.gz`,
  `*{trajectory,traj,relax,npt,nvt,nve,qha,md_,_md,-md,md-,md.,dynamics,simulation}*`,
]

const brace = (names: string[]) => `{${[...new Set(names)].sort().join(`,`)}}`
const with_gzip = (pattern: string): string[] => [pattern, `${pattern}.gz`]
const vscode_scalar_type = (value: unknown) =>
  typeof value === `boolean` || typeof value === `number` ? typeof value : `string`
const is_setting_type = (value: object): value is SettingType => `value` in value

const case_variants = (stems: readonly string[]): string[] =>
  stems.flatMap((stem) => [stem.toUpperCase(), stem])

// Structure stems must end the filename; a suffix wildcard would claim source files such
// as poscar_writer.py. Volumetric stems support decorated names such as run_CHGCAR_001.
const structure_glob = brace(
  case_variants(VASP_VIEWER_STEMS.filter((stem) => !VASP_VOLUMETRIC_FILES.includes(stem))),
)
const volumetric_glob = brace(case_variants(VASP_VOLUMETRIC_FILES))
const decorated_glob = brace(VASP_VOLUMETRIC_FILES.map((stem) => stem.toUpperCase()))

const vasp_selectors = [
  ...with_gzip(`*${structure_glob}`),
  ...with_gzip(volumetric_glob),
  ...with_gzip(`*[._-]${volumetric_glob}`),
  `${decorated_glob}[._-]*`,
  `*[._-]${decorated_glob}[._-]*`,
]

export const build_custom_editor_selectors = (): { filenamePattern: string }[] => {
  const ext_glob = `*.${brace([
    ...TEXT_VIEWER_EXTENSIONS,
    ...BINARY_VIEWER_EXTENSIONS,
    ...HINT_ONLY_EXTENSIONS,
  ])}`
  return [...with_gzip(ext_glob), ...KEYWORD_SELECTORS, ...vasp_selectors].map(
    (filenamePattern) => ({ filenamePattern }),
  )
}

// Every non-web_only leaf of SETTINGS_CONFIG as a `matterviz.<path>` VS Code setting, plus a
// deprecated entry (type + deprecationMessage, no default) for each removed key so the editor
// flags stale settings.json values. Exported so tests can check the generated ids against what
// the code actually reads; the schema/removed-key parameters let tests feed their own.
export const build_vscode_settings = (
  settings_schema: unknown = SETTINGS_CONFIG,
  deprecated_settings: typeof DEPRECATED_SETTINGS = DEPRECATED_SETTINGS,
): Record<string, Record<string, unknown>> => {
  const vscode_config: Record<string, Record<string, unknown>> = {}

  const process_setting_schema = (schema: unknown, key_path: string): void => {
    if (!schema || typeof schema !== `object`) return
    if (!is_setting_type(schema)) {
      for (const [key, value] of Object.entries(schema)) {
        process_setting_schema(value, `${key_path}.${key}`)
      }
      return
    }
    if (schema.web_only) return

    const config: Record<string, unknown> = {
      type: vscode_scalar_type(schema.value),
      default: schema.value,
      description: schema.description,
    }
    if (schema.minimum !== undefined) config.minimum = schema.minimum
    if (schema.maximum !== undefined) config.maximum = schema.maximum
    if (schema.multipleOf !== undefined) config.multipleOf = schema.multipleOf
    if (schema.minItems !== undefined) config.minItems = schema.minItems
    if (schema.maxItems !== undefined) config.maxItems = schema.maxItems
    if (schema.enum) config.enum = Object.keys(schema.enum)

    // Empty-array defaults cannot reveal an item type, so default those to string.
    if (Array.isArray(schema.value)) {
      config.type = `array`
      config.items = { type: vscode_scalar_type(schema.value[0]), ...schema.items }
    } else if (is_plain_object(schema.value)) {
      // Free-form map: any key, values of one type (string unless the leaf says otherwise)
      config.type = `object`
      config.additionalProperties = schema.additionalProperties ?? { type: `string` }
    }
    vscode_config[key_path] = config
  }

  process_setting_schema(settings_schema, `matterviz`)
  for (const [key_path, { type, deprecated }] of Object.entries(deprecated_settings)) {
    const full_path = `matterviz.${key_path}`
    if (full_path in vscode_config) {
      throw new Error(`${full_path} is both a live setting and listed in DEPRECATED_SETTINGS`)
    }
    vscode_config[full_path] = { type, deprecationMessage: deprecated }
  }
  return vscode_config
}

function sync_package_config(): void {
  const package_path = resolve(import.meta.dirname, `..`, `package.json`)
  const package_text = readFileSync(package_path, `utf-8`)
  const package_content = JSON.parse(package_text)
  const vscode_config = build_vscode_settings()

  // Host-only settings the extension reads itself survive regeneration; everything else is
  // owned by SETTINGS_CONFIG, so a group deleted from the schema disappears here too instead
  // of lingering as a documented toggle wired to nothing.
  const existing_props = package_content.contributes?.configuration?.properties ?? {}
  const preserved_props = Object.fromEntries(
    HOST_SETTING_KEYS.flatMap((key) =>
      key in existing_props ? [[key, existing_props[key]]] : [],
    ),
  )

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
    if (updated !== package_text) {
      console.error(`❌ package.json is stale — run \`pnpm -C extensions/vscode sync-config\``)
      process.exit(1)
    }
    console.info(`✅ package.json is in sync with SETTINGS_CONFIG and $lib file types`)
    return
  }

  writeFileSync(package_path, updated, `utf-8`)
  console.info(
    `✅ Synced ${Object.keys(vscode_config).length} settings and ${selectors.length} custom-editor selectors to package.json`,
  )
}

// Guard so importing the generators from tests does not rewrite package.json
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) sync_package_config()
