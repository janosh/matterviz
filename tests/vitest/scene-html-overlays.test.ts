// threlte's <HTML> wraps its content in a div that takes pointer events (its `pointerEvents`
// prop only applies with `transform`), so a label drawn over a 3D object swallowed the hover
// meant for that object: a chempot domain's tooltip never showed while the cursor sat on its
// formula label. Every overlay must pass `style="pointer-events: none"` unless it is meant to
// be clicked, in which case it is listed here.
import { globSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { parse } from 'svelte/compiler'
import { expect, test } from 'vitest'

const repo_root = resolve(import.meta.dirname, `../..`)
const interactive = new Set([
  `src/lib/brillouin/KPath.svelte`, // high-symmetry point chips report hovers
  `src/lib/structure/StructureScene.svelte:bond_context_menu`, // buttons
])

type Node = Record<string, unknown>
const walk = (node: unknown, visit: (node: Node) => void): void => {
  if (!node || typeof node !== `object`) return
  if (Array.isArray(node)) return node.forEach((item) => walk(item, visit))
  visit(node as Node)
  for (const [key, value] of Object.entries(node)) {
    if (key !== `parent` && key !== `metadata`) walk(value, visit)
  }
}

test(`threlte <HTML> overlays let pointer events through unless meant to be clicked`, () => {
  const offenders: string[] = []
  let n_overlays = 0
  for (const file of globSync(`${repo_root}/src/lib/**/*.svelte`)) {
    const source = readFileSync(file, `utf8`)
    if (!/<(?:extras\.)?HTML\b/.test(source)) continue
    const path = relative(repo_root, file)
    walk(parse(source, { modern: true }).fragment, (node) => {
      if (node.type !== `Component` || !/^(?:extras\.)?HTML$/.test(String(node.name))) return
      n_overlays++
      const attrs = node.attributes as Node[]
      const style = attrs.find((attr) => attr.name === `style`)
      const style_text = JSON.stringify(style?.value ?? ``)
      const node_source = source.slice(Number(node.start), Number(node.end))
      const context = node_source.includes(`bond_context_menu`)
        ? `${path}:bond_context_menu`
        : path
      if (!/pointer-events:\s*none/.test(style_text) && !interactive.has(context)) {
        offenders.push(`${context}:${source.slice(0, Number(node.start)).split(`\n`).length}`)
      }
    })
  }
  expect(n_overlays).toBeGreaterThan(10)
  expect(offenders).toEqual([])
})
