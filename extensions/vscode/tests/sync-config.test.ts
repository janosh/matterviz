import { describe, expect, test } from 'vitest'
import pkg_json from '../package.json' with { type: 'json' }
import { build_custom_editor_selectors, build_vscode_settings } from '../scripts/sync-config'

describe(`sync-config`, () => {
  const generated = build_vscode_settings()

  test(`package.json carries exactly the generated settings plus the three host settings`, () => {
    // A removed schema setting must disappear from the manifest when it is regenerated.
    const props: Record<string, Record<string, unknown>> = pkg_json.contributes.configuration
      .properties
    expect(Object.keys(generated).length).toBeGreaterThan(200)
    expect(
      Object.keys(props)
        .filter((key) => !(key in generated))
        .toSorted(),
    ).toEqual([`matterviz.auto_render`, `matterviz.open_beside`, `matterviz.theme`])
    for (const [key, config] of Object.entries(generated)) {
      expect(props[key], key).toEqual(config)
      expect(config).not.toHaveProperty(`deprecationMessage`)
    }
    expect(pkg_json.contributes.customEditors[0].selector).toEqual(
      build_custom_editor_selectors(),
    )
  })

  // Object-valued leaves (free-form maps) used to be emitted as `type: string`, so VS Code
  // rejected every value a user could type for them
  test.each([
    [`string values by default`, {}, { type: `string` }],
    [`declared value type`, { additionalProperties: { type: `object` } }, { type: `object` }],
  ])(`an object leaf is a JSON-schema object map with %s`, (_name, extra, additional) => {
    const schema = {
      trajectory: {
        atom_type_mapping: { value: {}, description: `LAMMPS types to elements`, ...extra },
      },
    }
    expect(build_vscode_settings(schema)[`matterviz.trajectory.atom_type_mapping`]).toEqual({
      type: `object`,
      default: {},
      description: `LAMMPS types to elements`,
      additionalProperties: additional,
    })
    expect(generated[`matterviz.trajectory.atom_type_mapping`]).toMatchObject({
      type: `object`,
      additionalProperties: { type: `string` },
    })
    expect(generated[`matterviz.structure.vector_configs`]).toMatchObject({
      type: `object`,
      additionalProperties: { type: `object` },
    })
  })
})
