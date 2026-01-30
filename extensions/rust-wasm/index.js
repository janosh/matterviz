// Entry point for @matterviz/wasm
// Loads wasm-pack output dynamically, throws helpful error if not built

const NOT_BUILT = `ferrox-wasm not built. Run 'cd extensions/rust-wasm && pnpm build'`

let cached_module = null

// Initialize and return the full WASM module
// All exports are available on the returned object after init
export default async function init(options) {
  if (cached_module) {
    // Already initialized, just return cached module
    return cached_module
  }

  let mod
  try {
    mod = await import(`./pkg/ferrox.js`)
  } catch {
    throw new Error(NOT_BUILT)
  }

  // Initialize the WASM binary
  await mod.default(options)
  cached_module = mod
  return mod
}

// For TypeScript: re-export types (these are just type declarations, no runtime)
// The actual values come from the module returned by init()
