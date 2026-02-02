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
"""Comprehensive potential benchmark: LJ and Morse.

Compares native implementations in:
- ferrox (Rust)
- torch-sim (PyTorch)
- ASE (NumPy/Python)

Run with: uv run potential_benchmark.py [--steps N] [--output FILE]
"""

import argparse
import json
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime

import ferrox
import numpy as np
import torch
from ase import Atoms, units
from ase.build import bulk
from ase.calculators.lj import LennardJones as AseLennardJones
from ase.calculators.morse import MorsePotential as AseMorse
from ase.md.velocitydistribution import MaxwellBoltzmannDistribution
from ase.md.verlet import VelocityVerlet
from torch_sim import SimState, nve_init, nve_step
from torch_sim.models.lennard_jones import LennardJonesModel as TorchSimLJ
from torch_sim.models.morse import MorseModel as TorchSimMorse


@dataclass
class BenchmarkResult:
    """Result for a single benchmark."""

    potential: str
    system: str
    n_atoms: int
    n_steps: int
    ferrox_time: float
    ferrox_steps_per_sec: float
    ase_time: float
    ase_steps_per_sec: float
    torchsim_time: float | None
    torchsim_steps_per_sec: float | None
    ferrox_vs_ase: float


def make_supercell(n_repeat: int) -> Atoms:
    """Create FCC Argon supercell with perturbation."""
    atoms = bulk("Ar", "fcc", a=5.26, cubic=True) * (n_repeat, n_repeat, n_repeat)
    rng = np.random.default_rng(42)
    atoms.positions += rng.uniform(-0.1, 0.1, atoms.positions.shape)
    return atoms


# === Ferrox runners ===


def run_ferrox_lj_nve(atoms: Atoms, n_steps: int, dt: float, temp: float) -> float:
    """Run NVE with ferrox LJ."""
    positions = [list(pos) for pos in atoms.get_positions()]
    cell = atoms.get_cell().array.tolist()
    masses = atoms.get_masses().tolist()

    def compute_forces(pos: list[list[float]]) -> list[list[float]]:
        _, forces = ferrox.compute_lennard_jones(
            pos, cell=cell, sigma=3.4, epsilon=0.0103, cutoff=10.0
        )
        return forces

    state = ferrox.MDState(positions, masses)
    state.init_velocities(temp, seed=42)

    start = time.perf_counter()
    for _ in range(n_steps):
        ferrox.md_velocity_verlet_step(state, dt, compute_forces)
    return time.perf_counter() - start


def run_ferrox_morse_nve(atoms: Atoms, n_steps: int, dt: float, temp: float) -> float:
    """Run NVE with ferrox Morse."""
    positions = [list(pos) for pos in atoms.get_positions()]
    cell = atoms.get_cell().array.tolist()
    masses = atoms.get_masses().tolist()

    def compute_forces(pos: list[list[float]]) -> list[list[float]]:
        _, forces, _ = ferrox.compute_morse(
            pos, cell=cell, d=0.0103, alpha=1.0, r0=3.82, cutoff=10.0
        )
        return forces

    state = ferrox.MDState(positions, masses)
    state.init_velocities(temp, seed=42)

    start = time.perf_counter()
    for _ in range(n_steps):
        ferrox.md_velocity_verlet_step(state, dt, compute_forces)
    return time.perf_counter() - start


# === ASE runners ===


def run_ase_lj_nve(atoms: Atoms, n_steps: int, dt: float, temp: float) -> float:
    """Run NVE with ASE LJ."""
    atoms = atoms.copy()
    atoms.calc = AseLennardJones(sigma=3.4, epsilon=0.0103, rc=10.0)
    MaxwellBoltzmannDistribution(
        atoms, temperature_K=temp, rng=np.random.default_rng(42)
    )
    dyn = VelocityVerlet(atoms, timestep=dt * units.fs, logfile=None)

    start = time.perf_counter()
    dyn.run(n_steps)
    return time.perf_counter() - start


