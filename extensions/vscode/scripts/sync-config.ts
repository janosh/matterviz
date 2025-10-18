/// <reference lib="deno.ns" />

import { SETTINGS_CONFIG, type SettingType } from '$lib/settings'

const readFileSync = (path: string) => Deno.readTextFileSync(path)
const writeFileSync = (path: string, data: string) => Deno.writeTextFileSync(path, data)
const join = (...paths: string[]) => {
  const separator = Deno.build.os === `windows` ? `\\` : `/`
  return paths.join(separator).replace(/[\/\\]+/g, separator)
}

// VSCode configuration generator that derives from your central settings schema
function sync_package_config() {
  const script_dir = new URL(`.`, import.meta.url).pathname
  const package_path = join(script_dir, `..`, `package.json`)
  const package_content = JSON.parse(readFileSync(package_path))

  // Auto-generate VSCode settings from SETTINGS_CONFIG
  const vscode_config: Record<string, unknown> = {}

  // Helper to process settings schema
  function process_setting_schema(schema: SettingType, key_path: string) {
    if (schema && typeof schema === `object` && `value` in schema) {
      // Skip settings that don't apply to editor context
      if (schema.context && ![`editor`, `all`].includes(schema.context)) return

      // This is a SettingSchema - cast to any to access dynamic properties
      const config: Record<string, unknown> = {
        type: typeof schema.value === `boolean`
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
      if (schema.minItems !== undefined) config.minItems = schema.minItems
      if (schema.maxItems !== undefined) config.maxItems = schema.maxItems
      if (schema.enum) {
        // Handle both array and object enums
        config.enum = Array.isArray(schema.enum) ? schema.enum : Object.keys(schema.enum)
      }

      // Add array item type for arrays
      if (Array.isArray(schema.value)) {
        const first_item = schema.value[0]
        config.items = {
          type: typeof first_item === `boolean`
            ? `boolean`
            : typeof first_item === `string`
            ? `string`
            : `number`,
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
  const existing_props = package_content.contributes?.configuration?.properties || {}
  const preserved_props: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(existing_props)) {
    // Preserve settings that aren't auto-generated from SETTINGS_CONFIG
    // Exclude both old .defaults.* settings and new schema-generated settings
    const is_schema_setting = Object.keys(SETTINGS_CONFIG).some((config_key) =>
      key.startsWith(`matterviz.${config_key}`) ||
      key.startsWith(`matterviz.defaults.${config_key}`)
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

  writeFileSync(package_path, JSON.stringify(package_content, null, 2) + `\n`)
  console.log(
    `✅ Synced ${
      Object.keys(vscode_config).length
    } settings from SETTINGS_CONFIG to package.json`,
  )
}

// Run the sync
sync_package_config()
