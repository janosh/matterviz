// Prop docs for the site's generated API reference: name, type, default and `//` comment of
// every prop in each src/lib component's `$props()` destructuring. The repo forbids JSDoc, so
// IDE hovers miss those comments; the demo pages show them instead (src/site/PropsTable.svelte).
// One TypeScript program over all component scripts resolves props a component inherits through
// imported or intersected types (BasePlotProps, Omit<...>, HTMLAttributes) to their declarations.
// Served by prop_docs_plugin as virtual modules, so nothing is written to disk.
import { globSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import ts from 'typescript'
import type { Plugin } from 'vite'

export type PropDoc = {
  name: string
  type?: string // as written in the declaring type, on one line
  default?: string // destructuring initializer, $bindable(...) unwrapped
  description?: string
  bindable?: true
  required?: true
}

const repo_root = resolve(import.meta.dirname, `../..`)
// Each component's merged <script> blocks become a virtual TS file next to it, so relative
// and #lib imports resolve as in the component
const VIRTUAL_SUFFIX = `.props.ts`
const LINT_PRAGMA_RE = /^(?:oxlint|eslint|oxfmt|prettier|@ts-)/

// Multi-line source text on one line, minus the padding, trailing commas and leading union
// operator its line breaks left
const one_line = (text: string): string =>
  text
    .replace(/\s+/g, ` `)
    .replace(/([([]) /g, `$1`)
    .replace(/,? ([)\]])/g, `$1`)
    .replace(/, \}/g, ` }`)
    .trim()
    .replace(/^[|&] /, ``)

const comment_lines = (text: string, ranges: readonly ts.CommentRange[]): string[] =>
  ranges
    .filter(({ kind }) => kind === ts.SyntaxKind.SingleLineCommentTrivia)
    .map(({ pos, end }) => text.slice(pos + 2, end).trim())
    .filter((line) => line && !LINT_PRAGMA_RE.test(line))

// `//` lines directly above a node (the block touching it, no blank line in between) plus a
// `//` comment trailing it on the same line, after an optional separator. A lone leading line
// of at most three unpunctuated words (`// Controls`, `// Axis configuration`) heads a group
// of props rather than describing this one, so it is skipped.
const node_comment = (node: ts.Node): string | undefined => {
  const { text } = node.getSourceFile()
  const leading = ts.getLeadingCommentRanges(text, node.pos) ?? []
  let block_start = leading.length
  let next_start = node.getStart()
  while (
    block_start > 0 &&
    !/\n[^\S\n]*\n/.test(text.slice(leading[block_start - 1].end, next_start))
  )
    next_start = leading[--block_start].pos
  const above = comment_lines(text, leading.slice(block_start))
  const is_section_header =
    above.length === 1 && /^[A-Z][\w-]*(?: [\w-]+){0,2}$/.test(above[0])
  const after = `;,`.includes(text[node.end]) ? node.end + 1 : node.end
  const lines = [
    ...(is_section_header ? [] : above),
    ...comment_lines(text, ts.getTrailingCommentRanges(text, after) ?? []),
  ]
  return lines.length ? lines.join(` `) : undefined
}

const parse = (text: string): ts.SourceFile =>
  ts.createSourceFile(`script.ts`, text, ts.ScriptTarget.ESNext, true)

const is_call_to = (node: ts.Node | undefined, name: string): node is ts.CallExpression =>
  node !== undefined &&
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === name

const find_props_declaration = (source: ts.SourceFile): ts.VariableDeclaration | undefined => {
  let found: ts.VariableDeclaration | undefined
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isVariableDeclaration(node) && is_call_to(node.initializer, `$props`)) found = node
    else ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const props_type_node = (declaration: ts.VariableDeclaration): ts.TypeNode | undefined =>
  declaration.type ??
  (is_call_to(declaration.initializer, `$props`)
    ? declaration.initializer.typeArguments?.[0]
    : undefined)