def run_ase_morse_nve(atoms: Atoms, n_steps: int, dt: float, temp: float) -> float:
    """Run NVE with ASE Morse."""
    atoms = atoms.copy()
    atoms.calc = AseMorse(epsilon=0.0103, rho0=3.82, r0=3.82)
    MaxwellBoltzmannDistribution(
        atoms, temperature_K=temp, rng=np.random.default_rng(42)
    )
    dyn = VelocityVerlet(atoms, timestep=dt * units.fs, logfile=None)

    start = time.perf_counter()
    dyn.run(n_steps)
    return time.perf_counter() - start


# === TorchSim runners ===


def create_simstate(atoms: Atoms) -> SimState:
    """Convert ASE Atoms to torch-sim SimState."""
    return SimState(
        positions=torch.tensor(atoms.get_positions(), dtype=torch.float64),
        masses=torch.tensor(atoms.get_masses(), dtype=torch.float64),
        cell=torch.tensor(atoms.get_cell().array, dtype=torch.float64),
        pbc=torch.tensor([True, True, True]),
        atomic_numbers=torch.tensor(atoms.get_atomic_numbers(), dtype=torch.int64),
    )


def run_torchsim_lj_nve(atoms: Atoms, n_steps: int, dt: float, temp: float) -> float:
    """Run NVE with torch-sim LJ."""
    model = TorchSimLJ(sigma=3.4, epsilon=0.0103, cutoff=10.0, dtype=torch.float64)
    state = create_simstate(atoms)
    kb_ev = 8.617333262e-5
    kT = torch.tensor(temp * kb_ev, dtype=torch.float64)
    dt_tensor = torch.tensor(dt, dtype=torch.float64)

    md_state = nve_init(state, model, kT=kT, seed=42)

    start = time.perf_counter()
    for _ in range(n_steps):
        md_state = nve_step(md_state, model, dt=dt_tensor)
    return time.perf_counter() - start


def run_torchsim_morse_nve(
    atoms: Atoms, n_steps: int, dt: float, temp: float
) -> float | None:
    """Run NVE with torch-sim Morse."""
    try:
        model = TorchSimMorse(
            sigma=3.82,
            epsilon=0.0103,
            alpha=1.0,
            cutoff=10.0,
            dtype=torch.float64,
            compute_forces=True,
        )
        state = create_simstate(atoms)
        kb_ev = 8.617333262e-5
        kT = torch.tensor(temp * kb_ev, dtype=torch.float64)
        dt_tensor = torch.tensor(dt, dtype=torch.float64)

        md_state = nve_init(state, model, kT=kT, seed=42)

        start = time.perf_counter()
        for _ in range(n_steps):
            md_state = nve_step(md_state, model, dt=dt_tensor)
        return time.perf_counter() - start
    except (RuntimeError, ValueError, TypeError) as exc:
        print(f"[torch-sim Morse error: {exc}]", end=" ")
        return None


# === Benchmark functions ===


def benchmark_potential(
    potential: str,
    systems: dict[str, Atoms],
    n_steps: int,
    dt: float,
    temp: float,
) -> list[BenchmarkResult]:
    """Benchmark a single potential type."""
    results = []

    if potential == "lj":
        ferrox_fn = run_ferrox_lj_nve
        ase_fn = run_ase_lj_nve
        ts_fn = run_torchsim_lj_nve
    elif potential == "morse":
        ferrox_fn = run_ferrox_morse_nve
        ase_fn = run_ase_morse_nve
        ts_fn = run_torchsim_morse_nve
    else:
        raise ValueError(f"Unknown potential: {potential}")

    for name, atoms in systems.items():
        print(f"\n  {potential.upper()} NVE on {name} ({len(atoms)} atoms)...")

        # Ferrox
        print("    - ferrox...", end=" ", flush=True)
        ferrox_time = ferrox_fn(atoms, n_steps, dt, temp)
        ferrox_sps = n_steps / ferrox_time
        print(f"{ferrox_sps:.1f} steps/s")

        # ASE
        print("    - ase...", end=" ", flush=True)
        ase_time = ase_fn(atoms, n_steps, dt, temp)
        ase_sps = n_steps / ase_time
        print(f"{ase_sps:.1f} steps/s")

        # TorchSim
        print("    - torch-sim...", end=" ", flush=True)
        ts_time = ts_fn(atoms, n_steps, dt, temp)
        if ts_time is not None:
            ts_sps = n_steps / ts_time
            print(f"{ts_sps:.1f} steps/s")
        else:
            ts_sps = None
            print("skipped")

        results.append(
            BenchmarkResult(
                potential=potential,
                system=name,
                n_atoms=len(atoms),
                n_steps=n_steps,
                ferrox_time=ferrox_time,
                ferrox_steps_per_sec=ferrox_sps,
                ase_time=ase_time,
                ase_steps_per_sec=ase_sps,
                torchsim_time=ts_time,
                torchsim_steps_per_sec=ts_sps,
                ferrox_vs_ase=ase_time / ferrox_time,
            )
        )

    return results


