# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "ase",
#     "numpy",
#     "torch",
#     "torch-sim",
# ]
#
# [tool.uv.sources]
# ferrox = { path = "../../", editable = true }
# ///
"""Lennard-Jones benchmark comparing native implementations.

This benchmark compares native LJ implementations in:
- ferrox (Rust)
- torch-sim (PyTorch)
- ASE (NumPy/Python)

Unlike the MACE benchmarks, this isolates algorithmic efficiency
without Python callback overhead since all implementations are native.

Run with: uv run lj_benchmark.py [--md-steps N] [--fire-steps N] [--output FILE]
"""

import argparse
import json
import math
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any

import ferrox
import numpy as np
import torch
from ase import Atoms, units
from ase.build import bulk
from ase.calculators.lj import LennardJones as AseLennardJones
from ase.md.langevin import Langevin
from ase.md.velocitydistribution import MaxwellBoltzmannDistribution
from ase.md.verlet import VelocityVerlet
from ase.optimize import FIRE
from torch_sim import (
    SimState,
    fire_init,
    fire_step,
    nve_init,
    nve_step,
    nvt_langevin_init,
    nvt_langevin_step,
)
from torch_sim.models.lennard_jones import LennardJonesModel as TorchSimLJ

# LJ parameters for Argon
SIGMA = 3.4  # Angstrom
EPSILON = 0.0103  # eV
CUTOFF = 10.0  # Angstrom
KB_EV = 8.617333262e-5  # Boltzmann constant in eV/K


def sanitize_nan(obj: Any) -> Any:
    """Recursively convert NaN floats to None for JSON compatibility."""
    if isinstance(obj, float) and math.isnan(obj):
        return None
    if isinstance(obj, dict):
        return {key: sanitize_nan(val) for key, val in obj.items()}
    if isinstance(obj, list):
        return [sanitize_nan(item) for item in obj]
    return obj


def safe_divide(numerator: float | None, denominator: float | None) -> float | None:
    """Safely divide two values, returning None if either is None or denominator is zero."""
    if numerator is None or denominator is None or denominator == 0:
        return None
    return numerator / denominator


@dataclass
class BenchmarkResult:
    """Result for a single benchmark."""

    system: str
    n_atoms: int
    benchmark_type: str
    n_steps: int
    ferrox_time: float | None
    ferrox_steps_per_sec: float | None
    torchsim_time: float | None
    torchsim_steps_per_sec: float | None
    ase_time: float | None
    ase_steps_per_sec: float | None
    ferrox_vs_torchsim: float | None
    ferrox_vs_ase: float | None


def make_lj_system(n_repeat: int) -> Atoms:
    """Create FCC Argon system with perturbed positions."""
    atoms = bulk("Ar", "fcc", a=5.26, cubic=True) * (n_repeat, n_repeat, n_repeat)
    rng = np.random.default_rng(42)
    atoms.positions += rng.uniform(-0.1, 0.1, atoms.positions.shape)
    return atoms


def create_torchsim_state(atoms: Atoms, device: str = "cpu") -> SimState:
    """Convert ASE Atoms to torch-sim SimState."""
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


# === Ferrox runners using native LJ ===


def make_lj_force_fn(
    cell: list[list[float]],
) -> Callable[[list[list[float]]], list[list[float]]]:
    """Create LJ force callback for ferrox."""

    def compute_forces(pos: list[list[float]]) -> list[list[float]]:
        _, forces = ferrox.compute_lennard_jones(
            pos, cell=cell, sigma=SIGMA, epsilon=EPSILON, cutoff=CUTOFF
        )
        return forces

    return compute_forces


def run_ferrox_lj_fire(atoms: Atoms, max_steps: int, fmax: float) -> tuple[float, int]:
    """Run FIRE optimization using ferrox with native LJ."""
    positions = [list(pos) for pos in atoms.get_positions()]
    force_fn = make_lj_force_fn(atoms.get_cell().array.tolist())

    config = ferrox.FireConfig()
    state = ferrox.FireState(positions, config)

    n_steps = 0
    start = time.perf_counter()
    for step in range(max_steps):
        state.step(force_fn)
        n_steps = step + 1
        if state.max_force() < fmax:
            break
    elapsed = time.perf_counter() - start

    return elapsed, n_steps


