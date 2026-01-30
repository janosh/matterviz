# @matterviz/ferrox-wasm

WebAssembly bindings for the [ferrox](../rust) structure matching library.

## Installation

```bash
pnpm add @matterviz/ferrox-wasm
```

## Building from Source

Requires [wasm-pack](https://rustwasm.github.io/wasm-pack/):

```bash
cargo install wasm-pack
```

Then build:

```bash
pnpm build
```

## Usage

```typescript
import init, { parse_cif, parse_poscar, WasmStructureMatcher } from '@matterviz/wasm'

// Initialize the WASM module
await init()

// Parse a structure from CIF content
const result = parse_cif(cifContent)
if ('ok' in result) {
  const structure = result.ok
  console.log(`Parsed structure with ${structure.sites.length} sites`)
} else {
  console.error(`Parse error: ${result.error}`)
}

// Compare two structures
const matcher = new WasmStructureMatcher()
  .with_latt_len_tol(0.2)
  .with_site_pos_tol(0.3)

const match_result = matcher.fit(structure1, structure2)
if ('ok' in match_result) {
  console.log(`Structures match: ${match_result.ok}`)
}
```

## API

### Parsing Functions

- `parse_structure(input)` - Parse from pymatgen-compatible JSON object
- `parse_cif(content)` - Parse from CIF content string
- `parse_poscar(content)` - Parse from POSCAR content string

### Structure Operations

- `make_supercell_diag(structure, nx, ny, nz)` - Create a supercell with diagonal scaling
- `get_reduced_structure(structure, algo)` - Get Niggli or LLL reduced structure
- `get_primitive(structure, symprec)` - Get the primitive cell
- `get_spacegroup_number(structure, symprec)` - Get the spacegroup number
- `structure_to_json(structure)` - Serialize to pymatgen-compatible JSON string

### WasmStructureMatcher

Builder-pattern structure matcher:

```typescript
const matcher = new WasmStructureMatcher()
  .with_latt_len_tol(0.2) // Fractional lattice length tolerance
  .with_site_pos_tol(0.3) // Normalized site position tolerance
  .with_angle_tol(5.0) // Angle tolerance in degrees
  .with_primitive_cell(true) // Reduce to primitive cell first
  .with_scale(true) // Scale volumes to match
  .with_element_comparator(false) // Use species (not just element) matching
```

Methods:

- `fit(struct1, struct2)` - Check if two structures match
- `fit_anonymous(struct1, struct2)` - Match under any species permutation
- `get_rms_dist(struct1, struct2)` - Get RMS distance between structures
- `deduplicate(structures)` - Find unique structures in a set
- `find_matches(new_structures, existing)` - Find matches against existing set

## Result Type

All functions return a discriminated union:

```typescript
type WasmResult<T> = { ok: T } | { error: string }
```

Use the helpers from the TypeScript wrapper:

```typescript
import { is_ok, unwrap } from '$lib/structure/ferrox-wasm'

const result = matcher.fit(s1, s2)
if (is_ok(result)) {
  console.log(result.ok) // boolean
} else {
  console.error(result.error) // string
}

// Or throw on error:
const matches = unwrap(result) // throws if error
```
