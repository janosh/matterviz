"""Structure generators for benchmarks."""

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


# Predefined test systems with increasing sizes
SYSTEMS: dict[str, Structure] = {}


def _init_systems() -> None:
    """Initialize predefined test systems (lazy loading)."""
    if SYSTEMS:
        return  # Already initialized

    # MgO rocksalt - ionic material
    SYSTEMS["mgo_8"] = make_supercell("MgO", "rocksalt", 4.21, (1, 1, 1))  # 8 atoms
    SYSTEMS["mgo_64"] = make_supercell("MgO", "rocksalt", 4.21, (2, 2, 2))  # 64 atoms
    SYSTEMS["mgo_216"] = make_supercell("MgO", "rocksalt", 4.21, (3, 3, 3))  # 216 atoms
    SYSTEMS["mgo_512"] = make_supercell("MgO", "rocksalt", 4.21, (4, 4, 4))  # 512 atoms

    # Cu FCC - metallic
    SYSTEMS["cu_32"] = make_supercell("Cu", "fcc", 3.61, (2, 2, 2))  # 32 atoms
    SYSTEMS["cu_108"] = make_supercell("Cu", "fcc", 3.61, (3, 3, 3))  # 108 atoms
    SYSTEMS["cu_256"] = make_supercell("Cu", "fcc", 3.61, (4, 4, 4))  # 256 atoms

    # Si diamond - covalent semiconductor
    SYSTEMS["si_64"] = make_supercell("Si", "diamond", 5.43, (2, 2, 2))  # 64 atoms
    SYSTEMS["si_216"] = make_supercell("Si", "diamond", 5.43, (3, 3, 3))  # 216 atoms


# Initialize on import
_init_systems()