def run_ferrox_lj_nve(
    atoms: Atoms, n_steps: int, dt: float, temperature: float
) -> float:
    """Run NVE MD using ferrox with native LJ."""
    positions = [list(pos) for pos in atoms.get_positions()]
    force_fn = make_lj_force_fn(atoms.get_cell().array.tolist())

    state = ferrox.MDState(positions, atoms.get_masses().tolist())
    state.init_velocities(temperature, seed=42)

    start = time.perf_counter()
    for _ in range(n_steps):
        ferrox.md_velocity_verlet_step(state, dt, force_fn)

    return time.perf_counter() - start


def run_ferrox_lj_nvt(
    atoms: Atoms, n_steps: int, dt: float, temperature: float, friction: float
) -> float:
    """Run NVT MD using ferrox with native LJ."""
    positions = [list(pos) for pos in atoms.get_positions()]
    force_fn = make_lj_force_fn(atoms.get_cell().array.tolist())

    state = ferrox.MDState(positions, atoms.get_masses().tolist())
    state.init_velocities(temperature, seed=42)
    integrator = ferrox.LangevinIntegrator(temperature, friction, dt, seed=42)

    start = time.perf_counter()
    for _ in range(n_steps):
        integrator.step(state, force_fn)

    return time.perf_counter() - start


# === TorchSim runners using native LJ ===


def run_torchsim_lj_fire(
    atoms: Atoms, max_steps: int, fmax: float
) -> tuple[float, int]:
    """Run FIRE optimization using torch-sim with native LJ."""
    model = TorchSimLJ(sigma=SIGMA, epsilon=EPSILON, cutoff=CUTOFF, dtype=torch.float64)
    state = create_torchsim_state(atoms)
    fire_state = fire_init(state, model)

    n_steps = 0
    start = time.perf_counter()
    for step in range(max_steps):
        fire_state = fire_step(fire_state, model)
        max_force = torch.max(torch.abs(fire_state.forces)).item()
        n_steps = step + 1
        if max_force < fmax:
            break
    elapsed = time.perf_counter() - start

    return elapsed, n_steps


def run_torchsim_lj_nve(
    atoms: Atoms, n_steps: int, dt: float, temperature: float
) -> float:
    """Run NVE MD using torch-sim with native LJ."""
    model = TorchSimLJ(sigma=SIGMA, epsilon=EPSILON, cutoff=CUTOFF, dtype=torch.float64)
    state = create_torchsim_state(atoms)

    kT = torch.tensor(temperature * KB_EV, dtype=torch.float64)
    dt_tensor = torch.tensor(dt, dtype=torch.float64)
    md_state = nve_init(state, model, kT=kT, seed=42)

    start = time.perf_counter()
    for _ in range(n_steps):
        md_state = nve_step(md_state, model, dt=dt_tensor)

    return time.perf_counter() - start


def run_torchsim_lj_nvt(
    atoms: Atoms, n_steps: int, dt: float, temperature: float, friction: float
) -> float:
    """Run NVT MD using torch-sim with native LJ."""
    model = TorchSimLJ(sigma=SIGMA, epsilon=EPSILON, cutoff=CUTOFF, dtype=torch.float64)
    state = create_torchsim_state(atoms)

    kT = torch.tensor(temperature * KB_EV, dtype=torch.float64)
    dt_tensor = torch.tensor(dt, dtype=torch.float64)
    gamma = torch.tensor(friction, dtype=torch.float64)
    md_state = nvt_langevin_init(state, model, kT=kT, seed=42)

    start = time.perf_counter()
    for _ in range(n_steps):
        md_state = nvt_langevin_step(md_state, model, dt=dt_tensor, kT=kT, gamma=gamma)

    return time.perf_counter() - start


# === ASE runners using native LJ ===


