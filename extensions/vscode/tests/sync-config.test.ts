import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import pkg_json from '../package.json' with { type: 'json' }
import { DEPRECATED_SETTINGS } from '$lib/settings'
import { build_custom_editor_selectors, build_vscode_settings } from '../scripts/sync-config'

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

  // Removed settings stay in the contributed configuration as deprecated entries so a stale
  // settings.json value gets flagged in the editor instead of being silently ignored
  test.each(Object.entries(DEPRECATED_SETTINGS))(
    `removed setting %s is emitted deprecated`,
    (key_path, { type, deprecated }) => {
      expect(generated[`matterviz.${key_path}`]).toEqual({
        type,
        deprecationMessage: deprecated,
      })
      expect(`default` in generated[`matterviz.${key_path}`]).toBe(false)
    },
  )

  test(`a live leaf's deprecated note becomes its deprecationMessage and removed keys may not collide`, () => {
    const schema = {
      plot: {
        old_toggle: { value: true, description: `Old toggle`, deprecated: `Use new_toggle` },
        new_toggle: { value: true, description: `New toggle` },
      },
    }
    const removed = { 'plot.gone': { type: `string` as const, deprecated: `Removed` } }
    expect(build_vscode_settings(schema, removed)).toEqual({
      'matterviz.plot.old_toggle': {
        type: `boolean`,
        default: true,
        description: `Old toggle`,
        deprecationMessage: `Use new_toggle`,
      },
      'matterviz.plot.new_toggle': {
        type: `boolean`,
        default: true,
        description: `New toggle`,
      },
      'matterviz.plot.gone': { type: `string`, deprecationMessage: `Removed` },
    })
    expect(() =>
      build_vscode_settings(schema, {
        'plot.new_toggle': { type: `boolean`, deprecated: `Removed` },
      }),
    ).toThrow(
      `matterviz.plot.new_toggle is both a live setting and listed in DEPRECATED_SETTINGS`,
    )
  })
})
