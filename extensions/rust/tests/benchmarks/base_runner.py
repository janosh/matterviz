"""Base classes and utilities for benchmark runners.

This module provides common abstractions to reduce code duplication across
ferrox_runner.py, ase_runner.py, and torchsim_runner.py.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np
from pymatgen.core import Structure
from pymatgen.io.ase import AseAtomsAdaptor

from .results import FireResult, MDResult
from .timing import gpu_timer

if TYPE_CHECKING:
    from ase import Atoms


@dataclass
class MDConfig:
    """Common configuration for MD simulations."""

    n_steps: int = 100
    dt: float = 1.0  # fs
    temperature: float = 300.0  # Kelvin
    friction: float = 0.01  # 1/fs (for NVT)
    seed: int = 42


@dataclass
class FireConfig:
    """Common configuration for FIRE optimization."""

    max_steps: int = 100
    fmax: float = 0.01  # eV/Angstrom


def structure_to_positions(structure: Structure) -> list[list[float]]:
    """Extract positions as nested list from pymatgen Structure."""
    return [list(site.coords) for site in structure]


def structure_to_atoms(structure: Structure) -> "Atoms":
    """Convert pymatgen Structure to ASE Atoms."""
    return AseAtomsAdaptor.get_atoms(structure)


def get_masses(structure: Structure) -> list[float]:
    """Get atomic masses from structure in amu."""
    return [float(site.specie.atomic_mass) for site in structure]


def get_cell_matrix(structure: Structure) -> list[list[float]]:
    """Get cell matrix from structure."""
    return structure.lattice.matrix.tolist()


def run_timed_md_loop(
    n_steps: int,
    step_fn: Callable[[], None],
    get_final_state: Callable[[], tuple[float, float]],
) -> MDResult:
    """Run a timed MD loop with common timing logic.

    Args:
        n_steps: Number of steps to run
        step_fn: Function to call for each step (no args)
        get_final_state: Function returning (temperature, kinetic_energy)

    Returns:
        MDResult with timing and final state
    """
    with gpu_timer() as timer:
        for _ in range(n_steps):
            step_fn()
        timer.n_steps = n_steps

    final_temp, final_ke = get_final_state()
    return MDResult(
        timing=timer,
        final_temperature=final_temp,
        final_kinetic_energy=final_ke,
    )


def run_timed_fire_loop(
    max_steps: int,
    step_fn: Callable[[], None],
    is_converged_fn: Callable[[float], bool],
    get_max_force_fn: Callable[[], float],
    fmax: float,
) -> FireResult:
    """Run a timed FIRE optimization loop with common timing logic.

    Args:
        max_steps: Maximum number of steps
        step_fn: Function to call for each step
        is_converged_fn: Function to check convergence given fmax
        get_max_force_fn: Function to get current max force
        fmax: Force convergence threshold

    Returns:
        FireResult with timing and convergence info
    """
    n_steps_actual = 0

    with gpu_timer() as timer:
        for step in range(max_steps):
            step_fn()
            n_steps_actual = step + 1
            if is_converged_fn(fmax):
                break
        timer.n_steps = n_steps_actual

    return FireResult(
        timing=timer,
        final_max_force=get_max_force_fn(),
        converged=is_converged_fn(fmax),
        n_steps_actual=n_steps_actual,
    )


def compute_temperature_from_velocities(
    velocities: np.ndarray, masses: np.ndarray
) -> float:
    """Compute temperature from velocities and masses.

    Args:
        velocities: Nx3 array of velocities
        masses: N array of masses in amu

    Returns:
        Temperature in Kelvin

    Raises:
        ValueError: If there are fewer than 2 atoms (n_dof would be <= 0)
    """
    # Boltzmann constant in eV/K
    kb_ev = 8.617333262e-5

    n_atoms = len(masses)
    n_dof = 3 * n_atoms - 3  # Remove COM

    if n_dof <= 0:
        raise ValueError(
            f"Need at least 2 atoms to compute temperature (got {n_atoms} atoms, "
            f"n_dof={n_dof})"
        )

    kinetic_energy = 0.5 * np.sum(masses[:, np.newaxis] * velocities**2)
    return 2.0 * kinetic_energy / (n_dof * kb_ev)


def compute_kinetic_energy(velocities: np.ndarray, masses: np.ndarray) -> float:
    """Compute kinetic energy from velocities and masses.

    Args:
        velocities: Nx3 array of velocities
        masses: N array of masses in amu

    Returns:
        Kinetic energy in eV
    """
    return 0.5 * np.sum(masses[:, np.newaxis] * velocities**2)
