// $site/imports glob helpers and the structure demo picker built from them
import { glob_default, glob_text } from '$site/imports'
import { structure_files } from '$site/structures'
import { expect, test } from 'vitest'

// glob_text unwraps the module-namespace shape the Rolldown prod build returns
// (vitest runs the dev transform, so this is the only place that path is tested)
const parsed = { lattice: { a: 5 }, sites: [] }
test.each([
  [`dev value`, parsed, parsed],
  [`prod module namespace`, { default: parsed }, parsed],
])(`glob_default %s`, (_desc, input, expected) => {
  expect(glob_default(input)).toBe(expected)
})

test.each([
  [`dev raw string`, `data_test`, `data_test`],
  [`prod string default`, { default: `data_test` }, `data_test`],
  [`prod parsed default re-stringified`, { default: parsed }, JSON.stringify(parsed)],
  [`nullish`, null, ``], // structure_file_text's missing-entry check relies on ``
])(`glob_text %s`, (_desc, input, expected) => {
  expect(glob_text(input)).toBe(expected)
})

// Regression: a prior `typeof content === 'string'` filter dropped every crystal
// in prod (namespace objects aren't strings), leaving only molecules in the picker
test(`structure_files includes crystals`, () => {
  const by_name = new Map(structure_files.map((file) => [file.name, file]))
  expect(by_name.get(`Li4Fe3Mn1(PO4)4.cif`)?.category).toBe(`crystal`)
  expect(by_name.get(`Cu-FCC.json`)?.category).toBe(`crystal`)
  expect(by_name.get(`mp-19017.json.gz`)).toMatchObject({
    type: `JSON`,
    category: `crystal`,
  })
  expect(by_name.get(`AgI-fq978185p-phono3py.yaml.gz`)).toMatchObject({
    type: `YAML`,
    category: `crystal`,
  })
  expect(structure_files.filter((file) => file.category === `crystal`).length).toBeGreaterThan(
    30,
  )
})
