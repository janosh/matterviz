import * as lib from '#lib'
import * as host from '#lib/host.js'
import * as io from '#lib/io/index.js'
import * as labels from '#lib/labels.js'
import * as math from '#lib/math.js'
import * as scene from '#lib/scene/index.js'
import * as shortcuts from '#lib/shortcuts.js'
import * as utils from '#lib/utils.js'
import * as workers from '#lib/workers.js'
import { expect, test } from 'vite-plus/test'

test(`library exports all Svelte components from #lib/*.svelte`, () => {
  const svelte_files = Object.keys(import.meta.glob(`#lib/*.svelte`))
    .map((path) => path.split(`/`).pop()?.split(`.`).shift())
    .filter((name): name is string => name !== undefined)
  const lib_exports = Object.keys(lib)
  for (const component of svelte_files) {
    expect(lib_exports).toContain(component)
  }
})

test(`ELEMENT_CATEGORIES and ELEM_SYMBOLS match element_data`, () => {
  const categories = new Set(lib.element_data.map((elem) => elem.category))
  expect(categories).toEqual(new Set(labels.ELEMENT_CATEGORIES))
  expect(labels.ELEM_SYMBOLS).toEqual(lib.element_data.map((elem) => elem.symbol))
})

test(`io exports is_binary without misclassifying sparse high bytes`, () => {
  expect(io.is_binary(`\u00FF${`a`.repeat(20)}`)).toBe(false)
})

// Shared infrastructure is published only on its own subpath (matterviz/math, /utils, ...),
// so internals of those modules can never leak into the root barrel
test.each([
  [`math`, math, [`Vec3`, `grow_capacity`, `quickselect`, `mulberry32`, `det_3x3`]],
  [
    `utils`,
    utils,
    [`plain_copy`, `identity_token`, `value_key`, `memo_by_identity`, `yield_turn`],
  ],
  [`io`, io, [`is_binary`, `decompress_file`]],
  [`scene`, scene, [`scratch_matrix`]],
  [`labels`, labels, [`format_value`, `plural`]],
  [`shortcuts`, shortcuts, [`SHORTCUTS`]],
  [`host`, host, [`host`]],
  [`workers`, workers, [`disable_workers`, `check_blob_workers`]],
] as const)(`root barrel omits %s names, which stay on their subpath`, (_sub, mod, names) => {
  for (const name of names) {
    expect(lib, name).not.toHaveProperty(name)
    if (name !== `Vec3`) expect(mod, name).toHaveProperty(name)
  }
})
