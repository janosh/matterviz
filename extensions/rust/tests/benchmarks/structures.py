"""Structure generators for benchmarks."""

from collections.abc import Iterator, Mapping

from ase.build import bulk
from pymatgen.core import Structure
from pymatgen.io.ase import AseAtomsAdaptor


def make_supercell(
    formula: str, crystal: str, a: float, size: tuple[int, int, int]
) -> Structure:
    """Create supercell as pymatgen Structure.

    Args:
        formula: Chemical formula (e.g., 'MgO', 'Cu', 'Si')
        crystal: Crystal structure type ('rocksalt', 'fcc', 'diamond')
        a: Lattice parameter in Angstrom
        size: Supercell size as (nx, ny, nz)

    Returns:
        pymatgen Structure object
    """
    atoms = bulk(formula, crystalstructure=crystal, a=a, cubic=True) * size
    return AseAtomsAdaptor.get_structure(atoms)


def perturb_structure(structure: Structure, amplitude: float = 0.1) -> Structure:
    """Perturb atomic positions slightly for testing optimization.

    Args:
        structure: Input structure
        amplitude: Maximum displacement in Angstrom

    Returns:
        New structure with perturbed positions
    """
    import numpy as np

    rng = np.random.default_rng(seed=42)
    new_structure = structure.copy()
    for idx in range(len(new_structure)):
        displacement = rng.uniform(-amplitude, amplitude, size=3)
        new_structure.translate_sites([idx], displacement, frac_coords=False)
    return new_structure


# System definitions (lazy-loaded to avoid import-time computation)
_SYSTEM_DEFINITIONS: dict[str, tuple[str, str, float, tuple[int, int, int]]] = {
    # MgO rocksalt - ionic material
    "mgo_8": ("MgO", "rocksalt", 4.21, (1, 1, 1)),  # 8 atoms
    "mgo_64": ("MgO", "rocksalt", 4.21, (2, 2, 2)),  # 64 atoms
    "mgo_216": ("MgO", "rocksalt", 4.21, (3, 3, 3)),  # 216 atoms
    "mgo_512": ("MgO", "rocksalt", 4.21, (4, 4, 4)),  # 512 atoms
    # Cu FCC - metallic
    "cu_32": ("Cu", "fcc", 3.61, (2, 2, 2)),  # 32 atoms
    "cu_108": ("Cu", "fcc", 3.61, (3, 3, 3)),  # 108 atoms
    "cu_256": ("Cu", "fcc", 3.61, (4, 4, 4)),  # 256 atoms
    # Si diamond - covalent semiconductor
    "si_64": ("Si", "diamond", 5.43, (2, 2, 2)),  # 64 atoms
    "si_216": ("Si", "diamond", 5.43, (3, 3, 3)),  # 216 atoms
}

_SYSTEMS_CACHE: dict[str, Structure] = {}


def get_system(name: str) -> Structure:
    """Get a predefined test system by name (lazy-loaded).

    Args:
        name: System name (e.g., 'mgo_64', 'cu_108', 'si_216')

    Returns:
        pymatgen Structure object
    """
    if name not in _SYSTEMS_CACHE:
        if name not in _SYSTEM_DEFINITIONS:
            available = ", ".join(sorted(_SYSTEM_DEFINITIONS.keys()))
            raise KeyError(f"Unknown system: '{name}'. Available: {available}")
        formula, crystal, a, size = _SYSTEM_DEFINITIONS[name]
        _SYSTEMS_CACHE[name] = make_supercell(formula, crystal, a, size)
    return _SYSTEMS_CACHE[name]


# For backward compatibility, provide SYSTEMS as a lazy-loading dict-like interface
class _LazySystemsDict(Mapping[str, Structure]):
    """Dict-like object that lazily loads systems on access."""

    def __getitem__(self, key: str) -> Structure:
        return get_system(key)

    def __iter__(self) -> Iterator[str]:
        return iter(_SYSTEM_DEFINITIONS)

    def __len__(self) -> int:
        return len(_SYSTEM_DEFINITIONS)


SYSTEMS = _LazySystemsDict()
