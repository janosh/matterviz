// Entry point for matterviz-wasm
// Loads wasm-pack output dynamically, throws helpful error if not built

const NOT_BUILT = `matterviz-wasm not built. Run 'pnpm build' in extensions/rust-wasm`

let cached_module = null
let init_promise = null

// Initialize and return the full WASM module
// All exports are available on the returned object after init
export default function init(options) {
  // Fast path: already initialized
  if (cached_module) return Promise.resolve(cached_module)

  // Memoize in-flight promise to prevent concurrent init races
  if (!init_promise) {
    init_promise = (async () => {
      let mod
      try {
        mod = await import(`./pkg/ferrox.js`)
      } catch (err) {
        throw new Error(NOT_BUILT, { cause: err })
      }
      await mod.default(options)
      cached_module = mod
      return mod
    })().catch((err) => {
      // Reset on failure so retry is possible
      init_promise = null
      throw err
    })
  }

  return init_promise
}

// For TypeScript: re-export types (these are just type declarations, no runtime)
// The actual values come from the module returned by init()
