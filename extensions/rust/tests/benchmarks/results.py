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


@dataclass
class BenchmarkResult:
    """Result for a single benchmark comparing ferrox, torch-sim, and ASE.

    Used by both compare.py (MACE benchmarks) and potential_benchmark.py (LJ/Morse).
    """

    system: str
    n_atoms: int
    benchmark_type: str  # 'fire', 'nve', 'nvt', 'lj', 'morse'
    n_steps: int
    ferrox_time: float | None  # None if runner failed
    ferrox_steps_per_sec: float | None
    torchsim_time: float | None
    torchsim_steps_per_sec: float | None
    ase_time: float | None
    ase_steps_per_sec: float | None
    ferrox_vs_torchsim: float | None  # speedup ratio (>1 means ferrox faster)
    ferrox_vs_ase: float | None
    potential: str | None = None  # e.g., 'lj', 'morse' (for potential benchmarks)
    error: str | None = None  # error message if any runner failed
