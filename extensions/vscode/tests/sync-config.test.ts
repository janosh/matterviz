import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import pkg_json from '../package.json' with { type: 'json' }
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

  // The extension forwards every generated setting into the webview's DEFAULTS, so an id
  // nothing in the library reads (trajectory.index_above_bytes shipped that way, and before
  // it 13 keys like trajectory.loop_playback and structure.show_cell) is a documented toggle
  // wired to nothing. Leaf-name matching over the library and host sources; a generic leaf
  // such as `opacity` can still hide, every distinctively named dead key gets caught.
  // `key: _anything` in a destructure discards the setting rather than reading it; that is
  // how trajectory.show_parsing_progress (as `: _show_parsing_progress`) hid from the
  // leaf-name match for a release
  const unread_ids = (ids: string[], sources: string) => {
    const haystack = sources.replaceAll(/\b\w+: _\w+\b/g, ``)
    return ids.filter((id) => !new RegExp(`\\b${id.split(`.`).at(-1)}\\b`).test(haystack))
  }

  test(`every generated setting id is read by the library or the extension host`, () => {
    const sources = globSync([`src/lib/**/*.{ts,svelte}`, `extensions/vscode/src/**/*.ts`], {
      cwd: repo_root,
      exclude: [`**/node_modules/**`, `src/lib/settings.ts`],
    })
      .map((path) => readFileSync(resolve(repo_root, path), `utf8`))
      .join(`\n`)
    expect(unread_ids(Object.keys(generated), sources)).toEqual([])
  })

  test.each([
    [
      `nothing names it`,
      `const fps = settings.trajectory.fps`,
      [`matterviz.trajectory.zzz_unread`],
    ],
    [
      `same-name destructure discard`,
      `const { zzz_unread: _zzz_unread, ...rest } = cfg`,
      [`matterviz.trajectory.zzz_unread`],
    ],
    [
      `renamed destructure discard`,
      `const { zzz_unread: _unused, ...rest } = cfg`,
      [`matterviz.trajectory.zzz_unread`],
    ],
    [`bracket access`, `const value = settings[\`zzz_unread\`]`, []],
    [`full-id string read`, `config.get('matterviz.trajectory.zzz_unread')`, []],
    [
      `discard plus a real read elsewhere`,
      `const { zzz_unread: _x } = a\nuse(b.zzz_unread)`,
      [],
    ],
  ])(`unread detection: %s`, (_shape, sources, expected) => {
    expect(unread_ids([`matterviz.trajectory.zzz_unread`], sources)).toEqual(expected)
  })
})
