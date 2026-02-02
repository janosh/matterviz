"""Lennard-Jones benchmark comparing native implementations.

This benchmark compares native LJ implementations in:
- ferrox (Rust)
- torch-sim (PyTorch)
- ASE (NumPy/Python)

Unlike the MACE benchmarks, this isolates algorithmic efficiency
without Python callback overhead since all implementations are native.
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


@dataclass
class BenchmarkResult:
    """Result for a single benchmark."""

    system: str
    n_atoms: int
    benchmark_type: str
    n_steps: int
    ferrox_time: float
    ferrox_steps_per_sec: float
    torchsim_time: float
    torchsim_steps_per_sec: float
    ase_time: float
    ase_steps_per_sec: float
    ferrox_vs_torchsim: float
    ferrox_vs_ase: float


def make_lj_system(n_repeat: int) -> tuple[Atoms, list, list]:
    """Create FCC Argon system.

    Args:
        n_repeat: Supercell repetitions in each direction

    Returns:
        Tuple of (ASE Atoms, positions list, cell list)
    """
    atoms = bulk("Ar", "fcc", a=5.26, cubic=True) * (n_repeat, n_repeat, n_repeat)
    # Add small random perturbation to break symmetry
    rng = np.random.default_rng(42)
    atoms.positions += rng.uniform(-0.1, 0.1, atoms.positions.shape)
    positions = atoms.get_positions().tolist()
    cell = atoms.get_cell().array.tolist()
    return atoms, positions, cell


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


def run_ferrox_lj_fire(atoms: Atoms, max_steps: int, fmax: float) -> tuple[float, int]:
    """Run FIRE optimization using ferrox with native LJ."""
    positions = [list(p) for p in atoms.get_positions()]
    cell = atoms.get_cell().array.tolist()

    def compute_forces(pos: list[list[float]]) -> list[list[float]]:
        _, forces = ferrox.compute_lennard_jones(
            pos, cell=cell, sigma=SIGMA, epsilon=EPSILON, cutoff=CUTOFF
        )
        return forces

    config = ferrox.FireConfig()
    state = ferrox.FireState(positions, config)

    n_steps = 0
    start = time.perf_counter()
    for step in range(max_steps):
        state.step(compute_forces)
        n_steps = step + 1
        if state.max_force() < fmax:
            break
    elapsed = time.perf_counter() - start

    return elapsed, n_steps


def run_ferrox_lj_nve(
    atoms: Atoms, n_steps: int, dt: float, temperature: float
) -> float:
    """Run NVE MD using ferrox with native LJ."""
    positions = [list(p) for p in atoms.get_positions()]
    cell = atoms.get_cell().array.tolist()
    masses = atoms.get_masses().tolist()

    def compute_forces(pos: list[list[float]]) -> list[list[float]]:
        _, forces = ferrox.compute_lennard_jones(
            pos, cell=cell, sigma=SIGMA, epsilon=EPSILON, cutoff=CUTOFF
        )
        return forces

    state = ferrox.MDState(positions, masses)
    state.init_velocities(temperature, seed=42)

    start = time.perf_counter()
    for _ in range(n_steps):
        ferrox.md_velocity_verlet_step(state, dt, compute_forces)

    return time.perf_counter() - start


def run_ferrox_lj_nvt(
    atoms: Atoms, n_steps: int, dt: float, temperature: float, friction: float
) -> float:
    """Run NVT MD using ferrox with native LJ."""
    positions = [list(p) for p in atoms.get_positions()]
    cell = atoms.get_cell().array.tolist()
    masses = atoms.get_masses().tolist()

    def compute_forces(pos: list[list[float]]) -> list[list[float]]:
        _, forces = ferrox.compute_lennard_jones(
            pos, cell=cell, sigma=SIGMA, epsilon=EPSILON, cutoff=CUTOFF
        )
        return forces

    state = ferrox.MDState(positions, masses)
    state.init_velocities(temperature, seed=42)
    integrator = ferrox.LangevinIntegrator(temperature, friction, dt, seed=42)

    start = time.perf_counter()
    for _ in range(n_steps):
        integrator.step(state, compute_forces)

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

    kb_ev = 8.617333262e-5
    kT = torch.tensor(temperature * kb_ev, dtype=torch.float64)
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

    kb_ev = 8.617333262e-5
    kT = torch.tensor(temperature * kb_ev, dtype=torch.float64)
    dt_tensor = torch.tensor(dt, dtype=torch.float64)
    gamma = torch.tensor(friction, dtype=torch.float64)

    md_state = nvt_langevin_init(state, model, kT=kT, seed=42)

    start = time.perf_counter()
    for _ in range(n_steps):
        md_state = nvt_langevin_step(md_state, model, dt=dt_tensor, kT=kT, gamma=gamma)

    return time.perf_counter() - start


# === ASE runners using native LJ ===


def run_ase_lj_fire(atoms: Atoms, max_steps: int, fmax: float) -> tuple[float, int]:
    """Run FIRE optimization using ASE with native LJ."""
    atoms = atoms.copy()
    calc = AseLennardJones(sigma=SIGMA, epsilon=EPSILON, rc=CUTOFF)
    atoms.calc = calc

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
    atoms = atoms.copy()
    calc = AseLennardJones(sigma=SIGMA, epsilon=EPSILON, rc=CUTOFF)
    atoms.calc = calc

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
    atoms = atoms.copy()
    calc = AseLennardJones(sigma=SIGMA, epsilon=EPSILON, rc=CUTOFF)
    atoms.calc = calc

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


def benchmark_fire(
    systems: dict, max_steps: int = 100, fmax: float = 0.01
) -> list[BenchmarkResult]:
    """Run FIRE benchmark."""
    results = []

    for name, atoms in systems.items():
        print(f"\n  Running FIRE on {name} ({len(atoms)} atoms)...")

        # Ferrox
        print("    - ferrox...", end=" ", flush=True)
        ferrox_time, ferrox_steps = run_ferrox_lj_fire(atoms, max_steps, fmax)
        ferrox_sps = ferrox_steps / ferrox_time
        print(f"{ferrox_sps:.1f} steps/s")

        # TorchSim
        print("    - torch-sim...", end=" ", flush=True)
        ts_time, ts_steps = run_torchsim_lj_fire(atoms, max_steps, fmax)
        ts_sps = ts_steps / ts_time
        print(f"{ts_sps:.1f} steps/s")

        # ASE
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
                ferrox_vs_torchsim=ts_time / ferrox_time,
                ferrox_vs_ase=ase_time / ferrox_time,
            )
        )

    return results


def benchmark_nve(
    systems: dict, n_steps: int = 100, dt: float = 5.0, temperature: float = 100.0
) -> list[BenchmarkResult]:
    """Run NVE benchmark."""
    results = []

    for name, atoms in systems.items():
        print(f"\n  Running NVE on {name} ({len(atoms)} atoms)...")

        # Ferrox
        print("    - ferrox...", end=" ", flush=True)
        ferrox_time = run_ferrox_lj_nve(atoms, n_steps, dt, temperature)
        ferrox_sps = n_steps / ferrox_time
        print(f"{ferrox_sps:.1f} steps/s")

        # TorchSim
        print("    - torch-sim...", end=" ", flush=True)
        ts_time = run_torchsim_lj_nve(atoms, n_steps, dt, temperature)
        ts_sps = n_steps / ts_time
        print(f"{ts_sps:.1f} steps/s")

        # ASE
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
                ferrox_vs_torchsim=ts_time / ferrox_time,
                ferrox_vs_ase=ase_time / ferrox_time,
            )
        )

    return results


def benchmark_nvt(
    systems: dict,
    n_steps: int = 100,
    dt: float = 5.0,
    temperature: float = 100.0,
    friction: float = 0.01,
) -> list[BenchmarkResult]:
    """Run NVT benchmark."""
    results = []

    for name, atoms in systems.items():
        print(f"\n  Running NVT on {name} ({len(atoms)} atoms)...")

        # Ferrox
        print("    - ferrox...", end=" ", flush=True)
        ferrox_time = run_ferrox_lj_nvt(atoms, n_steps, dt, temperature, friction)
        ferrox_sps = n_steps / ferrox_time
        print(f"{ferrox_sps:.1f} steps/s")

        # TorchSim
        print("    - torch-sim...", end=" ", flush=True)
        ts_time = run_torchsim_lj_nvt(atoms, n_steps, dt, temperature, friction)
        ts_sps = n_steps / ts_time
        print(f"{ts_sps:.1f} steps/s")

        # ASE
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
                ferrox_vs_torchsim=ts_time / ferrox_time,
                ferrox_vs_ase=ase_time / ferrox_time,
            )
        )

    return results


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
        print(
            f"| {row.system} | {row.n_atoms} | {row.n_steps} | "
            f"{row.ferrox_steps_per_sec:.1f} | {row.torchsim_steps_per_sec:.1f} | "
            f"{row.ase_steps_per_sec:.1f} | {row.ferrox_vs_torchsim:.2f}x | "
            f"{row.ferrox_vs_ase:.2f}x |"
        )


def run_lj_benchmarks(
    n_steps_md: int = 100,
    max_steps_fire: int = 100,
    output_file: str | None = None,
) -> dict:
    """Run all LJ benchmarks."""
    # Create systems of different sizes
    systems = {
        "ar_32": make_lj_system(2)[0],  # 32 atoms
        "ar_108": make_lj_system(3)[0],  # 108 atoms
        "ar_256": make_lj_system(4)[0],  # 256 atoms
        "ar_500": make_lj_system(5)[0],  # 500 atoms
    }

    print("=" * 70)
    print("LENNARD-JONES BENCHMARK: Ferrox (Rust) vs TorchSim (PyTorch) vs ASE")
    print("=" * 70)
    print(f"\nSystems: {list(systems.keys())}")
    print(f"MD steps: {n_steps_md}, FIRE max steps: {max_steps_fire}")
    print(f"LJ params: sigma={SIGMA} A, epsilon={EPSILON} eV, cutoff={CUTOFF} A")

    all_results = {"fire": [], "nve": [], "nvt": []}

    print("\n" + "-" * 70)
    print("FIRE GEOMETRY OPTIMIZATION")
    print("-" * 70)
    fire_results = benchmark_fire(systems, max_steps_fire)
    all_results["fire"] = [asdict(r) for r in fire_results]
    print_results_table(fire_results, "FIRE Optimization Results")

    print("\n" + "-" * 70)
    print("NVE MOLECULAR DYNAMICS")
    print("-" * 70)
    nve_results = benchmark_nve(systems, n_steps_md)
    all_results["nve"] = [asdict(r) for r in nve_results]
    print_results_table(nve_results, "NVE MD Results")

    print("\n" + "-" * 70)
    print("NVT MOLECULAR DYNAMICS (Langevin)")
    print("-" * 70)
    nvt_results = benchmark_nvt(systems, n_steps_md)
    all_results["nvt"] = [asdict(r) for r in nvt_results]
    print_results_table(nvt_results, "NVT MD Results")

    # Add metadata
    all_results["metadata"] = {
        "timestamp": datetime.now(tz=UTC).isoformat(),
        "systems": list(systems.keys()),
        "n_steps_md": n_steps_md,
        "max_steps_fire": max_steps_fire,
        "lj_params": {"sigma": SIGMA, "epsilon": EPSILON, "cutoff": CUTOFF},
    }

    # Save JSON if requested
    if output_file:
        with open(output_file, "w") as f:
            json.dump(all_results, f, indent=2)
        print(f"\nResults saved to: {output_file}")

    # Print summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)

    for bench_type in ["fire", "nve", "nvt"]:
        results = all_results[bench_type]
        if results:
            avg_vs_ts = sum(r["ferrox_vs_torchsim"] for r in results) / len(results)
            avg_vs_ase = sum(r["ferrox_vs_ase"] for r in results) / len(results)
            print(f"\n{bench_type.upper()}:")
            print(f"  Avg Ferrox vs TorchSim: {avg_vs_ts:.2f}x")
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
