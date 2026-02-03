/// <reference lib="deno.ns" />
// Orchestrates documentation generation for ferrox Rust, Python, and WASM bindings
// Run with: deno run -A scripts/generate-ferrox-docs.ts
// Prerequisites:
// - pydoc-markdown installed (uv pip install pydoc-markdown)
// - typedoc installed (pnpm add -D typedoc typedoc-plugin-markdown)
// - wasm-pack built (for TypeDoc to find types.d.ts)
// - maturin built and ferrox installed (for pydoc-markdown to import the module)

const WORKSPACE_ROOT = new URL(`..`, import.meta.url).pathname.replace(/\/$/, ``)
const RUST_DIR = `${WORKSPACE_ROOT}/extensions/rust`
const ROUTES_DIR = `${WORKSPACE_ROOT}/src/routes/ferrox`

// Read version from Cargo.toml to avoid hardcoding
async function get_ferrox_version(): Promise<string> {
  try {
    const cargo_toml = await Deno.readTextFile(`${RUST_DIR}/Cargo.toml`)
    const match = cargo_toml.match(/^version\s*=\s*"([^"]+)"/m)
    return match?.[1] ?? `*`
  } catch {
    return `*`
  }
}

// Check if a file exists
async function file_exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path)
    return true
  } catch {
    return false
  }
}

interface CommandResult {
  success: boolean
  stderr: string
}

async function run_command(cmd: string[], cwd: string): Promise<CommandResult> {
  console.log(`  Running: ${cmd.join(` `)} (in ${cwd})`)
  const proc = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: `inherit`,
    stderr: `piped`,
  })
  const output = await proc.output()
  return {
    success: output.success,
    stderr: new TextDecoder().decode(output.stderr),
  }
}

// recursive: true doesn't throw if dir already exists
const ensure_dir = (path: string) => Deno.mkdir(path, { recursive: true })

// Escape Svelte syntax outside code blocks using Unicode lookalikes
// { → ❴ (U+2774), } → ❵ (U+2775), < → ‹ (U+2039), @ → ＠ (U+FF20)
const CODE_FENCE_RE = /^(\s*[-*+]?\s*|\s*\d+\.\s*)?(\`\`\`|~~~)/
const HTML_TAG_RE =
  /^<\/?(a|abbr|b|blockquote|br|code|dd|del|div|dl|dt|em|h[1-6]|hr|i|img|ins|kbd|li|ol|p|pre|q|s|small|span|strong|sub|sup|table|tbody|td|th|thead|tr|u|ul)[\s>\/]/i
const SVELTE_DIRECTIVE_RE = /^@(html|const|render|debug|snippet)\b/

function escape_svelte_syntax(content: string): string {
  let in_code_block = false
  return content.split(`\n`).map((line) => {
    if (CODE_FENCE_RE.test(line)) {
      in_code_block = !in_code_block
      return line
    }
    if (in_code_block) return line

    // Replace backslash-escaped braces first, then process char by char
    const processed = line.replace(/\\{/g, `❴`).replace(/\\}/g, `❵`)
    let escaped = ``
    let in_inline_code = false
    for (let idx = 0; idx < processed.length; idx++) {
      const char = processed[idx]
      // Toggle inline code state on unescaped backticks
      if (char === `\`` && (idx === 0 || processed[idx - 1] !== `\\`)) {
        in_inline_code = !in_inline_code
        escaped += char
      } else if (in_inline_code) {
        escaped += char
      } else if (char === `{`) {
        escaped += `❴`
      } else if (char === `}`) {
        escaped += `❵`
      } else if (char === `<` || char === `@`) {
        const rest = processed.slice(idx)
        if (char === `<`) {
          escaped += HTML_TAG_RE.test(rest) || rest.startsWith(`<!`) ? char : `‹`
        } else {
          escaped += SVELTE_DIRECTIVE_RE.test(rest) ? `＠` : char
        }
      } else {
        escaped += char
      }
    }
    return escaped
  }).join(`\n`)
}

// Post-process generated markdown for SvelteKit/mdsvex compatibility
async function postprocess_markdown(filepath: string): Promise<void> {
  try {
    let content = await Deno.readTextFile(filepath)

    // Escape curly braces and angle brackets to prevent Svelte syntax errors
    content = escape_svelte_syntax(content)

    // Ensure the file doesn't have conflicting frontmatter
    if (!content.startsWith(`---`) && !content.startsWith(`#`)) {
      // Add a title if the file doesn't start with a heading
      // Strip /+page.md suffix, then get last segment, fallback to parent dir or "API"
      const path_without_suffix = filepath.replace(/\/\+page\.md$/, ``)
      const segments = path_without_suffix.split(`/`)
      const last_segment = segments.pop() || ``
      const filename = last_segment || segments.slice(-1)[0] || `API`
      content = `# ${filename}\n\n${content}`
    }

    await Deno.writeTextFile(filepath, content)
  } catch (err) {
    console.warn(`Warning: Could not post-process ${filepath}: ${err}`)
  }
}

