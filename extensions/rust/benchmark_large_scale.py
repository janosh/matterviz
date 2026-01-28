"""Large-scale benchmark comparing ferrox (Rust) vs pymatgen (Python) StructureMatcher.

This benchmark uses real WBM (Wrenformer-Bowser-Megnet) structures from matbench-discovery
to measure performance at scale (up to 10k+ structures).

Key scenarios:
- Deduplication at scale (sanity check: WBM should have zero duplicates)
- Pairwise fit sampling
- Group structures scaling
- Memory profiling

Usage:
    python benchmark_large_scale.py                    # Full benchmark (10k structures)
    python benchmark_large_scale.py --quick            # Quick benchmark (1k structures)
    python benchmark_large_scale.py --n-structures 5000
    python benchmark_large_scale.py --export-plots
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import tracemalloc
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import numpy as np

if TYPE_CHECKING:
    from collections.abc import Callable

# Check for required packages
try:
    from tqdm import tqdm
except ImportError:
    raise ImportError("tqdm not installed. Run: pip install tqdm") from None

try:
    from tabulate import tabulate
except ImportError:
    raise ImportError("tabulate not installed. Run: pip install tabulate") from None

# pymatgen imports
from pymatgen.analysis.structure_matcher import StructureMatcher as PyMatcher
from pymatgen.core import Structure

# ferrox import
try:
    from ferrox import StructureMatcher as RustMatcher
except ImportError:
    raise ImportError(
        "ferrox not installed. Run: cd extensions/rust && maturin develop --features python --release"
    ) from None


# Data Classes


@dataclass
class BenchmarkConfig:
    """Configuration for benchmark runs."""

    n_structures: int = 10000
    n_warmup_runs: int = 1
    n_timed_runs: int = 3
    random_seed: int = 42
    output_json_path: str | None = "benchmark_large_scale_results.json"
    export_plots: bool = False
    verbose: bool = True
    quick: bool = False


@dataclass
class StructureStats:
    """Statistics about a set of structures."""

    n_structures: int = 0
    total_atoms: int = 0
    avg_atoms: float = 0.0
    min_atoms: int = 0
    max_atoms: int = 0
    atom_count_distribution: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "n_structures": self.n_structures,
            "total_atoms": self.total_atoms,
            "avg_atoms": round(self.avg_atoms, 2),
            "min_atoms": self.min_atoms,
            "max_atoms": self.max_atoms,
        }


@dataclass
class BenchmarkResult:
    """Result of a single benchmark run."""

    name: str
    scenario: str
    implementation: str  # "pymatgen" or "ferrox"
    n_structures: int
    n_comparisons: int
    total_time_s: float
    time_std_s: float
    throughput_per_s: float
    memory_peak_mb: float
    extra_info: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "name": self.name,
            "scenario": self.scenario,
            "implementation": self.implementation,
            "n_structures": self.n_structures,
            "n_comparisons": self.n_comparisons,
            "total_time_s": round(self.total_time_s, 4),
            "time_std_s": round(self.time_std_s, 4),
            "throughput_per_s": round(self.throughput_per_s, 2),
            "memory_peak_mb": round(self.memory_peak_mb, 2),
            "extra_info": self.extra_info,
        }


@dataclass
class ComparisonResult:
    """Comparison between pymatgen and ferrox results."""

    scenario: str
    n_structures: int
    pymatgen_time_s: float
    ferrox_time_s: float
    speedup: float
    pymatgen_memory_mb: float
    ferrox_memory_mb: float
    results_match: bool

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "scenario": self.scenario,
            "n_structures": self.n_structures,
            "pymatgen_time_s": round(self.pymatgen_time_s, 4),
            "ferrox_time_s": round(self.ferrox_time_s, 4),
            "speedup": round(self.speedup, 2),
            "pymatgen_memory_mb": round(self.pymatgen_memory_mb, 2),
            "ferrox_memory_mb": round(self.ferrox_memory_mb, 2),
            "results_match": self.results_match,
        }


# Structure Loading


def generate_synthetic_structures(
    n_structures: int, seed: int = 42, verbose: bool = True
) -> list[Structure]:
    """Generate synthetic structures for benchmarking when WBM data is unavailable.

    Creates diverse structures with varying compositions, sizes, and lattice types.

    Args:
        n_structures: Number of structures to generate.
        seed: Random seed for reproducibility.
        verbose: Whether to show progress.

    Returns:
        List of pymatgen Structure objects.
    """
    from pymatgen.core import Lattice

    if verbose:
        print(f"Generating {n_structures:,} synthetic structures...")

    rng = np.random.default_rng(seed=seed)
    structures = []

    # Element pools for variety
    metals = [
        "Li",
        "Na",
        "K",
        "Mg",
        "Ca",
        "Sr",
        "Ba",
        "Fe",
        "Co",
        "Ni",
        "Cu",
        "Zn",
        "Al",
        "Ti",
        "V",
        "Cr",
        "Mn",
    ]
    nonmetals = ["O", "S", "Se", "N", "P", "F", "Cl", "Br", "I"]

    iterator = tqdm(range(n_structures), desc="Generating", disable=not verbose)
    for _idx in iterator:
        # Random lattice parameters
        a = rng.uniform(3.0, 12.0)
        b = rng.uniform(3.0, 12.0)
        c = rng.uniform(3.0, 12.0)
        alpha = rng.uniform(70.0, 110.0)
        beta = rng.uniform(70.0, 110.0)
        gamma = rng.uniform(70.0, 110.0)

        lattice = Lattice.from_parameters(a, b, c, alpha, beta, gamma)

        # Random number of atoms (bias towards smaller structures)
        n_atoms = int(rng.exponential(10)) + 2
        n_atoms = min(n_atoms, 100)  # Cap at 100 atoms

        # Random composition (metal + nonmetal)
        n_metals = rng.integers(1, n_atoms)
        n_nonmetals = n_atoms - n_metals

        species = []
        species.extend(rng.choice(metals, size=n_metals).tolist())
        if n_nonmetals > 0:
            species.extend(rng.choice(nonmetals, size=n_nonmetals).tolist())

        # Random fractional coordinates
        coords = rng.random((n_atoms, 3))

        try:
            struct = Structure(lattice, species, coords)
            structures.append(struct)
        except ValueError:
            # Skip structures with invalid coordinates (e.g., overlapping sites)
            continue

    if verbose:
        print(f"  Generated {len(structures):,} structures")

    return structures


def load_wbm_structures(limit: int = 10000, verbose: bool = True) -> list[Structure]:
    """Load WBM structures from matbench-discovery.

    Falls back to synthetic structures if WBM data is unavailable.

    Args:
        limit: Maximum number of structures to load.
        verbose: Whether to show progress bar.

    Returns:
        List of pymatgen Structure objects.
    """
    try:
        # Import with delayed loading to avoid module-level errors
        import importlib

        matbench_data = importlib.import_module("matbench_discovery.data")
        ase_atoms_from_zip = matbench_data.ase_atoms_from_zip
        DataFiles = importlib.import_module("matbench_discovery.enums").DataFiles
        from pymatgen.io.ase import AseAtomsAdaptor
    except (ImportError, AttributeError) as exc:
        if verbose:
            print(
                f"WARNING: matbench-discovery not available ({exc}), using synthetic structures"
            )
        return generate_synthetic_structures(limit, verbose=verbose)

    if verbose:
        print(f"Loading up to {limit:,} WBM structures...")

    try:
        # Load ASE Atoms from ZIP
        data_path = DataFiles.wbm_initial_atoms.path
        atoms_list = list(ase_atoms_from_zip(data_path, limit=limit))

        if verbose:
            print(f"  Loaded {len(atoms_list):,} ASE Atoms objects")
            print("  Converting to pymatgen Structures...")

        # Convert to pymatgen Structures
        structures = []
        iterator = tqdm(atoms_list, desc="Converting", disable=not verbose)
        for atoms in iterator:
            try:
                struct = AseAtomsAdaptor.get_structure(atoms)
                structures.append(struct)
            except Exception as exc:
                if verbose:
                    print(f"  Warning: Failed to convert structure: {exc}")

        if verbose:
            print(f"  Successfully converted {len(structures):,} structures")

        if not structures:
            raise ValueError("No structures loaded from WBM")

        return structures

    except Exception as exc:
        import traceback

        if verbose:
            print(f"WARNING: Failed to load WBM structures: {exc}")
            print(traceback.format_exc())
            print("Falling back to synthetic structures")
        return generate_synthetic_structures(limit, verbose=verbose)


def compute_structure_stats(structures: list[Structure]) -> StructureStats:
    """Compute statistics about a list of structures.

    Args:
        structures: List of pymatgen Structure objects.

    Returns:
        StructureStats object with computed statistics.
    """
    if not structures:
        return StructureStats()

    atom_counts = [len(s) for s in structures]

    # Bin atom counts
    bins = [(1, 10), (11, 20), (21, 50), (51, 100), (101, 200), (201, float("inf"))]
    distribution = {}
    for low, high in bins:
        label = f"{low}-{int(high)}" if high != float("inf") else f"{low}+"
        count = sum(1 for ac in atom_counts if low <= ac <= high)
        if count > 0:
            distribution[label] = count

    return StructureStats(
        n_structures=len(structures),
        total_atoms=sum(atom_counts),
        avg_atoms=np.mean(atom_counts),
        min_atoms=min(atom_counts),
        max_atoms=max(atom_counts),
        atom_count_distribution=distribution,
    )


# JSON Conversion


def convert_structures_to_json(
    structures: list[Structure], verbose: bool = True
) -> list[str]:
    """Convert structures to JSON strings for ferrox.

    Args:
        structures: List of pymatgen Structure objects.
        verbose: Whether to show progress bar.

    Returns:
        List of JSON strings.
    """
    if verbose:
        print(f"Converting {len(structures):,} structures to JSON...")

    json_structures = []
    iterator = tqdm(structures, desc="JSON conversion", disable=not verbose)
    for struct in iterator:
        json_structures.append(json.dumps(struct.as_dict()))

    return json_structures


# Benchmark Utilities


def benchmark_with_memory(
    func: Callable[[], Any],
    n_warmup: int = 1,
    n_timed: int = 3,
) -> tuple[Any, float, float, float]:
    """Run a benchmark function with timing and memory tracking.

    Args:
        func: Function to benchmark (should take no arguments).
        n_warmup: Number of warmup runs.
        n_timed: Number of timed runs.

    Returns:
        Tuple of (result, median_time, std_time, peak_memory_mb).
    """
    # Warmup runs
    for _ in range(n_warmup):
        func()

    # Timed runs with memory tracking
    times = []
    peak_memory = 0
    result = None

    for _ in range(n_timed):
        tracemalloc.start()
        start = time.perf_counter()
        result = func()
        elapsed = time.perf_counter() - start
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        times.append(elapsed)
        peak_memory = max(peak_memory, peak)

    median_time = np.median(times)
    std_time = np.std(times) if len(times) > 1 else 0.0
    peak_memory_mb = peak_memory / (1024 * 1024)

    return result, median_time, std_time, peak_memory_mb


# Benchmark Scenarios


def benchmark_deduplication(
    structures: list[Structure],
    json_structures: list[str],
    config: BenchmarkConfig,
) -> list[ComparisonResult]:
    """Benchmark deduplication on varying structure counts.

    Args:
        structures: List of pymatgen Structure objects.
        json_structures: List of JSON strings for ferrox.
        config: Benchmark configuration.

    Returns:
        List of comparison results.
    """
    print("\n" + "=" * 70)
    print("BENCHMARK: Deduplication at Scale")
    print("=" * 70)

    # Structure counts to test
    if config.quick:
        counts = [100, 500, 1000]
    else:
        counts = [100, 500, 1000, 2000, 5000, min(10000, len(structures))]

    # Filter to available structures
    counts = [c for c in counts if c <= len(structures)]

    py_matcher = PyMatcher(ltol=0.2, stol=0.3, angle_tol=5.0, primitive_cell=False)
    rust_matcher = RustMatcher(latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0)

    results = []

    for n_struct in counts:
        print(f"\n--- Deduplication with {n_struct:,} structures ---")

        subset_structs = structures[:n_struct]
        subset_json = json_structures[:n_struct]

        # Pymatgen benchmark
        print("  Running pymatgen...")

        def py_dedup(structs=subset_structs):
            groups = py_matcher.group_structures(structs)
            return len(groups)

        py_result, py_time, py_std, py_mem = benchmark_with_memory(
            py_dedup,
            n_warmup=config.n_warmup_runs,
            n_timed=config.n_timed_runs,
        )
        py_n_groups = py_result
        print(
            f"    Time: {py_time:.3f}s (±{py_std:.3f}s), Groups: {py_n_groups}, Memory: {py_mem:.1f}MB"
        )

        # ferrox benchmark
        print("  Running ferrox...")

        def rust_dedup(json_strs=subset_json):
            groups = rust_matcher.group(json_strs)
            return len(groups)

        rust_result, rust_time, rust_std, rust_mem = benchmark_with_memory(
            rust_dedup,
            n_warmup=config.n_warmup_runs,
            n_timed=config.n_timed_runs,
        )
        rust_n_groups = rust_result
        print(
            f"    Time: {rust_time:.3f}s (±{rust_std:.3f}s), Groups: {rust_n_groups}, Memory: {rust_mem:.1f}MB"
        )

        # Compute speedup
        speedup = py_time / rust_time if rust_time > 0 else float("inf")
        results_match = py_n_groups == rust_n_groups

        print(f"  Speedup: {speedup:.1f}x, Results match: {results_match}")

        # Sanity check: WBM should have mostly unique structures
        n_duplicates = n_struct - py_n_groups
        if n_duplicates > 0:
            print(f"  WARNING: Found {n_duplicates} duplicate structures in WBM!")

        results.append(
            ComparisonResult(
                scenario=f"dedup_{n_struct}",
                n_structures=n_struct,
                pymatgen_time_s=py_time,
                ferrox_time_s=rust_time,
                speedup=speedup,
                pymatgen_memory_mb=py_mem,
                ferrox_memory_mb=rust_mem,
                results_match=results_match,
            )
        )

    return results


def benchmark_pairwise_fit(
    structures: list[Structure],
    json_structures: list[str],
    config: BenchmarkConfig,
) -> list[ComparisonResult]:
    """Benchmark pairwise fit on sampled pairs.

    Args:
        structures: List of pymatgen Structure objects.
        json_structures: List of JSON strings for ferrox.
        config: Benchmark configuration.

    Returns:
        List of comparison results.
    """
    print("\n" + "=" * 70)
    print("BENCHMARK: Pairwise Fit Sampling")
    print("=" * 70)

    # Number of pairs to test
    if config.quick:
        pair_counts = [1000, 5000]
    else:
        pair_counts = [1000, 5000, 10000, 50000]

    rng = np.random.default_rng(seed=config.random_seed)
    n_available = len(structures)

    py_matcher = PyMatcher(ltol=0.2, stol=0.3, angle_tol=5.0, primitive_cell=False)
    rust_matcher = RustMatcher(latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0)

    results = []

    # Note: This benchmark measures the full API as users would call it.
    # For ferrox, this includes JSON parsing overhead on each fit() call.
    # This is intentional - it reflects real-world usage patterns.
    # To strictly compare the matching speed without JSON overhead,
    # need to implement "strict_compare" mode.
    for n_pairs in pair_counts:
        print(f"\n--- Pairwise fit with {n_pairs:,} pairs ---")

        # Sample random pairs
        indices = rng.integers(0, n_available, size=(n_pairs, 2))

        # Pymatgen benchmark
        print("  Running pymatgen...")

        def py_fit(pair_idx=indices, structs=structures):
            n_matches = 0
            for idx1, idx2 in pair_idx:
                if py_matcher.fit(structs[idx1], structs[idx2]):
                    n_matches += 1
            return n_matches

        py_result, py_time, py_std, py_mem = benchmark_with_memory(
            py_fit,
            n_warmup=config.n_warmup_runs,
            n_timed=config.n_timed_runs,
        )
        py_n_matches = py_result
        py_throughput = n_pairs / py_time if py_time > 0 else float("inf")
        print(
            f"    Time: {py_time:.3f}s (±{py_std:.3f}s), Matches: {py_n_matches}, "
            f"Throughput: {py_throughput:.0f} pairs/s"
        )

        # ferrox benchmark
        print("  Running ferrox...")

        def rust_fit(pair_idx=indices, json_strs=json_structures):
            n_matches = 0
            for idx1, idx2 in pair_idx:
                if rust_matcher.fit(json_strs[idx1], json_strs[idx2]):
                    n_matches += 1
            return n_matches

        rust_result, rust_time, rust_std, rust_mem = benchmark_with_memory(
            rust_fit,
            n_warmup=config.n_warmup_runs,
            n_timed=config.n_timed_runs,
        )
        rust_n_matches = rust_result
        rust_throughput = n_pairs / rust_time if rust_time > 0 else float("inf")
        print(
            f"    Time: {rust_time:.3f}s (±{rust_std:.3f}s), Matches: {rust_n_matches}, "
            f"Throughput: {rust_throughput:.0f} pairs/s"
        )

        # Compute speedup
        speedup = py_time / rust_time if rust_time > 0 else float("inf")
        results_match = py_n_matches == rust_n_matches

        print(f"  Speedup: {speedup:.1f}x, Results match: {results_match}")

        results.append(
            ComparisonResult(
                scenario=f"pairwise_{n_pairs}",
                n_structures=n_pairs,
                pymatgen_time_s=py_time,
                ferrox_time_s=rust_time,
                speedup=speedup,
                pymatgen_memory_mb=py_mem,
                ferrox_memory_mb=rust_mem,
                results_match=results_match,
            )
        )

    return results


def benchmark_group_structures_scaling(
    structures: list[Structure],
    json_structures: list[str],
    config: BenchmarkConfig,
) -> list[ComparisonResult]:
    """Benchmark group_structures with increasing structure counts.

    This is the stress test - O(n²) complexity.

    Args:
        structures: List of pymatgen Structure objects.
        json_structures: List of JSON strings for ferrox.
        config: Benchmark configuration.

    Returns:
        List of comparison results.
    """
    print("\n" + "=" * 70)
    print("BENCHMARK: Group Structures Scaling (O(n²) stress test)")
    print("=" * 70)

    # Structure counts to test
    if config.quick:
        counts = [50, 100, 200]
    else:
        counts = [50, 100, 200, 500, 1000]

    # Filter to available structures
    counts = [c for c in counts if c <= len(structures)]

    py_matcher = PyMatcher(ltol=0.2, stol=0.3, angle_tol=5.0, primitive_cell=False)
    rust_matcher = RustMatcher(latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0)

    results = []

    for n_struct in counts:
        print(f"\n--- Group structures with {n_struct:,} structures ---")

        subset_structs = structures[:n_struct]
        subset_json = json_structures[:n_struct]
        n_comparisons = n_struct * (n_struct - 1) // 2

        # Pymatgen benchmark
        print("  Running pymatgen...")

        def py_group(structs=subset_structs):
            return py_matcher.group_structures(structs)

        py_result, py_time, py_std, py_mem = benchmark_with_memory(
            py_group,
            n_warmup=config.n_warmup_runs,
            n_timed=min(config.n_timed_runs, 2),  # Fewer runs for slow operations
        )
        py_n_groups = len(py_result)
        py_throughput = n_comparisons / py_time if py_time > 0 else float("inf")
        print(
            f"    Time: {py_time:.3f}s (±{py_std:.3f}s), Groups: {py_n_groups}, "
            f"Throughput: {py_throughput:.0f} comparisons/s"
        )

        # ferrox benchmark
        print("  Running ferrox...")

        def rust_group(json_strs=subset_json):
            return rust_matcher.group(json_strs)

        rust_result, rust_time, rust_std, rust_mem = benchmark_with_memory(
            rust_group,
            n_warmup=config.n_warmup_runs,
            n_timed=config.n_timed_runs,
        )
        rust_n_groups = len(rust_result)
        rust_throughput = n_comparisons / rust_time if rust_time > 0 else float("inf")
        print(
            f"    Time: {rust_time:.3f}s (±{rust_std:.3f}s), Groups: {rust_n_groups}, "
            f"Throughput: {rust_throughput:.0f} comparisons/s"
        )

        # Compute speedup
        speedup = py_time / rust_time if rust_time > 0 else float("inf")
        results_match = py_n_groups == rust_n_groups

        print(f"  Speedup: {speedup:.1f}x, Results match: {results_match}")

        results.append(
            ComparisonResult(
                scenario=f"group_{n_struct}",
                n_structures=n_struct,
                pymatgen_time_s=py_time,
                ferrox_time_s=rust_time,
                speedup=speedup,
                pymatgen_memory_mb=py_mem,
                ferrox_memory_mb=rust_mem,
                results_match=results_match,
            )
        )

    return results


def benchmark_by_structure_size(
    structures: list[Structure],
    json_structures: list[str],
    config: BenchmarkConfig,
) -> list[ComparisonResult]:
    """Benchmark performance binned by structure size (atom count).

    Args:
        structures: List of pymatgen Structure objects.
        json_structures: List of JSON strings for ferrox.
        config: Benchmark configuration.

    Returns:
        List of comparison results.
    """
    print("\n" + "=" * 70)
    print("BENCHMARK: Performance by Structure Size")
    print("=" * 70)

    # Bin structures by atom count
    bins = [(1, 20), (21, 50), (51, 100), (101, 200)]

    py_matcher = PyMatcher(ltol=0.2, stol=0.3, angle_tol=5.0, primitive_cell=False)
    rust_matcher = RustMatcher(latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0)

    results = []
    rng = np.random.default_rng(seed=config.random_seed)

    for low, high in bins:
        # Find structures in this size range
        indices = [idx for idx, s in enumerate(structures) if low <= len(s) <= high]

        if len(indices) < 100:
            print(
                f"\n--- Skipping {low}-{high} atoms (only {len(indices)} structures) ---"
            )
            continue

        print(
            f"\n--- Structures with {low}-{high} atoms ({len(indices):,} available) ---"
        )

        # Sample 500 pairs from this bin
        n_pairs = min(500, len(indices) * (len(indices) - 1) // 2)
        pair_indices = rng.choice(indices, size=(n_pairs, 2), replace=True)

        # Pymatgen benchmark
        print("  Running pymatgen...")

        def py_fit(pairs=pair_indices, structs=structures):
            n_matches = 0
            for idx1, idx2 in pairs:
                if py_matcher.fit(structs[idx1], structs[idx2]):
                    n_matches += 1
            return n_matches

        py_result, py_time, _py_std, py_mem = benchmark_with_memory(
            py_fit,
            n_warmup=config.n_warmup_runs,
            n_timed=config.n_timed_runs,
        )
        py_throughput = n_pairs / py_time if py_time > 0 else float("inf")
        print(f"    Time: {py_time:.3f}s, Throughput: {py_throughput:.0f} pairs/s")

        # ferrox benchmark
        print("  Running ferrox...")

        def rust_fit(pairs=pair_indices, json_strs=json_structures):
            n_matches = 0
            for idx1, idx2 in pairs:
                if rust_matcher.fit(json_strs[idx1], json_strs[idx2]):
                    n_matches += 1
            return n_matches

        rust_result, rust_time, _rust_std, rust_mem = benchmark_with_memory(
            rust_fit,
            n_warmup=config.n_warmup_runs,
            n_timed=config.n_timed_runs,
        )
        rust_throughput = n_pairs / rust_time if rust_time > 0 else float("inf")
        print(f"    Time: {rust_time:.3f}s, Throughput: {rust_throughput:.0f} pairs/s")

        # Compute speedup
        speedup = py_time / rust_time if rust_time > 0 else float("inf")
        results_match = py_result == rust_result

        print(f"  Speedup: {speedup:.1f}x")

        results.append(
            ComparisonResult(
                scenario=f"size_{low}_{high}",
                n_structures=n_pairs,
                pymatgen_time_s=py_time,
                ferrox_time_s=rust_time,
                speedup=speedup,
                pymatgen_memory_mb=py_mem,
                ferrox_memory_mb=rust_mem,
                results_match=results_match,
            )
        )

    return results


# Output Functions


def print_summary_table(results: list[ComparisonResult]) -> None:
    """Print a formatted summary table of results.

    Args:
        results: List of comparison results.
    """
    print("\n" + "=" * 70)
    print("SUMMARY TABLE")
    print("=" * 70)

    table_data = []
    for res in results:
        table_data.append(
            [
                res.scenario,
                f"{res.n_structures:,}",
                f"{res.pymatgen_time_s:.3f}s",
                f"{res.ferrox_time_s:.3f}s",
                f"{res.speedup:.1f}x",
                f"{res.pymatgen_memory_mb:.1f}MB",
                f"{res.ferrox_memory_mb:.1f}MB",
                "✓" if res.results_match else "✗",
            ]
        )

    headers = "Scenario,N,Pymatgen,ferrox,Speedup,Py Mem,Rust Mem,Match".split(",")
    print(tabulate(table_data, headers=headers, tablefmt="grid"))

    # Summary statistics
    if results:
        finite_speedups = [r.speedup for r in results if r.speedup != float("inf")]
        all_match = all(r.results_match for r in results)

        if finite_speedups:
            print(f"\nAverage speedup: {np.mean(finite_speedups):.1f}x")
            print(f"Maximum speedup: {max(finite_speedups):.1f}x")
        else:
            print("\nSpeedup: inf (Rust time too fast to measure)")
        print(
            f"All results match: {'Yes' if all_match else 'NO - DISCREPANCY DETECTED!'}"
        )


def save_results_json(results: list[ComparisonResult], path: str) -> None:
    """Save results to JSON file.

    Args:
        results: List of comparison results.
        path: Output file path.
    """
    data = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "results": [r.to_dict() for r in results],
    }

    with open(path, "w") as f:
        json.dump(data, f, indent=2)

    print(f"\nResults saved to: {path}")


def create_plots(results: list[ComparisonResult], output_dir: str = ".") -> None:
    """Create benchmark plots.

    Args:
        results: List of comparison results.
        output_dir: Directory to save plots.
    """
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        print("WARNING: matplotlib not installed, skipping plots")
        return

    print("\nGenerating plots...")

    # Filter results by scenario type
    dedup_results = [r for r in results if r.scenario.startswith("dedup_")]
    group_results = [r for r in results if r.scenario.startswith("group_")]
    pairwise_results = [r for r in results if r.scenario.startswith("pairwise_")]

    _fig, axes = plt.subplots(2, 2, figsize=(12, 10))

    # Plot 1: Deduplication scaling
    if dedup_results:
        ax = axes[0, 0]
        n_structs = [r.n_structures for r in dedup_results]
        py_times = [r.pymatgen_time_s for r in dedup_results]
        rust_times = [r.ferrox_time_s for r in dedup_results]

        ax.loglog(n_structs, py_times, "o-", label="pymatgen", color="blue")
        ax.loglog(n_structs, rust_times, "s-", label="ferrox", color="orange")
        ax.set_xlabel("Number of Structures")
        ax.set_ylabel("Time (s)")
        ax.set_title("Deduplication Scaling")
        ax.legend()
        ax.grid(True, alpha=0.3)

    # Plot 2: Group structures scaling
    if group_results:
        ax = axes[0, 1]
        n_structs = [r.n_structures for r in group_results]
        py_times = [r.pymatgen_time_s for r in group_results]
        rust_times = [r.ferrox_time_s for r in group_results]

        ax.loglog(n_structs, py_times, "o-", label="pymatgen", color="blue")
        ax.loglog(n_structs, rust_times, "s-", label="ferrox", color="orange")
        ax.set_xlabel("Number of Structures")
        ax.set_ylabel("Time (s)")
        ax.set_title("Group Structures Scaling (O(n²))")
        ax.legend()
        ax.grid(True, alpha=0.3)

    # Plot 3: Speedup vs problem size
    ax = axes[1, 0]
    scenarios = [r.scenario for r in results]
    speedups = [r.speedup for r in results]
    colors = ["green" if s >= 1 else "red" for s in speedups]

    ax.barh(range(len(scenarios)), speedups, color=colors, alpha=0.7)
    ax.set_yticks(range(len(scenarios)))
    ax.set_yticklabels(scenarios, fontsize=8)
    ax.axvline(x=1, color="black", linestyle="--", alpha=0.5)
    ax.set_xlabel("Speedup (higher is better)")
    ax.set_title("ferrox Speedup vs Pymatgen")
    ax.grid(True, axis="x", alpha=0.3)

    # Plot 4: Pairwise fit throughput
    if pairwise_results:
        ax = axes[1, 1]
        n_pairs = [r.n_structures for r in pairwise_results]
        py_throughput = [
            r.n_structures / r.pymatgen_time_s
            if r.pymatgen_time_s > 0
            else float("inf")
            for r in pairwise_results
        ]
        rust_throughput = [
            r.n_structures / r.ferrox_time_s if r.ferrox_time_s > 0 else float("inf")
            for r in pairwise_results
        ]

        width = 0.35
        x_pos = np.arange(len(n_pairs))
        ax.bar(
            x_pos - width / 2,
            py_throughput,
            width,
            label="pymatgen",
            color="blue",
            alpha=0.7,
        )
        ax.bar(
            x_pos + width / 2,
            rust_throughput,
            width,
            label="ferrox",
            color="orange",
            alpha=0.7,
        )
        ax.set_xticks(x_pos)
        ax.set_xticklabels([f"{n:,}" for n in n_pairs])
        ax.set_xlabel("Number of Pairs")
        ax.set_ylabel("Throughput (pairs/s)")
        ax.set_title("Pairwise Fit Throughput")
        ax.legend()
        ax.grid(True, axis="y", alpha=0.3)

    plt.tight_layout()

    plot_path = os.path.join(output_dir, "benchmark_plots.png")
    plt.savefig(plot_path, dpi=150)
    print(f"Plots saved to: {plot_path}")

    plt.close()


# CLI and Main


def parse_args() -> argparse.Namespace:
    """Parse command line arguments.

    Returns:
        Parsed arguments.
    """
    parser = argparse.ArgumentParser(
        description="Large-scale benchmark comparing ferrox vs pymatgen StructureMatcher",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python benchmark_large_scale.py                     # Full benchmark (10k structures)
  python benchmark_large_scale.py --quick             # Quick benchmark (1k structures)
  python benchmark_large_scale.py --n-structures 5000 # Custom structure count
  python benchmark_large_scale.py --export-plots      # Generate matplotlib plots
""",
    )
    parser.add_argument(
        "--quick",
        "-q",
        action="store_true",
        help="Run quick benchmark with fewer structures and scenarios",
    )
    parser.add_argument(
        "--n-structures",
        "-n",
        type=int,
        default=10000,
        help="Maximum number of structures to load (default: 10000)",
    )
    parser.add_argument(
        "--runs",
        "-r",
        type=int,
        default=3,
        help="Number of timed runs per benchmark (default: 3)",
    )
    parser.add_argument(
        "--warmup",
        "-w",
        type=int,
        default=1,
        help="Number of warmup runs (default: 1)",
    )
    parser.add_argument(
        "--seed",
        "-s",
        type=int,
        default=42,
        help="Random seed for reproducibility (default: 42)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default="benchmark_large_scale_results.json",
        help="Output JSON file path",
    )
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="Don't save results to JSON file",
    )
    parser.add_argument(
        "--export-plots",
        action="store_true",
        help="Export matplotlib plots",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Reduce output verbosity",
    )
    parser.add_argument(
        "--synthetic",
        action="store_true",
        help="Use synthetic structures instead of WBM data",
    )

    return parser.parse_args()


