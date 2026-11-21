// Types every widget model key against the props of the component it drives, read with the
// TypeScript compiler from the svelte-package declarations in dist/ (what the bundle mounts),
// for build/widget-model-schema.json
import ts from 'typescript'
import type { ModelKeySchema, ModelKeyTarget, ModelKind } from './reactive.svelte'

const kind_order: readonly ModelKind[] = [
  `string`,
  `number`,
  `boolean`,
  `object`,
  `array`,
  `null`,
]

type Kinds = { kinds: Set<ModelKind>; literals: Set<string>; open_string: boolean }

// JSON kinds of a TS type: undefined (unset) and functions/snippets (can't cross the JSON
// bridge) drop out, any/unknown allow every kind, enum keeps the string literals when no
// plain string is accepted
const type_kinds = (checker: ts.TypeChecker, type: ts.Type, acc: Kinds): Kinds => {
  const { flags } = type
  if (type.isUnion()) {
    for (const member of type.types) type_kinds(checker, member, acc)
  } else if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    for (const kind of kind_order) acc.kinds.add(kind)
    acc.open_string = true
  } else if (flags & ts.TypeFlags.TypeParameter) {
    const constraint = checker.getBaseConstraintOfType(type)
    type_kinds(checker, constraint ?? checker.getUnknownType(), acc)
  } else if (flags & ts.TypeFlags.Null) acc.kinds.add(`null`)
  else if (flags & ts.TypeFlags.StringLiteral) {
    acc.kinds.add(`string`)
    acc.literals.add((type as ts.StringLiteralType).value)
  } else if (flags & ts.TypeFlags.StringLike) {
    acc.kinds.add(`string`)
    acc.open_string = true
  } else if (flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike))
    acc.kinds.add(`number`)
  else if (flags & ts.TypeFlags.BooleanLike) acc.kinds.add(`boolean`)
  else if (
    flags &
    (ts.TypeFlags.Object | ts.TypeFlags.Intersection | ts.TypeFlags.NonPrimitive)
  ) {
    const kind = object_kind(checker, type)
    if (kind) acc.kinds.add(kind)
  } else if (!(flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Never))) {
    throw new Error(`no JSON kind for type ${checker.typeToString(type)}`)
  }
  return acc
}

// array for arrays, tuples and typed arrays (numeric index + length), undefined for functions
const object_kind = (checker: ts.TypeChecker, type: ts.Type): ModelKind | undefined => {
  if (checker.isArrayLikeType(type)) return `array`
  const numeric_index = checker.getIndexInfoOfType(type, ts.IndexKind.Number)
  if (numeric_index && type.getProperty(`length`)) return `array`
  const is_function = type.getCallSignatures().length > 0 && type.getProperties().length === 0
  return is_function ? undefined : `object`
}

// Schema of a value any of `types` accepts (one type per object member a prop path ran through)
const schema_of = (
  checker: ts.TypeChecker,
  types: readonly ts.Type[],
  where: string,
): ModelKeySchema => {
  const acc: Kinds = { kinds: new Set(), literals: new Set(), open_string: false }
  for (const type of types) type_kinds(checker, type, acc)
  const { kinds, literals, open_string } = acc
  if (!kinds.size) {
    const type_names = types.map((type) => checker.typeToString(type)).join(` | `)
    throw new Error(`${where} (${type_names}) takes no JSON`)
  }
  const kind_list = kind_order.filter((kind) => kinds.has(kind))
  return open_string || !literals.size
    ? { type: kind_list }
    : { type: kind_list, enum: [...literals].toSorted() }
}

// What a value must be to suit every target: kinds and enum intersected
const intersect = (schemas: ModelKeySchema[], where: string): ModelKeySchema => {
  const [first, ...rest] = schemas
  let type = first.type
  let values = first.enum
  for (const schema of rest) {
    type = type.filter((kind) => schema.type.includes(kind))
    if (schema.enum)
      values = values ? values.filter((val) => schema.enum?.includes(val)) : schema.enum
  }
  if (!type.length || values?.length === 0) {
    throw new Error(`${where} has no JSON kind all its targets accept`)
  }
  return values && type.includes(`string`) ? { type, enum: values } : { type }
}