def setup_ase_lj_atoms(atoms: Atoms) -> Atoms:
    """Copy atoms and attach LJ calculator."""
    atoms = atoms.copy()
    atoms.calc = AseLennardJones(sigma=SIGMA, epsilon=EPSILON, rc=CUTOFF)
    return atoms


def run_ase_lj_fire(atoms: Atoms, max_steps: int, fmax: float) -> tuple[float, int]:
    """Run FIRE optimization using ASE with native LJ."""
    atoms = setup_ase_lj_atoms(atoms)
    n_steps = 0

    def count_steps() -> None:
        nonlocal n_steps
        n_steps += 1

    optimizer = FIRE(atoms, logfile=None)
    optimizer.attach(count_steps)

    start = time.perf_counter()
    optimizer.run(fmax=fmax, steps=max_steps)

    return time.perf_counter() - start, n_steps


def run_ase_lj_nve(atoms: Atoms, n_steps: int, dt: float, temperature: float) -> float:
    """Run NVE MD using ASE with native LJ."""
    atoms = setup_ase_lj_atoms(atoms)
    MaxwellBoltzmannDistribution(
        atoms, temperature_K=temperature, rng=np.random.default_rng(42)
    )
    dyn = VelocityVerlet(atoms, timestep=dt * units.fs, logfile=None)

    start = time.perf_counter()
    dyn.run(n_steps)

    return time.perf_counter() - start


def run_ase_lj_nvt(
    atoms: Atoms, n_steps: int, dt: float, temperature: float, friction: float
) -> float:
    """Run NVT MD using ASE with native LJ."""
    atoms = setup_ase_lj_atoms(atoms)
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

    start = time.perf_counter()
    dyn.run(n_steps)

    return time.perf_counter() - start


# === Benchmark orchestration ===


def benchmark_fire(
    systems: dict[str, Atoms], max_steps: int = 100, fmax: float = 0.01
) -> list[BenchmarkResult]:
    """Run FIRE benchmark across all systems."""
    results = []

    for name, atoms in systems.items():
        print(f"\n  Running FIRE on {name} ({len(atoms)} atoms)...")

        print("    - ferrox...", end=" ", flush=True)
        ferrox_time, ferrox_steps = run_ferrox_lj_fire(atoms, max_steps, fmax)
        ferrox_sps = ferrox_steps / ferrox_time
        print(f"{ferrox_sps:.1f} steps/s")

        print("    - torch-sim...", end=" ", flush=True)
        ts_time, ts_steps = run_torchsim_lj_fire(atoms, max_steps, fmax)
        ts_sps = ts_steps / ts_time
        print(f"{ts_sps:.1f} steps/s")

        print("    - ase...", end=" ", flush=True)
        ase_time, ase_steps = run_ase_lj_fire(atoms, max_steps, fmax)
        ase_sps = ase_steps / ase_time
        print(f"{ase_sps:.1f} steps/s")

        results.append(
            BenchmarkResult(
                system=name,
                n_atoms=len(atoms),
                benchmark_type="fire",
                n_steps=ferrox_steps,
                ferrox_time=ferrox_time,
                ferrox_steps_per_sec=ferrox_sps,
                torchsim_time=ts_time,
                torchsim_steps_per_sec=ts_sps,
                ase_time=ase_time,
                ase_steps_per_sec=ase_sps,
                ferrox_vs_torchsim=safe_divide(ts_time, ferrox_time),
                ferrox_vs_ase=safe_divide(ase_time, ferrox_time),
            )
        )

    return results


