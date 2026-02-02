"""ASE benchmark runner functions."""

from typing import TYPE_CHECKING

import numpy as np
from ase import units
from ase.md.langevin import Langevin
from ase.md.velocitydistribution import MaxwellBoltzmannDistribution
from ase.md.verlet import VelocityVerlet
from ase.optimize import FIRE
from pymatgen.core import Structure

from .base_runner import structure_to_atoms
from .results import FireResult, MDResult
from .timing import gpu_timer

if TYPE_CHECKING:
    from mace.calculators import MACECalculator


def run_ase_fire(
    structure: Structure,
    mace_calc: "MACECalculator",
    max_steps: int = 100,
    fmax: float = 0.01,
) -> FireResult:
    """Run FIRE optimization using ASE."""
    atoms = structure_to_atoms(structure)
    atoms.calc = mace_calc

    n_steps_actual = 0

    def count_steps() -> None:
        nonlocal n_steps_actual
        n_steps_actual += 1

    optimizer = FIRE(atoms, logfile=None)
    optimizer.attach(count_steps)

    with gpu_timer() as timer:
        converged = optimizer.run(fmax=fmax, steps=max_steps)
        timer.n_steps = n_steps_actual

    return FireResult(
        timing=timer,
        final_max_force=float(np.max(np.abs(atoms.get_forces()))),
        converged=converged,
        n_steps_actual=n_steps_actual,
    )


def run_ase_nve(
    structure: Structure,
    mace_calc: "MACECalculator",
    n_steps: int = 100,
    dt: float = 1.0,
    temperature: float = 300.0,
) -> MDResult:
    """Run NVE MD using ASE velocity Verlet."""
    atoms = structure_to_atoms(structure)
    atoms.calc = mace_calc
    MaxwellBoltzmannDistribution(
        atoms, temperature_K=temperature, rng=np.random.default_rng(42)
    )
    dyn = VelocityVerlet(atoms, timestep=dt * units.fs, logfile=None)

    with gpu_timer() as timer:
        dyn.run(n_steps)
        timer.n_steps = n_steps

    return MDResult(
        timing=timer,
        final_temperature=atoms.get_temperature(),
        final_kinetic_energy=atoms.get_kinetic_energy(),
    )


def run_ase_nvt(
    structure: Structure,
    mace_calc: "MACECalculator",
    n_steps: int = 100,
    dt: float = 1.0,
    temperature: float = 300.0,
    friction: float = 0.01,
) -> MDResult:
    """Run NVT MD using ASE Langevin dynamics."""
    atoms = structure_to_atoms(structure)
    atoms.calc = mace_calc
    MaxwellBoltzmannDistribution(
        atoms, temperature_K=temperature, rng=np.random.default_rng(42)
    )
    dyn = Langevin(
        atoms,
        timestep=dt * units.fs,
        temperature_K=temperature,
        friction=friction / units.fs,
        logfile=None,
        rng=np.random.default_rng(42),
    )

    with gpu_timer() as timer:
        dyn.run(n_steps)
        timer.n_steps = n_steps

    return MDResult(
        timing=timer,
        final_temperature=atoms.get_temperature(),
        final_kinetic_energy=atoms.get_kinetic_energy(),
    )