def main() -> None:
    """Run the large-scale benchmark."""
    args = parse_args()

    # Build config
    n_structures = 1000 if args.quick else args.n_structures

    config = BenchmarkConfig(
        n_structures=n_structures,
        n_warmup_runs=args.warmup,
        n_timed_runs=args.runs,
        random_seed=args.seed,
        output_json_path=None if args.no_save else args.output,
        export_plots=args.export_plots,
        verbose=not args.quiet,
        quick=args.quick,
    )

    print("=" * 70)
    print("LARGE-SCALE ferrox vs PYMATGEN BENCHMARK")
    print("=" * 70)
    print("\nConfiguration:")
    print(f"  Max structures: {config.n_structures:,}")
    print(f"  Warmup runs: {config.n_warmup_runs}")
    print(f"  Timed runs: {config.n_timed_runs}")
    print(f"  Random seed: {config.random_seed}")
    print(f"  Quick mode: {config.quick}")

    # Load structures
    if args.synthetic:
        structures = generate_synthetic_structures(
            config.n_structures, seed=config.random_seed, verbose=config.verbose
        )
    else:
        structures = load_wbm_structures(
            limit=config.n_structures, verbose=config.verbose
        )

    if not structures:
        print("ERROR: No structures loaded!")
        sys.exit(1)

    # Compute and display statistics
    stats = compute_structure_stats(structures)
    print("\nStructure Statistics:")
    print(f"  Total structures: {stats.n_structures:,}")
    print(f"  Average atoms: {stats.avg_atoms:.1f}")
    print(f"  Min/Max atoms: {stats.min_atoms}/{stats.max_atoms}")
    print(f"  Size distribution: {stats.atom_count_distribution}")

    # Convert to JSON for ferrox
    json_structures = convert_structures_to_json(structures, verbose=config.verbose)

    # Run benchmarks
    all_results: list[ComparisonResult] = []

    # 1. Deduplication benchmark
    dedup_results = benchmark_deduplication(structures, json_structures, config)
    all_results.extend(dedup_results)

    # 2. Pairwise fit benchmark
    pairwise_results = benchmark_pairwise_fit(structures, json_structures, config)
    all_results.extend(pairwise_results)

    # 3. Group structures scaling benchmark
    group_results = benchmark_group_structures_scaling(
        structures, json_structures, config
    )
    all_results.extend(group_results)

    # 4. Structure size benchmark
    if not config.quick:
        size_results = benchmark_by_structure_size(structures, json_structures, config)
        all_results.extend(size_results)

    # Print summary
    print_summary_table(all_results)

    # Save results
    if config.output_json_path:
        save_results_json(all_results, config.output_json_path)

    # Generate plots
    if config.export_plots:
        create_plots(all_results)

    print("\nBenchmark complete!")


if __name__ == "__main__":
    main()
