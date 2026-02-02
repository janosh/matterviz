"""Main benchmark comparison script.

Usage:
    python -m benchmarks.compare [--systems SYSTEMS] [--output OUTPUT]

Example:
    python -m benchmarks.compare --systems mgo_64,cu_108 --output results.json
"""

import argparse
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from pymatgen.core import Structure

from .ase_runner import run_ase_fire, run_ase_nve, run_ase_nvt
from .ferrox_runner import run_ferrox_fire, run_ferrox_nve, run_ferrox_nvt
from .mace_model import get_mace_model
from .structures import SYSTEMS, perturb_structure
from .torchsim_runner import (
    get_torchsim_mace_model,
    run_torchsim_fire,
    run_torchsim_nve,
    run_torchsim_nvt,
)
from .validate import print_validation_report, validate_all_systems

if TYPE_CHECKING:
    from mace.calculators import MACECalculator

    from .torchsim_runner import MaceModel


@dataclass
class BenchmarkResult:
    """Result for a single benchmark configuration."""

    system: str
    n_atoms: int
    benchmark_type: str  # 'fire', 'nve', 'nvt'
    n_steps: int
    ferrox_time: float | None  # None if runner failed
    ferrox_steps_per_sec: float | None
    torchsim_time: float | None
    torchsim_steps_per_sec: float | None
    ase_time: float | None
    ase_steps_per_sec: float | None
    ferrox_vs_torchsim: float | None  # speedup ratio (>1 means ferrox faster)
    ferrox_vs_ase: float | None
    error: str | None = None  # error message if any runner failed


def safe_divide(numerator: float | None, denominator: float | None) -> float | None:
    """Safely divide, returning None if either value is None or denominator is ~0."""
    if numerator is None or denominator is None:
        return None
    if abs(denominator) < 1e-9:
        return None
    return numerator / denominator


def benchmark_fire(
    systems: dict[str, Structure],
    mace_calc: "MACECalculator",
    torchsim_model: "MaceModel",
    max_steps: int = 100,
    fmax: float = 0.01,
) -> list[BenchmarkResult]:
    """Run FIRE optimization benchmark comparing all packages.

    Args:
        systems: Dict of system_name -> Structure
        mace_calc: MACE calculator for ASE/ferrox
        torchsim_model: torch-sim MaceModel
        max_steps: Maximum optimization steps
        fmax: Force convergence threshold

    Returns:
        List of BenchmarkResult for each system
    """
    results = []

    for name, structure in systems.items():
        print(f"\n  Running FIRE on {name} ({structure.num_sites} atoms)...")
        perturbed = perturb_structure(structure, amplitude=0.1)
        errors = []

        # Ferrox
        ferrox_time, ferrox_sps, n_steps = None, None, max_steps
        print("    - ferrox...", end=" ", flush=True)
        try:
            ferrox_result = run_ferrox_fire(perturbed, mace_calc, max_steps, fmax)
            ferrox_time = ferrox_result.timing.elapsed
            ferrox_sps = ferrox_result.timing.steps_per_second
            n_steps = ferrox_result.n_steps_actual
            print(f"{ferrox_sps:.1f} steps/s")
        except Exception as exc:
            errors.append(f"ferrox: {exc}")
            print(f"FAILED: {exc}")

        # TorchSim
        torchsim_time, torchsim_sps = None, None
        print("    - torch-sim...", end=" ", flush=True)
        try:
            torchsim_result = run_torchsim_fire(
                perturbed, torchsim_model, max_steps, fmax
            )
            torchsim_time = torchsim_result.timing.elapsed
            torchsim_sps = torchsim_result.timing.steps_per_second
            print(f"{torchsim_sps:.1f} steps/s")
        except Exception as exc:
            errors.append(f"torchsim: {exc}")
            print(f"FAILED: {exc}")

        # ASE
        ase_time, ase_sps = None, None
        print("    - ase...", end=" ", flush=True)
        try:
            ase_result = run_ase_fire(perturbed, mace_calc, max_steps, fmax)
            ase_time = ase_result.timing.elapsed
            ase_sps = ase_result.timing.steps_per_second
            print(f"{ase_sps:.1f} steps/s")
        except Exception as exc:
            errors.append(f"ase: {exc}")
            print(f"FAILED: {exc}")

        results.append(
            BenchmarkResult(
                system=name,
                n_atoms=structure.num_sites,
                benchmark_type="fire",
                n_steps=n_steps,
                ferrox_time=ferrox_time,
                ferrox_steps_per_sec=ferrox_sps,
                torchsim_time=torchsim_time,
                torchsim_steps_per_sec=torchsim_sps,
                ase_time=ase_time,
                ase_steps_per_sec=ase_sps,
                ferrox_vs_torchsim=safe_divide(torchsim_time, ferrox_time),
                ferrox_vs_ase=safe_divide(ase_time, ferrox_time),
                error="; ".join(errors) if errors else None,
            )
        )

    return results


