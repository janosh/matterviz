import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

// build/widget-model-schema.json is typed from the components' declarations in dist/ at build
// time, so CI runs this after the anywidget build (publint job); the unit shards skip it
const build_dir = resolve(import.meta.dirname, `../../extensions/anywidget/build`)
const schema_path = `${build_dir}/widget-model-schema.json`
const has_build = existsSync(schema_path)
if (!has_build) {
  if (process.env.CI) throw new Error(`${schema_path} missing: run pnpm build:anywidget first`)
  console.warn(
    `anywidget not built: skipping widget-model-schema checks (pnpm build:anywidget)`,
  )
}

type KeySchema = { type: string[]; enum?: string[] }
const read_json = (name: string): unknown =>
  has_build ? JSON.parse(readFileSync(`${build_dir}/${name}`, `utf8`)) : {}

describe.runIf(has_build)(`widget-model-schema.json`, () => {
  const schema = read_json(`widget-model-schema.json`) as Record<
    string,
    Record<string, KeySchema>
  >
  const model_keys = read_json(`widget-model-keys.json`) as Record<string, string[]>

  // the build throws on a model key it can't type, so no key is omitted
  test(`describes exactly the keys of widget-model-keys.json`, () => {
    expect(Object.keys(schema).toSorted()).toEqual(Object.keys(model_keys).toSorted())
    for (const [widget_type, keys] of Object.entries(model_keys)) {
      expect(Object.keys(schema[widget_type]).toSorted(), widget_type).toEqual(keys.toSorted())
    }
  })

  test.each([
    [
      `structure`,
      `cell_type`,
      { type: [`string`], enum: [`conventional`, `original`, `primitive`] },
    ],
    [
      `scatter_plot_3d`,
      `camera_projection`,
      { type: [`string`], enum: [`orthographic`, `perspective`] },
    ],
    [
      `brillouin_zone`,
      `camera_projection`,
      { type: [`string`], enum: [`orthographic`, `perspective`] },
    ],
    // scene props, typed through Structure's scene_props
    [`structure`, `atom_radius`, { type: [`number`] }],
    [`trajectory`, `show_atoms`, { type: [`boolean`] }],
    [`convex_hull`, `show_stable`, { type: [`boolean`] }],
    // folded into x_axis.range
    [`scatter_plot`, `x_range`, { type: [`array`] }],
    // nullable_prop: None hides the bar
    [`scatter_plot`, `color_bar`, { type: [`object`, `null`] }],
    [`structure`, `hovered_site_idx`, { type: [`number`, `null`] }],
    // declared by the transforming derived prop
    [`structure`, `volumetric_data`, { type: [`object`, `array`] }],
    [`structure`, `style`, { type: [`string`, `null`] }],
  ])(`%s.%s is %j`, (widget_type, key, expected) => {
    expect(schema[widget_type][key]).toEqual(expected)
  })

  test(`descriptors list JSON kinds in a fixed order, enums only for strings`, () => {
    const kinds = [`string`, `number`, `boolean`, `object`, `array`, `null`]
    for (const [widget_type, keys] of Object.entries(schema)) {
      for (const [key, { type, enum: values, ...rest }] of Object.entries(keys)) {
        const where = `${widget_type}.${key}`
        expect(rest, where).toEqual({})
        expect(type.length, where).toBeGreaterThan(0)
        expect(type, where).toEqual(kinds.filter((kind) => type.includes(kind)))
        if (values) {
          expect(type, where).toContain(`string`)
          expect(values, where).toEqual([...new Set(values)].toSorted())
        }
      }
    }
  })
})
