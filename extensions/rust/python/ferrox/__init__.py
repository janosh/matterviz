"""ferrox - High-performance crystallographic structure operations in Rust.

Features: I/O (CIF/POSCAR/extXYZ/JSON), structure matching, symmetry analysis,
coordination analysis, supercells, primitive/conventional cells, composition parsing,
oxidation state guessing and bond valence analysis.

## Submodule Organization

Functions are organized into submodules by domain:

- `ferrox.io` - Structure parsing and writing (CIF, POSCAR, XYZ, etc.)
- `ferrox.structure` - Structure manipulation (supercell, sort, interpolate, etc.)
- `ferrox.lattice` - Lattice operations (metric tensor, reduction, etc.)
- `ferrox.neighbors` - Neighbor lists and distance calculations
- `ferrox.coordination` - Coordination numbers and local environments
- `ferrox.composition` - Composition parsing and analysis
- `ferrox.symmetry` - Space groups, Wyckoff positions, symmetry operations
- `ferrox.defects` - Point defect generation and analysis
- `ferrox.surfaces` - Surface/slab operations, Miller indices, adsorption
- `ferrox.cell` - Cell operations (minimum image, reduction)
- `ferrox.elastic` - Elastic tensor calculations
- `ferrox.rdf` - Radial distribution functions
- `ferrox.xrd` - X-ray diffraction
- `ferrox.oxidation` - Oxidation state analysis
- `ferrox.order_params` - Steinhardt order parameters
- `ferrox.trajectory` - Trajectory analysis (MSD, diffusion)
- `ferrox.md` - Molecular dynamics integrators
- `ferrox.potentials` - Classical interatomic potentials (LJ, Morse, etc.)

## Usage Example

```python
from ferrox import Element
from ferrox import io, structure, defects

# Parse a structure file
struct = io.parse_file("POSCAR")

# Create a supercell
supercell = structure.make_supercell(struct, [[2, 0, 0], [0, 2, 0], [0, 0, 2]])

# Create a vacancy defect
defect = defects.create_vacancy(supercell, 0)
```
"""

# Top-level classes and submodules
from ferrox._ferrox import (
    Element,
    __version__,
    cell,
    composition,
    coordination,
    defects,
    elastic,
    io,
    lattice,
    md,
    neighbors,
    order_params,
    oxidation,
    potentials,
    rdf,
    structure,
    surfaces,
    symmetry,
    trajectory,
    xrd,
)

# Re-export commonly used classes at top level for convenience
# Users can import as: from ferrox import StructureMatcher
# Or via attribute access: ferrox.structure.StructureMatcher
StructureMatcher = structure.StructureMatcher
