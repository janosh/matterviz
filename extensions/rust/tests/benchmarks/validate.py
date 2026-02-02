"""Numerical validation utilities for benchmark comparisons."""

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np
from pymatgen.core import Structure
from pymatgen.io.ase import AseAtomsAdaptor

if TYPE_CHECKING:
    from mace.calculators import MACECalculator

    from .torchsim_runner import MaceModel


@dataclass
class ValidationResult:
    """Result of force/energy validation between packages."""

    max_force_diff: float
    mean_force_diff: float
    energy_diff: float | None
    passed: bool
    tolerance: float


def compute_forces_ferrox(
    structure: Structure, mace_calc: "MACECalculator"
) -> np.ndarray:
    """Compute forces using ferrox force callback.

    Args:
        structure: Input structure
        mace_calc: MACE calculator

    Returns:
        Nx3 array of forces in eV/Angstrom
    """
    from .mace_model import create_force_callback

    positions = [list(site.coords) for site in structure]
    force_fn = create_force_callback(mace_calc, structure)
    forces = force_fn(positions)
    return np.array(forces)


def compute_forces_ase(structure: Structure, mace_calc: "MACECalculator") -> np.ndarray:
    """Compute forces using ASE.

    Args:
        structure: Input structure
        mace_calc: MACE calculator

    Returns:
        Nx3 array of forces in eV/Angstrom
    """
    atoms = AseAtomsAdaptor.get_atoms(structure)
    atoms.calc = mace_calc
    return atoms.get_forces()


def compute_forces_torchsim(structure: Structure, model: "MaceModel") -> np.ndarray:
    """Compute forces using torch-sim.

    Args:
        structure: Input structure
        model: torch-sim MaceModel

    Returns:
        Nx3 array of forces in eV/Angstrom
    """
    from .torchsim_runner import structure_to_simstate

    device = str(model.device)
    state = structure_to_simstate(structure, device=device)

    # Run a single forward pass to get forces
    output = model(state)
    return output["forces"].detach().cpu().numpy()


def validate_forces(
    structure: Structure,
    mace_calc: "MACECalculator",
    torchsim_model: "MaceModel",
    tolerance: float = 1e-5,
) -> ValidationResult:
    """Validate that forces match across all packages.

    Args:
        structure: Test structure
        mace_calc: MACE calculator for ASE/ferrox
        torchsim_model: torch-sim MaceModel
        tolerance: Maximum allowed force difference in eV/Angstrom

    Returns:
        ValidationResult with comparison metrics
    """
    # Compute forces with each package
    forces_ferrox = compute_forces_ferrox(structure, mace_calc)
    forces_ase = compute_forces_ase(structure, mace_calc)
    forces_torchsim = compute_forces_torchsim(structure, torchsim_model)

    # Compare all pairs
    diff_ferrox_ase = np.abs(forces_ferrox - forces_ase)
    diff_ferrox_ts = np.abs(forces_ferrox - forces_torchsim)
    diff_ase_ts = np.abs(forces_ase - forces_torchsim)

    # Maximum difference across all pairs
    max_diff = max(diff_ferrox_ase.max(), diff_ferrox_ts.max(), diff_ase_ts.max())

    # Mean difference
    mean_diff = np.mean(
        [diff_ferrox_ase.mean(), diff_ferrox_ts.mean(), diff_ase_ts.mean()]
    )

    return ValidationResult(
        max_force_diff=float(max_diff),
        mean_force_diff=float(mean_diff),
        energy_diff=None,  # Could add energy validation too
        passed=bool(max_diff < tolerance),
        tolerance=float(tolerance),
    )


def validate_all_systems(
    systems: dict[str, Structure],
    mace_calc: "MACECalculator",
    torchsim_model: "MaceModel",
    tolerance: float = 1e-5,
) -> dict[str, ValidationResult]:
    """Validate forces for all test systems.

    Args:
        systems: Dict of system_name -> Structure
        mace_calc: MACE calculator for ASE/ferrox
        torchsim_model: torch-sim MaceModel
        tolerance: Maximum allowed force difference

    Returns:
        Dict of system_name -> ValidationResult
    """
    results = {}
    for name, structure in systems.items():
        results[name] = validate_forces(structure, mace_calc, torchsim_model, tolerance)
    return results


def print_validation_report(results: dict[str, ValidationResult]) -> None:
    """Print a summary of validation results.

    Args:
        results: Dict of system_name -> ValidationResult
    """
    print("\n" + "=" * 60)
    print("NUMERICAL VALIDATION REPORT")
    print("=" * 60)

    all_passed = True
    for name, result in results.items():
        status = "PASS" if result.passed else "FAIL"
        if not result.passed:
            all_passed = False
        print(f"\n{name}:")
        print(f"  Max force diff:  {result.max_force_diff:.2e} eV/A")
        print(f"  Mean force diff: {result.mean_force_diff:.2e} eV/A")
        print(f"  Tolerance:       {result.tolerance:.2e} eV/A")
        print(f"  Status:          {status}")

    print("\n" + "-" * 60)
    overall = "ALL PASSED" if all_passed else "SOME FAILED"
    print(f"Overall: {overall}")
    print("=" * 60 + "\n")