def benchmark_nve(
    systems: dict[str, Atoms],
    n_steps: int = 100,
    dt: float = 5.0,
    temperature: float = 100.0,
) -> list[BenchmarkResult]:
    """Run NVE benchmark across all systems."""
    results = []

    for name, atoms in systems.items():
        print(f"\n  Running NVE on {name} ({len(atoms)} atoms)...")

        print("    - ferrox...", end=" ", flush=True)
        ferrox_time = run_ferrox_lj_nve(atoms, n_steps, dt, temperature)
        ferrox_sps = n_steps / ferrox_time
        print(f"{ferrox_sps:.1f} steps/s")

        print("    - torch-sim...", end=" ", flush=True)
        ts_time = run_torchsim_lj_nve(atoms, n_steps, dt, temperature)
        ts_sps = n_steps / ts_time
        print(f"{ts_sps:.1f} steps/s")

        print("    - ase...", end=" ", flush=True)
        ase_time = run_ase_lj_nve(atoms, n_steps, dt, temperature)
        ase_sps = n_steps / ase_time
        print(f"{ase_sps:.1f} steps/s")

        results.append(
            BenchmarkResult(
                system=name,
                n_atoms=len(atoms),
                benchmark_type="nve",
                n_steps=n_steps,
                ferrox_time=ferrox_time,
                ferrox_steps_per_sec=ferrox_sps,
                torchsim_time=ts_time,
                torchsim_steps_per_sec=ts_sps,
                ase_time=ase_time,
                ase_steps_per_sec=ase_sps,
                ferrox_vs_torchsim=safe_divide(ts_time, ferrox_time),
                ferrox_vs_ase=safe_divide(ase_time, ferrox_time),
            )
        )

    return results


def benchmark_nvt(
    systems: dict[str, Atoms],
    n_steps: int = 100,
    dt: float = 5.0,
    temperature: float = 100.0,
    friction: float = 0.01,
) -> list[BenchmarkResult]:
    """Run NVT benchmark across all systems."""
    results = []

    for name, atoms in systems.items():
        print(f"\n  Running NVT on {name} ({len(atoms)} atoms)...")

        print("    - ferrox...", end=" ", flush=True)
        ferrox_time = run_ferrox_lj_nvt(atoms, n_steps, dt, temperature, friction)
        ferrox_sps = n_steps / ferrox_time
        print(f"{ferrox_sps:.1f} steps/s")

        print("    - torch-sim...", end=" ", flush=True)
        ts_time = run_torchsim_lj_nvt(atoms, n_steps, dt, temperature, friction)
        ts_sps = n_steps / ts_time
        print(f"{ts_sps:.1f} steps/s")

        print("    - ase...", end=" ", flush=True)
        ase_time = run_ase_lj_nvt(atoms, n_steps, dt, temperature, friction)
        ase_sps = n_steps / ase_time
        print(f"{ase_sps:.1f} steps/s")

        results.append(
            BenchmarkResult(
                system=name,
                n_atoms=len(atoms),
                benchmark_type="nvt",
                n_steps=n_steps,
                ferrox_time=ferrox_time,
                ferrox_steps_per_sec=ferrox_sps,
                torchsim_time=ts_time,
                torchsim_steps_per_sec=ts_sps,
                ase_time=ase_time,
                ase_steps_per_sec=ase_sps,
                ferrox_vs_torchsim=safe_divide(ts_time, ferrox_time),
                ferrox_vs_ase=safe_divide(ase_time, ferrox_time),
            )
        )

    return results


def format_value(val: float | None, fmt: str = ".1f", suffix: str = "") -> str:
    """Format a numeric value, returning 'N/A' for None."""
    if val is None:
        return "N/A"
    return f"{val:{fmt}}{suffix}"


def print_results_table(results: list[BenchmarkResult], title: str) -> None:
    """Print results as markdown table."""
    print(f"\n### {title}\n")
    print(
        "| System | Atoms | Steps | Ferrox (s/s) | TorchSim (s/s) | ASE (s/s) | Ferrox/TS | Ferrox/ASE |"
    )
    print(
        "|--------|-------|-------|--------------|----------------|-----------|-----------|------------|"
    )

    for row in results:
        ts_sps = format_value(row.torchsim_steps_per_sec)
        ase_sps = format_value(row.ase_steps_per_sec)
        ferrox_sps = format_value(row.ferrox_steps_per_sec)
        vs_ts = format_value(row.ferrox_vs_torchsim, ".2f", "x")
        vs_ase = format_value(row.ferrox_vs_ase, ".2f", "x")
        print(
            f"| {row.system} | {row.n_atoms} | {row.n_steps} | "
            f"{ferrox_sps} | {ts_sps} | {ase_sps} | {vs_ts} | {vs_ase} |"
        )