// TS for a component: its <script> blocks (module first, so the props annotation can use its
// types) plus a default export typed like the component, so `ComponentProps<typeof X>` in other
// components resolves to X's documented props. Generic parameters (`generics="T extends U"`)
// also become top-level aliases of their default or constraint for the annotation to use.
const component_ts = (svelte_source: string): string => {
  // attribute values may contain `>` (generics="T extends Record<K, V>")
  const scripts = [
    ...svelte_source.matchAll(/<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script>/g),
  ].map(([, attrs, body]) => ({ attrs, body, is_module: /\bmodule\b/.test(attrs) }))
  const body = [...scripts.filter((s) => s.is_module), ...scripts.filter((s) => !s.is_module)]
    .map((script) => script.body)
    .join(`\n`)
  const generics = scripts
    .map(({ attrs }) => /\bgenerics="([^"]*)"/.exec(attrs)?.[1])
    .find(Boolean)
  const lines = [body]
  if (generics) {
    const [alias] = parse(`type _<${generics}> = 0`).statements
    for (const param of ts.isTypeAliasDeclaration(alias) ? (alias.typeParameters ?? []) : []) {
      const target = param.default ?? param.constraint
      lines.push(`type ${param.name.text} = ${target?.getText() ?? `unknown`}`)
    }
  }
  const declaration = find_props_declaration(parse(body))
  const props_type = (declaration && props_type_node(declaration)?.getText()) ?? `{}`
  const type_params = generics ? `<${generics}>` : ``
  lines.push(
    `declare function __component${type_params}(this: void, internals: unknown, props: ${props_type}): {}`,
    `export default __component`,
  )
  return lines.join(`\n`)
}

const find_prop = (checker: ts.TypeChecker, type: ts.Type, name: string) =>
  type.isUnion()
    ? type.types.map((member) => checker.getPropertyOfType(member, name)).find(Boolean)
    : checker.getPropertyOfType(type, name)