// widget_type -> model key -> schema. components maps widget_type to its path under dist_dir
// (src/elements/components.ts), targets is the bundle's WIDGET_MODEL_TARGETS and model_keys
// its WIDGET_MODEL_KEYS. Throws listing every key without a target, stale prop path or
// type with no JSON kind
export function widget_model_schema(
  dist_dir: string,
  components: Readonly<Record<string, string>>,
  targets: Readonly<Record<string, Readonly<Record<string, readonly ModelKeyTarget[]>>>>,
  model_keys: Readonly<Record<string, readonly string[]>>,
): Record<string, Record<string, ModelKeySchema>> {
  const virtual_file = `${dist_dir}/__widget_model_schema.ts`
  const props_aliases = Object.entries(components).map(
    ([widget_type, path]) =>
      `import type C_${widget_type} from './${path}.svelte'
export type ${widget_type} = ComponentProps<typeof C_${widget_type}>`,
  )
  const source = `import type { ComponentProps } from 'svelte'\n${props_aliases.join(`\n`)}`
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: [`lib.esnext.d.ts`, `lib.dom.d.ts`, `lib.dom.iterable.d.ts`],
    types: [],
    skipLibCheck: true,
    noEmit: true,
  }
  const base_host = ts.createCompilerHost(options)
  const host: ts.CompilerHost = {
    ...base_host,
    getSourceFile: (file, language, ...rest) =>
      file === virtual_file
        ? ts.createSourceFile(file, source, language)
        : base_host.getSourceFile(file, language, ...rest),
    fileExists: (file) => file === virtual_file || base_host.fileExists(file),
    readFile: (file) => (file === virtual_file ? source : base_host.readFile(file)),
  }
  const program = ts.createProgram([virtual_file], options, host)
  const source_file = program.getSourceFile(virtual_file)
  const diagnostics = source_file ? program.getSemanticDiagnostics(source_file) : []
  if (!source_file || diagnostics.length) {
    const messages = diagnostics.map((diag) =>
      ts.flattenDiagnosticMessageText(diag.messageText, `\n`),
    )
    throw new Error(`can't read component props: ${messages.join(`; `)}`)
  }
  const checker = program.getTypeChecker()
  const module_symbol = checker.getSymbolAtLocation(source_file)
  const props_types = new Map(
    (module_symbol ? checker.getExportsOfModule(module_symbol) : []).map((symbol) => [
      symbol.name,
      checker.getDeclaredTypeOfSymbol(symbol),
    ]),
  )

  // Types at a prop path: the prop, then a key of its object members at each step (one type
  // per member that has the key)
  const types_at = (widget_type: string, path: readonly string[]): ts.Type[] => {
    const props_type = props_types.get(widget_type)
    if (!props_type) throw new Error(`no props type for ${widget_type}`)
    let types = [props_type]
    for (const [depth, key] of path.entries()) {
      const members = types
        .flatMap((type) => (type.isUnion() ? type.types : [type]))
        .filter((member) => object_kind(checker, member) === `object`)
      types = members.flatMap((member) => {
        const symbol = checker.getPropertyOfType(member, key)
        return symbol ? [checker.getTypeOfSymbol(symbol)] : []
      })
      if (!types.length) {
        throw new Error(`${widget_type}.${path.slice(0, depth + 1).join(`.`)} is not a prop`)
      }
    }
    return types
  }

  // every problem at once, so one build lists all stale specs
  const errors: string[] = []
  const schema = Object.fromEntries(
    Object.entries(model_keys).map(([widget_type, keys]) => [
      widget_type,
      Object.fromEntries(
        keys.flatMap((key) => {
          const where = `${widget_type}.${key}`
          try {
            const key_targets = targets[widget_type]?.[key] ?? []
            if (!key_targets.length) {
              throw new Error(`${where} has no target (DrivenProp.targets)`)
            }
            const schemas = key_targets.map((target) =>
              `type` in target
                ? target
                : schema_of(
                    checker,
                    types_at(widget_type, target),
                    `${widget_type}.${target.join(`.`)}`,
                  ),
            )
            return [[key, intersect(schemas, where)]]
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error))
            return []
          }
        }),
      ),
    ]),
  )
  if (errors.length) throw new Error(`widget-model-schema:\n  ${errors.join(`\n  `)}`)
  return schema
}
