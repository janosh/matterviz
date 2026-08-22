// Scoped CSS rules whose class only ever reaches a *child component* (as a `class` prop) match
// nothing: Svelte scopes the rule to this component's elements, the child renders the element
// unscoped, and the compiler stays silent because the prop "might" match. #439 turned
// Trajectory's analysis-pane toggle anchors into four visible toolbar icons exactly this way.
// Such rules must be written with :global(...) around the component-owned class.
import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'svelte/compiler'
import { expect, test } from 'vitest'

const repo_root = resolve(import.meta.dirname, `../..`)
const svelte_files = globSync(`${repo_root}/src/**/*.svelte`)

type Node = Record<string, unknown>
const walk = (node: unknown, visit: (node: Node) => void): void => {
  if (!node || typeof node !== `object`) return
  if (Array.isArray(node)) return node.forEach((item) => walk(item, visit))
  visit(node as Node)
  for (const [key, value] of Object.entries(node)) {
    if (key !== `parent` && key !== `metadata`) walk(value, visit)
  }
}
// Every class name that can appear in a class attribute value: text, string literals,
// template quasis and the keys of `{ class_name: condition }` objects
const class_tokens = (attr: Node): string[] => {
  const tokens: string[] = []
  const add = (text: string) => tokens.push(...text.split(/\s+/).filter(Boolean))
  walk(attr.value, (node) => {
    if (node.type === `Text`) add(String(node.data))
    if (node.type === `Literal` && typeof node.value === `string`) add(node.value)
    if (node.type === `TemplateLiteral`) {
      for (const quasi of node.quasis as { value: { cooked: string } }[])
        add(quasi.value.cooked)
    }
    if (node.type === `Property`) {
      const key = node.key as Node
      if (key.type === `Identifier`) tokens.push(String(key.name))
      if (key.type === `Literal`) tokens.push(String(key.value))
    }
  })
  return tokens
}

// `file: .class` for every scoped class selector whose class only reaches child components
function component_only_class_selectors(file: string): string[] {
  const ast = parse(readFileSync(file, `utf8`), { modern: true })
  if (!ast.css) return []
  const on_elements = new Set<string>()
  const on_components = new Set<string>()
  walk(ast.fragment, (node) => {
    const type = String(node.type)
    if (![`RegularElement`, `SvelteElement`, `Component`, `SvelteComponent`].includes(type))
      return
    const target = type.endsWith(`Component`) ? on_components : on_elements
    for (const attr of node.attributes as Node[]) {
      if (attr.type === `Attribute` && attr.name === `class`)
        for (const cls of class_tokens(attr)) target.add(cls)
      if (attr.type === `ClassDirective`) target.add(String(attr.name))
    }
  })
  const offending = new Set<string>()
  // Only the selectors Svelte scopes count: class selectors outside any :global(...) argument,
  // including those nested in :is()/:not()/:has()/:where()
  const visit_selector_list = (list: Node[]): void => {
    for (const complex of list) {
      for (const relative of complex.children as Node[]) {
        for (const selector of relative.selectors as Node[]) {
          const name = String(selector.name)
          if (selector.type === `PseudoClassSelector` && name !== `global`) {
            visit_selector_list(((selector.args as Node | null)?.children as Node[]) ?? [])
          } else if (
            selector.type === `ClassSelector` &&
            !on_elements.has(name) &&
            on_components.has(name)
          ) {
            offending.add(`${file.replace(`${repo_root}/`, ``)}: .${name}`)
          }
        }
      }
    }
  }
  const visit_rule = (rule: Node): void => {
    const block = rule.block as Node | null
    if (rule.type === `Rule`) visit_selector_list((rule.prelude as Node).children as Node[])
    for (const child of (block?.children as Node[] | undefined) ?? []) visit_rule(child)
  }
  for (const rule of ast.css.children) visit_rule(rule as unknown as Node)
  return [...offending]
}

test(`no scoped CSS rule targets a class that only reaches a child component as a prop`, () => {
  expect(svelte_files.length).toBeGreaterThan(100)
  expect(svelte_files.flatMap(component_only_class_selectors)).toEqual([])
})