def benchmark_nve(
    systems: dict[str, Structure],
    mace_calc: "MACECalculator",
    torchsim_model: "MaceModel",
    n_steps: int = 100,
    dt: float = 1.0,
    temperature: float = 300.0,
) -> list[BenchmarkResult]:
    """Run NVE MD benchmark comparing all packages.

    Args:
        systems: Dict of system_name -> Structure
        mace_calc: MACE calculator for ASE/ferrox
        torchsim_model: torch-sim MaceModel
        n_steps: Number of MD steps
        dt: Time step in fs
        temperature: Initial temperature in Kelvin

    Returns:
        List of BenchmarkResult for each system
    """
    results = []

    for name, structure in systems.items():
        print(f"\n  Running NVE on {name} ({structure.num_sites} atoms)...")
        errors = []

        # Ferrox
        ferrox_time, ferrox_sps = None, None
        print("    - ferrox...", end=" ", flush=True)
        try:
            ferrox_result = run_ferrox_nve(
                structure, mace_calc, n_steps, dt, temperature
            )
            ferrox_time = ferrox_result.timing.elapsed
            ferrox_sps = ferrox_result.timing.steps_per_second
            print(f"{ferrox_sps:.1f} steps/s")
        except Exception as exc:
            errors.append(f"ferrox: {exc}")
            print(f"FAILED: {exc}")

        # TorchSim
        torchsim_time, torchsim_sps = None, None
        print("    - torch-sim...", end=" ", flush=True)
        try:
            torchsim_result = run_torchsim_nve(
                structure, torchsim_model, n_steps, dt, temperature
            )
            torchsim_time = torchsim_result.timing.elapsed
            torchsim_sps = torchsim_result.timing.steps_per_second
            print(f"{torchsim_sps:.1f} steps/s")
        except Exception as exc:
            errors.append(f"torchsim: {exc}")
            print(f"FAILED: {exc}")

        # ASE
        ase_time, ase_sps = None, None
        print("    - ase...", end=" ", flush=True)
        try:
            ase_result = run_ase_nve(structure, mace_calc, n_steps, dt, temperature)
            ase_time = ase_result.timing.elapsed
            ase_sps = ase_result.timing.steps_per_second
            print(f"{ase_sps:.1f} steps/s")
        except Exception as exc:
            errors.append(f"ase: {exc}")
            print(f"FAILED: {exc}")

        results.append(
            BenchmarkResult(
                system=name,
                n_atoms=structure.num_sites,
                benchmark_type="nve",
                n_steps=n_steps,
                ferrox_time=ferrox_time,
                ferrox_steps_per_sec=ferrox_sps,
                torchsim_time=torchsim_time,
                torchsim_steps_per_sec=torchsim_sps,
                ase_time=ase_time,
                ase_steps_per_sec=ase_sps,
                ferrox_vs_torchsim=safe_divide(torchsim_time, ferrox_time),
                ferrox_vs_ase=safe_divide(ase_time, ferrox_time),
                error="; ".join(errors) if errors else None,
            )
        )

    return results


