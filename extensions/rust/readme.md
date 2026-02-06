# ferrox

High-performance base layer for computational materials science, written in Rust with Python and WebAssembly bindings. Provides 10-100x speedups for atomistic simulations.

## Features

- **Structure I/O**: Parse CIF, POSCAR, extXYZ, LAMMPS, and more
- **Structure Matching**: Fast deduplication and grouping with parallel processing
- **Symmetry Analysis**: Space groups, Wyckoff positions, primitive/conventional cells
- **Molecular Dynamics**: NVE/NVT integrators, thermostats, classical potentials
- **Surface Science**: Slab generation, Miller indices, adsorption sites, Wulff shapes
- **Defect Engineering**: Vacancies, substitutions, interstitials, Voronoi sites
- **Trajectory Analysis**: RDF, MSD, diffusion coefficients, order parameters
- **Properties**: XRD patterns, elastic tensors, coordination numbers
- **Python bindings**: Drop-in compatible with pymatgen Structure dictionaries

## Installation

```bash
pip install ferrox
```

## Usage

```python
import json
from ferrox import StructureMatcher
from pymatgen.core import Structure

# Create matcher with desired tolerances
matcher = StructureMatcher(latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0)

# Compare two structures
s1 = Structure(...)
s2 = Structure(...)
is_match = matcher.fit(json.dumps(s1.as_dict()), json.dumps(s2.as_dict()))

# Batch deduplication
structures = [s.as_dict() for s in my_structures]
json_strs = [json.dumps(s) for s in structures]
unique_indices = matcher.get_unique_indices(json_strs)
groups = matcher.group(json_strs)
```

## Development

Requires Rust 1.93+ and Python 3.11+.

```bash
# Build and install in development mode
cd extensions/rust
maturin develop --features python --release

# Run tests
cargo test
```

### Python Type Stubs

Python type stubs (`.pyi` files) are auto-generated from Rust code using `pyo3-stub-gen`. After modifying PyO3-exposed functions or classes, regenerate stubs:

```bash
python scripts/generate_stubs.py

# Verify stubs pass type checking
ty check python/ferrox
```

The script runs `cargo` to generate raw stubs, then cleans them to use modern Python type syntax (`X | None` instead of `Optional[X]`, `list[float]` instead of `builtins.list[builtins.float]`).

The CI pipeline automatically verifies stubs are in sync with Rust code.

## License

MIT
