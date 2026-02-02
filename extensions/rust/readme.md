# ferrox

High-performance structure matching for crystallographic data, written in Rust with Python bindings.

## Features

- **Fast matching**: Compare crystal structures for equivalence using the same algorithm as pymatgen's StructureMatcher
- **Batch processing**: Efficiently deduplicate and group large sets of structures with automatic parallelization
- **Python bindings**: Use from Python via PyO3 bindings, accepting pymatgen Structure.as_dict() JSON format

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

Requires Rust 1.70+ and Python 3.10+.

```bash
# Build and install in development mode
cd extensions/rust
maturin develop --features python --release

# Run tests
cargo test
```

## License

MIT
