"""Shared types for benchmark runners."""

from dataclasses import dataclass

from .timing import TimingResult


@dataclass
class FireResult:
    """Result from FIRE optimization."""

    timing: TimingResult
    final_max_force: float
    converged: bool
    n_steps_actual: int


@dataclass
class MDResult:
    """Result from MD simulation."""

    timing: TimingResult
    final_temperature: float
    final_kinetic_energy: float
