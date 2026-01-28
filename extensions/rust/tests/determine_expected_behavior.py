"""Verify ferrox matches pymatgen's StructureMatcher on edge cases.

This test suite documents and verifies expected behavior for edge cases that
are easy to get wrong. Each test:
1. Explains WHY the result should be True/False based on algorithm details
2. Verifies both pymatgen and ferrox agree
3. Catches regressions if either implementation changes

Run with: pytest tests/determine_expected_behavior.py -v
Or standalone: python tests/determine_expected_behavior.py

These tests complement the larger test_pymatgen_compat.py suite by focusing on
specific edge cases with detailed explanations.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass

import pytest
from pymatgen.analysis.structure_matcher import ElementComparator
from pymatgen.analysis.structure_matcher import StructureMatcher as PyMatcher
from pymatgen.core import Lattice, Species, Structure

# Try importing ferrox - tests will be skipped if not installed
try:
    from ferrox import StructureMatcher as RustMatcher

    FERROX_AVAILABLE = True
except ImportError:
    FERROX_AVAILABLE = False
    RustMatcher = None  # type: ignore[assignment, misc]


# Structure Factories


def make_cubic(element: str, a: float) -> Structure:
    """Create simple cubic structure with one atom at origin."""
    return Structure(Lattice.cubic(a), [element], [[0, 0, 0]])


def make_bcc(element: str, a: float) -> Structure:
    """Create BCC structure."""
    return Structure(Lattice.cubic(a), [element, element], [[0, 0, 0], [0.5, 0.5, 0.5]])


def make_fcc(element: str, a: float) -> Structure:
    """Create FCC structure (conventional cell, 4 atoms)."""
    return Structure(
        Lattice.cubic(a),
        [element] * 4,
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )


def make_rocksalt(cation: str, anion: str, a: float) -> Structure:
    """Create rocksalt structure (NaCl type)."""
    return Structure(Lattice.cubic(a), [cation, anion], [[0, 0, 0], [0.5, 0.5, 0.5]])


# Test Result Container


@dataclass
class MatchResult:
    """Result of comparing pymatgen and ferrox."""

    pymatgen: bool
    ferrox: bool | None  # None if ferrox not available
    agree: bool

    @classmethod
    def compare(
        cls,
        s1: Structure,
        s2: Structure,
        py_matcher: PyMatcher,
        rust_matcher: RustMatcher | None,
    ) -> MatchResult:
        """Compare pymatgen and ferrox results."""
        py_result = py_matcher.fit(s1, s2)

        if rust_matcher is not None:
            json1 = json.dumps(s1.as_dict())
            json2 = json.dumps(s2.as_dict())
            rust_result = rust_matcher.fit(json1, json2)
            return cls(
                pymatgen=py_result, ferrox=rust_result, agree=py_result == rust_result
            )
        return cls(pymatgen=py_result, ferrox=None, agree=True)


# Matcher Fixtures


@pytest.fixture
def py_matcher() -> PyMatcher:
    """Pymatgen matcher with primitive_cell=False for fair comparison.

    We disable primitive cell reduction because ferrox's implementation
    may produce different (but equivalent) primitive cells, causing
    false mismatches in these compatibility tests.
    """
    return PyMatcher(ltol=0.2, stol=0.3, angle_tol=5.0, primitive_cell=False)


@pytest.fixture
def py_matcher_no_scale() -> PyMatcher:
    """Pymatgen matcher with scale=False."""
    return PyMatcher(
        ltol=0.2, stol=0.3, angle_tol=5.0, primitive_cell=False, scale=False
    )


@pytest.fixture
def rust_matcher() -> RustMatcher | None:
    """Ferrox matcher (None if not installed)."""
    if FERROX_AVAILABLE:
        return RustMatcher(latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0)
    return None


@pytest.fixture
def rust_matcher_no_scale() -> RustMatcher | None:
    """Ferrox matcher with scale=False (None if not installed)."""
    if FERROX_AVAILABLE:
        return RustMatcher(
            latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0, scale=False
        )
    return None


# Lattice Tolerance Tests
#
# The ltol parameter defines allowed lattice length ratios.
# With ltol=0.2, the allowed range is (1/(1+ltol), 1+ltol) = (0.833, 1.2).
# This is an ASYMMETRIC range:
# - Smaller lattice: ratio > 0.833 (17% smaller allowed)
# - Larger lattice: ratio < 1.2 (20% larger allowed)


@pytest.mark.parametrize(
    ("a1", "a2", "expected", "reason"),
    [
        # Inside tolerance
        (4.0, 4.0, True, "identical"),
        (4.0, 4.0 * 1.033, True, "3.3% larger, ratio=1.033 inside (0.833, 1.2)"),
        (4.0, 4.0 * 1.15, True, "15% larger, ratio=1.15 inside (0.833, 1.2)"),
        (4.0, 4.0 * 0.85, True, "15% smaller, ratio=0.85 inside (0.833, 1.2)"),
        # Outside tolerance
        (4.0, 5.0, False, "25% larger, ratio=1.25 outside (0.833, 1.2)"),
        (4.0, 3.0, False, "25% smaller, ratio=0.75 outside (0.833, 1.2)"),
        # Boundary cases (exclusive, so exact boundary should fail)
        (4.0, 4.0 * 1.2, False, "exact upper bound 1.2 (exclusive)"),
        (4.0, 4.0 / 1.2, False, "exact lower bound 0.833 (exclusive)"),
    ],
)
def test_ltol_boundaries(
    py_matcher_no_scale: PyMatcher,
    rust_matcher_no_scale: RustMatcher | None,
    a1: float,
    a2: float,
    expected: bool,
    reason: str,
) -> None:
    """Test lattice tolerance boundaries with scale=False."""
    s1 = make_cubic("Fe", a1)
    s2 = make_cubic("Fe", a2)

    result = MatchResult.compare(s1, s2, py_matcher_no_scale, rust_matcher_no_scale)

    assert result.pymatgen == expected, f"pymatgen: {reason}"
    if result.ferrox is not None:
        assert result.agree, f"ferrox disagrees with pymatgen: {reason}"


# Site Order Invariance Tests
#
# The Hungarian algorithm should find optimal site assignment regardless
# of the order atoms appear in the structure definition.


def test_shuffled_sites_rocksalt(
    py_matcher: PyMatcher,
    rust_matcher: RustMatcher | None,
) -> None:
    """NaCl with swapped atom order should still match."""
    s1 = make_rocksalt("Na", "Cl", 5.64)
    s2 = Structure(
        Lattice.cubic(5.64),
        ["Cl", "Na"],
        [[0.5, 0.5, 0.5], [0.0, 0.0, 0.0]],
    )

    result = MatchResult.compare(s1, s2, py_matcher, rust_matcher)

    assert result.pymatgen, "Hungarian algorithm should find correct assignment"
    if result.ferrox is not None:
        assert result.agree, "ferrox should match pymatgen"


def test_shuffled_sites_fcc(
    py_matcher: PyMatcher,
    rust_matcher: RustMatcher | None,
) -> None:
    """FCC with shuffled site order should still match."""
    s1 = make_fcc("Cu", 3.6)
    s2 = Structure(
        Lattice.cubic(3.6),
        ["Cu"] * 4,
        [[0, 0.5, 0.5], [0.5, 0, 0.5], [0, 0, 0], [0.5, 0.5, 0]],
    )

    result = MatchResult.compare(s1, s2, py_matcher, rust_matcher)

    assert result.pymatgen, "shuffled FCC sites should still match"
    if result.ferrox is not None:
        assert result.agree


# Volume Scaling Tests
#
# With scale=True (default), structures are normalized by volume before
# comparison, so differently-sized versions of the same structure match.
# With scale=False, volume differences within ltol still match.


def test_scale_true_large_difference(
    py_matcher: PyMatcher,
    rust_matcher: RustMatcher | None,
) -> None:
    """With scale=True, even large volume differences should match."""
    s1 = make_cubic("Fe", 4.0)
    s2 = make_cubic("Fe", 8.0)  # 8x volume

    result = MatchResult.compare(s1, s2, py_matcher, rust_matcher)

    assert result.pymatgen, "scale=True normalizes volume"
    if result.ferrox is not None:
        assert result.agree


def test_scale_false_within_tolerance(
    py_matcher_no_scale: PyMatcher,
    rust_matcher_no_scale: RustMatcher | None,
) -> None:
    """With scale=False, small volume differences within ltol should match."""
    s1 = make_cubic("Fe", 4.0)
    s2 = make_cubic("Fe", 4.0 * 1.033)  # ~10% volume, ratio=1.033 inside ltol

    result = MatchResult.compare(s1, s2, py_matcher_no_scale, rust_matcher_no_scale)

    assert result.pymatgen, "ratio 1.033 inside (0.833, 1.2)"
    if result.ferrox is not None:
        assert result.agree


def test_scale_false_outside_tolerance(
    py_matcher_no_scale: PyMatcher,
    rust_matcher_no_scale: RustMatcher | None,
) -> None:
    """With scale=False, large volume differences outside ltol should NOT match."""
    s1 = make_cubic("Fe", 4.0)
    s2 = make_cubic("Fe", 5.0)  # ratio=1.25 outside ltol

    result = MatchResult.compare(s1, s2, py_matcher_no_scale, rust_matcher_no_scale)

    assert not result.pymatgen, "ratio 1.25 outside (0.833, 1.2)"
    if result.ferrox is not None:
        assert result.agree


# Origin Shift Tests
#
# Fractional coordinate origin is arbitrary - shifting all atoms by the
# same vector should produce an equivalent structure.


@pytest.mark.parametrize(
    "shift",
    [
        [0.5, 0.0, 0.0],
        [0.0, 0.5, 0.0],
        [0.0, 0.0, 0.5],
        [0.5, 0.5, 0.5],
        [0.25, 0.25, 0.25],
        [0.1, 0.2, 0.3],
    ],
)
def test_origin_shift(
    py_matcher: PyMatcher,
    rust_matcher: RustMatcher | None,
    shift: list[float],
) -> None:
    """Structures with shifted origin should match."""
    s1 = make_cubic("Fe", 4.0)
    s2 = Structure(
        Lattice.cubic(4.0),
        ["Fe"],
        [[shift[0] % 1, shift[1] % 1, shift[2] % 1]],
    )

    result = MatchResult.compare(s1, s2, py_matcher, rust_matcher)

    assert result.pymatgen, f"origin shift {shift} should match"
    if result.ferrox is not None:
        assert result.agree


# Oxidation State Tests
#
# SpeciesComparator (default): Fe2+ != Fe3+
# ElementComparator: Fe2+ == Fe3+ (oxidation state ignored)


def test_species_comparator_different_oxi() -> None:
    """SpeciesComparator should NOT match different oxidation states."""
    lattice = Lattice.cubic(5.0)
    s_fe2 = Structure(lattice, [Species("Fe", 2)], [[0, 0, 0]])
    s_fe3 = Structure(lattice, [Species("Fe", 3)], [[0, 0, 0]])

    matcher = PyMatcher(ltol=0.2, stol=0.3, angle_tol=5.0, primitive_cell=False)
    assert not matcher.fit(s_fe2, s_fe3), "Fe2+ != Fe3+ with SpeciesComparator"

    if FERROX_AVAILABLE:
        rust_matcher = RustMatcher(
            latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0, comparator="species"
        )
        json1 = json.dumps(s_fe2.as_dict())
        json2 = json.dumps(s_fe3.as_dict())
        assert not rust_matcher.fit(json1, json2)


def test_element_comparator_different_oxi() -> None:
    """ElementComparator SHOULD match different oxidation states."""
    lattice = Lattice.cubic(5.0)
    s_fe2 = Structure(lattice, [Species("Fe", 2)], [[0, 0, 0]])
    s_fe3 = Structure(lattice, [Species("Fe", 3)], [[0, 0, 0]])

    matcher = PyMatcher(
        ltol=0.2,
        stol=0.3,
        angle_tol=5.0,
        primitive_cell=False,
        comparator=ElementComparator(),
    )
    assert matcher.fit(s_fe2, s_fe3), "Fe2+ == Fe3+ with ElementComparator"

    if FERROX_AVAILABLE:
        rust_matcher = RustMatcher(
            latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0, comparator="element"
        )
        json1 = json.dumps(s_fe2.as_dict())
        json2 = json.dumps(s_fe3.as_dict())
        assert rust_matcher.fit(json1, json2)


# Non-Matching Tests


def test_different_elements(
    py_matcher: PyMatcher,
    rust_matcher: RustMatcher | None,
) -> None:
    """Different elements should never match."""
    s1 = make_cubic("Fe", 4.0)
    s2 = make_cubic("Cu", 4.0)

    result = MatchResult.compare(s1, s2, py_matcher, rust_matcher)

    assert not result.pymatgen, "Fe != Cu"
    if result.ferrox is not None:
        assert result.agree


def test_different_compositions(
    py_matcher: PyMatcher,
    rust_matcher: RustMatcher | None,
) -> None:
    """Different compositions should never match."""
    s1 = make_bcc("Fe", 2.87)
    s2 = make_rocksalt("Fe", "O", 4.3)

    result = MatchResult.compare(s1, s2, py_matcher, rust_matcher)

    assert not result.pymatgen, "Fe2 != FeO"
    if result.ferrox is not None:
        assert result.agree


def test_different_structure_types() -> None:
    """Same element but different crystal structure should not match."""
    s1 = make_bcc("Fe", 2.87)
    s2 = make_fcc("Fe", 3.6)

    matcher = PyMatcher(
        ltol=0.2,
        stol=0.3,
        angle_tol=5.0,
        primitive_cell=False,
        attempt_supercell=False,
    )

    assert not matcher.fit(s1, s2), "BCC (2 atoms) != FCC (4 atoms)"


# Standalone Execution


def print_summary() -> None:
    """Print summary when run as standalone script."""
    print("=" * 70)
    print("FERROX vs PYMATGEN EDGE CASE VERIFICATION")
    print("=" * 70)

    if not FERROX_AVAILABLE:
        print("\nWARNING: ferrox not installed - only testing pymatgen behavior")
        print("Install with: cd extensions/rust && maturin develop --features python")

    test_cases: list[tuple[str, Structure, Structure, PyMatcher, bool, str]] = []

    # Build test cases
    py_default = PyMatcher(ltol=0.2, stol=0.3, angle_tol=5.0, primitive_cell=False)
    py_no_scale = PyMatcher(
        ltol=0.2, stol=0.3, angle_tol=5.0, primitive_cell=False, scale=False
    )

    # Lattice tolerance
    test_cases.append(
        (
            "ltol: 25% larger (outside)",
            make_cubic("Fe", 4.0),
            make_cubic("Fe", 5.0),
            py_no_scale,
            False,
            "ratio 1.25 outside (0.833, 1.2)",
        )
    )
    test_cases.append(
        (
            "ltol: 3.3% larger (inside)",
            make_cubic("Fe", 4.0),
            make_cubic("Fe", 4.132),
            py_no_scale,
            True,
            "ratio 1.033 inside (0.833, 1.2)",
        )
    )

    # Shuffled sites
    s1_nacl = make_rocksalt("Na", "Cl", 5.64)
    s2_shuffled = Structure(
        Lattice.cubic(5.64),
        ["Cl", "Na"],
        [[0.5, 0.5, 0.5], [0.0, 0.0, 0.0]],
    )
    test_cases.append(
        (
            "shuffled sites: NaCl",
            s1_nacl,
            s2_shuffled,
            py_default,
            True,
            "Hungarian algorithm finds correct assignment",
        )
    )

    # Run and print
    print("\nTest Results:")
    print("-" * 70)

    rust_default = (
        RustMatcher(latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0)
        if FERROX_AVAILABLE
        else None
    )
    rust_no_scale = (
        RustMatcher(latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0, scale=False)
        if FERROX_AVAILABLE
        else None
    )

    all_pass = True
    for name, struct_a, struct_b, py_m, expected, reason in test_cases:
        rust_m = rust_no_scale if py_m.scale is False else rust_default
        result = MatchResult.compare(struct_a, struct_b, py_m, rust_m)

        py_ok = result.pymatgen == expected
        rust_ok = result.ferrox == expected if result.ferrox is not None else True
        status = "PASS" if (py_ok and rust_ok) else "FAIL"

        if status == "FAIL":
            all_pass = False

        ferrox_str = str(result.ferrox) if result.ferrox is not None else "N/A"
        print(f"{status}: {name}")
        print(
            f"      Expected: {expected} | pymatgen: {result.pymatgen} | ferrox: {ferrox_str}"
        )
        print(f"      Reason: {reason}")
        print()

    print("=" * 70)
    if all_pass:
        print("All edge case tests PASSED")
    else:
        print("Some tests FAILED - check output above")
    print("=" * 70)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--pytest":
        sys.exit(pytest.main([__file__, "-v"]))
    else:
        print_summary()