def run_lj_benchmarks(
    n_steps_md: int = 100,
    max_steps_fire: int = 100,
    output_file: str | None = None,
) -> dict[str, Any]:
    """Run all LJ benchmarks."""
    systems = {
        "ar_32": make_lj_system(2),
        "ar_108": make_lj_system(3),
        "ar_256": make_lj_system(4),
        "ar_500": make_lj_system(5),
    }

    print("=" * 70)
    print("LENNARD-JONES BENCHMARK: Ferrox (Rust) vs TorchSim (PyTorch) vs ASE")
    print("=" * 70)
    print(f"\nSystems: {list(systems.keys())}")
    print(f"MD steps: {n_steps_md}, FIRE max steps: {max_steps_fire}")
    print(f"LJ params: sigma={SIGMA} A, epsilon={EPSILON} eV, cutoff={CUTOFF} A")

    all_results: dict[str, Any] = {}
    benchmarks = [
        (
            "fire",
            "FIRE GEOMETRY OPTIMIZATION",
            "FIRE Optimization Results",
            lambda: benchmark_fire(systems, max_steps_fire),
        ),
        (
            "nve",
            "NVE MOLECULAR DYNAMICS",
            "NVE MD Results",
            lambda: benchmark_nve(systems, n_steps_md),
        ),
        (
            "nvt",
            "NVT MOLECULAR DYNAMICS (Langevin)",
            "NVT MD Results",
            lambda: benchmark_nvt(systems, n_steps_md),
        ),
    ]

    for key, header, table_title, run_benchmark in benchmarks:
        print("\n" + "-" * 70)
        print(header)
        print("-" * 70)
        results = run_benchmark()
        all_results[key] = [asdict(res) for res in results]
        print_results_table(results, table_title)

    all_results["metadata"] = {
        "timestamp": datetime.now(tz=UTC).isoformat(),
        "systems": list(systems.keys()),
        "n_steps_md": n_steps_md,
        "max_steps_fire": max_steps_fire,
        "lj_params": {"sigma": SIGMA, "epsilon": EPSILON, "cutoff": CUTOFF},
    }

    if output_file:
        with open(output_file, "w") as fh:
            json.dump(sanitize_nan(all_results), fh, indent=2)
        print(f"\nResults saved to: {output_file}")

    # Print summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)

    for bench_type in ["fire", "nve", "nvt"]:
        results = all_results[bench_type]
        if results:
            ts_ratios = [
                row["ferrox_vs_torchsim"]
                for row in results
                if row["ferrox_vs_torchsim"] is not None
            ]
            ase_ratios = [
                row["ferrox_vs_ase"]
                for row in results
                if row["ferrox_vs_ase"] is not None
            ]

            print(f"\n{bench_type.upper()}:")
            if ts_ratios:
                avg_vs_ts = sum(ts_ratios) / len(ts_ratios)
                print(f"  Avg Ferrox vs TorchSim: {avg_vs_ts:.2f}x")
            if ase_ratios:
                avg_vs_ase = sum(ase_ratios) / len(ase_ratios)
                print(f"  Avg Ferrox vs ASE:      {avg_vs_ase:.2f}x")

    print("\n" + "=" * 70)

    return all_results


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="LJ benchmark: Ferrox vs TorchSim vs ASE"
    )
    parser.add_argument("--md-steps", type=int, default=100, help="Number of MD steps")
    parser.add_argument("--fire-steps", type=int, default=100, help="Max FIRE steps")
    parser.add_argument("--output", type=str, default=None, help="Output JSON file")

    args = parser.parse_args()

    run_lj_benchmarks(
        n_steps_md=args.md_steps,
        max_steps_fire=args.fire_steps,
        output_file=args.output,
    )


if __name__ == "__main__":
    main()
