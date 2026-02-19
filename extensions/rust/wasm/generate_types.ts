#!/usr/bin/env -S deno run -A
// Auto-generate types.d.ts from wasm-pack output + Rust source.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WASM_SRC = join(__dirname, `..`, `src`, `wasm`)
const PKG_DTS = join(__dirname, `pkg`, `ferrox.d.ts`)
const OUT_DTS = join(__dirname, `types.d.ts`)

const RUST_TO_TS: Record<string, string> = {
  'f32': `number`,
  'f64': `number`,
  'u8': `number`,
  'u16': `number`,
  'u32': `number`,
  'u64': `number`,
  'i8': `number`,
  'i16': `number`,
  'i32': `number`,
  'i64': `number`,
  'usize': `number`,
  'bool': `boolean`,
  'String': `string`,
  '()': `void`,
}

const RUST_SPECIAL: Record<string, string> = {
  '[[f64; 3]; 3]': `Matrix3x3`,
  'JsCrystal': `Crystal`,
}

function rust_type_to_ts(rust_type: string): string {
  rust_type = rust_type.trim()

  const option_match = rust_type.match(/^Option<(.+)>$/)
  if (option_match) return `${rust_type_to_ts(option_match[1])} | null`

  const vec_match = rust_type.match(/^Vec<(.+)>$/)
  if (vec_match) {
    const inner_type = rust_type_to_ts(vec_match[1])
    return inner_type.includes(`|`) ? `(${inner_type})[]` : `${inner_type}[]`
  }

  return RUST_TO_TS[rust_type] ?? RUST_SPECIAL[rust_type] ?? rust_type
}

