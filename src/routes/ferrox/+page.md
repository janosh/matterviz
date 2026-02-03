# Ferrox

Ferrox is a high-performance Rust library for crystallographic structure operations, with Python and WebAssembly bindings.

## Features

- **Fast structure matching**: Compare structures for equivalence with configurable tolerances
- **Batch deduplication**: Find unique structures in large datasets with parallel processing
- **File I/O**: Parse and write CIF, POSCAR, XYZ, EXTXYZ, and JSON formats
- **Symmetry analysis**: Space groups, Wyckoff positions, primitive/conventional cells
- **Coordination analysis**: Neighbor lists, coordination numbers, local environments
- **Defects & surfaces**: Point defect generation, slab construction, Miller indices
- **Molecular dynamics**: Integrators (Verlet, Langevin), thermostats (Nose-Hoover), NPT ensemble
- **Geometry optimization**: FIRE and CellFIRE optimizers
- **Classical potentials**: Lennard-Jones, Morse, soft sphere, harmonic bonds

## API Documentation

- [Rust API](/ferrox/rust) - Core Rust library documentation
- [Python API](/ferrox/python) - Python bindings via PyO3
- [WASM API](/ferrox/wasm) - WebAssembly/TypeScript bindings

## Installation

### Python

```bash
pip install ferrox
```

### Rust

```toml
[dependencies]
ferrox = "*"  # or pin to specific version from crates.io
```

### JavaScript/TypeScript (WASM)

Build from source and use in the browser:

```javascript
import init, * as ferrox from 'matterviz/structure/ferrox-wasm'

await init()
const result = ferrox.parse_cif(cif_content)
if (result.ok) {
  console.log(result.ok)
}
```

## Quick Examples

### Python Example

```python
from ferrox import io, structure, symmetry

# Parse a structure file
struct = io.parse_structure_file("POSCAR")

# Get symmetry info
spacegroup = symmetry.get_spacegroup_symbol(struct, symprec=0.01)
print(f"Space group: {spacegroup}")

# Create a 2x2x2 supercell
supercell = structure.make_supercell(struct, [[2, 0, 0], [0, 2, 0], [0, 0, 2]])
```

### Rust Example

```rust
use ferrox::{Structure, StructureMatcher};

let matcher = StructureMatcher::new()
    .with_latt_len_tol(0.2)
    .with_site_pos_tol(0.3)
    .with_angle_tol(5.0);

let is_match = matcher.fit(&struct1, &struct2);
```

### TypeScript/WASM

```typescript
import init, { get_spacegroup_symbol, parse_cif } from 'matterviz/structure/ferrox-wasm'

await init()

const result = parse_cif(cif_content)
if (result.ok) {
  const spacegroup = get_spacegroup_symbol(result.ok, 0.01)
  console.log(`Space group: ${spacegroup.ok}`)
}
```

## Links

- [GitHub: extensions/rust](https://github.com/janosh/matterviz/tree/main/extensions/rust)
- [PyPI: ferrox](https://pypi.org/project/ferrox/)
- [Releases](https://github.com/janosh/matterviz/releases) - Changelog and version history
- [Issues](https://github.com/janosh/matterviz/issues) - Bug reports and feature requests
