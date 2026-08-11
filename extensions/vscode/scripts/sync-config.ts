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
const vscode_setting_type = (value: unknown) =>
  Array.isArray(value) ? `array` : vscode_scalar_type(value)

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

const build_custom_editor_selectors = (): { filenamePattern: string }[] => {
  const ext_glob = `*.${brace([
    ...TEXT_VIEWER_EXTENSIONS,
    ...BINARY_VIEWER_EXTENSIONS,
    ...HINT_ONLY_EXTENSIONS,
  ])}`
  return [...with_gzip(ext_glob), ...KEYWORD_SELECTORS, ...vasp_selectors].map(
    (filenamePattern) => ({ filenamePattern }),
  )
}

function sync_package_config(): void {
  const package_path = resolve(import.meta.dirname, `..`, `package.json`)
  const package_text = readFileSync(package_path, `utf-8`)
  const package_content = JSON.parse(package_text)

  const vscode_config: Record<string, unknown> = {}

  function process_setting_schema(schema: SettingType, key_path: string): void {
    if (!schema || typeof schema !== `object`) return
    if (!(`value` in schema)) {
      for (const [key, value] of Object.entries(schema)) {
        const nested_key = key_path ? `${key_path}.${key}` : key
        process_setting_schema(value as SettingType, nested_key)
      }
      return
    }
    if (schema.context && ![`editor`, `all`].includes(schema.context)) return

    const config: Record<string, unknown> = {
      type: vscode_setting_type(schema.value),
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
      config.items = { type: vscode_scalar_type(schema.value[0]), ...schema.items }
    }
    vscode_config[key_path] = config
  }

  for (const [key, value] of Object.entries(SETTINGS_CONFIG)) {
    process_setting_schema(value, `matterviz.${key}`)
  }

  // Preserve existing non-schema settings (like auto_render, theme, etc.)
  const existing_props = package_content.contributes?.configuration?.properties ?? {}
  const schema_prefixes = Object.keys(SETTINGS_CONFIG).map((key) => `matterviz.${key}`)
  // Match at a `.` boundary so a manually maintained matterviz.structurePreview survives
  // alongside a generated matterviz.structure.* group.
  const preserved_props = Object.fromEntries(
    Object.entries(existing_props).filter(([key]) =>
      schema_prefixes.every((prefix) => key !== prefix && !key.startsWith(`${prefix}.`)),
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

sync_package_config()
