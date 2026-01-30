// Dynamic loader for ferrox WASM module
// Throws a helpful error if wasm-pack hasn't been run yet

let wasmModule = null

async function loadWasm() {
  if (wasmModule) return wasmModule

  try {
    // Dynamic import - this will fail if pkg/ferrox.js doesn't exist
    wasmModule = await import(`./pkg/ferrox.js`)
    return wasmModule
  } catch (err) {
    const msg = `ferrox-wasm not built. Run 'cd extensions/rust-wasm && pnpm build' to compile.`
    throw new Error(msg, { cause: err })
  }
}

// Re-export init as default with lazy loading
export default async function init(options) {
  const mod = await loadWasm()
  return mod.default(options)
}

// Proxy all exports through the loader
export const WasmStructureMatcher = new Proxy(function () {}, {
  construct: () => {
    throw new Error(`ferrox-wasm not initialized. Call init() first or use ensure_ferrox_wasm_ready().`)
  },
})

// For functions, create async wrappers that load on first call
const createAsyncWrapper = (name) => async (...args) => {
  const mod = await loadWasm()
  if (!mod[name]) throw new Error(`Function ${name} not found in ferrox-wasm`)
  return mod[name](...args)
}

// Export async wrappers for all functions
export const parse_structure = createAsyncWrapper(`parse_structure`)
export const parse_cif = createAsyncWrapper(`parse_cif`)
export const parse_poscar = createAsyncWrapper(`parse_poscar`)
export const make_supercell_diag = createAsyncWrapper(`make_supercell_diag`)
export const make_supercell = createAsyncWrapper(`make_supercell`)
export const get_reduced_structure = createAsyncWrapper(`get_reduced_structure`)
export const get_primitive = createAsyncWrapper(`get_primitive`)
export const get_spacegroup_number = createAsyncWrapper(`get_spacegroup_number`)
export const structure_to_json = createAsyncWrapper(`structure_to_json`)
export const get_volume = createAsyncWrapper(`get_volume`)
export const get_total_mass = createAsyncWrapper(`get_total_mass`)
export const get_density = createAsyncWrapper(`get_density`)
export const get_neighbor_list = createAsyncWrapper(`get_neighbor_list`)
export const get_distance = createAsyncWrapper(`get_distance`)
export const get_distance_matrix = createAsyncWrapper(`get_distance_matrix`)
export const get_sorted_structure = createAsyncWrapper(`get_sorted_structure`)
export const get_sorted_by_electronegativity = createAsyncWrapper(`get_sorted_by_electronegativity`)
export const interpolate_structures = createAsyncWrapper(`interpolate_structures`)
export const copy_structure = createAsyncWrapper(`copy_structure`)
export const wrap_to_unit_cell = createAsyncWrapper(`wrap_to_unit_cell`)
export const translate_sites = createAsyncWrapper(`translate_sites`)
export const perturb_structure = createAsyncWrapper(`perturb_structure`)
export const get_atomic_mass = createAsyncWrapper(`get_atomic_mass`)
export const get_electronegativity = createAsyncWrapper(`get_electronegativity`)

// Direct access to loaded module (for advanced use after init)
export async function getModule() {
  return loadWasm()
}
