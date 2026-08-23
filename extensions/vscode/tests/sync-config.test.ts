import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import pkg_json from '../package.json' with { type: 'json' }
import {
  build_custom_editor_selectors,
  build_vscode_settings,
  DEPRECATED_SETTINGS,
} from '../scripts/sync-config'

const repo_root = resolve(import.meta.dirname, `..`, `..`, `..`)

describe(`sync-config`, () => {
  const generated = build_vscode_settings()

  test(`package.json carries exactly the generated settings plus the three host settings`, () => {
    // sync-config.ts only regenerates package.json on `prebuild`, so a schema edit stays
    // invisible to the editor until someone runs it. It also preserves properties it did not
    // generate, so a setting deleted from (or scoped away from the editor in) SETTINGS_CONFIG
    // could linger as a documented toggle wired to nothing.
    const props = pkg_json.contributes.configuration.properties as unknown as Record<
      string,
      Record<string, unknown>
    >
    expect(Object.keys(generated).length).toBeGreaterThan(200)
    expect(
      Object.keys(props)
        .filter((key) => !(key in generated))
        .toSorted(),
    ).toEqual([`matterviz.auto_render`, `matterviz.open_beside`, `matterviz.theme`])
    for (const [key, config] of Object.entries(generated))
      expect(props[key], key).toEqual(config)
    expect(pkg_json.contributes.customEditors[0].selector).toEqual(
      build_custom_editor_selectors(),
    )
  })

  // Removed settings stay in the contributed configuration as deprecated entries (no default)
  // so a stale settings.json value gets flagged in the editor instead of being silently ignored
  test.each(Object.entries(DEPRECATED_SETTINGS))(
    `removed setting %s is emitted deprecated`,
    (key_path, { type, deprecated }) => {
      expect(generated[`matterviz.${key_path}`]).toStrictEqual({
        type,
        deprecationMessage: deprecated,
      })
    },
  )

  test(`a removed key may not collide with a live setting`, () => {
    const schema = { plot: { new_toggle: { value: true, description: `New toggle` } } }
    const removed = { 'plot.new_toggle': { type: `boolean` as const, deprecated: `Removed` } }
    expect(() => build_vscode_settings(schema, removed)).toThrow(
      `matterviz.plot.new_toggle is both a live setting and listed in DEPRECATED_SETTINGS`,
    )
  })
})
