"""MACE model setup for benchmarks."""

from collections.abc import Callable
from functools import lru_cache
from typing import TYPE_CHECKING

import numpy as np
import torch
from pymatgen.core import Structure

if TYPE_CHECKING:
    from mace.calculators import MACECalculator


@lru_cache(maxsize=1)
def get_mace_model(device: str | None = None) -> "MACECalculator":
    """Load MACE-MP-0 Medium model (cached).

    Args:
        device: Device to load model on ('cuda' or 'cpu'). If None, auto-detects.

    Returns:
        MACECalculator instance
    """
    from mace.calculators import mace_mp

    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    return mace_mp(model="medium", device=device, default_dtype="float64")


def create_force_callback(
    mace_calc: "MACECalculator", structure: Structure
) -> Callable[[list[list[float]]], list[list[float]]]:
    """Create a force callback for ferrox from MACE calculator.

    The callback takes positions (Nx3) and returns forces (Nx3).

    Args:
        mace_calc: MACE calculator instance
        structure: Reference structure (for species and cell)

    Returns:
        Callable that computes forces from positions
    """
    from ase import Atoms

    # Pre-extract structure info
    symbols = [str(site.specie) for site in structure]
    cell = structure.lattice.matrix
    pbc = (
        list(structure.lattice.pbc)
        if hasattr(structure.lattice, "pbc")
        else [True, True, True]
    )

    def compute_forces(positions: list[list[float]]) -> list[list[float]]:
        """Compute forces using MACE.

        Args:
            positions: Nx3 array of atomic positions in Angstrom

        Returns:
            Nx3 array of forces in eV/Angstrom
        """
        pos_array = np.array(positions, dtype=np.float64)
        atoms = Atoms(symbols=symbols, positions=pos_array, cell=cell, pbc=pbc)
        atoms.calc = mace_calc
        forces = atoms.get_forces()
        return forces.tolist()

    return compute_forces
