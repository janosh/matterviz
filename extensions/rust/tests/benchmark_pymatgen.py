"""Benchmark ferrox vs pymatgen StructureMatcher on real structure files.

This script loads structures from matterviz and pymatgen test files and benchmarks
compatibility and performance. For unit tests, use pytest on test_pymatgen_compat.py.

Usage:
    python tests/benchmark_pymatgen.py              # Full benchmark
    python tests/benchmark_pymatgen.py --quick      # Quick synthetic-only benchmark
"""

from __future__ import annotations

import argparse
import gzip
import json
import time
import warnings
from collections import defaultdict

from pymatgen.analysis.structure_matcher import StructureMatcher as PyMatcher
from pymatgen.core import Structure
from test_pymatgen_compat import (
    BASE_STRUCTURES,
    MATTERVIZ_STRUCTURES_DIR,
    PYMATGEN_CIF_DIR,
    make_rocksalt,
    perturb,
    scale_lattice,
    shuffle_sites,
    strain_lattice,
    translate,
)

try:
    from ferrox import StructureMatcher as RustMatcher
except ImportError:
    print("ERROR: ferrox not installed. Run: maturin develop --features python")
    raise SystemExit(1)


def load_matterviz_structures() -> dict[str, Structure]:
    """Load JSON structures from matterviz."""
    structures = {}
    if not MATTERVIZ_STRUCTURES_DIR.exists():
        return structures

    for json_file in MATTERVIZ_STRUCTURES_DIR.glob("*.json"):
        try:
            data = json.loads(json_file.read_text())
            if data.get("@class") == "Structure":
                structures[json_file.stem] = Structure.from_dict(data)
        except Exception as exc:
            warnings.warn(f"Failed to load {json_file.stem}: {exc}", stacklevel=2)

    for gz_file in MATTERVIZ_STRUCTURES_DIR.glob("*.json.gz"):
        try:
            with gzip.open(gz_file, "rt") as fh:
                data = json.load(fh)
            if data.get("@class") == "Structure":
                structures[gz_file.stem.replace(".json", "")] = Structure.from_dict(
                    data
                )
        except Exception as exc:
            warnings.warn(f"Failed to load {gz_file.stem}: {exc}", stacklevel=2)

    return structures


def load_pymatgen_cif_structures() -> dict[str, Structure]:
    """Load CIF structures from pymatgen test files."""
    structures = {}
    if not PYMATGEN_CIF_DIR.exists():
        return structures

    for cif_file in PYMATGEN_CIF_DIR.glob("*.cif"):
        try:
            structures[cif_file.stem] = Structure.from_file(str(cif_file))
        except Exception as exc:
            warnings.warn(f"Failed to load {cif_file.stem}: {exc}", stacklevel=2)

    return structures


def benchmark(quick: bool = False) -> None:
    """Run compatibility benchmark."""
    print("=" * 70)
    print("FERROX vs PYMATGEN COMPATIBILITY BENCHMARK")
    print("=" * 70)

    py_matcher = PyMatcher(ltol=0.2, stol=0.3, angle_tol=5.0, primitive_cell=False)
    rust_matcher = RustMatcher(
        latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0, primitive_cell=False
    )

    results: dict[str, list[tuple[str, bool, bool]]] = defaultdict(list)

    def compare(s1: Structure, s2: Structure, category: str, desc: str) -> None:
        """Compare and record result."""
        try:
            py_result = bool(py_matcher.fit(s1, s2))
            rust_result = rust_matcher.fit(
                json.dumps(s1.as_dict()), json.dumps(s2.as_dict())
            )
            results[category].append((desc, py_result == rust_result, py_result))
        except Exception as exc:
            results[category].append((f"{desc}: {exc}", False, False))

    start = time.perf_counter()

    # Synthetic tests
    print("\nRunning synthetic structure tests...")
    for name, struct in BASE_STRUCTURES:
        compare(struct, struct, "self-match", name)
        compare(struct, perturb(struct, 0.02), "perturb", f"{name} ±0.02")
        compare(struct, scale_lattice(struct, 1.02), "scale", f"{name} ×1.02")
        compare(struct, strain_lattice(struct, 0.01), "strain", f"{name} +1%")

    nacl = make_rocksalt("Na", "Cl", 5.64)
    compare(nacl, shuffle_sites(nacl), "shuffle", "NaCl shuffled")
    compare(nacl, translate(nacl, [0.25, 0.25, 0.25]), "translate", "NaCl +0.25")

    if not quick:
        # Load real structures
        print("\nLoading structures...")
        matterviz = load_matterviz_structures()
        print(f"  matterviz: {len(matterviz)} structures")
        cif = load_pymatgen_cif_structures()
        print(f"  pymatgen CIF: {len(cif)} structures")

        all_structures = {**matterviz, **cif}

        # Self-matching
        print("\nRunning self-matching tests...")
        for name, struct in all_structures.items():
            compare(struct, struct, "file-self", name)

        # Cross-file comparisons (limited)
        print("\nRunning cross-file comparisons...")
        items = list(all_structures.items())[:20]
        for idx, (name1, s1) in enumerate(items):
            for name2, s2 in items[idx + 1 :]:
                compare(s1, s2, "cross-file", f"{name1} vs {name2}")

    elapsed = time.perf_counter() - start

    # Print summary
    print("\n" + "=" * 70)
    print("RESULTS")
    print("=" * 70)

    total_tests = 0
    total_passed = 0
    for category, cat_results in sorted(results.items()):
        passed = sum(1 for _, match, _ in cat_results if match)
        total = len(cat_results)
        total_tests += total
        total_passed += passed
        status = "✓" if passed == total else "✗"
        print(f"  {status} {category}: {passed}/{total}")

    pct = 100 * total_passed / total_tests if total_tests else 0.0
    print(f"\nTotal: {total_passed}/{total_tests} ({pct:.1f}%)")
    print(f"Time: {elapsed:.2f}s")

    # Show failures
    failures = [
        (cat, desc)
        for cat, cat_results in results.items()
        for desc, match, _ in cat_results
        if not match
    ]
    if failures:
        print(f"\nFailures ({len(failures)}):")
        for cat, desc in failures[:10]:
            print(f"  [{cat}] {desc}")
        if len(failures) > 10:
            print(f"  ... and {len(failures) - 10} more")
        raise SystemExit(1)

    print("\n✓ All tests passed - ferrox matches pymatgen exactly")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--quick", action="store_true", help="Quick synthetic-only benchmark"
    )
    args = parser.parse_args()
    benchmark(quick=args.quick)
