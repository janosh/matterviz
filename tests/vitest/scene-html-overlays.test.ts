// threlte's <HTML> wraps its content in a div that takes pointer events (its `pointerEvents`
// prop only applies with `transform`), so a label drawn over a 3D object swallowed the hover
// meant for that object: a chempot domain's tooltip never showed while the cursor sat on its
// formula label. SceneLabel is pointer-transparent unless `interactive`, so every overlay must
// go through it rather than use <HTML> directly.
import { globSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { parse } from 'svelte/compiler'
import { expect, test } from 'vite-plus/test'

const repo_root = resolve(import.meta.dirname, `../..`)

type Node = Record<string, unknown>
const has_html = (node: unknown): boolean => {
  if (!node || typeof node !== `object`) return false
  if (Array.isArray(node)) return node.some(has_html)
  const { type, name } = node as Node
  if (type === `Component` && /^(?:extras\.)?HTML$/.test(String(name))) return true
  return Object.entries(node).some(
    ([key, value]) => key !== `parent` && key !== `metadata` && has_html(value),
  )
}

test(`threlte <HTML> is only used through SceneLabel`, () => {
  const users = globSync(`${repo_root}/src/lib/**/*.svelte`).filter((file) => {
    const source = readFileSync(file, `utf8`)
    return /<(?:extras\.)?HTML\b/.test(source) && has_html(parse(source, { modern: true }))
  })
  expect(users.map((file) => relative(repo_root, file))).toEqual([
    `src/lib/scene/SceneLabel.svelte`,
  ])
})