def print_results_table(results: list[BenchmarkResult], title: str) -> None:
    """Print results as markdown table."""
    print(f"\n### {title}\n")
    print(
        "| Potential | System | Atoms | Steps | Ferrox (s/s) | ASE (s/s) | TorchSim (s/s) | Ferrox/ASE |"
    )
    print(
        "|-----------|--------|-------|-------|--------------|-----------|----------------|------------|"
    )

    for row in results:
        ts_sps = (
            f"{row.torchsim_steps_per_sec:.1f}" if row.torchsim_steps_per_sec else "N/A"
        )
        print(
            f"| {row.potential} | {row.system} | {row.n_atoms} | {row.n_steps} | "
            f"{row.ferrox_steps_per_sec:.1f} | {row.ase_steps_per_sec:.1f} | {ts_sps} | "
            f"{row.ferrox_vs_ase:.2f}x |"
        )


def run_benchmarks(n_steps: int = 50, output_file: str | None = None) -> dict:
    """Run all benchmarks."""
    systems = {
        "ar_32": make_supercell(2),
        "ar_108": make_supercell(3),
        "ar_256": make_supercell(4),
        "ar_500": make_supercell(5),
    }

    print("=" * 70)
    print("POTENTIAL BENCHMARK: Ferrox (Rust) vs ASE (Python) vs TorchSim (PyTorch)")
    print("=" * 70)
    print(f"\nSystems: {list(systems.keys())}")
    print(f"Steps per benchmark: {n_steps}")

    all_results: dict = {"lj": [], "morse": []}

    print("\n" + "-" * 70)
    print("LENNARD-JONES POTENTIAL")
    print("-" * 70)
    lj_results = benchmark_potential("lj", systems, n_steps, dt=5.0, temp=100.0)
    all_results["lj"] = [asdict(res) for res in lj_results]
    print_results_table(lj_results, "Lennard-Jones NVE Results")

    print("\n" + "-" * 70)
    print("MORSE POTENTIAL")
    print("-" * 70)
    morse_results = benchmark_potential("morse", systems, n_steps, dt=5.0, temp=100.0)
    all_results["morse"] = [asdict(res) for res in morse_results]
    print_results_table(morse_results, "Morse NVE Results")

    # Summary
    print("\n" + "=" * 70)
    print("SUMMARY (Average Ferrox speedup vs ASE)")
    print("=" * 70)

    for pot in ["lj", "morse"]:
        results = all_results[pot]
        if results:
            avg_speedup = sum(res["ferrox_vs_ase"] for res in results) / len(results)
            print(f"  {pot.upper()}: {avg_speedup:.1f}x faster than ASE")

    all_results["metadata"] = {
        "timestamp": datetime.now(tz=UTC).isoformat(),
        "n_steps": n_steps,
        "systems": list(systems.keys()),
    }

    if output_file:
        with open(output_file, "w") as fh:
            json.dump(all_results, fh, indent=2)
        print(f"\nResults saved to: {output_file}")

    return all_results


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Potential benchmark: Ferrox vs ASE vs TorchSim"
    )
    parser.add_argument("--steps", type=int, default=50, help="Number of MD steps")
    parser.add_argument("--output", type=str, default=None, help="Output JSON file")

    args = parser.parse_args()

    run_benchmarks(n_steps=args.steps, output_file=args.output)


if __name__ == "__main__":
    main()
