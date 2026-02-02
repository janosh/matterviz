"""Ferrox benchmark runner functions."""

from typing import TYPE_CHECKING

import ferrox
from pymatgen.core import Structure

from .base_runner import (
    get_masses,
    run_timed_fire_loop,
    run_timed_md_loop,
    structure_to_positions,
)
from .mace_model import create_force_callback
from .results import FireResult, MDResult

if TYPE_CHECKING:
    from mace.calculators import MACECalculator


def run_ferrox_fire(
    structure: Structure,
    mace_calc: "MACECalculator",
    max_steps: int = 100,
    fmax: float = 0.01,
) -> FireResult:
    """Run FIRE optimization using ferrox."""
    force_fn = create_force_callback(mace_calc, structure)
    config = ferrox.FireConfig()
    state = ferrox.FireState(structure_to_positions(structure), config)

    return run_timed_fire_loop(
        max_steps=max_steps,
        step_fn=lambda: state.step(force_fn),
        is_converged_fn=state.is_converged,
        get_max_force_fn=state.max_force,
        fmax=fmax,
    )


def run_ferrox_nve(
    structure: Structure,
    mace_calc: "MACECalculator",
    n_steps: int = 100,
    dt: float = 1.0,
    temperature: float = 300.0,
) -> MDResult:
    """Run NVE MD using ferrox velocity Verlet."""
    force_fn = create_force_callback(mace_calc, structure)
    state = ferrox.MDState(structure_to_positions(structure), get_masses(structure))
    state.init_velocities(temperature, seed=42)
    state.forces = force_fn(state.positions)

    return run_timed_md_loop(
        n_steps=n_steps,
        step_fn=lambda: ferrox.md_velocity_verlet_step(state, dt, force_fn),
        get_final_state=lambda: (state.temperature(), state.kinetic_energy()),
    )


def run_ferrox_nvt(
    structure: Structure,
    mace_calc: "MACECalculator",
    n_steps: int = 100,
    dt: float = 1.0,
    temperature: float = 300.0,
    friction: float = 0.01,
) -> MDResult:
    """Run NVT MD using ferrox Langevin dynamics."""
    force_fn = create_force_callback(mace_calc, structure)
    state = ferrox.MDState(structure_to_positions(structure), get_masses(structure))
    state.init_velocities(temperature, seed=42)
    integrator = ferrox.LangevinIntegrator(temperature, friction, dt, seed=42)

    return run_timed_md_loop(
        n_steps=n_steps,
        step_fn=lambda: integrator.step(state, force_fn),
        get_final_state=lambda: (state.temperature(), state.kinetic_energy()),
    )