def benchmark_nvt(
    systems: dict[str, Structure],
    mace_calc: "MACECalculator",
    torchsim_model: "MaceModel",
    n_steps: int = 100,
    dt: float = 1.0,
    temperature: float = 300.0,
    friction: float = 0.01,
) -> list[BenchmarkResult]:
    """Run NVT MD benchmark comparing all packages.

    Args:
        systems: Dict of system_name -> Structure
        mace_calc: MACE calculator for ASE/ferrox
        torchsim_model: torch-sim MaceModel
        n_steps: Number of MD steps
        dt: Time step in fs
        temperature: Target temperature in Kelvin
        friction: Langevin friction coefficient in 1/fs

    Returns:
        List of BenchmarkResult for each system
    """
    results = []

    for name, structure in systems.items():
        print(f"\n  Running NVT on {name} ({structure.num_sites} atoms)...")
        errors = []

        # Ferrox
        ferrox_time, ferrox_sps = None, None
        print("    - ferrox...", end=" ", flush=True)
        try:
            ferrox_result = run_ferrox_nvt(
                structure, mace_calc, n_steps, dt, temperature, friction
            )
            ferrox_time = ferrox_result.timing.elapsed
            ferrox_sps = ferrox_result.timing.steps_per_second
            print(f"{ferrox_sps:.1f} steps/s")
        except Exception as exc:
            errors.append(f"ferrox: {exc}")
            print(f"FAILED: {exc}")

        # TorchSim
        torchsim_time, torchsim_sps = None, None
        print("    - torch-sim...", end=" ", flush=True)
        try:
            torchsim_result = run_torchsim_nvt(
                structure, torchsim_model, n_steps, dt, temperature, friction
            )
            torchsim_time = torchsim_result.timing.elapsed
            torchsim_sps = torchsim_result.timing.steps_per_second
            print(f"{torchsim_sps:.1f} steps/s")
        except Exception as exc:
            errors.append(f"torchsim: {exc}")
            print(f"FAILED: {exc}")

        # ASE
        ase_time, ase_sps = None, None
        print("    - ase...", end=" ", flush=True)
        try:
            ase_result = run_ase_nvt(
                structure, mace_calc, n_steps, dt, temperature, friction
            )
            ase_time = ase_result.timing.elapsed
            ase_sps = ase_result.timing.steps_per_second
            print(f"{ase_sps:.1f} steps/s")
        except Exception as exc:
            errors.append(f"ase: {exc}")
            print(f"FAILED: {exc}")

        results.append(
            BenchmarkResult(
                system=name,
                n_atoms=structure.num_sites,
                benchmark_type="nvt",
                n_steps=n_steps,
                ferrox_time=ferrox_time,
                ferrox_steps_per_sec=ferrox_sps,
                torchsim_time=torchsim_time,
                torchsim_steps_per_sec=torchsim_sps,
                ase_time=ase_time,
                ase_steps_per_sec=ase_sps,
                ferrox_vs_torchsim=safe_divide(torchsim_time, ferrox_time),
                ferrox_vs_ase=safe_divide(ase_time, ferrox_time),
                error="; ".join(errors) if errors else None,
            )
        )

    return results


def fmt_val(val: float | None, decimals: int = 2, suffix: str = "") -> str:
    """Format a value, returning 'N/A' if None."""
    if val is None:
        return "N/A"
    return f"{val:.{decimals}f}{suffix}"


def print_results_table(results: list[BenchmarkResult], title: str) -> None:
    """Print results as a formatted markdown table.

    Args:
        results: List of benchmark results
        title: Table title
    """
    print(f"\n### {title}\n")
    print(
        "| System | Atoms | Steps | Ferrox (s/s) | TorchSim (s/s) | ASE (s/s) | "
        "Ferrox/TS | Ferrox/ASE |"
    )
    print(
        "|--------|-------|-------|--------------|----------------|-----------|"
        "-----------|------------|"
    )

    for row in results:
        ferrox_sps = fmt_val(row.ferrox_steps_per_sec, decimals=1)
        torchsim_sps = fmt_val(row.torchsim_steps_per_sec, decimals=1)
        ase_sps = fmt_val(row.ase_steps_per_sec, decimals=1)
        vs_ts = fmt_val(row.ferrox_vs_torchsim, suffix="x")
        vs_ase = fmt_val(row.ferrox_vs_ase, suffix="x")
        print(
            f"| {row.system} | {row.n_atoms} | {row.n_steps} | "
            f"{ferrox_sps} | {torchsim_sps} | {ase_sps} | {vs_ts} | {vs_ase} |"
        )
        if row.error:
            print(f"|  ↳ Error: {row.error} | | | | | | | |")


