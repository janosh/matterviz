"""Torch-sim benchmark runner functions."""

import os
from typing import TYPE_CHECKING

import torch
from pymatgen.core import Structure

from .base_runner import run_timed_fire_loop, run_timed_md_loop, structure_to_atoms
from .results import FireResult, MDResult

if TYPE_CHECKING:
    from torch_sim import SimState
    from torch_sim.models.mace import MaceModel

KB_EV = 8.617333262e-5  # Boltzmann constant in eV/K


def get_torchsim_mace_model(device: str = "cpu") -> "MaceModel":
    """Load MACE model for torch-sim."""
    import glob

    from mace.calculators import mace_mp
    from torch_sim.models.mace import MaceModel

    calc = mace_mp(model="medium", device=device, default_dtype="float64")
    model_path = getattr(calc, "model_path", None) or getattr(calc, "models_path", None)
    if model_path is None:
        model_path = os.path.expanduser("~/.cache/mace")
        candidates = glob.glob(f"{model_path}/*model*")
        if not candidates:
            raise RuntimeError("Could not find MACE model path")
        model_path = max(candidates, key=os.path.getmtime)

    return MaceModel(model=model_path, device=torch.device(device), dtype=torch.float64)


def structure_to_simstate(structure: Structure, device: str = "cpu") -> "SimState":
    """Convert pymatgen Structure to torch-sim SimState."""
    from torch_sim import SimState

    atoms = structure_to_atoms(structure)
    return SimState(
        positions=torch.tensor(
            atoms.get_positions(), dtype=torch.float64, device=device
        ),
        masses=torch.tensor(atoms.get_masses(), dtype=torch.float64, device=device),
        cell=torch.tensor(atoms.get_cell().array, dtype=torch.float64, device=device),
        pbc=torch.tensor([True, True, True], device=device),
        atomic_numbers=torch.tensor(
            atoms.get_atomic_numbers(), dtype=torch.int64, device=device
        ),
    )


def run_torchsim_fire(
    structure: Structure,
    model: "MaceModel",
    max_steps: int = 100,
    fmax: float = 0.01,
) -> FireResult:
    """Run FIRE optimization using torch-sim."""
    from torch_sim import fire_init, fire_step

    fire_state = fire_init(structure_to_simstate(structure, str(model.device)), model)

    def step() -> None:
        nonlocal fire_state
        fire_state = fire_step(fire_state, model)

    def get_max_force() -> float:
        return torch.max(torch.abs(fire_state.forces)).item()

    return run_timed_fire_loop(
        max_steps=max_steps,
        step_fn=step,
        is_converged_fn=lambda fmax_thresh: get_max_force() < fmax_thresh,
        get_max_force_fn=get_max_force,
        fmax=fmax,
    )


def run_torchsim_nve(
    structure: Structure,
    model: "MaceModel",
    n_steps: int = 100,
    dt: float = 1.0,
    temperature: float = 300.0,
) -> MDResult:
    """Run NVE MD using torch-sim velocity Verlet."""
    from torch_sim import calc_temperature, nve_init, nve_step

    device = str(model.device)
    kT = torch.tensor(temperature * KB_EV, device=device, dtype=torch.float64)
    dt_tensor = torch.tensor(dt, device=device, dtype=torch.float64)
    md_state = nve_init(structure_to_simstate(structure, device), model, kT=kT, seed=42)

    def step() -> None:
        nonlocal md_state
        md_state = nve_step(md_state, model, dt=dt_tensor)

    def get_final_state() -> tuple[float, float]:
        temp = calc_temperature(
            masses=md_state.masses, velocities=md_state.velocities
        ).item()
        ke = (
            0.5
            * torch.sum(
                md_state.masses * torch.sum(md_state.velocities**2, dim=-1)
            ).item()
        )
        return temp, ke

    return run_timed_md_loop(n_steps, step, get_final_state)


def run_torchsim_nvt(
    structure: Structure,
    model: "MaceModel",
    n_steps: int = 100,
    dt: float = 1.0,
    temperature: float = 300.0,
    friction: float = 0.01,
) -> MDResult:
    """Run NVT MD using torch-sim Langevin dynamics."""
    from torch_sim import calc_temperature, nvt_langevin_init, nvt_langevin_step

    device = str(model.device)
    kT = torch.tensor(temperature * KB_EV, device=device, dtype=torch.float64)
    dt_tensor = torch.tensor(dt, device=device, dtype=torch.float64)
    gamma = torch.tensor(friction, device=device, dtype=torch.float64)
    md_state = nvt_langevin_init(
        structure_to_simstate(structure, device), model, kT=kT, seed=42
    )

    def step() -> None:
        nonlocal md_state
        md_state = nvt_langevin_step(md_state, model, dt=dt_tensor, kT=kT, gamma=gamma)

    def get_final_state() -> tuple[float, float]:
        temp = calc_temperature(
            masses=md_state.masses, velocities=md_state.velocities
        ).item()
        ke = (
            0.5
            * torch.sum(
                md_state.masses * torch.sum(md_state.velocities**2, dim=-1)
            ).item()
        )
        return temp, ke

    return run_timed_md_loop(n_steps, step, get_final_state)
