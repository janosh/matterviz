# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "ase",
#     "mace-torch",
#     "numpy",
#     "pymatgen",
#     "torch",
#     "torch-sim",
# ]
#
# [tool.uv.sources]
# ferrox = { path = "../../", editable = true }
# ///
"""Main MACE benchmark comparison script.

This script compares ferrox, torch-sim, and ASE using MACE-MP as the force model.

Usage (as module from tests/ directory):
    python -m benchmarks.compare [--systems SYSTEMS] [--output OUTPUT]

Example:
    python -m benchmarks.compare --systems mgo_64,cu_108 --output results.json
"""

import argparse
import json
from collections.abc import Callable, Mapping
from dataclasses import asdict
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from pymatgen.core import Structure

from .ase_runner import run_ase_fire, run_ase_nve, run_ase_nvt
from .ferrox_runner import run_ferrox_fire, run_ferrox_nve, run_ferrox_nvt
from .mace_model import get_mace_model
from .results import BenchmarkResult, FireResult, MDResult, safe_divide
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


def _run_single_runner(
    name: str,
    runner_fn: Callable[[], FireResult | MDResult],
) -> tuple[float | None, float | None, list[str]]:
    """Run a single benchmark runner with error handling.

    Returns:
        Tuple of (elapsed_time, steps_per_second, errors_list)
    """
    print(f"    - {name}...", end=" ", flush=True)
    try:
        result = runner_fn()
        elapsed = result.timing.elapsed
        sps = result.timing.steps_per_second
        print(f"{sps:.1f} steps/s")
    except (RuntimeError, ValueError, TypeError, KeyError, AttributeError) as exc:
        print(f"FAILED: {exc}")
        return None, None, [f"{name}: {exc}"]
    else:
        return elapsed, sps, []


def _run_benchmark_suite(
    systems: Mapping[str, Structure],
    benchmark_type: str,
    label: str,
    ferrox_fn: Callable[[Structure], FireResult | MDResult],
    torchsim_fn: Callable[[Structure], FireResult | MDResult],
    ase_fn: Callable[[Structure], FireResult | MDResult],
    n_steps: int,
    preprocess: Callable[[Structure], Structure] | None = None,
) -> list[BenchmarkResult]:
    """Generic benchmark runner for ferrox, torch-sim, and ASE.

    Args:
        systems: Dict of system_name -> Structure
        benchmark_type: Type identifier ('fire', 'nve', 'nvt')
        label: Human-readable label for printing (e.g., 'FIRE', 'NVE')
        ferrox_fn: Ferrox runner function taking Structure
        torchsim_fn: TorchSim runner function taking Structure
        ase_fn: ASE runner function taking Structure
        n_steps: Number of steps (used in result)
        preprocess: Optional function to preprocess structure before benchmarking

    Returns:
        List of BenchmarkResult for each system
    """
    results = []

    for name, structure in systems.items():
        print(f"\n  Running {label} on {name} ({structure.num_sites} atoms)...")
        struct = preprocess(structure) if preprocess else structure
        all_errors: list[str] = []

        ferrox_time, ferrox_sps, errs = _run_single_runner(
            "ferrox", lambda s=struct: ferrox_fn(s)
        )
        all_errors.extend(errs)

        torchsim_time, torchsim_sps, errs = _run_single_runner(
            "torch-sim", lambda s=struct: torchsim_fn(s)
        )
        all_errors.extend(errs)

        ase_time, ase_sps, errs = _run_single_runner("ase", lambda s=struct: ase_fn(s))
        all_errors.extend(errs)

        results.append(
            BenchmarkResult(
                system=name,
                n_atoms=structure.num_sites,
                benchmark_type=benchmark_type,
                n_steps=n_steps,
                ferrox_time=ferrox_time,
                ferrox_steps_per_sec=ferrox_sps,
                torchsim_time=torchsim_time,
                torchsim_steps_per_sec=torchsim_sps,
                ase_time=ase_time,
                ase_steps_per_sec=ase_sps,
                ferrox_vs_torchsim=safe_divide(torchsim_time, ferrox_time),
                ferrox_vs_ase=safe_divide(ase_time, ferrox_time),
                error="; ".join(all_errors) if all_errors else None,
            )
        )

    return results


def benchmark_fire(
    systems: Mapping[str, Structure],
    mace_calc: "MACECalculator",
    torchsim_model: "MaceModel",
    max_steps: int = 100,
    fmax: float = 0.01,
) -> list[BenchmarkResult]:
    """Run FIRE optimization benchmark comparing all packages."""
    return _run_benchmark_suite(
        systems=systems,
        benchmark_type="fire",
        label="FIRE",
        ferrox_fn=lambda s: run_ferrox_fire(s, mace_calc, max_steps, fmax),
        torchsim_fn=lambda s: run_torchsim_fire(s, torchsim_model, max_steps, fmax),
        ase_fn=lambda s: run_ase_fire(s, mace_calc, max_steps, fmax),
        n_steps=max_steps,
        preprocess=lambda s: perturb_structure(s, amplitude=0.1),
    )


def benchmark_nve(
    systems: Mapping[str, Structure],
    mace_calc: "MACECalculator",
    torchsim_model: "MaceModel",
    n_steps: int = 100,
    dt: float = 1.0,
    temperature: float = 300.0,
) -> list[BenchmarkResult]:
    """Run NVE MD benchmark comparing all packages."""
    return _run_benchmark_suite(
        systems=systems,
        benchmark_type="nve",
        label="NVE",
        ferrox_fn=lambda s: run_ferrox_nve(s, mace_calc, n_steps, dt, temperature),
        torchsim_fn=lambda s: run_torchsim_nve(
            s, torchsim_model, n_steps, dt, temperature
        ),
        ase_fn=lambda s: run_ase_nve(s, mace_calc, n_steps, dt, temperature),
        n_steps=n_steps,
    )


def benchmark_nvt(
    systems: Mapping[str, Structure],
    mace_calc: "MACECalculator",
    torchsim_model: "MaceModel",
    n_steps: int = 100,
    dt: float = 1.0,
    temperature: float = 300.0,
    friction: float = 0.01,
) -> list[BenchmarkResult]:
    """Run NVT MD benchmark comparing all packages."""
    return _run_benchmark_suite(
        systems=systems,
        benchmark_type="nvt",
        label="NVT",
        ferrox_fn=lambda s: run_ferrox_nvt(
            s, mace_calc, n_steps, dt, temperature, friction
        ),
        torchsim_fn=lambda s: run_torchsim_nvt(
            s, torchsim_model, n_steps, dt, temperature, friction
        ),
        ase_fn=lambda s: run_ase_nvt(s, mace_calc, n_steps, dt, temperature, friction),
        n_steps=n_steps,
    )


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

    errors = []
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
            errors.append(f"  - {row.system}: {row.error}")

    if errors:
        print("\n**Errors:**")
        for err in errors:
            print(err)


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
        valid = {name: SYSTEMS[name] for name in system_names if name in SYSTEMS}
        invalid = [name for name in system_names if name not in SYSTEMS]
        if invalid:
            print(f"WARNING: Unknown systems ignored: {invalid}")
            print(f"Available systems: {list(SYSTEMS.keys())}")
        systems = valid
    else:
        systems = SYSTEMS

    if not systems:
        print(f"ERROR: No valid systems selected. Available: {list(SYSTEMS.keys())}")
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