def run_all_benchmarks(
    system_names: list[str] | None = None,
    n_steps_md: int = 100,
    max_steps_fire: int = 100,
    output_file: str | None = None,
) -> dict:
    """Run all benchmarks and generate report.

    Args:
        system_names: List of system names to benchmark (None = all)
        n_steps_md: Number of MD steps
        max_steps_fire: Maximum FIRE optimization steps
        output_file: Optional path to save JSON results

    Returns:
        Dict with all benchmark results
    """
    # Select systems
    if system_names:
        systems = {name: SYSTEMS[name] for name in system_names if name in SYSTEMS}
    else:
        systems = SYSTEMS

    if not systems:
        print("ERROR: No valid systems selected")
        return {}

    print("=" * 70)
    print("FERROX vs TORCH-SIM vs ASE BENCHMARK")
    print("=" * 70)
    print(f"\nSystems: {list(systems.keys())}")
    print(f"MD steps: {n_steps_md}, FIRE max steps: {max_steps_fire}")

    # Load MACE models
    print("\nLoading MACE models...")
    mace_calc = get_mace_model()
    print("  - MACE calculator loaded (for ASE/ferrox)")
    torchsim_model = get_torchsim_mace_model()
    print("  - torch-sim MaceModel loaded")

    # Run numerical validation first
    print("\n" + "-" * 70)
    print("NUMERICAL VALIDATION")
    print("-" * 70)
    validation_results = validate_all_systems(
        systems, mace_calc, torchsim_model, tolerance=1e-4
    )
    print_validation_report(validation_results)

    # Run benchmarks
    all_results: dict = {"validation": {}, "fire": [], "nve": [], "nvt": []}

    # Store validation results
    for name, result in validation_results.items():
        all_results["validation"][name] = asdict(result)

    print("\n" + "-" * 70)
    print("FIRE GEOMETRY OPTIMIZATION")
    print("-" * 70)
    fire_results = benchmark_fire(systems, mace_calc, torchsim_model, max_steps_fire)
    all_results["fire"] = [asdict(r) for r in fire_results]
    print_results_table(fire_results, "FIRE Optimization Results")

    print("\n" + "-" * 70)
    print("NVE MOLECULAR DYNAMICS (Velocity Verlet)")
    print("-" * 70)
    nve_results = benchmark_nve(systems, mace_calc, torchsim_model, n_steps_md)
    all_results["nve"] = [asdict(r) for r in nve_results]
    print_results_table(nve_results, "NVE MD Results")

    print("\n" + "-" * 70)
    print("NVT MOLECULAR DYNAMICS (Langevin)")
    print("-" * 70)
    nvt_results = benchmark_nvt(systems, mace_calc, torchsim_model, n_steps_md)
    all_results["nvt"] = [asdict(r) for r in nvt_results]
    print_results_table(nvt_results, "NVT MD Results")

    # Add metadata
    all_results["metadata"] = {
        "timestamp": datetime.now(tz=UTC).isoformat(),
        "systems": list(systems.keys()),
        "n_steps_md": n_steps_md,
        "max_steps_fire": max_steps_fire,
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
            # Filter out None values for averaging
            vs_ts_vals = [
                r["ferrox_vs_torchsim"]
                for r in results
                if r["ferrox_vs_torchsim"] is not None
            ]
            vs_ase_vals = [
                r["ferrox_vs_ase"] for r in results if r["ferrox_vs_ase"] is not None
            ]
            print(f"\n{bench_type.upper()}:")
            if vs_ts_vals:
                avg_vs_ts = sum(vs_ts_vals) / len(vs_ts_vals)
                print(
                    f"  Avg Ferrox vs TorchSim: {avg_vs_ts:.2f}x ({len(vs_ts_vals)}/{len(results)} succeeded)"
                )
            else:
                print("  Avg Ferrox vs TorchSim: N/A (all failed)")
            if vs_ase_vals:
                avg_vs_ase = sum(vs_ase_vals) / len(vs_ase_vals)
                print(
                    f"  Avg Ferrox vs ASE:      {avg_vs_ase:.2f}x ({len(vs_ase_vals)}/{len(results)} succeeded)"
                )
            else:
                print("  Avg Ferrox vs ASE:      N/A (all failed)")

    print("\n" + "=" * 70)

    return all_results


def main() -> None:
    """Main entry point for CLI."""
    parser = argparse.ArgumentParser(description="Benchmark ferrox vs torch-sim vs ASE")
    parser.add_argument(
        "--systems",
        type=str,
        default=None,
        help="Comma-separated list of systems to benchmark (default: all)",
    )
    parser.add_argument(
        "--md-steps",
        type=int,
        default=100,
        help="Number of MD steps (default: 100)",
    )
    parser.add_argument(
        "--fire-steps",
        type=int,
        default=100,
        help="Maximum FIRE optimization steps (default: 100)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output JSON file path",
    )

    args = parser.parse_args()

    system_names = args.systems.split(",") if args.systems else None

    run_all_benchmarks(
        system_names=system_names,
        n_steps_md=args.md_steps,
        max_steps_fire=args.fire_steps,
        output_file=args.output,
    )


if __name__ == "__main__":
    main()