async function generate_rust_docs(): Promise<boolean> {
  console.log(`\n📦 Generating Rust documentation...`)

  const output_dir = `${ROUTES_DIR}/rust`
  const output_file = `${output_dir}/+page.md`
  const version = await get_ferrox_version()

  await ensure_dir(output_dir)

  // Generate a placeholder page that links to rustdoc HTML
  // Full rustdoc markdown is too large for Svelte to compile
  const placeholder = `# Ferrox Rust API

The Rust API documentation is available at [docs.rs/ferrox](https://docs.rs/ferrox) once published.

For local development, run:

\`\`\`bash
cd extensions/rust
cargo doc --open
\`\`\`

## Links

- [GitHub: extensions/rust/src](https://github.com/janosh/matterviz/tree/main/extensions/rust/src)
- [crates.io](https://crates.io/crates/ferrox)
- [Releases](https://github.com/janosh/matterviz/releases)

## Key Modules

- **structure** - Crystal structure representation
- **structure_matcher** - Structure comparison algorithms
- **io** - File format parsers (CIF, POSCAR, XYZ)
- **symmetry** - Space group and symmetry operations
- **neighbors** - Neighbor list calculations
- **defects** - Point defect generation
- **surfaces** - Slab and surface construction
- **potentials** - Classical interatomic potentials
- **optimizers** - Geometry optimization (FIRE, CellFIRE)
- **md** - Molecular dynamics integrators

## Installation

Add to your \`Cargo.toml\`:

\`\`\`toml
[dependencies]
ferrox = "${version}"
\`\`\`
`

  await Deno.writeTextFile(output_file, placeholder)
  console.log(`  ✅ Rust docs generated at ${output_file}`)
  return true
}

async function generate_python_docs(): Promise<boolean> {
  console.log(`\n🐍 Generating Python documentation...`)

  const output_dir = `${ROUTES_DIR}/python`
  await ensure_dir(output_dir)

  const result = await run_command([`pydoc-markdown`], RUST_DIR)

  if (!result.success) {
    console.error(`  ❌ pydoc-markdown failed:`)
    console.error(result.stderr)
    return false
  }

  // Post-process
  const output_file = `${output_dir}/+page.md`
  await postprocess_markdown(output_file)

  console.log(`  ✅ Python docs generated at ${output_file}`)
  return true
}

async function generate_wasm_docs(): Promise<boolean> {
  console.log(`\n🌐 Generating WASM/TypeScript documentation...`)

  const wasm_dir = `${RUST_DIR}/wasm`
  const output_dir = `${ROUTES_DIR}/wasm`
  const types_file = `${wasm_dir}/pkg/ferrox.d.ts`

  // Check if wasm-pack output exists (types.d.ts imports from it)
  if (!await file_exists(types_file)) {
    console.error(`  ❌ Missing ${types_file} - run wasm-pack build first`)
    return false
  }

  await ensure_dir(output_dir)

  // Use npx with -p flags to ensure both packages are available
  const result = await run_command(
    [`npx`, `-p`, `typedoc`, `-p`, `typedoc-plugin-markdown`, `--`, `typedoc`],
    wasm_dir,
  )

  if (!result.success) {
    console.error(`  ❌ typedoc failed:`)
    console.error(result.stderr)
    return false
  }

  // TypeDoc generates multiple files - post-process all, then rename main entry
  try {
    const md_files: string[] = []
    for await (const entry of Deno.readDir(output_dir)) {
      if (entry.isFile && entry.name.endsWith(`.md`)) md_files.push(entry.name)
    }

    // Post-process all markdown files in parallel
    await Promise.all(
      md_files.map((name) => postprocess_markdown(`${output_dir}/${name}`)),
    )

    // Rename main entry file to +page.md, or create fallback
    const main_file = [`README.md`, `index.md`, `modules.md`].find((f) =>
      md_files.includes(f)
    )
    if (main_file) {
      await Deno.rename(`${output_dir}/${main_file}`, `${output_dir}/+page.md`)
    } else if (!md_files.includes(`+page.md`)) {
      await Deno.writeTextFile(
        `${output_dir}/+page.md`,
        `# WASM API\n\nSee generated documentation files.\n`,
      )
    }
  } catch (err) {
    console.warn(`  Warning: Post-processing issue: ${err}`)
  }

  console.log(`  ✅ WASM docs generated at ${output_dir}`)
  return true
}

async function main(): Promise<void> {
  console.log(`🔧 Ferrox Documentation Generator\n================================`)
  console.log(`Workspace: ${WORKSPACE_ROOT}`)

  const generators = [
    [`Rust`, generate_rust_docs],
    [`Python`, generate_python_docs],
    [`WASM`, generate_wasm_docs],
  ] as const

  const results = await Promise.allSettled(generators.map(([, fn]) => fn()))

  console.log(`\n📊 Summary:`)
  const all_success = results.every((res, idx) => {
    const ok = res.status === `fulfilled` && res.value
    console.log(
      `  ${ok ? `✅` : `❌`} ${generators[idx][0]}: ${ok ? `Success` : `Failed`}`,
    )
    return ok
  })

  console.log(all_success ? `\n✨ All docs generated!` : `\n⚠️  Some docs failed.`)

  if (!all_success) Deno.exit(1)
}

main().catch((err) => {
  console.error(err)
  Deno.exit(1)
})