const component_props = (source: ts.SourceFile, checker: ts.TypeChecker): PropDoc[] => {
  const declaration = find_props_declaration(source)
  if (!declaration || !ts.isObjectBindingPattern(declaration.name)) return []
  const type_node = props_type_node(declaration)
  const props_type = type_node && checker.getTypeFromTypeNode(type_node)
  return declaration.name.elements
    .filter((element) => !element.dotDotDotToken)
    .map((element) => {
      const name = (element.propertyName ?? element.name)
        .getText()
        .replace(/^['"`]|['"`]$/g, ``)
      const symbol = props_type ? find_prop(checker, props_type, name) : undefined
      // Intersections list a prop's declaration in every member type: prefer the repo's own
      // (e.g. BasePlotProps.children) over a library one (HTMLAttributes.children), and among
      // those the first with a comment
      const declarations = symbol?.declarations ?? []
      const own = declarations.filter(
        (decl) => !decl.getSourceFile().fileName.includes(`/node_modules/`),
      )
      const commented = own
        .map((decl) => ({ decl, comment: node_comment(decl) }))
        .find(({ comment }) => comment)
      const member = commented?.decl ?? own[0] ?? declarations[0]
      const written_type =
        member && ts.isPropertySignature(member) ? member.type?.getText() : undefined
      const type =
        written_type ?? (symbol && checker.typeToString(checker.getTypeOfSymbol(symbol)))
      const description = commented?.comment ?? node_comment(element)
      const bindable = is_call_to(element.initializer, `$bindable`)
      const init = bindable ? element.initializer.arguments[0] : element.initializer
      const doc: PropDoc = { name }
      if (type) doc.type = one_line(type)
      if (init) doc.default = one_line(init.getText())
      if (description) doc.description = description
      if (bindable) doc.bindable = true
      if (symbol && !(symbol.flags & ts.SymbolFlags.Optional)) doc.required = true
      return doc
    })
}

// Prop docs keyed by component name (file basename) for the given .svelte files. Components
// they import are loaded too (lazily, as virtual TS files) to resolve inherited prop types.
export const extract_prop_docs = (files: readonly string[]): Record<string, PropDoc[]> => {
  const virtual_files = new Map<string, string>()
  const virtual_text = (name: string): string => {
    let text = virtual_files.get(name)
    if (text === undefined) {
      text = component_ts(readFileSync(name.slice(0, -VIRTUAL_SUFFIX.length), `utf8`))
      virtual_files.set(name, text)
    }
    return text
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    types: [],
  }
  const host = ts.createCompilerHost(options, true)
  const { fileExists, getSourceFile, readFile } = host
  const is_virtual = (name: string): boolean =>
    name.endsWith(`.svelte${VIRTUAL_SUFFIX}`) &&
    fileExists(name.slice(0, -VIRTUAL_SUFFIX.length))
  host.fileExists = (name) => is_virtual(name) || fileExists(name)
  host.readFile = (name) => (is_virtual(name) ? virtual_text(name) : readFile(name))
  host.getSourceFile = (name, language, ...rest) =>
    is_virtual(name)
      ? ts.createSourceFile(name, virtual_text(name), language, true, ts.ScriptKind.TS)
      : getSourceFile(name, language, ...rest)
  // `./X.svelte` and `#lib/.../X.svelte` resolve to X's virtual TS file
  host.resolveModuleNameLiterals = (literals, containing_file, redirected, compiler_options) =>
    literals.map(({ text }) => {
      const resolve_name = (spec: string) =>
        ts.resolveModuleName(
          spec,
          containing_file,
          compiler_options,
          host,
          undefined,
          redirected,
        )
      const virtual = text.endsWith(`.svelte`)
        ? resolve_name(`${text}${VIRTUAL_SUFFIX}`)
        : undefined
      return virtual?.resolvedModule ? virtual : resolve_name(text)
    })
  const roots = files.map((file) => `${file}${VIRTUAL_SUFFIX}`)
  const program = ts.createProgram(roots, options, host)
  const checker = program.getTypeChecker()
  return Object.fromEntries(
    roots.map((root) => {
      const source = program.getSourceFile(root)
      if (!source) throw new Error(`TypeScript program is missing ${root}`)
      return [basename(root, `.svelte${VIRTUAL_SUFFIX}`), component_props(source, checker)]
    }),
  )
}

const VIRTUAL_ID = `virtual:prop-docs`

// `virtual:prop-docs` default-exports { [component]: () => import(`virtual:prop-docs/<component>`) }
// so each page loads only its own components' docs. The extraction (one TS program, a few
// seconds) runs on the first per-component load and reruns after src/lib changes.
export const prop_docs_plugin = (): Plugin => {
  const lib_dir = `${repo_root}/src/lib/`
  const component_files = globSync(`**/*.svelte`, { cwd: lib_dir })
    .map((path) => `${lib_dir}${path}`)
    .filter((file) => readFileSync(file, `utf8`).includes(`$props(`))
  const file_by_name = new Map(
    component_files.map((file) => [basename(file, `.svelte`), file]),
  )
  let docs: Record<string, PropDoc[]> | null = null
  return {
    name: `prop-docs`,
    resolveId: (id) => (id.startsWith(VIRTUAL_ID) ? `\0${id}` : null),
    load(id) {
      if (id === `\0${VIRTUAL_ID}`) {
        const loaders = [...file_by_name.keys()].map(
          (name) => `${JSON.stringify(name)}: () => import('${VIRTUAL_ID}/${name}')`,
        )
        return `export default {${loaders.join(`,`)}}`
      }
      if (!id.startsWith(`\0${VIRTUAL_ID}/`)) return null
      const name = id.slice(`\0${VIRTUAL_ID}/`.length)
      const file = file_by_name.get(name)
      if (!file) return this.error(`No src/lib component named ${name} calls $props()`)
      this.addWatchFile(file)
      docs ??= extract_prop_docs(component_files)
      return `export default ${JSON.stringify(docs[name])}`
    },
    watchChange(id) {
      if (id.startsWith(lib_dir)) docs = null
    },
  }
}