function parse_rust_return_types(): Map<string, string> {
  const return_types = new Map<string, string>()
  const rs_files = readdirSync(WASM_SRC).filter((file) => file.endsWith(`.rs`))

  for (const file of rs_files) {
    const content = readFileSync(join(WASM_SRC, file), `utf8`)
    const joined = content
      .replace(/^\s*\/\/.*$/gm, ``)
      .replace(/\/\*[\s\S]*?\*\//g, ``)
      .replace(/\n\s*/g, ` `)

    for (
      const match of joined.matchAll(
        /pub fn (\w+)\s*\([^)]*\)\s*->\s*WasmResult<([^{]+?)>\s*\{/g,
      )
    ) {
      return_types.set(match[1], rust_type_to_ts(match[2].trim()))
    }
  }

  return return_types
}

function apply_rules(
  input_text: string,
  rules: Array<[pattern: RegExp, replacement: string]>,
): string {
  return rules.reduce(
    (updated_text, [pattern, replacement]) => updated_text.replace(pattern, replacement),
    input_text,
  )
}

function remove_dead_defs(input_text: string): string {
  const dead_types = [`JsVector3`, `JsMatrix3x3`, `JsIntMatrix3x3`, `JsMillerIndex`]
  const dead_interfaces = [`JsCrystal`, `JsSite`, `JsSpeciesOccupancy`, `JsLattice`]
  const lines = input_text.split(`\n`)
  const filtered: string[] = []
  let skip_until = -1

  for (let idx = 0; idx < lines.length; idx++) {
    if (idx <= skip_until) continue
    const trimmed = lines[idx].trimStart()

    const is_dead_type = dead_types.some((name) =>
      trimmed.startsWith(`export type ${name}`)
    )
    const dead_interface = dead_interfaces.find((name) =>
      trimmed.startsWith(`export interface ${name} {`)
    )

    if (is_dead_type || dead_interface) {
      while (filtered.length > 0) {
        const previous_line = filtered.at(-1)?.trimStart() ?? ``
        if (!(previous_line.startsWith(`*`) || previous_line.startsWith(`/**`))) break
        filtered.pop()
      }
      if (dead_interface) {
        let depth = 0
        for (let line_idx = idx; line_idx < lines.length; line_idx++) {
          if (lines[line_idx].includes(`{`)) depth++
          if (lines[line_idx].includes(`}`)) depth--
          if (depth === 0) {
            skip_until = line_idx
            break
          }
        }
      } else if (is_dead_type) {
        let depth = 0
        let has_brace_block = false
        for (let line_idx = idx; line_idx < lines.length; line_idx++) {
          const line = lines[line_idx]
          const opens = line.match(/\{/g)?.length ?? 0
          const closes = line.match(/\}/g)?.length ?? 0
          if (opens > 0) has_brace_block = true
          depth += opens - closes
          if (line.trimEnd().endsWith(`;`) && (!has_brace_block || depth <= 0)) {
            skip_until = line_idx
            break
          }
        }
      }
      continue
    }

    filtered.push(lines[idx])
  }

  return filtered.join(`\n`)
}

function generate(): { output: string; n_typed: number } {
  let generated_dts: string
  try {
    generated_dts = readFileSync(PKG_DTS, `utf8`)
  } catch {
    console.error(
      `Error: ${PKG_DTS} not found. Run 'pnpm build' first to generate WASM bindings.`,
    )
    process.exit(1)
  }

  const return_types = parse_rust_return_types()
  const n_typed = return_types.size

  let patched = generated_dts.replace(
    /(\w+)\(([^)]*)\): WasmResult;/g,
    (full_match: string, fn_name: string, params: string) => {
      const ts_type = return_types.get(fn_name)
      if (ts_type) return `${fn_name}(${params}): WasmResult<${ts_type}>;`
      console.warn(`Warning: no return type found for ${fn_name}`)
      return full_match
    },
  )

  patched = patched.replace(
    /^(export function .+| {2,}\w+\(.+)\bJsCrystal\b/gm,
    (match: string) => match.replace(/\bJsCrystal\b/g, `Crystal`),
  )

  patched = apply_rules(patched, [
    [/\bMap<string,\s*([^>]+)>/g, `Record<string, $1>`],
    [/\bValue\b/g, `unknown`],
    [/\bMatrix3x3\b(?![\w[])/g, `JsMatrix3x3`],
    [/^(\s+(?!readonly\s)\w[\w?]*: .+) \| undefined;$/gm, `$1 | null;`],
    [/^\/\* tslint:disable \*\/\n\/\* eslint-disable \*\/\n/, ``],
    [/\nexport interface InitOutput \{[\s\S]*?\n\}\n/, `\n`],
    [/\nexport type SyncInitInput[^\n]*\n/, `\n`],
    [/\n\/\*\*\n \* Instantiates[\s\S]*?\*\/\nexport function initSync[^\n]*\n/, `\n`],
    [
      /\n\/\*\*\n \* If `module_or_path`[\s\S]*?\*\/\nexport default function __wbg_init[^\n]*\n/,
      `\n`,
    ],
  ])

  patched = remove_dead_defs(patched)

  patched = apply_rules(patched, [
    [/\bJsVector3\b/g, `Vec3`],
    [/\bJsMatrix3x3\b/g, `Matrix3x3`],
    [/\bJsIntMatrix3x3\b/g, `Matrix3x3`],
    [/\bJsMillerIndex\b/g, `Vec3`],
    // wasm-pack may inline tuple literals instead of named aliases.
    // Normalize these to shared Vec3 aliases to keep generated types DRY/stable.
    [
      /\[\[number, number, number\], \[number, number, number\], \[number, number, number\]\]/g,
      `[Vec3, Vec3, Vec3]`,
    ],
    [/\[number, number, number\]/g, `Vec3`],
    [
      /fit_anonymous\(struct1: Crystal, struct2: Crystal, mapping_name\?: string \| null, mapping\?: any \| null\): WasmResult<boolean>/g,
      `fit_anonymous(struct1: Crystal, struct2: Crystal, mapping_name?: string | null, mapping?: Record<string, string> | null): WasmResult<boolean>`,
    ],
    [
      /get_structure_distance_anonymous_mapped\(struct1: Crystal, struct2: Crystal, mapping: any\): WasmResult<number \| null>/g,
      `get_structure_distance_anonymous_mapped(struct1: Crystal, struct2: Crystal, mapping: Record<string, string>): WasmResult<number | null>`,
    ],
  ])

  const ascii_fixes: Record<string, string> = {
    '\u00c5\u00b3': `A^3`, // ų (mangled Å³)
    '\u0173': `A^3`, // ų (alternate mangling)
    '\u00c5ngstr\u00f6ms': `Angstroms`,
    'Nos\u00e9': `Nose`,
    '\u00b3': `^3`,
    '\u00c5.': `A.`,
    '\u00c5': `A`,
    'K\u03b1': `Ka`,
    '2\u03b8': `2-theta`,
    '\u00b2\u207a': `2+`,
    '\u00b2\u207b': `2-`,
  }
  for (const [old, replacement] of Object.entries(ascii_fixes)) {
    patched = patched.replaceAll(old, replacement)
  }

  patched = patched.replace(/;$/gm, ``)

  const header = `// Auto-generated by generate_types.ts — do not edit manually.
// Re-run: deno run -A extensions/rust/wasm/generate_types.ts
// Source: wasm-pack output (pkg/ferrox.d.ts) + Rust return types (src/wasm/*.rs)

export type { Crystal, Matrix3x3, Vec3 } from 'matterviz'
import type { Crystal, Matrix3x3, Vec3 } from 'matterviz'

// The module returned by init() has all exports from pkg/ferrox.js
import * as ferrox from './pkg/ferrox.d.ts'
export type FerroxModule = typeof ferrox

export default function init(
  options?:
    | { module_or_path?: InitInput | Promise<InitInput> }
    | InitInput
    | Promise<InitInput>,
): Promise<FerroxModule>

`

  return { output: header + patched.trim() + `\n`, n_typed }
}

const { output, n_typed } = generate()
writeFileSync(OUT_DTS, output)
console.log(`Generated ${OUT_DTS} (${n_typed} typed WasmResult<T> return types)`)
